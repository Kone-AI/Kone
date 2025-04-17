// Google Provider
class GoogleProvider {
    constructor() {
        // Load configuration
        this.enabled = process.env.ENABLE_GOOGLE !== 'false';
        this.primaryKey = process.env.GOOGLE_API_KEY;
        this.backupKey1 = process.env.GOOGLE_API_KEY_BACKUP1;
        this.backupKey2 = process.env.GOOGLE_API_KEY_BACKUP2;
        this.models = new Map();
        this.lastUpdate = 0;
        this.updateInterval = 5 * 60 * 1000; // 5 minutes

        // Enable if any key is available
        this.enabled = this.enabled && (this.primaryKey || this.backupKey1 || this.backupKey2);

        if (this.enabled) {
            const keys = {
                primaryKey: this.primaryKey ? '****' + this.primaryKey.slice(-4) : 'none',
                backupKey1: this.backupKey1 ? '****' + this.backupKey1.slice(-4) : 'none',
                backupKey2: this.backupKey2 ? '****' + this.backupKey2.slice(-4) : 'none'
            };
            console.log('Google initialized with keys:', keys);
        }
    }

    formatModelName(modelId) {
        if (modelId.startsWith('google/')) {
            return modelId;
        }
        return `google/${modelId}`;
    }

    getBaseModelName(model) {
        return model.replace(/^google\//, '');
    }

    async updateAvailableModels() {
        const now = Date.now();
        if (now - this.lastUpdate < this.updateInterval && this.models.size > 0) {
            return Array.from(this.models.keys());
        }

        this.models.clear();

        try {
            const defaultModels = [
                // Gemini Pro models
                'gemini-1.5-pro-latest',
                'gemini-1.5-pro-001',
                'gemini-1.5-pro-002',
                'gemini-1.5-pro',
                
                // Gemini Ultra models
                'gemini-2.0-pro-exp',
                'gemini-2.0-pro-exp-02-05',
                'gemini-2.5-pro-exp-03-25',
                
                // Gemini Flash models (excluding vision variants)
                'gemini-2.0-flash-exp',
                'gemini-2.0-flash',
                'gemini-2.0-flash-001',
                'gemini-2.0-flash-lite-001',
                'gemini-2.0-flash-lite',
                'gemini-2.0-flash-lite-preview-02-05',
                'gemini-2.0-flash-lite-preview',
                
                // Gemma models
                'gemma-3-1b-it',
                'gemma-3-4b-it',
                'gemma-3-12b-it',
                'gemma-3-27b-it'
            ];

            for (const modelId of defaultModels) {
                const formattedId = this.formatModelName(modelId);
                this.models.set(formattedId, {
                    id: formattedId,
                    object: 'model',
                    created: Date.now(),
                    owned_by: 'https://deepmind.google',
                    permission: [],
                    root: modelId,
                    parent: null,
                    context_length: 32768
                });
            }

            this.lastUpdate = now;
            return Array.from(this.models.keys());
        } catch (error) {
            console.error('Error fetching Google models:', error);
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

    // track key states and rotation
    #keyStates = new Map();
    #keyRotationDelay = 60000; // 1 minute cooldown

    constructor() {
        super();
        // Initialize key states
        [this.primaryKey, this.backupKey1, this.backupKey2].forEach(key => {
            if (key) {
                this.#keyStates.set(key, {
                    lastError: null,
                    errorCount: 0,
                    cooldownUntil: 0
                });
            }
        });
    }

    getApiKey() {
        const now = Date.now();
        const availableKeys = Array.from(this.#keyStates.entries())
            .filter(([key, state]) => {
                // Check if key is in cooldown
                if (state.cooldownUntil > now) {
                    return false;
                }
                // Reset error count if enough time has passed
                if (state.lastError && (now - state.lastError) > this.#keyRotationDelay) {
                    state.errorCount = 0;
                    state.lastError = null;
                }
                return true;
            })
            .map(([key]) => key);

        if (availableKeys.length === 0) {
            // If all keys are in cooldown, choose the one with shortest remaining cooldown
            const nextAvailableKey = Array.from(this.#keyStates.entries())
                .reduce((best, [key, state]) => {
                    if (!best || state.cooldownUntil < this.#keyStates.get(best).cooldownUntil) {
                        return key;
                    }
                    return best;
                }, null);

            if (nextAvailableKey) {
                // Reset its state and return it
                this.#keyStates.get(nextAvailableKey).cooldownUntil = 0;
                return nextAvailableKey;
            }
        }

        // Choose key with lowest error count
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

        // Exponential backoff for repeated errors
        if (error.status === 429 || error.status === 403) {
            state.cooldownUntil = Date.now() + (Math.min(
                this.#keyRotationDelay * Math.pow(2, state.errorCount - 1),
                1000 * 60 * 60 // Max 1 hour cooldown
            ));
        }

        // Log key rotation in debug mode
        if (process.env.DEBUG_MODE === 'true') {
            console.log('Google API key error:', {
                key: '****' + key.slice(-4),
                error: error.message,
                errorCount: state.errorCount,
                cooldownUntil: new Date(state.cooldownUntil).toISOString()
            });
        }
    }

    async chat(messages, options = {}) {
        if (!this.enabled) {
            throw new Error('Google provider is not enabled');
        }

        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new Error('No API key available');
        }

        const model = this.getBaseModelName(options.model || 'gemini-pro');
        const temperature = options.temperature ?? 0.7;
        const maxTokens = options.max_tokens;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: messages.map(msg => ({
                        role: msg.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: msg.content }]
                    })),
                    generationConfig: {
                        temperature,
                        maxOutputTokens: maxTokens,
                        stopSequences: options.stop || []
                    },
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ]
                })
            });
if (!response.ok) {
    const error = await response.json();
    
    // silently handle rate limits by trying backup keys
    // Handle quota and rate limit errors
    if (error.error?.message?.includes('quota') || error.error?.message?.includes('rate limit')) {
        this.markKeyError(apiKey, error);
            
        // Try again with a different key
        const newKey = this.getApiKey();
        if (newKey && newKey !== apiKey) {
            if (process.env.DEBUG_MODE === 'true') {
                console.log('Retrying with new Google API key:', {
                    previousKey: '****' + apiKey.slice(-4),
                    newKey: '****' + newKey.slice(-4)
                });
            }
            return this.chat(messages, options);
        }
        
        // All keys exhausted
        throw new Error('All Google API keys are rate limited or in cooldown');
    }
                
                throw new Error(error.error?.message || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                throw new Error('Invalid response format from Google API');
            }

            return {
                id: `gmn-${Date.now()}`,
                object: 'chat.completion',
                created: Date.now(),
                model: this.formatModelName(model),
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: data.candidates[0].content.parts[0].text
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };

        } catch (error) {
            console.error('Google API error:', error);
            throw error;
        }
    }
}

export default new GoogleProvider();