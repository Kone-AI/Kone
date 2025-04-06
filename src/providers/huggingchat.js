// HuggingChat Provider
class HuggingChatProvider {
    constructor() {
        this.enabled = process.env.ENABLE_HUGGINGCHAT !== 'false';
        this.models = new Map();
        this.lastUpdate = 0;
        this.updateInterval = 5 * 60 * 1000; // 5 minutes
        this.supportsStreaming = false;

        // Default models list
        this.defaultModels = [
            'hugging/mistralai/Mixtral-8x7B-Instruct-v0.1',
            'hugging/mistralai/Mistral-7B-Instruct-v0.2',
            'hugging/meta-llama/Llama-2-70b-chat-hf',
            'hugging/openchat/openchat-3.5',
            'hugging/google/gemma-7b-it',
            'hugging/microsoft/phi-2'
        ];

        // Initialize models map with defaults
        this.defaultModels.forEach(modelId => {
            this.models.set(modelId, {
                id: modelId,
                object: 'model',
                created: Date.now(),
                owned_by: 'https://huggingface.co',
                permission: [],
                root: modelId.replace('hugging/', ''),
                parent: null,
                context_length: 4096,
                capabilities: {
                    text: true,
                    images: false
                }
            });
        });
    }

    formatModelName(modelId) {
        if (modelId.startsWith('hugging/')) {
            return modelId;
        }
        return `hugging/${modelId}`;
    }

    getBaseModelName(model) {
        return model.replace(/^hugging\//, '');
    }

    async canHandle(model) {
        if (!this.enabled) return false;
        return this.defaultModels.includes(this.formatModelName(model));
    }

    async chat(messages, options = {}) {
        throw new Error('HuggingChat direct API access is currently unavailable. Please use a different provider.');
    }

    async getModels() {
        if (!this.enabled) return [];
        return Array.from(this.models.values());
    }
}

export default new HuggingChatProvider();