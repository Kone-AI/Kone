// deepseek.js provider - fast and affordable llms
import OpenAI from 'openai';

class DeepseekProvider {
  constructor() {
    this.enabled = Boolean(process.env.DEEPSEEK_API_KEY);
    
    // setup deepseek client with openai sdk
    this.client = this.enabled ? new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com/v1'
    }) : null;

    this.supportsStreaming = true;
    this.disabledModels = new Set();
    this.models = new Map();
    this.lastUpdate = 0;
    this.updateInterval = 5 * 60 * 1000; // 5 minutes
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second

    // known deepseek models and their capabilities
    this.knownModels = new Map([
      ['deepseek-chat', { context: 32000, vision: false }],
      ['deepseek-chat-v1', { context: 32000, vision: false }],
      ['deepseek-coder', { context: 32000, vision: false }],
      ['deepseek-coder-v1', { context: 32000, vision: false }],
      ['deepseek-math', { context: 16000, vision: false }],
      ['deepseek-vision', { context: 32000, vision: true }]
    ]);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  validateMessage(msg) {
    if (!msg || typeof msg !== 'object') {
      throw new Error('invalid message format');
    }

    if (!['user', 'assistant', 'system'].includes(msg.role)) {
      throw new Error(`invalid message role: ${msg.role}`);
    }

    // handle different content types
    if (Array.isArray(msg.content)) {
      // validate each content part
      msg.content.forEach(part => {
        if (part.type === 'text' && typeof part.text !== 'string') {
          throw new Error('invalid text content');
        }
        if (part.type === 'image_url' && (!part.image_url || typeof part.image_url.url !== 'string')) {
          throw new Error('invalid image content');
        }
      });
    } else if (typeof msg.content !== 'string') {
      throw new Error('invalid message content');
    }

    return true;
  }

  formatModelName(modelId) {
    // if it already has our prefix, use it as-is
    if (modelId.startsWith('deepseek/')) {
      return modelId;
    }
    return `deepseek/${modelId}`;
  }

  getBaseModelName(model) {
    // if it starts with our prefix, remove it
    if (model.startsWith('deepseek/')) {
      return model.replace('deepseek/', '');
    }
    // if it's not our model, return as-is
    return model;
  }

  disableModel(model) {
    // store the full prefixed name
    const fullName = this.formatModelName(model);
    this.disabledModels.add(fullName);
    console.error(`model disabled due to error: ${fullName}`);
  }

  async updateAvailableModels() {
    // if provider is not enabled, return empty list
    if (!this.enabled) {
      return [];
    }

    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval && this.models.size > 0) {
      return Array.from(this.models.keys());
    }

    try {
      // Get models directly from DeepSeek API
      const models = await this.client.models.list();
      this.models.clear();

      // Process each model
      for (const model of models.data) {
        const formattedId = this.formatModelName(model.id);
        if (!this.disabledModels.has(formattedId)) {
          const capabilities = this.knownModels.get(model.id) || {
            context: model.context_length || 8192,
            vision: model.id.includes('vision')
          };

          this.models.set(formattedId, {
            id: formattedId,
            object: 'model',
            created: model.created || Date.now(),
            owned_by: 'https://deepseek.ai',
            permission: [],
            root: model.id,
            parent: null,
            context_length: capabilities.context,
            capabilities: {
              text: true,
              images: capabilities.vision,
              audio: false,
              video: false
            }
          });
        }
      }

      this.lastUpdate = now;
      return Array.from(this.models.keys());
    } catch (error) {
      console.error('Failed to fetch DeepSeek models:', error);
      // Don't update lastUpdate on error so we'll try again sooner
      return Array.from(this.models.keys());
    }
  }

  async canHandle(model) {
    // if provider is not enabled, can't handle any models
    if (!this.enabled) return false;

    try {
      const models = await this.updateAvailableModels();
      return models.includes(this.formatModelName(model));
    } catch {
      return false;
    }
  }

  transformResponse(response, model) {
    if (!response) {
      throw new Error('empty response from api');
    }

    // DeepSeek responses should already be in OpenAI format
    if (response && typeof response === 'object') {
      if (response.model) {
        response.model = this.formatModelName(model);
      }
      if (response.choices && Array.isArray(response.choices)) {
        response.choices.forEach(choice => {
          if (choice.model) {
            choice.model = this.formatModelName(model);
          }
        });
      }
    }
    return response;
  }

  async chat(messages, options = {}) {
    // if provider is not enabled, fail fast
    if (!this.enabled) {
      throw new Error('deepseek provider not enabled');
    }

    // validate input
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages must be a non-empty array');
    }

    messages.forEach(msg => this.validateMessage(msg));

    const { model, stream, temperature, max_tokens } = options;
    if (!model) {
      throw new Error('model is required');
    }

    const baseModel = this.getBaseModelName(model);
    const modelInfo = this.knownModels.get(baseModel);
    if (!modelInfo) {
      throw new Error(`unsupported model: ${baseModel}`);
    }

    // validate temperature
    if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
      throw new Error('temperature must be between 0 and 2');
    }

    // validate max_tokens
    if (max_tokens !== undefined && (typeof max_tokens !== 'number' || max_tokens < 1)) {
      throw new Error('max_tokens must be a positive number');
    }

    // don't allow image input for non-vision models
    if (!modelInfo.vision && messages.some(msg => 
      Array.isArray(msg.content) && 
      msg.content.some(part => part.type === 'image_url')
    )) {
      throw new Error(`model ${baseModel} does not support image input`);
    }

    let attempt = 0;
    while (attempt < this.retryAttempts) {
      try {
        // Create completion with the OpenAI SDK
        const completion = await this.client.chat.completions.create({
          model: baseModel,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          stream,
          temperature,
          max_tokens,
          ...options
        });

        // Handle streaming responses
        if (stream) {
          return this._handleStream(completion, model);
        }

        // Return regular response
        return this.transformResponse(completion, model);
      } catch (error) {
        attempt++;

        // Handle different error types
        if (error.status === 401 || error.status === 403) {
          throw new Error('unauthorized: check your api key');
        }

        if (error.status === 402) {
          this.disableModel(model);
          throw new Error('model quota exceeded');
        }

        if (error.status === 429) {
          if (attempt < this.retryAttempts) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1); // exponential backoff
            await this.sleep(delay);
            continue;
          }
          throw new Error('rate limit exceeded');
        }

        if (error.status >= 500) {
          if (attempt < this.retryAttempts) {
            await this.sleep(this.retryDelay);
            continue;
          }
        }

        // Unknown error
        throw error;
      }
    }

    throw new Error('max retry attempts exceeded');
  }

  async *_handleStream(stream, model) {
    try {
      for await (const chunk of stream) {
        if (!chunk || !chunk.choices?.[0]?.delta) {
          continue; // skip invalid chunks
        }

        // DeepSeek chunks should be in OpenAI format
        if (chunk.model) {
          chunk.model = this.formatModelName(model);
        }
        yield chunk;
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        throw new Error('unauthorized: check your api key');
      }
      if (error.status === 402) {
        this.disableModel(model);
        throw new Error('model quota exceeded');
      }
      if (error.status === 429) {
        throw new Error('rate limit exceeded');
      }
      throw error;
    }
  }

  async getModels() {
    // if provider is not enabled, return empty list
    if (!this.enabled) return [];
    
    await this.updateAvailableModels();
    return Array.from(this.models.values());
  }
}

export default DeepseekProvider;