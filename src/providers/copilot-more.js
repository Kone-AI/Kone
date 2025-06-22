// copilot-more provider using the openai sdk - no auth needed which is pretty nice
import OpenAI from 'openai';
import BaseProvider from './base.js';

class CopilotMoreProvider extends BaseProvider {
  constructor() {
    const baseURL = process.env.COPILOT_MORE_API_URL;
    const defaultModels = [{
      id: 'copilot-more/gpt-4',
      name: 'GPT-4',
      contextLength: 128000,
      pricing: { prompt: 0, completion: 0 }
    }];

    super({
      name: 'CopilotMoreProvider',
      baseURL,
      apiKeyRequired: true,
      supportsStreaming: true,
      models: defaultModels
    });

    this.models = new Map(defaultModels.map(m => [m.id, m]));
    this.apiKey = process.env.COPILOT_MORE_API_KEY;
    this.enabled = Boolean(this.apiKey);

    if (this.enabled) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL,
        defaultHeaders: { 'accept-encoding': 'gzip' }
      });
      console.log(`[CopilotMore] Initialized with baseURL: ${baseURL}`);
    } else {
      console.warn('[CopilotMore] No API key provided, provider will be disabled');
    }

    this.disabledModels = new Set();
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

  async validateModel(model) {
    // quick check if model is already known to be disabled
    const formattedModel = this.formatModelName(model);
    if (this.disabledModels.has(formattedModel)) {
      return false;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.getBaseModelName(model),
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1
      });

      return Boolean(response);
    } catch (error) {
      // specifically handle unsupported model errors
      if (error.status === 400 && error.message?.includes('not supported')) {
        this.disableModel(model);
        return false;
      }
      // for other errors, assume model might still be valid
      return true;
    }
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

      const availableModels = models.map(model => ({
        id: this.formatModelName(model.id),
        object: 'model',
        created: Date.now(),
        owned_by: 'copilot-more',
        permission: [],
        root: model.id,
        parent: null,
        context_length: model.context_window || 128000,
        capabilities: {
          text: true,
          images: false,
          audio: false,
          video: false
        }
      }));

      this.models = new Map(availableModels.map(m => [m.id, m]));
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

    // validate messages
    if (!Array.isArray(messages)) {
      throw new Error('messages must be an array');
    }

    messages.forEach(msg => this.validateMessage(msg));

    // get model name without our prefix
    const baseModelName = this.getBaseModelName(options.model);

    // prepare request parameters
    const params = {
      model: baseModelName,
      messages,
      stream: options.stream || false,
      max_tokens: options.max_tokens,
      temperature: options.temperature,
      top_p: options.top_p,
      presence_penalty: options.presence_penalty,
      frequency_penalty: options.frequency_penalty,
      stop: options.stop
    };

    // remove undefined values
    Object.keys(params).forEach(key => {
      if (params[key] === undefined) {
        delete params[key];
      }
    });

    let attempt = 0;
    let lastError = null;

    while (attempt < this.retryAttempts) {
      try {
        const response = await this.client.chat.completions.create(params);
        return this.transformResponse(response, options.model);
      } catch (error) {
        lastError = error;

        // if model not supported, fail fast
        if (error.status === 400 && error.message?.includes('not supported')) {
          this.disableModel(options.model);
          throw error;
        }

        // if rate limited, wait before retry
        if (error.status === 429) {
          await this.sleep(this.retryDelay * Math.pow(2, attempt));
          attempt++;
          continue;
        }

        // for other errors, throw immediately
        throw error;
      }
    }

    // if we get here, we've exhausted our retries
    throw lastError;
  }
}

export default CopilotMoreProvider;