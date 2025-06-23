// openrouter.js provider - implements OpenRouter's streaming API
import Provider from './base.js';
import logger from '../utils/logger.js';

// permanent blacklist for invalid/broken models
const IGNORED_MODELS = new Set([
    'quasar-alpha',
    'google/gemini-2.5-pro-preview-03-25', // preview models that dont exist anymore
    'all-hands/openhands-lm-32b-v0.1',     // broken model
    'deepseek/deepseek-v3-base:free',      // consistently returns empty responses
    'deepseek-ai/deepseek-coder-33b-instruct:free'  // unreliable responses
]);

class OpenRouterProvider extends Provider {
  constructor() {
    // Initialize with empty config, will be populated in updateAvailableModels
    super({ models: {} });
    
    this.enabled = process.env.ENABLE_OPENROUTER !== 'false';
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.supportsStreaming = true;
    this.lastUpdate = 0;
    this.updateInterval = 5 * 60 * 60 * 1000; // 5 hours in ms
    this.disabledModels = new Set();
    this.lastProviderError = null;
    this.providerDisableTime = 15 * 60 * 1000; // 15 minutes

    // Setup API keys
    this.apiKeys = [];
    if (process.env.OPENROUTER_API_KEY) {
      this.apiKeys.push({ key: process.env.OPENROUTER_API_KEY, lastError: null });
    }
    if (process.env.OPENROUTER_BACKUP_KEY_1) {
      this.apiKeys.push({ key: process.env.OPENROUTER_BACKUP_KEY_1, lastError: null });
    }
    if (process.env.OPENROUTER_BACKUP_KEY_2) {
      this.apiKeys.push({ key: process.env.OPENROUTER_BACKUP_KEY_2, lastError: null });
    }

    this.enabled = this.enabled && this.apiKeys.length > 0;
    this.activeKeyIndex = 0;
    this.keyRotationDelay = 60000; // 1 minute cooldown for failed keys

    if (this.enabled && process.env.DEBUG_MODE === 'true') {
      logger.debug('OpenRouter initialized:', {
        keys: this.apiKeys.map(k => '****' + k.key.slice(-4)).join(', ')
      });
    }
  }

  isProviderDisabled() {
    return this.lastProviderError &&
           (Date.now() - this.lastProviderError.timestamp < this.providerDisableTime);
  }

  getCurrentKey() {
    // If provider is in temporary disable state, return null
    if (this.isProviderDisabled()) {
      throw this.lastProviderError.error;
    }

    const now = Date.now();
    for (let i = 0; i < this.apiKeys.length; i++) {
      const keyIndex = (this.activeKeyIndex + i) % this.apiKeys.length;
      const keyInfo = this.apiKeys[keyIndex];
      
      if (!keyInfo.lastError || now - keyInfo.lastError >= this.keyRotationDelay) {
        this.activeKeyIndex = keyIndex;
        return keyInfo.key;
      }
    }
    return null;
  }

  handleKeyError(error) {
    const now = Date.now();
    const currentKey = this.apiKeys[this.activeKeyIndex];
    if (currentKey) {
      currentKey.lastError = {
        timestamp: now,
        error: error.message,
        code: error.status || 'unknown'
      };
    }

    // Log failed key attempt
    if (process.env.DEBUG_MODE === 'true') {
      logger.debug('OpenRouter key error:', {
        key: '****' + currentKey?.key.slice(-4),
        error: error.message,
        status: error.status,
        remainingKeys: this.apiKeys.length - 1
      });
    }

    // Count how many keys are currently in error state
    const failedKeys = this.apiKeys.filter(k =>
      k.lastError && (now - k.lastError.timestamp < this.keyRotationDelay)
    );
    
    // If all keys have failed, disable the provider temporarily
    if (failedKeys.length === this.apiKeys.length) {
      this.lastProviderError = {
        timestamp: now,
        error: error,
        failedKeys: failedKeys.map(k => ({
          key: '****' + k.key.slice(-4),
          lastError: k.lastError
        }))
      };
      throw new Error(`All API keys failed (${failedKeys.length} total): ${error.message}`);
    }
    
    // Try next key with exponential backoff
    let nextKeyIndex = (this.activeKeyIndex + 1) % this.apiKeys.length;
    while (
      this.apiKeys[nextKeyIndex].lastError &&
      (now - this.apiKeys[nextKeyIndex].lastError.timestamp <
       Math.min(this.keyRotationDelay * Math.pow(2, this.apiKeys[nextKeyIndex].lastError.attempts || 0),
       1000 * 60 * 60)) // Max 1 hour backoff
    ) {
      nextKeyIndex = (nextKeyIndex + 1) % this.apiKeys.length;
    }
    
    this.activeKeyIndex = nextKeyIndex;
    if (this.apiKeys[nextKeyIndex].lastError) {
      this.apiKeys[nextKeyIndex].lastError.attempts =
        (this.apiKeys[nextKeyIndex].lastError.attempts || 0) + 1;
    }
  }

