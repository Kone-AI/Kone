// base.js - provider interface and types

/**
 * @typedef {Object} ModelConfig
 * @property {string} display_name - Display name for the model
 * @property {number} context_length - Maximum context length
 * @property {string|null} fallback - Fallback model ID if this model fails
 * @property {Object} pricing - Model pricing information
 * @property {number} pricing.prompt - Cost per 1K tokens for prompts
 * @property {number} pricing.completion - Cost per 1K tokens for completions
 */

/**
 * @typedef {Object} ProviderConfig
 * @property {Object.<string, ModelConfig>} models - Map of model IDs to their configurations
 */

/**
 * @typedef {Object} Message
 * @property {string} role - The role of the message sender (e.g., 'user', 'assistant', 'system')
 * @property {string} content - The content of the message
 */

/**
 * @typedef {Object} ChatOptions
 * @property {boolean} [stream] - Whether to stream the response
 * @property {number} [temperature] - Temperature for response generation
 * @property {number} [max_tokens] - Maximum tokens in response
 * @property {string} model - Model identifier
 */

/**
 * @typedef {Object} ModelCapabilities
 * @property {boolean} text - Whether the model supports text
 * @property {boolean} images - Whether the model supports images
 * @property {boolean} [audio] - Whether the model supports audio
 * @property {boolean} [video] - Whether the model supports video
 * @property {string} [tokenizer] - The tokenizer used by the model
 */

/**
 * @typedef {Object} ModelInfo
 * @property {string} id - The model identifier
 * @property {string} display_name - Display name for the model
 * @property {string} object - Type of object (usually 'model')
 * @property {number} created - Creation timestamp
 * @property {string} owned_by - Model owner/provider
 * @property {Array} permission - Permission settings
 * @property {string} root - Base model identifier
 * @property {string|null} parent - Parent model identifier
 * @property {number} context_length - Maximum context length
 * @property {ModelCapabilities} capabilities - Model capabilities
 * @property {Object} pricing - Model pricing information
 */

/**
 * @typedef {Object} ChatResponseChoice
 * @property {number} index - Choice index
 * @property {Message} message - Response message
 * @property {string|null} finish_reason - Why generation stopped
 */

/**
 * @typedef {Object} ChatResponse
 * @property {string} id - Response identifier
 * @property {string} object - Type of object (usually 'chat.completion')
 * @property {number} created - Creation timestamp
 * @property {string} model - Model used
 * @property {ChatResponseChoice[]} choices - Response choices
 * @property {Object} usage - Token usage statistics
 */

/**
 * Base Provider Interface
 * @interface
 */
class Provider {
  /** @type {boolean} */
  supportsStreaming = false;

  /** @type {ProviderConfig} */
  config = null;

  /**
   * Initialize provider with configuration
   * @param {ProviderConfig} config - Provider configuration
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Get model configuration
   * @param {string} modelId - Model identifier
   * @returns {ModelConfig|null} - Model configuration if available
   */
  getModelConfig(modelId) {
    return this.config?.models?.[modelId] || null;
  }

  /**
   * Get display name for a model
   * @param {string} modelId - Model identifier
   * @returns {string} - Display name or model ID if not configured
   */
  getDisplayName(modelId) {
    const config = this.getModelConfig(modelId);
    return config?.display_name || modelId;
  }

  /**
   * Get fallback model for a given model
   * @param {string} modelId - Model identifier
   * @returns {string|null} - Fallback model ID if available
   */
  getFallbackModel(modelId) {
    const config = this.getModelConfig(modelId);
    return config?.fallback || null;
  }

  /**
   * Calculate cost for token usage
   * @param {string} modelId - Model identifier
   * @param {Object} usage - Token usage statistics
   * @returns {Object} - Cost breakdown and total
   */
  calculateCost(modelId, usage) {
    const config = this.getModelConfig(modelId);
    if (!config || !config.pricing) return { prompt: 0, completion: 0, total: 0 };

    const promptCost = (usage.prompt_tokens / 1000) * config.pricing.prompt;
    const completionCost = (usage.completion_tokens / 1000) * config.pricing.completion;

    return {
      prompt: promptCost,
      completion: completionCost,
      total: promptCost + completionCost
    };
  }

  /**
   * Check if provider can handle this model
   * @param {string} model - Model identifier to check
   * @returns {Promise<boolean>} - Whether provider can handle model
   */
  async canHandle(model) {
    const config = this.getModelConfig(model);
    return config !== null;
  }

  /**
   * Send chat request to provider
   * @param {Message[]} messages - Chat messages
   * @param {ChatOptions} options - Chat options
   * @returns {Promise<ChatResponse|AsyncGenerator>} - Chat response
   */
  async chat(messages, options) {
    throw new Error('Not implemented');
  }

  /**
   * Get available models from provider
   * @returns {Promise<ModelInfo[]>} - Available models
   */
  async getModels() {
    return Object.entries(this.config?.models || {}).map(([id, config]) => ({
      id,
      display_name: config.display_name,
      object: 'model',
      created: Date.now(),
      owned_by: this.constructor.name,
      permission: [],
      root: id,
      parent: null,
      context_length: config.context_length,
      capabilities: {
        text: true,
        images: false,
        audio: false,
        video: false
      },
      pricing: config.pricing
    }));
  }
}

export default Provider;