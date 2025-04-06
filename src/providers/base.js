// base.js - provider interface and types

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
 * @property {string} object - Type of object (usually 'model')
 * @property {number} created - Creation timestamp
 * @property {string} owned_by - Model owner/provider
 * @property {Array} permission - Permission settings
 * @property {string} root - Base model identifier
 * @property {string|null} parent - Parent model identifier
 * @property {number} context_length - Maximum context length
 * @property {ModelCapabilities} capabilities - Model capabilities
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

  /**
   * Format a model name with provider prefix
   * @param {string} modelId - Raw model identifier
   * @returns {string} - Formatted model identifier
   */
  formatModelName(modelId) {
    throw new Error('Not implemented');
  }

  /**
   * Get base model name without provider prefix
   * @param {string} model - Formatted model identifier
   * @returns {string} - Base model name
   */
  getBaseModelName(model) {
    throw new Error('Not implemented');
  }

  /**
   * Check if provider can handle this model
   * @param {string} model - Model identifier to check
   * @returns {Promise<boolean>} - Whether provider can handle model
   */
  async canHandle(model) {
    throw new Error('Not implemented');
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
    throw new Error('Not implemented');
  }
}

export default Provider;