  formatModelName(modelId) {
    // For display/storage, always add openrouter/ prefix
    if (!modelId.startsWith('openrouter/')) {
      return `openrouter/${modelId}`;
    }
    return modelId;
  }

  getBaseModelName(model) {
    // For API requests, remove openrouter/ prefix
    if (model.startsWith('openrouter/')) {
      return model.substring('openrouter/'.length);
    }
    return model;
  }

  disableModel(model) {
    // store the full prefixed name
    const fullName = this.formatModelName(model);
    this.disabledModels.add(fullName);
    logger.debug(`Model disabled due to quota:`, {
      model: fullName,
      reason: 'Quota exceeded'
    });
    delete this.config.models[this.getBaseModelName(model)];
  }

  getModelOwner(modelId) {  
    return 'https://openrouter.ai';
  }

  async updateAvailableModels() {
    if (!this.enabled) return [];

    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval && Object.keys(this.config.models).length > 0) {
      return Object.keys(this.config.models).map(id => this.formatModelName(id));
    }

    try {
      const apiKey = this.getCurrentKey();
      if (!apiKey) {
        throw new Error('No valid API keys available');
      }

      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.enabled = false;
          throw new Error('Invalid API key');
        }
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const newConfig = { models: {} };

      data.data.forEach(model => {
        // Skip ignored models and paid models
        if (IGNORED_MODELS.has(model.id)) return;
        
        // Only include models that are free ($0) or have ":free" in their name
        const isFreeModel = (
          (model.pricing?.prompt === 0 && model.pricing?.completion === 0) ||
          model.id.includes(':free')
        );
        
        if (!isFreeModel) return;

        // Add model to config if not disabled
        const modelId = this.formatModelName(model.id);
        if (!this.disabledModels.has(modelId)) {
          newConfig.models[model.id] = {
            display_name: model.name || model.id,
            context_length: model.context_length || 4096,
            pricing: model.pricing || { prompt: 0, completion: 0 },
            fallback: null // OpenRouter doesn't provide fallback info
          };
        }
      });

