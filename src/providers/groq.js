// groq.js provider - fancy new hotness
import OpenAI from 'openai';

class GroqProvider {
  constructor() {
    this.enabled = process.env.ENABLE_GROQ !== 'false';
    
    // setup api keys
    this.apiKeys = [];
    if (process.env.GROQ_API_KEY) {
      this.apiKeys.push({ key: process.env.GROQ_API_KEY, lastError: null });
    }
    if (process.env.GROQ_BACKUP_KEY_1) {
      this.apiKeys.push({ key: process.env.GROQ_BACKUP_KEY_1, lastError: null });
    }
    if (process.env.GROQ_BACKUP_KEY_2) {
      this.apiKeys.push({ key: process.env.GROQ_BACKUP_KEY_2, lastError: null });
    }

    this.activeKeyIndex = 0;
    this.keyRotationDelay = 60000; // 1 minute cooldown for failed keys

    this.supportsStreaming = true;
    this.disabledModels = new Set();
    this.models = new Map();

    // Initialize models Map
    const modelsList = [
      { name: 'allam-2-7b', context_length: 1024, image_support: false },
      { name: 'deepseek-r1-distill-llama-70b', context_length: 131072, image_support: false },
      { name: 'deepseek-r1-distill-qwen-32b', context_length: 131072, image_support: false },
      { name: 'gemma2-9b-it', context_length: 8192, image_support: false },
      { name: 'llama-3.1-8b-instant', context_length: 131072, image_support: false },
      { name: 'llama-3.2-11b-vision-preview', context_length: 131072, image_support: true },
      { name: 'llama-3.2-1b-preview', context_length: 131072, image_support: false },
      { name: 'llama-3.2-3b-preview', context_length: 131072, image_support: false },
      { name: 'llama-3.2-90b-vision-preview', context_length: 131072, image_support: true },
      { name: 'llama-3.3-70b-specdec', context_length: 131072, image_support: false },
      { name: 'llama-3.3-70b-versatile', context_length: 131072, image_support: false },
      { name: 'llama-guard-3-8b', context_length: 8192, image_support: false },
      { name: 'llama3-70b-8192', context_length: 131072, image_support: false },
      { name: 'llama3-8b-8192', context_length: 131072, image_support: false },
      { name: 'qwen-2.5-32b', context_length: 131072, image_support: false },
      { name: 'qwen-2.5-coder-32b', context_length: 131072, image_support: false },
      { name: 'qwen-qwq-32b', context_length: 131072, image_support: false }
    ];

    // Remove models that require special terms
    const requiresTerms = ['mistral-saba-24b'];
    modelsList
      .filter(model => !requiresTerms.includes(model.name))
      .forEach(model => {
        const modelId = this.formatModelName(model.name);
        this.models.set(modelId, {
          id: modelId,
          object: 'model',
          created: Date.now(),
          owned_by: 'https://groq.com',
          permission: [],
          root: model.name,
          parent: null,
          context_length: model.context_length,
          capabilities: {
            text: true,
            images: model.image_support
          }
        });
      });

    // Create OpenAI client for the active key
    this.updateClient();

    if (this.enabled && process.env.DEBUG_MODE === 'true') {
      console.log('Groq initialized with:', {
        primaryKey: this.apiKeys[0]?.key ? '****' + this.apiKeys[0].key.slice(-4) : 'none',
        backupKey1: this.apiKeys[1]?.key ? '****' + this.apiKeys[1].key.slice(-4) : 'none',
        backupKey2: this.apiKeys[2]?.key ? '****' + this.apiKeys[2].key.slice(-4) : 'none'
      });
    }
  }

  updateClient() {
    const currentKey = this.getActiveKey();
    if (currentKey) {
      this.client = new OpenAI({
        apiKey: currentKey,
        baseURL: 'https://api.groq.com/openai/v1'
      });
    } else {
      this.client = null;
    }
  }

