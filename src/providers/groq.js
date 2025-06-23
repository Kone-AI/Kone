// groq.js - Groq provider implementation
import Provider from './base.js';
import OpenAI from 'openai';
import logger from '../utils/logger.js';

class GroqProvider extends Provider {
    #apiKeys = [];
    #activeKeyIndex = 0;
    #keyRotationDelay = 60000; // 1 minute cooldown
    #client = null;

    constructor() {
        // Initialize with default model configurations
        super({
            models: {
                'allam-2-7b': {
                    display_name: 'Allam 2.7B',
                    context_length: 1024,
                    pricing: { prompt: 0.0001, completion: 0.0001 },
                    fallback: 'gemma2-9b-it'
                },
                'gemma2-9b-it': {
                    display_name: 'Gemma 2 9B',
                    context_length: 8192,
                    pricing: { prompt: 0.0002, completion: 0.0002 },
                    fallback: 'llama-3.1-8b-instant'
                },
                'llama-3.1-8b-instant': {
                    display_name: 'Llama 3.1 8B Instant',
                    context_length: 131072,
                    pricing: { prompt: 0.0002, completion: 0.0002 },
                    fallback: 'llama3-8b-8192'
                },
                'llama-3.3-70b-specdec': {
                    display_name: 'Llama 3.3 70B SpecDec',
                    context_length: 131072,
                    pricing: { prompt: 0.0007, completion: 0.0007 },
                    fallback: 'llama3-70b-8192'
                },
                'llama-3.3-70b-versatile': {
                    display_name: 'Llama 3.3 70B Versatile',
                    context_length: 131072,
                    pricing: { prompt: 0.0007, completion: 0.0007 },
                    fallback: 'llama3-70b-8192'
                },
                'llama-guard-3-8b': {
                    display_name: 'Llama Guard 3 8B',
                    context_length: 8192,
                    pricing: { prompt: 0.0002, completion: 0.0002 },
                    fallback: 'llama3-8b-8192'
                },
                'llama3-70b-8192': {
                    display_name: 'Llama 3 70B',
                    context_length: 131072,
                    pricing: { prompt: 0.0007, completion: 0.0007 },
                    fallback: null
                },
                'llama3-8b-8192': {
                    display_name: 'Llama 3 8B',
                    context_length: 131072,
                    pricing: { prompt: 0.0002, completion: 0.0002 },
                    fallback: null
                }
            }
        });
        
        // load configuration
        this.enabled = process.env.ENABLE_GROQ !== 'false';
        
        // setup api keys
        if (process.env.GROQ_API_KEY) {
            this.#apiKeys.push({ key: process.env.GROQ_API_KEY, lastError: null });
        }
        if (process.env.GROQ_BACKUP_KEY_1) {
            this.#apiKeys.push({ key: process.env.GROQ_BACKUP_KEY_1, lastError: null });
        }
        if (process.env.GROQ_BACKUP_KEY_2) {
            this.#apiKeys.push({ key: process.env.GROQ_BACKUP_KEY_2, lastError: null });
        }

        // enable if any key is available
        this.enabled = this.enabled && this.#apiKeys.length > 0;

        // Create OpenAI client for the active key
        this.#updateClient();

        if (this.enabled && process.env.DEBUG_MODE === 'true') {
            logger.debug('Groq initialized:', {
                primaryKey: this.#apiKeys[0]?.key ? '****' + this.#apiKeys[0].key.slice(-4) : 'none',
                backupKey1: this.#apiKeys[1]?.key ? '****' + this.#apiKeys[1].key.slice(-4) : 'none',
                backupKey2: this.#apiKeys[2]?.key ? '****' + this.#apiKeys[2].key.slice(-4) : 'none'
            });
        }
    }

