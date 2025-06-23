// hackclub.js - HackClub provider implementation
import Provider from './base.js';
import logger from '../utils/logger.js';

class HackClubProvider extends Provider {
    constructor() {
        // Initialize with default model configuration
        super({
            models: {
                'meta-llama/llama-4-maverick-17b-128e-instruct': {
                    display_name: 'Llama 4 Maverick',
                    context_length: 10000000,
                    pricing: { prompt: 0, completion: 0 },
                    fallback: null
                }
            }
        });

        this.baseUrl = 'https://ai.hackclub.com';
        this.enabled = true;
        this.lastModelCheck = 0;
        this.modelCheckInterval = 5 * 60 * 1000; // Check every 5 minutes
        this.currentModel = 'meta-llama/llama-4-maverick-17b-128e-instruct';
    }

    async getCurrentModel() {
        const now = Date.now();
        if (now - this.lastModelCheck < this.modelCheckInterval && 
            this.currentModel !== 'meta-llama/llama-4-maverick-17b-128e-instruct') {
            return this.currentModel;
        }

        try {
            logger.debug('[HackClub] Fetching current model');
            const response = await fetch(`${this.baseUrl}/model`);
            
            if (!response.ok) {
                logger.warn(`[HackClub] Failed to fetch model (${response.status}), using default`);
                return 'meta-llama/llama-4-maverick-17b-128e-instruct';
            }

            const modelId = await response.text();
            this.currentModel = modelId.trim();
            this.lastModelCheck = now;

            // Update models configuration with current model
            this.config.models = {
                [this.currentModel]: {
                    display_name: this.currentModel.split('/').pop(),
                    context_length: 10000000,
                    pricing: { prompt: 0, completion: 0 },
                    fallback: null
                }
            };

            logger.debug(`[HackClub] Current model: ${this.currentModel}`);
            return this.currentModel;
        } catch (error) {
            logger.warn('[HackClub] Error fetching model, using default:', error);
            this.currentModel = 'meta-llama/llama-4-maverick-17b-128e-instruct';
            return this.currentModel;
        }
    }

    formatModelName(modelId) {
        return modelId.startsWith('hackclub/') ? modelId : `hackclub/${modelId}`;
    }

    getBaseModelName(model) {
        return model.replace(/^hackclub\//, '');
    }

    async chat(messages, options = {}) {
        if (!this.enabled) {
            throw new Error('HackClub provider is not enabled');
        }

        // Ensure we have the current model
        await this.getCurrentModel();

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': options.stream ? 'text/event-stream' : 'application/json'
            },
            body: JSON.stringify({
                messages,
                stream: options.stream
            })
        });

        if (!response.ok) {
            throw new Error(`HackClub API returned ${response.status}`);
        }

        if (options.stream) {
            return this._handleStream(response);
        }

        const data = await response.json();
        if (!data.choices?.[0]?.message) {
            throw new Error('Invalid response format from HackClub API');
        }

        return {
            id: data.id || `hackclub-${Date.now()}`,
            object: 'chat.completion',
            created: data.created || Math.floor(Date.now() / 1000),
            model: this.formatModelName(this.currentModel),
            choices: [{
                index: 0,
                message: {
                    role: data.choices[0].message.role || 'assistant',
                    content: data.choices[0].message.content || ''
                },
                finish_reason: data.choices[0].finish_reason || 'stop'
            }]
        };
    }

    async *_handleStream(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const {value, done} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data: ')) continue;
                    if (line.includes('[DONE]')) return;

                    try {
                        const data = JSON.parse(line.slice(6));
                        if (!data.choices?.[0]?.delta) continue;

                        yield {
                            id: data.id || `hackclub-${Date.now()}`,
                            object: 'chat.completion.chunk',
                            created: data.created || Math.floor(Date.now() / 1000),
                            model: this.formatModelName(this.currentModel),
                            choices: [{
                                index: 0,
                                delta: {
                                    role: data.choices[0].delta.role || 'assistant',
                                    content: data.choices[0].delta.content || ''
                                },
                                finish_reason: data.choices[0].finish_reason
                            }]
                        };
                    } catch (error) {
                        logger.error('[HackClub] Error parsing stream chunk:', error);
                        continue;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}

export default new HackClubProvider();