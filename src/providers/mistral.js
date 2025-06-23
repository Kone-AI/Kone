// mistral.js - Mistral AI provider implementation
import Provider from './base.js';

class MistralProvider extends Provider {
    #keyStates = new Map();
    #keyRotationDelay = 60000; // 1 minute cooldown

    constructor() {
        // Initialize with default model configurations
        super({
            models: {
                'mistral-small-latest': {
                    display_name: 'Mistral-Small-Latest',
                    context_length: 32768,
                    pricing: { prompt: 0.0002, completion: 0.0002 },
                    fallback: 'mistral-small-2402'
                },
                'mistral-small-2402': {
                    display_name: 'Mistral-Small-2402',
                    context_length: 32768,
                    pricing: { prompt: 0.0002, completion: 0.0002 },
                    fallback: 'mistral-small-2312'
                },
                'mistral-small-2312': {
                    display_name: 'Mistral-Small-2312',
                    context_length: 32768,
                    pricing: { prompt: 0.0002, completion: 0.0002 },
                    fallback: 'mistral-medium-latest'
                },
                'mistral-medium-latest': {
                    display_name: 'Mistral-Medium-Latest',
                    context_length: 32768,
                    pricing: { prompt: 0.0006, completion: 0.0006 },
                    fallback: 'mistral-medium-2402'
                },
                'mistral-medium-2402': {
                    display_name: 'Mistral-Medium-2402',
                    context_length: 32768,
                    pricing: { prompt: 0.0006, completion: 0.0006 },
                    fallback: 'mistral-medium-2312'
                },
                'mistral-medium-2312': {
                    display_name: 'Mistral-Medium-2312',
                    context_length: 32768,
                    pricing: { prompt: 0.0006, completion: 0.0006 },
                    fallback: 'mistral-large-latest'
                },
                'mistral-large-latest': {
                    display_name: 'Mistral-Large-Latest',
                    context_length: 32768,
                    pricing: { prompt: 0.0024, completion: 0.0024 },
                    fallback: 'mistral-large-2402'
                },
                'mistral-large-2402': {
                    display_name: 'Mistral-Large-2402',
                    context_length: 32768,
                    pricing: { prompt: 0.0024, completion: 0.0024 },
                    fallback: 'mistral-large-2312'
                },
                'mistral-large-2312': {
                    display_name: 'Mistral-Large-2312',
                    context_length: 32768,
                    pricing: { prompt: 0.0024, completion: 0.0024 },
                    fallback: null
                }
            }
        });

        this.enabled = process.env.ENABLE_MISTRAL !== 'false';
        this.supportsStreaming = true;

        // Setup API keys
        if (process.env.MISTRAL_API_KEY) {
            this.#keyStates.set(process.env.MISTRAL_API_KEY, { lastError: null });
        }
        if (process.env.MISTRAL_BACKUP_KEY_1) {
            this.#keyStates.set(process.env.MISTRAL_BACKUP_KEY_1, { lastError: null });
        }
        if (process.env.MISTRAL_BACKUP_KEY_2) {
            this.#keyStates.set(process.env.MISTRAL_BACKUP_KEY_2, { lastError: null });
        }
    }

    async chat(messages, options = {}) {
        if (!this.enabled) {
            throw new Error('Mistral provider not enabled');
        }

        if (!Array.isArray(messages) || messages.length === 0) {
            throw new Error('messages must be a non-empty array');
        }

        const { model = 'mistral-small-latest', stream, temperature, max_tokens } = options;

        // Validate model
        if (!this.config.models[model]) {
            throw new Error(`Model ${model} not supported`);
        }

        // Handle rate limits and errors
        for (const [key, state] of this.#keyStates) {
            if (state.lastError) {
                const timeSinceError = Date.now() - state.lastError.timestamp;
                if (timeSinceError < this.#keyRotationDelay) {
                    continue; // Skip this key if it's still in cooldown
                }
                state.lastError = null; // Reset error state after cooldown
            }

            try {
                // Make API request
                const response = await this.makeRequest(key, messages, {
                    model,
                    stream,
                    temperature,
                    max_tokens
                });

                return response;

            } catch (error) {
                // Handle rate limits and quota errors
                if (error.status === 429 || error.message?.includes('quota')) {
                    state.lastError = {
                        error,
                        timestamp: Date.now()
                    };
                    continue; // Try next key
                }
                throw error; // Re-throw other errors
            }
        }

        throw new Error('All API keys exhausted or rate limited');
    }

    async makeRequest(apiKey, messages, options) {
        // Implementation of actual API request
        throw new Error('Not implemented');
    }
}

export default MistralProvider;