    #updateClient() {
        const currentKey = this.#getActiveKey();
        if (currentKey) {
            this.#client = new OpenAI({
                apiKey: currentKey,
                baseURL: 'https://api.groq.com/openai/v1'
            });
        } else {
            this.#client = null;
        }
    }

    #getActiveKey() {
        const now = Date.now();
        for (let i = 0; i < this.#apiKeys.length; i++) {
            const keyIndex = (this.#activeKeyIndex + i) % this.#apiKeys.length;
            const keyInfo = this.#apiKeys[keyIndex];
            
            if (keyInfo.lastError && now - keyInfo.lastError < this.#keyRotationDelay) {
                continue;
            }
            
            this.#activeKeyIndex = keyIndex;
            return keyInfo.key;
        }
        return null;
    }

    #handleKeyError(error) {
        const keyInfo = this.#apiKeys[this.#activeKeyIndex];
        if (keyInfo) {
            if (error.status === 401 || error.status === 403) {
                keyInfo.lastError = Infinity;
            } else if (error.status === 429) {
                keyInfo.lastError = Date.now();
            }
        }
        this.#updateClient();
    }

    formatModelName(modelId) {
        return modelId.startsWith('groq/') ? modelId : `groq/${modelId}`;
    }

    getBaseModelName(model) {
        return model.replace(/^groq\//, '');
    }

    async chat(messages, options = {}) {
        if (!this.enabled) {
            throw new Error('Groq provider is not enabled');
        }

        if (!Array.isArray(messages) || messages.length === 0) {
            throw new Error('Messages must be a non-empty array');
        }

        const { model = 'llama3-70b-8192', stream, timeout, ...otherOptions } = options;
        const baseModel = this.getBaseModelName(model);

        if (!this.config.models[baseModel]) {
            throw {
                message: `Model not found: ${baseModel}`,
                type: 'invalid_request_error',
                code: 'model_not_found',
                param: 'model',
                status: 404,
                provider: this.constructor.name,
                details: {
                    available_models: Object.keys(this.config.models)
                }
            };
        }

        // Log model details in debug mode
        if (process.env.DEBUG_MODE === 'true') {
            logger.debug('Groq request details:', {
                provider: this.constructor.name,
                requested_model: model,
                base_model: baseModel,
                stream: Boolean(stream),
                active_key: this.#apiKeys[this.#activeKeyIndex]?.key ? '****' + this.#apiKeys[this.#activeKeyIndex].key.slice(-4) : 'none'
            });
        }

        // Try with all available keys
        for (let attempt = 0; attempt < this.#apiKeys.length; attempt++) {
            if (!this.#client) {
                throw new Error('No Groq API keys available');
            }

            try {
                // Sanitize options to only include supported fields
                const supportedOptions = {
                    model: baseModel,
                    messages,
                    stream,
                    temperature: otherOptions.temperature,
                    max_tokens: otherOptions.max_tokens,
                    top_p: otherOptions.top_p,
                    frequency_penalty: otherOptions.frequency_penalty,
                    presence_penalty: otherOptions.presence_penalty
                };

                const completion = await this.#client.chat.completions.create(supportedOptions);

                // Handle streaming
                if (stream) {
                    return this.#handleStream(completion, model);
                }

                // Add our model prefix to the response
                if (completion.model) {
                    completion.model = this.formatModelName(completion.model);
                }
                return completion;

            } catch (error) {
                // Enhanced error logging
                if (process.env.DEBUG_MODE === 'true') {
                    logger.error('Groq API error:', {
                        message: error.message,
                        status: error.status,
                        code: error.error?.code,
                        model: baseModel,
                        key_index: this.#activeKeyIndex,
                        response: error.response?.data
                    });
                }

                this.#handleKeyError(error);

                // Check for model terms error
                if (error?.error?.code === 'model_terms_required') {
                    delete this.config.models[baseModel];
                    throw new Error(`Model ${model} requires terms acceptance and has been disabled`);
                }

                // Try next key if rate limited
                if (error.status === 429 && attempt < this.#apiKeys.length - 1) {
                    if (process.env.DEBUG_MODE === 'true') {
                        logger.debug(`${this.constructor.name}: Retrying with backup key`);
                    }
                    continue;
                }

                // Check for decommissioned model error
                if (error?.error?.code === 'model_decommissioned') {
                    delete this.config.models[baseModel];
                    throw new Error(`Model ${model} has been decommissioned and is no longer available`);
                }

                // If rate limited and no more keys, try fallback model
                if (error.status === 429) {
                    const fallbackModel = this.getFallbackModel(baseModel);
                    if (fallbackModel) {
                        if (process.env.DEBUG_MODE === 'true') {
                            logger.debug(`[groq] trying fallback model ${fallbackModel}`);
                        }
                        return this.chat(messages, { ...options, model: fallbackModel });
                    }
                }

                throw error;
            }
        }

        throw new Error('All Groq API keys failed or were rate limited');
    }

    async *#handleStream(stream, model) {
        try {
            for await (const chunk of stream) {
                if (!chunk || !chunk.choices?.[0]?.delta) continue;
                
                // Add our model prefix
                if (chunk.model) {
                    chunk.model = this.formatModelName(chunk.model);
                }
                yield chunk;
            }
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                this.#handleKeyError(error);
                throw new Error('Unauthorized: check your API key');
            }
            if (error.status === 429) {
                this.#handleKeyError(error);
                throw new Error('Rate limit exceeded');
            }
            throw error;
        }
    }
}

export default new GroqProvider();