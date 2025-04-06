// GLAMA API Provider
import OpenAI from 'openai';

class GlamaProvider {
    constructor() {
        this.enabled = process.env.ENABLE_GLAMA !== 'false';
        this.baseURL = 'https://glama.ai/api/gateway/openai/v1';
        this.modelsEndpoint = 'https://glama.ai/api/gateway/v1/models';
        this.apiKeys = [];
        this.models = new Map();
        this.lastUpdate = 0;
        this.updateInterval = 5 * 60 * 1000; // 5 minutes

        // Setup API keys
        if (process.env.GLAMA_API_KEY) {
            this.apiKeys.push({ key: process.env.GLAMA_API_KEY, isPrimary: true, lastError: null });
        }
        if (process.env.GLAMA_BACKUP_KEY_1) {
            this.apiKeys.push({ key: process.env.GLAMA_BACKUP_KEY_1, isPrimary: false, lastError: null });
        }
        if (process.env.GLAMA_BACKUP_KEY_2) {
            this.apiKeys.push({ key: process.env.GLAMA_BACKUP_KEY_2, isPrimary: false, lastError: null });
        }

        this.enabled = this.enabled && this.apiKeys.length > 0;
        this.activeKeyIndex = 0;

        this.supportsStreaming = true;
    }

    createClient(keyIndex = this.activeKeyIndex) {
        const key = this.apiKeys[keyIndex]?.key;
        if (!key) return null;

        return new OpenAI({
            apiKey: key,
            baseURL: this.baseURL,
            timeout: 30000
        });
    }

    formatModelName(modelId) {
        if (modelId.startsWith('glama/')) {
            return modelId;
        }
        return `glama/${modelId}`;
    }

    getBaseModelName(model) {
        return model.replace(/^glama\//, '');
    }

    async updateAvailableModels() {
        if (!this.enabled) return [];

        const now = Date.now();
        if (now - this.lastUpdate < this.updateInterval && this.models.size > 0) {
            return Array.from(this.models.keys());
        }

        try {
            const response = await fetch(this.modelsEndpoint);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const models = await response.json();
            this.models.clear();

            for (const model of models) {
                // Only include free models
                if (parseFloat(model.pricePerToken?.input || '1') > 0 || parseFloat(model.pricePerToken?.output || '1') > 0) {
                    continue;
                }

                // Check for text input/output capability
                const capabilities = model.capabilities || [];
                if (!capabilities.includes('input:text') || !capabilities.includes('output:text')) {
                    continue;
                }

                const formattedId = this.formatModelName(model.id);
                this.models.set(formattedId, {
                    id: formattedId,
                    object: 'model',
                    created: new Date(model.added).getTime(),
                    owned_by: 'https://glama.ai',
                    permission: [],
                    root: model.id,
                    parent: null,
                    context_length: model.maxTokensInput || 32768,
                    capabilities: {
                        text: true,
                        images: capabilities.includes('input:image') && capabilities.includes('output:image')
                    }
                });
            }

            this.lastUpdate = now;
            return Array.from(this.models.keys());
        } catch (error) {
            console.error('Failed to fetch GLAMA models:', error);
            return [];
        }
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

    async chat(messages, options = {}) {
        if (!this.enabled) {
            throw new Error('GLAMA provider is not enabled');
        }

        const client = this.createClient();
        if (!client) throw new Error('No API key available');

        const { model, stream } = options;
        const baseModel = this.getBaseModelName(model);

        try {
            const completion = await client.chat.completions.create({
                model: baseModel,
                messages,
                stream: Boolean(stream),
                temperature: options.temperature,
                max_tokens: options.max_tokens,
                top_p: options.top_p
            });

            if (stream) {
                return completion;
            }

            return {
                id: completion.id,
                object: 'chat.completion',
                created: completion.created,
                model: this.formatModelName(model),
                choices: completion.choices.map(choice => ({
                    index: choice.index,
                    message: {
                        role: 'assistant',
                        content: choice.message.content
                    },
                    finish_reason: choice.finish_reason
                })),
                usage: completion.usage
            };

        } catch (error) {
            console.error('GLAMA API error:', error);
            throw error;
        }
    }

    async getModels() {
        if (!this.enabled) return [];
        
        await this.updateAvailableModels();
        return Array.from(this.models.values());
    }
}

export default new GlamaProvider();