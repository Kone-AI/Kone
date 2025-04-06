// claude.js provider - anthropics fancy ai friend
import OpenAI from 'openai';

class ClaudeProvider {
  constructor() {
    this.enabled = Boolean(process.env.ANTHROPIC_API_KEY);
    
    // setup claude client using openai sdk since they have a compatible api
    this.client = this.enabled ? new OpenAI({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: 'https://api.anthropic.com/v1',
      defaultHeaders: {
        'anthropic-version': '2024-02-01'  // updated to latest version
      }
    }) : null;

    this.supportsStreaming = true;
    this.disabledModels = new Set();
    this.models = [];
    this.lastUpdate = 0;
    this.updateInterval = 5 * 60 * 1000; // 5 minutes
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
    
    // known claude models and their capabilities
    this.knownModels = new Map([
      ['claude-3-opus-20240229', { context: 200000, vision: true }],
      ['claude-3-sonnet-20240229', { context: 200000, vision: true }],
      ['claude-3-haiku-20240307', { context: 200000, vision: true }],
      ['claude-2.1', { context: 200000, vision: false }],
      ['claude-2.0', { context: 100000, vision: false }],
      ['claude-instant-1.2', { context: 100000, vision: false }]
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
        if (part.type === 'image' && (!part.image_url || typeof part.image_url.url !== 'string')) {
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
    if (modelId.startsWith('claude/')) {
      return modelId;
    }
    return `claude/${modelId}`;
  }

  getBaseModelName(model) {
    // if it starts with our prefix, remove it
    if (model.startsWith('claude/')) {
      return model.replace('claude/', '');
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
    if (now - this.lastUpdate < this.updateInterval && this.models.length > 0) {
      return this.models.map(m => m.id);
    }

    try {
      const response = await this.client.models.list();
      this.models = Array.from(response)
        .filter(model => this.knownModels.has(model.id))
        .map(model => {
          const capabilities = this.knownModels.get(model.id);
          return {
            id: this.formatModelName(model.id),
            object: 'model',
            created: Date.now(),
            owned_by: 'https://anthropic.com',
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
          };
        });

      this.lastUpdate = now;
      return this.models.map(m => m.id);
    } catch (error) {
      console.error('Failed to fetch Claude models:', error);
      // Don't update lastUpdate on error so we'll try again sooner
      return this.models.map(m => m.id);
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

    // convert from anthropic format to openai format
    return {
      id: response.id || ('claude-' + Math.random().toString(36).substring(2)),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.formatModelName(model),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.choices?.[0]?.message?.content || response.content || ''
        },
        finish_reason: response.choices?.[0]?.finish_reason || 'stop'
      }],
      usage: response.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }

  async chat(messages, options = {}) {
    // if provider is not enabled, fail fast
    if (!this.enabled) {
      throw new Error('claude provider not enabled');
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
    if (!this.knownModels.has(baseModel)) {
      throw new Error(`unsupported model: ${baseModel}`);
    }

    // validate temperature
    if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 1)) {
      throw new Error('temperature must be between 0 and 1');
    }

    // validate max_tokens
    if (max_tokens !== undefined && (typeof max_tokens !== 'number' || max_tokens < 1)) {
      throw new Error('max_tokens must be a positive number');
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

        // Format chunks to match OpenAI format
        yield {
          id: chunk.id || ('claude-' + Math.random().toString(36).substring(2)),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: this.formatModelName(model),
          choices: [{
            index: 0,
            delta: {
              content: chunk.choices[0].delta.content || ''
            },
            finish_reason: chunk.choices[0].finish_reason
          }]
        };
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
    return this.models.filter(model => !this.disabledModels.has(model.id));
  }
}

export default ClaudeProvider;