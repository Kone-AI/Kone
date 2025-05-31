// HuggingChat Provider
import BaseProvider from './base.js';

const DEFAULT_MODELS = [
    'hugging/mistralai/Mixtral-8x7B-Instruct-v0.1',
    'hugging/mistralai/Mistral-7B-Instruct-v0.2',
    'hugging/meta-llama/Llama-2-70b-chat-hf',
    'hugging/openchat/openchat-3.5',
    'hugging/google/gemma-7b-it',
    'hugging/microsoft/phi-2'
];

class HuggingChatProvider extends BaseProvider {
    constructor() {
        super({
            name: 'HuggingChatProvider',
            baseURL: 'https://huggingface.co/chat',
            apiKeyRequired: false,
            supportsStreaming: false,
            models: DEFAULT_MODELS.map(id => ({
                id: id,
                name: id.replace('hugging/', ''),
                contextLength: 4096,
                pricing: { prompt: 0, completion: 0 }
            }))
        });
        
        this.lastRateLimitError = 0;
        this.rateLimitCooldown = 60 * 60 * 1000; // 1 hour cooldown when rate limited
    }

    async chat(messages, options = {}) {
        // Check rate limit cooldown
        const now = Date.now();
        if (this.lastRateLimitError > 0 && now - this.lastRateLimitError < this.rateLimitCooldown) {
            const remainingTime = Math.round((this.rateLimitCooldown - (now - this.lastRateLimitError)) / 1000 / 60);
            throw new Error(`HuggingChat API is rate limited. Please try again in ~${remainingTime} minutes.`);
        }
        
        throw new Error('HuggingChat direct API access is currently unavailable. Please use a different provider.');
    }
}

export default new HuggingChatProvider();