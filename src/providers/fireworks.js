// Fireworks provider - implements Fireworks' API via OpenAI compatibility
import OpenAI from 'openai';

class FireworksProvider {
  constructor() {
    this.enabled = process.env.ENABLE_FIREWORKS !== 'false';
    
    // setup api keys
    this.apiKeys = [];
    if (process.env.FIREWORKS_API_KEY) {
      this.apiKeys.push({ key: process.env.FIREWORKS_API_KEY, lastError: null });
    }
    if (process.env.FIREWORKS_BACKUP_KEY_1) {
      this.apiKeys.push({ key: process.env.FIREWORKS_BACKUP_KEY_1, lastError: null });
    }
    if (process.env.FIREWORKS_BACKUP_KEY_2) {
      this.apiKeys.push({ key: process.env.FIREWORKS_BACKUP_KEY_2, lastError: null });
    }

    this.activeKeyIndex = 0;
    this.keyRotationDelay = 60000; // 1 minute cooldown for failed keys

    this.supportsStreaming = true;
    this.disabledModels = new Set();
    this.models = new Map();
    this.lastUpdate = 0;
    this.updateInterval = 5 * 60 * 1000; // 5 minutes

    // Create OpenAI client for active key
    this.updateClient();

    if (this.enabled && process.env.DEBUG_MODE === 'true') {
      console.log('Fireworks initialized with:', {
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
        baseURL: 'https://api.fireworks.ai/inference/v1'
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
    return modelId.startsWith('fireworks/') ? modelId : `fireworks/${modelId}`;
  }

  getBaseModelName(model) {
    return model.replace(/^fireworks\//, '');
  }

  async updateAvailableModels() {
    if (!this.enabled || !this.client) return [];

    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval && this.models.size > 0) {
      return Array.from(this.models.keys());
    }

    try {
      const response = await this.client.models.list();
      this.models.clear();

      for (const model of response.data) {
        const modelId = this.formatModelName(model.id);
        if (!this.disabledModels.has(modelId)) {
          this.models.set(modelId, {
            id: modelId,
            object: 'model',
            created: model.created || Date.now(),
            owned_by: 'https://fireworks.ai',
            permission: [],
            root: model.id,
            parent: null,
            context_length: model.context_length || 8192,
            capabilities: {
              text: true,
              images: model.id.toLowerCase().includes('vision'),
              audio: false,
              video: false
            }
          });
        }
      }

      this.lastUpdate = now;
      return Array.from(this.models.keys());
    } catch (error) {
      console.error('Failed to fetch Fireworks models:', error);
      return Array.from(this.models.keys());
    }
  }

  async getModels() {
    if (!this.enabled) return [];
    
    await this.updateAvailableModels();
    return Array.from(this.models.values());
  }

  async canHandle(model) {
    if (!this.enabled) return false;

    try {
      const models = await this.updateAvailableModels();
      return models.includes(this.formatModelName(model));
    } catch {
      return false;
    }
  }

  disableModel(model) {
    const fullName = this.formatModelName(model);
    this.disabledModels.add(fullName);
    console.error(`model disabled due to error: ${fullName}`);
  }

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('fireworks provider not enabled');
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages must be a non-empty array');
    }

    const { model, stream, temperature, max_tokens, ...otherOptions } = options;
    
    if (!model) {
      throw new Error('model is required');
    }

    const baseModel = this.getBaseModelName(model);

    // Try with all available keys
    for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
      if (!this.client) {
        throw new Error('No Fireworks API keys available');
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
          console.error('Fireworks API error:', error);
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

    throw new Error('All Fireworks API keys failed or were rate limited');
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

export default new FireworksProvider();