      this.config = newConfig;
      this.lastUpdate = now;
      return Object.keys(this.config.models).map(id => this.formatModelName(id));
    } catch (error) {
      logger.error('Failed to fetch OpenRouter models:', {
        error: error.message,
        status: error.status,
        details: error.details || null
      });
      if (error.message.includes('Invalid API key')) {
        this.enabled = false;
      }
      return Object.keys(this.config.models).map(id => this.formatModelName(id));
    }
  }

  async *handleStream(reader, model) {
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append new chunk to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines from buffer
        while (true) {
          const lineEnd = buffer.indexOf('\n');
          if (lineEnd === -1) break;

          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);

          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                const chunk = {
                  id: parsed.id || ('or-' + Math.random().toString(36).substring(2)),
                  object: 'chat.completion.chunk',
                  created: parsed.created || Math.floor(Date.now() / 1000),
                  model: this.formatModelName(model), // Add prefix to model name
                  choices: [{
                    index: 0,
                    delta: { content },
                    finish_reason: parsed.choices?.[0]?.finish_reason
                  }]
                };
                yield chunk;
              }
            } catch (e) {
              logger.error('Failed to parse stream chunk:', {
                error: e.message,
                chunk: data,
                model: model
              });
            }
          }
        }
      }
    } finally {
      reader.cancel();
    }
  }

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('OpenRouter provider is not enabled');
    }

    const { model, stream, timeout, ...restOptions } = options;
    if (!model) {
      throw new Error('Model is required');
    }
    
    // openrouter doesn't support timeout option

    // Remove openrouter/ prefix for API request
    const baseModel = this.getBaseModelName(model);

    try {
      // Clean up options and messages
      const cleanOptions = restOptions;
      const cleanMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Setup request headers
      const headers = {
        'Authorization': `Bearer ${this.getCurrentKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/OpenRouterTeam/openrouter.dev', // Required for privacy settings
        'X-Title': 'HackClub-API', // App name
        'X-Privacy-Policy': 'true' // Enable data sharing/training
      };

      // Add Accept header for streaming
      if (stream) {
        headers['Accept'] = 'text/event-stream';
      }

      // Make request to OpenRouter API
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: baseModel, // Use unprefixed model name
          messages: cleanMessages,
          stream: Boolean(stream),
          ...cleanOptions
        })
      });

      if (!response.ok) {
        let errorText = `${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorText = errorData.error?.message || errorText;
        } catch {}

        const error = new Error(`OpenRouter API error: ${errorText}`);
        error.status = response.status;

        // Handle rate limits and auth errors by rotating keys
        if (response.status === 429 || response.status === 402 || response.status === 401 || response.status === 403) {
          this.handleKeyError(error);
          return this.chat(messages, options); // Retry with next key
        }

        throw error;
      }

      if (stream) {
        // Get the reader for streaming
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }
        return this.handleStream(reader, baseModel);
      }

      // Handle regular response
      const completion = await response.json();
      
      // Handle rate limit responses
      if (completion.error) {
        const error = new Error(completion.error.message || 'Unknown error');
        error.status = completion.error.code;
        error.details = completion.error.metadata;
        throw error;
      }
      
      // Log raw response for debugging
      if (process.env.DEBUG_MODE === 'true') {
        logger.debug(`Raw response from ${baseModel}:`, {
          id: completion.id,
          model: completion.model,
          finish_reason: completion.choices?.[0]?.finish_reason,
          content: completion.choices?.[0]?.message?.content?.slice(0, 100) +
                  (completion.choices?.[0]?.message?.content?.length > 100 ? '...' : '') || 'null',
          usage: completion.usage || null
        });
      }

      // Only transform valid responses
      if (completion.choices?.[0]?.message?.content || completion.choices?.[0]?.delta?.content) {
        return this.transformResponse(completion, baseModel);
      }

      throw new Error(`Invalid response from model: ${JSON.stringify(completion)}`);
    } catch (error) {
      // Remove openrouter/ prefix for API request
      const baseModel = this.getBaseModelName(model);

      if (process.env.DEBUG_MODE === 'true') {
        logger.error('OpenRouter API error:', {
          error: error.message,
          status: error.status,
          model: baseModel,
          details: error.details || null,
          response: error.response || null
        });
      }

      // Handle errors not already caught by response.ok check
      if (error.status === 429 || error.status === 402 || error.status === 401 || error.status === 403) {
        const currentKey = this.apiKeys[this.activeKeyIndex];
        if (currentKey) {
          currentKey.lastError = Date.now();
        }

        const failedKeys = this.apiKeys.filter(k => k.lastError &&
          (Date.now() - k.lastError < this.keyRotationDelay));

        if (failedKeys.length === this.apiKeys.length) {
          this.lastProviderError = {
            timestamp: Date.now(),
            error: error
          };
        } else {
          this.activeKeyIndex = (this.activeKeyIndex + 1) % this.apiKeys.length;
          if (this.getCurrentKey()) {
            return this.chat(messages, options); // Retry with next key
          }
        }
      }

      if (error.status === 402) {
        this.disableModel(model);
      }

      throw error;
    }
  }
}

export default new OpenRouterProvider();