  getActiveKey() {
    const now = Date.now();
    for (let i = 0; i < this.apiKeys.length; i++) {
      const keyIndex = (this.activeKeyIndex + i) % this.apiKeys.length;
      const keyInfo = this.apiKeys[keyIndex];
      
      if (keyInfo.lastError && now - keyInfo.lastError < this.keyRotationDelay) {
        continue;
      }
      
      this.activeKeyIndex = keyIndex;
      return keyInfo.key;
    }
    return null;
  }

  handleKeyError(error) {
    const keyInfo = this.apiKeys[this.activeKeyIndex];
    if (keyInfo) {
      if (error.status === 401 || error.status === 403) {
        keyInfo.lastError = Infinity;
      } else if (error.status === 429) {
        keyInfo.lastError = Date.now();
      }
    }
    this.updateClient();
  }

  formatModelName(modelId) {
    return modelId.startsWith('groq/') ? modelId : `groq/${modelId}`;
  }

  getBaseModelName(model) {
    return model.replace(/^groq\//, '');
  }

  async getModels() {
    return this.enabled ? Array.from(this.models.values()) : [];
  }

  async canHandle(model) {
    return this.enabled && this.models.has(this.formatModelName(model));
  }

  disableModel(model) {
    const fullName = this.formatModelName(model);
    this.disabledModels.add(fullName);
    console.error(`model disabled due to error: ${fullName}`);
  }

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('groq provider not enabled');
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages must be a non-empty array');
    }

    const { model, stream, timeout, ...otherOptions } = options;
    
    // groq doesn't support timeout option
    if (!model) {
      throw new Error('model is required');
    }

    const baseModel = this.getBaseModelName(model);
    if (!this.models.has(this.formatModelName(baseModel))) {
      throw {
        message: `Model not found: ${baseModel}`,
        type: 'invalid_request_error',
        code: 'model_not_found',
        param: 'model',
        status: 404,
        provider: this.constructor.name,
        details: {
          available_models: Array.from(this.models.keys())
        }
      };
    }

    // Log model details in debug mode
    if (process.env.DEBUG_MODE === 'true') {
      console.log('Groq request details:', {
        provider: this.constructor.name,
        requested_model: model,
        base_model: baseModel,
        stream: Boolean(stream),
        active_key: this.apiKeys[this.activeKeyIndex]?.key ? '****' + this.apiKeys[this.activeKeyIndex].key.slice(-4) : 'none'
      });
    }

    // Try with all available keys
    for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
      if (!this.client) {
        throw new Error('No Groq API keys available');
      }

      try {
        const completion = await this.client.chat.completions.create({
          model: baseModel,
          messages,
          stream,
          ...otherOptions
        });

        // Handle streaming
        if (stream) {
          return this._handleStream(completion, model);
        }

        // Add our model prefix to the response
        if (completion.model) {
          completion.model = this.formatModelName(completion.model);
        }
        return completion;

      } catch (error) {
        // Enhanced error logging
        if (process.env.DEBUG_MODE === 'true') {
          console.error('Groq API error:', {
            message: error.message,
            status: error.status,
            code: error.error?.code,
            model: baseModel,
            key_index: this.activeKeyIndex,
            response: error.response?.data
          });
        }

        this.handleKeyError(error);

        // Check for model terms error
        if (error?.error?.code === 'model_terms_required') {
          this.disableModel(model);
          throw new Error(`Model ${model} requires terms acceptance and has been disabled`);
        }

        // Try next key if rate limited
        if (error.status === 429 && attempt < this.apiKeys.length - 1) {
          if (process.env.DEBUG_MODE === 'true') {
            console.log(`${this.constructor.name}: Retrying with backup key`);
          }
          continue;
        }

        throw error;
      }
    }

    throw new Error('All Groq API keys failed or were rate limited');
  }

  async *_handleStream(stream, model) {
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
        this.handleKeyError(error);
        throw new Error('unauthorized: check your api key');
      }
      if (error.status === 429) {
        this.handleKeyError(error);
        throw new Error('rate limit exceeded');
      }
      throw error;
    }
  }
}

export default new GroqProvider();