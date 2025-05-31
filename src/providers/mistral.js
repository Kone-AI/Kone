// Mistral provider - implements Mistral's API via OpenAI compatibility
import OpenAI from 'openai';

class MistralProvider {
  constructor() {
    this.enabled = process.env.ENABLE_MISTRAL !== 'false';
    
    // setup api keys
    this.apiKeys = [];
    if (process.env.MISTRAL_API_KEY) {
      this.apiKeys.push({ key: process.env.MISTRAL_API_KEY, lastError: null });
    }
    if (process.env.MISTRAL_BACKUP_KEY_1) {
      this.apiKeys.push({ key: process.env.MISTRAL_BACKUP_KEY_1, lastError: null });
    }
    if (process.env.MISTRAL_BACKUP_KEY_2) {
      this.apiKeys.push({ key: process.env.MISTRAL_BACKUP_KEY_2, lastError: null });
    }

    this.activeKeyIndex = 0;
    this.keyRotationDelay = 60000; // 1 minute cooldown for failed keys

    this.supportsStreaming = true;
    this.disabledModels = new Set();
    this.models = new Map();
    this.lastUpdate = 0;

    // Hardcode models as Mistral doesn't have a /models endpoint
    this.mistralModels = [
      { id: 'mistral-small-latest', context_length: 32000 },
      { id: 'pixtral-12b-2409', context_length: 16000 },
      { id: 'open-mistral-nemo', context_length: 128000 },
      { id: 'open-codestral-mamba', context_length: 256000 }
    ];

    // Create OpenAI client for active key
    this.updateClient();

    // Initialize models from hardcoded list
    this.updateAvailableModels();

    if (this.enabled && process.env.DEBUG_MODE === 'true') {
      console.log('Mistral initialized with:', {
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
        baseURL: 'https://api.mistral.ai/v1'
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
    return modelId.startsWith('mistral/') ? modelId : `mistral/${modelId}`;
  }

  getBaseModelName(model) {
    return model.replace(/^mistral\//, '');
  }

  async updateAvailableModels() {
    if (!this.enabled) return [];

    this.models.clear();
    this.mistralModels.forEach(model => {
      const modelId = this.formatModelName(model.id);
      if (!this.disabledModels.has(modelId)) {
        this.models.set(modelId, {
          id: modelId,
          object: 'model',
          created: Date.now(),
          owned_by: 'https://mistral.ai',
          permission: [],
          root: model.id,
          parent: null,
          context_length: model.context_length,
          capabilities: {
            text: true,
            images: false,
            audio: false,
            video: false
          }
        });
      }
    });

    this.lastUpdate = Date.now();
    return Array.from(this.models.keys());
  }

  async getModels() {
    if (!this.enabled) return [];
    return Array.from(this.models.values());
  }

  async canHandle(model) {
    if (!this.enabled) return false;
    return this.models.has(this.formatModelName(model));
  }

  disableModel(model) {
    const fullName = this.formatModelName(model);
    this.disabledModels.add(fullName);
    console.error(`model disabled due to error: ${fullName}`);
  }

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('mistral provider not enabled');
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages must be a non-empty array');
    }

    const { model, stream, temperature, max_tokens, ...otherOptions } = options;
    
    if (!model) {
      throw new Error('model is required');
    }

    const baseModel = this.getBaseModelName(model);
    if (!this.models.has(this.formatModelName(baseModel))) {
      throw new Error(`unsupported model: ${baseModel}`);
    }

    // Try with all available keys
    for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
      if (!this.client) {
        throw new Error('No Mistral API keys available');
      }

      try {
        // Only include supported options
        const payload = {
          model: baseModel,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          stream: Boolean(stream)
        };

        // Add optional parameters only if they are defined
        if (temperature !== undefined) payload.temperature = temperature;
        if (max_tokens !== undefined) payload.max_tokens = max_tokens;
        // Add other supported options
        if (otherOptions.top_p !== undefined) payload.top_p = otherOptions.top_p;
        if (otherOptions.presence_penalty !== undefined) payload.presence_penalty = otherOptions.presence_penalty;
        if (otherOptions.frequency_penalty !== undefined) payload.frequency_penalty = otherOptions.frequency_penalty;

        const completion = await this.client.chat.completions.create(payload);

        // handle 422 validation errors
        if (completion.error?.status === 422) {
          const validationError = new Error(
            `Mistral API validation error: ${completion.error.message}`
          );
          validationError.status = 422;
          validationError.details = completion.error.details;
          throw validationError;
        }

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
        if (process.env.DEBUG_MODE === 'true') {
          console.error('Mistral API error:', error);
        }

        this.handleKeyError(error);

        // Try next key if rate limited or bad request
        if ((error.status === 429 || error.status === 400) && attempt < this.apiKeys.length - 1) {
          if (process.env.DEBUG_MODE === 'true') {
            console.log(`${this.constructor.name}: Retrying with backup key after ${error.status} error`);
          }
          
          // For 400 errors, check if it's a model not found (common issue with incorrect max tokens)
          if (error.status === 400) {
            // Try modifying the request for the next attempt
            if (max_tokens !== undefined && max_tokens > 4000) {
              max_tokens = 4000; // Limit max tokens to 4000 for retry
            }
          }
          
          continue;
        }

        // Clean up error message for BadRequestError (400)
        if (error.status === 400) {
          const cleanError = new Error('Mistral API error: The request is invalid, likely due to incompatible parameters');
          cleanError.status = 400;
          cleanError.original = error;
          throw cleanError;
        }

        throw error;
      }
    }

    throw new Error('All Mistral API keys failed or were rate limited');
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

export default new MistralProvider();