// mention.js - mention.com provider implementation
import BaseProvider from './base.js';

// list of supported models
const MODELS = [
  'gpt-4.1', 'gpt-4.1-2025-04-14', 'gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14', 'gpt-4.5-preview', 
  'gpt-4.5-preview-2025-02-27', 'gpt-4o', 'gpt-4o-2024-08-06', 
  'gpt-4o-audio-preview', 'gpt-4o-audio-preview-2024-12-17',
  'gpt-4o-realtime-preview', 'gpt-4o-realtime-preview-2024-12-17',
  'gpt-4o-mini', 'gpt-4o-mini-2024-07-18', 'gpt-4o-mini-audio-preview',
  'gpt-4o-mini-audio-preview-2024-12-17', 'gpt-4o-mini-realtime-preview',
  'gpt-4o-mini-realtime-preview-2024-12-17', 'o1', 'o1-2024-12-17',
  'o1-pro', 'o1-pro-2025-03-19', 'o3', 'o3-2025-04-16', 'o4-mini',
  'o4-mini-2025-04-16', 'o3-mini', 'o3-mini-2025-01-31', 'o1-mini',
  'o1-mini-2024-09-12', 'gpt-4o-mini-search-preview',
  'gpt-4o-mini-search-preview-2025-03-11', 'gpt-4o-search-preview',
  'gpt-4o-search-preview-2025-03-11'
];
class MentionProvider extends BaseProvider {
  constructor() {
    super({
      name: 'MentionProvider',
      baseURL: 'https://mention.com/wp-json/openai-proxy/v1',
      apiKeyRequired: false,
      supportsStreaming: false,
      models: MODELS.map(id => ({
        id: `mention/${id}`,
        name: id,
        contextLength: 4096,
        pricing: { prompt: 0, completion: 0 }
      }))
    });
  }

  async chat(messages, options = {}) {
    try {
      const response = await fetch(`${this.baseURL}/generate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        referrer: "https://mention.com/en/tiktok-caption-generator/",
        body: JSON.stringify({
          model: options.model.replace('mention/', ''),
          messages: messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 256,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0
        }),
        mode: "cors"
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: options.model,
        choices: [{
          index: 0,
          message: result.choices[0].message,
          finish_reason: result.choices[0].finish_reason || 'stop'
        }],
        usage: result.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
    } catch (error) {
      throw new Error(`Mention API error: ${error.message}`);
    }
  }
}

export default new MentionProvider();