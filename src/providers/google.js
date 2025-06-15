import BaseProvider from './base.js';

// google provider implementation of the openai-compatible api
class GoogleProvider extends BaseProvider {
    #keyStates = new Map();
    #keyRotationDelay = 60000; // 1 minute cooldown

    constructor() {
        const defaultModels = [
            {
                id: 'models/gemini-1.5-pro-latest',
                name: 'Gemini 1.5 Pro Latest',
                contextLength: 2000000,
                pricing: { prompt: 0.0005, completion: 0.0005 }
            },
            {
                id: 'models/gemini-1.5-pro-001',
                name: 'Gemini 1.5 Pro 001',
                contextLength: 2000000,
                pricing: { prompt: 0.0005, completion: 0.0005 }
            },
            {
                id: 'models/gemini-pro-vision',
                name: 'Gemini Pro Vision',
                contextLength: 12288,
                pricing: { prompt: 0.001, completion: 0.001 }
            }
        ];

        super({
            name: 'GoogleProvider',
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
            apiKeyRequired: true,
            supportsStreaming: true,
            models: defaultModels
        });

        this.models = new Map(defaultModels.map(m => [m.id, m]));
        
        // load configuration
        this.enabled = process.env.ENABLE_GOOGLE !== 'false';
        this.primaryKey = process.env.GOOGLE_API_KEY;
        this.backupKey1 = process.env.GOOGLE_BACKUP_KEY_1;
        this.backupKey2 = process.env.GOOGLE_BACKUP_KEY_2;
        this.lastUpdate = 0;
        this.updateInterval = 5 * 60 * 1000; // 5 minutes

        // initialize key states
        [this.primaryKey, this.backupKey1, this.backupKey2].forEach(key => {
            if (key) {
                this.#keyStates.set(key, {
                    lastError: null,
                    errorCount: 0,
                    cooldownUntil: 0
                });
            }
        });

        // enable if any key is available
        this.enabled = this.enabled && (this.primaryKey || this.backupKey1 || this.backupKey2);

        if (this.enabled && process.env.DEBUG_MODE === 'true') {
            console.log('google initialized with keys:', {
                primaryKey: this.primaryKey ? '****' + this.primaryKey.slice(-4) : 'none',
                backupKey1: this.backupKey1 ? '****' + this.backupKey1.slice(-4) : 'none', 
                backupKey2: this.backupKey2 ? '****' + this.backupKey2.slice(-4) : 'none'
            });
        }
    }

    formatModelName(modelId) {
        if (modelId.startsWith('models/')) {
            return modelId;
        }
        return `models/${modelId}`;
    }

    getBaseModelName(model) {
        return model.replace(/^models\//, '');
    }

    async updateAvailableModels() {
        const now = Date.now();
        if (now - this.lastUpdate < this.updateInterval && this.models.size > 0) {
            return Array.from(this.models.keys());
        }
        try {
            // get models from the api
            const apiKey = this.getApiKey();
            const response = await fetch(`${this.baseURL}/models?key=${apiKey}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${data.error?.message || 'Unknown error'}`);
            }

            // only use gemini models that aren't embeddings
            const geminiModels = data.models.filter(m => 
                m.name.includes('gemini') && 
                !m.name.includes('embedding') && 
                !m.name.includes('exp')
            );

            for (const model of geminiModels) {
                this.models.set(model.name, {
                    id: model.name,
                    object: 'model',
                    created: Date.now(),
                    owned_by: 'google',
                    permission: [],
                    root: model.name,
                    parent: null,
                    context_length: model.inputTokenLimit
                });
            }

            this.lastUpdate = now;
            return Array.from(this.models.keys());
        } catch (error) {
            console.error('error fetching google models:', error);
            return [];
        }
    }

    async getModels() {
        if (!this.enabled) return [];
        
        await this.updateAvailableModels();
        return Array.from(this.models.values());
    }

    async canHandle(model) {
        if (!this.enabled) return false;

        try {
            const models = await this.updateAvailableModels();
            return models.includes(this.formatModelName(model));
        } catch {
            return false;
        }
    }

    getApiKey() {
        const now = Date.now();
        const availableKeys = Array.from(this.#keyStates.entries())
            .filter(([key, state]) => {
                // check if key is in cooldown
                if (state.cooldownUntil > now) {
                    return false;
                }
                // reset error count if enough time has passed
                if (state.lastError && (now - state.lastError) > this.#keyRotationDelay * 10) {
                    state.errorCount = 0;
                    state.lastError = null;
                }
                return true;
            })
            .map(([key]) => key);

        if (availableKeys.length === 0) {
            // if all keys are in cooldown, choose the one with shortest remaining cooldown
            const nextAvailableKey = Array.from(this.#keyStates.entries())
                .reduce((best, [key, state]) => {
                    if (!best || state.cooldownUntil < this.#keyStates.get(best).cooldownUntil) {
                        return key;
                    }
                    return best;
                }, null);

            if (nextAvailableKey) {
                // reset its state and return it
                this.#keyStates.get(nextAvailableKey).cooldownUntil = 0;
                return nextAvailableKey;
            }
        }

        // choose key with lowest error count
        return availableKeys.reduce((best, key) => {
            if (!best || this.#keyStates.get(key).errorCount < this.#keyStates.get(best).errorCount) {
                return key;
            }
            return best;
        }, availableKeys[0]);
    }

    markKeyError(key, error) {
        if (!key || !this.#keyStates.has(key)) return;

        const state = this.#keyStates.get(key);
        state.lastError = Date.now();
        state.errorCount++;

        // exponential backoff for repeated errors
        if (error.status === 429 || error.status === 403) {
            state.cooldownUntil = Date.now() + (Math.min(
                this.#keyRotationDelay * Math.pow(3, state.errorCount - 1), // use 3^n for more aggressive backoff
                1000 * 60 * 60 // max 1 hour cooldown
            ));
            
            // log rate limit in debug mode
            if (process.env.DEBUG_MODE === 'true') {
                console.log(`google api rate limited. key will be cooled down for ${Math.round((state.cooldownUntil - Date.now())/1000)} seconds.`);
            }
        }

        // log key rotation in debug mode
        if (process.env.DEBUG_MODE === 'true') {
            console.log('google api key error:', {
                key: '****' + key.slice(-4),
                error: error.message,
                errorCount: state.errorCount,
                cooldownUntil: new Date(state.cooldownUntil).toISOString()
            });
        }
    }

    supportsStreaming() {
        return true;
    }

    async chat(messages, options = {}) {
        if (!this.enabled) {
            throw new Error('google provider is not enabled');
        }

        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new Error('no api key available for google');
        }

        const model = this.getBaseModelName(options.model || 'gemini-pro');

        // prepare common payload parts
        const payload = {
            model,
            messages: this._prepareMessages(messages),
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens,
            stream: options.stream || false,
            stop: options.stop || []
        };

        if (options.stream) {
            return this._streamChat(apiKey, payload);
        } else {
            return this._nonStreamChat(apiKey, payload);
        }
    }

    // prepare messages, handling content types
    _prepareMessages(messages) {
        return messages.map(msg => {
            if (typeof msg.content === 'string') {
                return {
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    content: msg.content
                };
            }
            
            // handle array content (multimodal)
            if (Array.isArray(msg.content)) {
                const parts = msg.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'text', text: part.text };
                    }
                    if (part.type === 'image_url') {
                        return {
                            type: 'image',
                            image_url: part.image_url
                        };
                    }
                    return part; // pass through other types
                });

                return {
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    content: parts
                };
            }

            // fallback
            return {
                role: msg.role === 'assistant' ? 'model' : 'user',
                content: String(msg.content)
            };
        });
    }

    async _nonStreamChat(apiKey, payload) {
        try {
            const response = await fetch(`${this.baseURL}/chat/completions?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorJson = {};
                try { errorJson = JSON.parse(errorText); } catch { /* ignore parsing error */ }

                // handle rate limits/quota errors for key rotation
                if (response.status === 429 || (errorJson.error?.message?.includes('quota') || errorJson.error?.message?.includes('rate limit'))) {
                    this.markKeyError(apiKey, { status: response.status, message: errorJson.error?.message || errorText });

                    // try again with a different key if available
                    const newKey = this.getApiKey();
                    if (newKey && newKey !== apiKey) {
                        if (process.env.DEBUG_MODE === 'true') {
                            console.log('[google] retrying non-stream with new key due to rate limit/quota.');
                        }
                        return this.chat(payload.messages, { 
                            ...payload,
                            stream: false
                        });
                    }
                    throw new Error('all google api keys are rate limited or in cooldown.');
                }

                throw new Error(errorJson.error?.message || `google api error (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            if (!data.choices?.[0]?.message?.content) {
                if (data.choices?.[0]?.finish_reason === 'safety') {
                    throw new Error('response blocked by google safety filters.');
                }
                if (data.choices?.[0]?.finish_reason) {
                    throw new Error(`google api finished with reason: ${data.choices[0].finish_reason}`);
                }
                throw new Error('invalid response format from google api (non-stream)');
            }

            return {
                id: `gmn-${Date.now()}`,
                object: 'chat.completion',
                created: Date.now(),
                model: this.formatModelName(payload.model),
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: data.choices[0].message.content
                    },
                    finish_reason: data.choices[0].finish_reason
                }],
                usage: data.usage || {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };

        } catch (error) {
            console.error('google non-stream api error:', error);
            throw error;
        }
    }

    async* _streamChat(apiKey, payload) {
        try {
            const response = await fetch(`${this.baseURL}/chat/completions?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorJson = {};
                try { errorJson = JSON.parse(errorText); } catch { /* ignore */ }

                // handle rate limits/quota errors for key rotation
                if (response.status === 429 || (errorJson.error?.message?.includes('quota') || errorJson.error?.message?.includes('rate limit'))) {
                    this.markKeyError(apiKey, { status: response.status, message: errorJson.error?.message || errorText });

                    const newKey = this.getApiKey();
                    if (newKey && newKey !== apiKey) {
                        if (process.env.DEBUG_MODE === 'true') {
                            console.log('[google] retrying stream with new key due to rate limit/quota.');
                        }
                        yield* this.chat(payload.messages, {
                            ...payload,
                            stream: true
                        });
                        return;
                    }
                    throw new Error('all google api keys are rate limited or in cooldown.');
                }

                throw new Error(errorJson.error?.message || `google api stream error (${response.status}): ${errorText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const completionId = `gmn-str-${Date.now()}`;
            const created = Date.now();

            yield {
                id: completionId,
                object: 'chat.completion.chunk',
                created: created,
                model: this.formatModelName(payload.model),
                choices: [{
                    index: 0,
                    delta: { role: 'assistant', content: '' },
                    finish_reason: null
                }]
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep potential partial line

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataString = line.substring(6).trim();
                        try {
                            const chunk = JSON.parse(dataString);
                            const content = chunk.choices?.[0]?.delta?.content;
                            const finishReason = chunk.choices?.[0]?.finish_reason;

                            if (content) {
                                yield {
                                    id: completionId,
                                    object: 'chat.completion.chunk',
                                    created: created,
                                    model: this.formatModelName(payload.model),
                                    choices: [{
                                        index: 0,
                                        delta: { content },
                                        finish_reason: null
                                    }]
                                };
                            }

                            if (finishReason) {
                                yield {
                                    id: completionId,
                                    object: 'chat.completion.chunk',
                                    created: created,
                                    model: this.formatModelName(payload.model),
                                    choices: [{
                                        index: 0,
                                        delta: {},
                                        finish_reason: finishReason
                                    }]
                                };
                                return;
                            }
                        } catch (e) {
                            console.error('error parsing google stream chunk:', e, 'data:', dataString);
                        }
                    }
                }
            }

            yield {
                id: completionId,
                object: 'chat.completion.chunk',
                created: created,
                model: this.formatModelName(payload.model),
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                }]
            };

        } catch (error) {
            console.error('google stream api error:', error);
            throw error;
        }
    }
}

export default new GoogleProvider();