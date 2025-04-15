// copilot-more provider using the openai sdk - no auth needed which is pretty nice
import OpenAI from 'openai';

class CopilotMoreProvider {
  constructor() {
    // only need api url, no token needed
    this.enabled = Boolean(process.env.COPILOT_MORE_API_URL);
    
    // setup client with openai sdk
    this.client = this.enabled ? new OpenAI({
      apiKey: 'anything', // accepts any value
      baseURL: process.env.COPILOT_MORE_API_URL
    }) : null;

    this.supportsStreaming = true;
    this.disabledModels = new Set();
    this.models = new Map();
    this.lastUpdate = 0;
    this.updateInterval = 5 * 60 * 1000; // 5 minutes
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
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

    if (typeof msg.content !== 'string') {
      throw new Error('invalid message content');
    }

    return true;
  }

  formatModelName(modelId) {
    // if it already has our prefix, use it as-is
    if (modelId.startsWith('copilot-more/')) {
      return modelId;
    }
    return `copilot-more/${modelId}`;
  }

  getBaseModelName(model) {
    // if it starts with our prefix, remove it
    if (model.startsWith('copilot-more/')) {
      return model.replace('copilot-more/', '');
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
      // fetch available models from the api
      const response = await this.client.models.list();
      const models = response.data || [];

      this.models.clear();
      for (const model of models) {
        const formattedId = this.formatModelName(model.id);
        if (!this.disabledModels.has(formattedId)) {
          this.models.set(formattedId, {
            id: formattedId,
            object: 'model',
            created: Date.now(),
            owned_by: 'Copilot',
            permission: [],
            root: model.id,
            parent: null,
            context_length: model.context_window || 200000, // default if not specified
            capabilities: {
              text: true,
              images: false,
              audio: false,
              video: false
            }
          });
        }
      }
    } catch (error) {
      console.error('failed to fetch copilot-more models:', error);
      return Array.from(this.models.keys());
    }

    this.lastUpdate = now;
    return Array.from(this.models.keys());
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

    // Responses should be in OpenAI format already
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
      throw new Error('copilot-more provider not enabled');
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

    // validate temperature
    if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
      throw new Error('temperature must be between 0 and 2');
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
          model: baseModel, // use base model name without prefix
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
          throw new Error('api authorization failed');
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

        // Transform chunks to include our model name
        if (chunk.model) {
          chunk.model = this.formatModelName(model);
        }
        yield chunk;
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        throw new Error('api authorization failed');  
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

export default CopilotMoreProvider;