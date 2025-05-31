import BaseProvider from './base.js';
import OpenAI from 'openai';

class DreamgenProvider extends BaseProvider {
constructor() {
super({
name: 'DreamgenProvider',
baseURL: 'https://dreamgen.com/api/v1',
apiKeyRequired: true,
supportsStreaming: false,
models: [
{
id: 'dreamgen/lucid-v1-medium/text',
name: 'Lucid V1 Medium (Text)',
contextLength: 8192,
pricing: { prompt: 0.005, completion: 0.005 }
},
{
id: 'dreamgen/lucid-v1-medium/assistant',
name: 'Lucid V1 Medium (Assistant)',
contextLength: 8192,
pricing: { prompt: 0.005, completion: 0.005 }
},
{
id: 'dreamgen/lucid-v1-extra-large/text',
name: 'Lucid V1 Extra Large (Text)',
contextLength: 8192,
pricing: { prompt: 0.01, completion: 0.01 }
},
{
id: 'dreamgen/lucid-v1-extra-large/assistant',
name: 'Lucid V1 Extra Large (Assistant)',
contextLength: 8192,
pricing: { prompt: 0.01, completion: 0.01 }
}
]
});

    this.client = new OpenAI({
        apiKey: process.env.DREAMGEN_API_KEY,
        baseURL: this.baseURL
    });
}

async chat(messages, options = {}) {
    if (!this.enabled) {
        throw new Error('DreamGen provider is not enabled');
    }

    try {
        const completion = await this.client.chat.completions.create({
            model: options.model?.replace('dreamgen/', '') || 'lucid-v1-medium/text',
            messages: messages,
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens,
            stream: false
        });

        return {
            id: completion.id || `dreamgen-${Date.now()}`,
            object: 'chat.completion',
            created: Date.now(),
            model: options.model || 'dreamgen/lucid-v1-medium/text',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: completion.choices[0].message.content
                },
                finish_reason: completion.choices[0].finish_reason || 'stop'
            }],
            usage: completion.usage || {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        };
    } catch (error) {
        if (error.status === 401) {
            throw new Error('Invalid DreamGen API key');
        }
        throw error;
    }
}

}

export default new DreamgenProvider();