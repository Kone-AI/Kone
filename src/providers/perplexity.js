// Perplexity provider - implements Perplexity's API via OpenAI compatibility
import OpenAI from 'openai';

class PerplexityProvider {
  constructor() {
    this.enabled = process.env.ENABLE_PERPLEXITY !== 'false';
    
    // setup api keys
    this.apiKeys = [];
    if (process.env.PERPLEXITY_API_KEY) {
      this.apiKeys.push({ key: process.env.PERPLEXITY_API_KEY, lastError: null });
    }
    if (process.env.PERPLEXITY_BACKUP_KEY_1) {
      this.apiKeys.push({ key: process.env.PERPLEXITY_BACKUP_KEY_1, lastError: null });
    }
    if (process.env.PERPLEXITY_BACKUP_KEY_2) {
      this.apiKeys.push({ key: process.env.PERPLEXITY_BACKUP_KEY_2, lastError: null });
    }

    this.activeKeyIndex = 0;
    this.keyRotationDelay = 60000; // 1 minute cooldown for failed keys

    this.supportsStreaming = true;
    this.disabledModels = new Set();
    this.models = new Map();
    this.lastUpdate = 0;

    // Hardcode models as Perplexity doesn't have a /models endpoint
    this.perplexityModels = [
      { id: 'sonar-deep-research', context_length: 128000 },
      { id: 'sonar-reasoning-pro', context_length: 128000 },
      { id: 'sonar-reasoning', context_length: 128000 },
      { id: 'sonar-pro', context_length: 200000 },
      { id: 'sonar', context_length: 128000 },
      { id: 'r1-1776', context_length: 128000 }
    ];

    // Create OpenAI client for active key
    this.updateClient();

    // Initialize models from hardcoded list
    this.updateAvailableModels();

    if (this.enabled && process.env.DEBUG_MODE === 'true') {
      console.log('Perplexity initialized with:', {
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
        baseURL: 'https://api.perplexity.ai'
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
    return modelId.startsWith('perplexity/') ? modelId : `perplexity/${modelId}`;
  }

  getBaseModelName(model) {
    return model.replace(/^perplexity\//, '');
  }

  async updateAvailableModels() {
    if (!this.enabled) return [];

    this.models.clear();
    this.perplexityModels.forEach(model => {
      const modelId = this.formatModelName(model.id);
      if (!this.disabledModels.has(modelId)) {
        this.models.set(modelId, {
          id: modelId,
          object: 'model',
          created: Date.now(),
          owned_by: 'https://perplexity.ai',
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
      throw new Error('perplexity provider not enabled');
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
        throw new Error('No Perplexity API keys available');
      }

      try {
        const completion = await this.client.chat.completions.create({
          model: baseModel,
          messages,
          stream,
          temperature,
          max_tokens,
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
        if (process.env.DEBUG_MODE === 'true') {
          console.error('Perplexity API error:', error);
        }

        this.handleKeyError(error);

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

    throw new Error('All Perplexity API keys failed or were rate limited');
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

export default new PerplexityProvider();