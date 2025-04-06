// providers/index.js - manage all our lovely ai friends
import logger from '../utils/logger.js';

// Import all providers
import VoidsProvider from './voids.js';
import OpenRouterProvider from './openrouter.js';
import GoogleProvider from './google.js';
import GlamaProvider from './glama.js';
import GroqProvider from './groq.js';
import HuggingChatProvider from './huggingchat.js';
import HackClubProvider from './hackclub.js';
import OpenAIProvider from './openai.js';
import ClaudeProvider from './claude.js';
import DeepseekProvider from './deepseek.js';
import DeepseekFreeProvider from './deepseek-free.js';
import TogetherProvider from './together.js';
import PerplexityProvider from './perplexity.js';
import CerebrasProvider from './cerebras.js';
import FireworksProvider from './fireworks.js';
import MistralProvider from './mistral.js';
import DeepInfraProvider from './deepinfra.js';
import CopilotMoreProvider from './copilot-more.js';

class ProviderManager {
  constructor() {
    this.providers = [];
    this.disabledProviders = new Set();
    this.providerErrors = new Map();
    this.rateLimits = new Map();
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    
    this.providerConfigs = [
      { instance: VoidsProvider, envKey: 'VOIDS_API_KEY', name: 'VoidsProvider' },
      { instance: OpenRouterProvider, envKey: 'OPENROUTER_API_KEY', name: 'OpenRouterProvider' },
      { instance: GoogleProvider, envKey: 'GOOGLE_API_KEY', name: 'GoogleProvider' },
      { instance: GlamaProvider, envKey: 'GLAMA_API_KEY', name: 'GlamaProvider' },
      { instance: GroqProvider, envKey: 'GROQ_API_KEY', name: 'GroqProvider' },
      { instance: HuggingChatProvider, envKey: 'HUGGINGFACE_EMAIL', name: 'HuggingChatProvider' },
      { instance: HackClubProvider, name: 'HackClubProvider' },
      { instance: OpenAIProvider, envKey: 'OPENAI_API_KEY', name: 'OpenAIProvider' },
      { instance: ClaudeProvider, envKey: 'ANTHROPIC_API_KEY', name: 'ClaudeProvider' },
      { instance: DeepseekProvider, envKey: 'DEEPSEEK_API_KEY', name: 'DeepseekProvider' },
      { instance: DeepseekFreeProvider, envKey: 'DEEPSEEK_FREE_API_KEY', name: 'DeepseekFreeProvider' },
      { instance: TogetherProvider, envKey: 'TOGETHER_API_KEY', name: 'TogetherProvider' },
      { instance: PerplexityProvider, envKey: 'PERPLEXITY_API_KEY', name: 'PerplexityProvider' },
      { instance: CerebrasProvider, envKey: 'CEREBRAS_API_KEY', name: 'CerebrasProvider' },
      { instance: FireworksProvider, envKey: 'FIREWORKS_API_KEY', name: 'FireworksProvider' },
      { instance: MistralProvider, envKey: 'MISTRAL_API_KEY', name: 'MistralProvider' },
      { instance: DeepInfraProvider, envKey: 'DEEPINFRA_API_KEY', name: 'DeepInfraProvider' },
      { instance: CopilotMoreProvider, name: 'CopilotMoreProvider' }
    ];

    this.initializeProviders();
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  initializeProviders() {
    for (const config of this.providerConfigs) {
      try {
        // Check if provider is explicitly disabled by ENABLE flag
        const enableFlag = `ENABLE_${config.name.replace('Provider', '').toUpperCase()}`;
        const isExplicitlyDisabled = process.env[enableFlag] === 'false';
        
        if (isExplicitlyDisabled) {
          logger.debug(`Provider disabled by config:`, {
            provider: config.name
          });
          this.disabledProviders.add(config.name);
          continue;
        }

        // Check if provider has required configuration
        const hasConfig = !config.envKey || process.env[config.envKey];
        if (hasConfig) {
          let instance = config.instance;
          
          // If provider is a class (not an instance), instantiate it
          if (typeof instance === 'function' || !instance.enabled) {
            instance = new config.instance();
          }

          if (instance.enabled) {
            this.providers.push(instance);
            logger.debug(`Provider initialized:`, {
              provider: config.name,
              status: 'enabled'
            });
          } else {
            this.disabledProviders.add(config.name);
            logger.debug(`Provider initialized:`, {
              provider: config.name,
              status: 'disabled'
            });
          }
        } else {
          logger.debug(`Provider missing configuration:`, {
            provider: config.name
          });
          this.disabledProviders.add(config.name);
          // Only add error if provider isn't explicitly disabled
          if (!isExplicitlyDisabled) {
            this.providerErrors.set(config.name, {
              error: 'Missing required configuration',
              timestamp: Date.now()
            });
          }
        }
      } catch (error) {
        logger.error(`Failed to initialize provider:`, {
          provider: config.name,
          error: error.message,
          stack: error.stack
        });
        this.disabledProviders.add(config.name);
        // Only add error if provider isn't explicitly disabled
        const enableFlag = `ENABLE_${config.name.replace('Provider', '').toUpperCase()}`;
        if (process.env[enableFlag] !== 'false') {
          this.providerErrors.set(config.name, {
            error: error.message,
            timestamp: Date.now()
          });
        }
      }
    }

    // Log summary if debug mode
    logger.debug('Provider initialization complete:', {
      enabled: this.providers.map(p => p.constructor.name),
      disabled: Array.from(this.disabledProviders),
      errors: Object.fromEntries(this.providerErrors),
      total_enabled: this.providers.length,
      total_disabled: this.disabledProviders.size
    });
  }

  validateMessage(msg) {
    if (!msg || typeof msg !== 'object') {
      throw new Error('invalid message format');
    }
    if (!['user', 'assistant', 'system'].includes(msg.role)) {
      throw new Error(`invalid message role: ${msg.role}`);
    }
    if (Array.isArray(msg.content)) {
      msg.content.forEach(part => {
        if (part.type === 'text' && typeof part.text !== 'string') {
          throw new Error('invalid text content');
        }
        if (part.type === 'image_url' && (!part.image_url || typeof part.image_url.url !== 'string')) {
          throw new Error('invalid image content');
        }
      });
    } else if (typeof msg.content !== 'string') {
      throw new Error('invalid message content');
    }
    return true;
  }

  validateOptions(options) {
    const { temperature, max_tokens } = options;
    if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
      throw new Error('temperature must be between 0 and 2');
    }
    if (max_tokens !== undefined && (typeof max_tokens !== 'number' || max_tokens < 1)) {
      throw new Error('max_tokens must be a positive number');
    }
    return true;
  }

  disableProvider(provider) {
    const name = provider.constructor.name;
    this.disabledProviders.add(name);
    logger.debug(`Provider disabled:`, {
      provider: name,
      reason: 'error'
    });
    // Only add error if provider isn't explicitly disabled
    const enableFlag = `ENABLE_${name.replace('Provider', '').toUpperCase()}`;
    if (process.env[enableFlag] !== 'false') {
      this.providerErrors.set(name, { 
        error: 'provider disabled due to error', 
        timestamp: Date.now() 
      });
    }
    this.providers = this.providers.filter(p => p.constructor.name !== name);
  }

  isProviderEnabled(provider) {
    return !this.disabledProviders.has(provider.constructor.name);
  }

  checkRateLimit(provider) {
    if (process.env.DISABLE_RATE_LIMIT === 'true') return;
    const now = Date.now();
    const limit = this.rateLimits.get(provider.constructor.name);
    let delay = limit?.delay || 1000;
    if (process.env.ENABLE_HEALTH_CHECKS !== 'false') {
      delay = parseInt(process.env.HEALTH_CHECK_DELAY) + 400;
    }
    if (limit && now - limit.timestamp < delay) {
      throw new Error('rate limit exceeded');
    }
  }

  updateRateLimit(provider, delay = 1000) {
    this.rateLimits.set(provider.constructor.name, { timestamp: Date.now(), delay });
  }

  async getAvailableModels() {
    const modelsByProvider = new Map();
    const errors = [];

    // Collect models from each provider and group by provider
    for (const provider of this.providers) {
      if (!this.isProviderEnabled(provider) || !provider.enabled) continue;
      try {
        this.checkRateLimit(provider);
        const providerModels = await provider.getModels();
        modelsByProvider.set(provider.constructor.name, providerModels);
        this.updateRateLimit(provider);
      } catch (error) {
        logger.error(`Failed to get models from provider:`, {
          provider: provider.constructor.name,
          error: error.message,
          status: error.status || null,
          details: error.details || null
        });
        errors.push({ provider: provider.constructor.name, error: error.message });
        
        // Only disable provider on non-transient errors
        if (error.status !== 429 && error.status !== 503) {
          this.disableProvider(provider);
        } else {
          this.updateRateLimit(provider, 1000 * Math.pow(2, errors.length));
        }
      }
    }

    // Sort providers by model count (ascending) and provider name
    const sortedProviders = Array.from(modelsByProvider.entries())
      .sort((a, b) => {
        const countDiff = a[1].length - b[1].length;
        return countDiff !== 0 ? countDiff : a[0].localeCompare(b[0]);
      });

    // Flatten sorted models into single array
    const models = sortedProviders.reduce((acc, [_, providerModels]) => {
      acc.push(...providerModels);
      return acc;
    }, []);
    if (models.length === 0) {
      const message = errors.length > 0 ?
        'Failed to get models from any provider: ' + errors.map(e => `${e.provider} (${e.error})`).join(', ') :
        'No enabled providers available';
      throw new Error(message);
    }
    return models;
  }

  async getProviderForModel(model) {
    if (!model) throw new Error('model is required');
    const errors = [];
    for (const provider of this.providers) {
      if (!this.isProviderEnabled(provider) || !provider.enabled) continue;
      try {
        this.checkRateLimit(provider);
        if (await provider.canHandle(model)) return provider;
        this.updateRateLimit(provider);
      } catch (error) {
        logger.error(`Provider error:`, {
          provider: provider.constructor.name,
          error: error.message,
          status: error.status || null,
          details: error.details || null
        });
        errors.push({ provider: provider.constructor.name, error: error.message });
        if (error.status === 429 || error.status === 503) {
          this.updateRateLimit(provider, 1000 * Math.pow(2, errors.length));
        } else {
          this.disableProvider(provider);
        }
      }
    }
    throw {
      message: `No provider available for model: ${model}. Errors: ${errors.map(e => `${e.provider} (${e.error})`).join(', ')}`,
      type: 'invalid_request_error', 
      param: 'model', 
      code: 'model_not_found'
    };
  }

  async chat(model, messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages must be a non-empty array');
    messages.forEach(msg => this.validateMessage(msg));
    this.validateOptions(options);
    let attempt = 0;
    let lastError = null;
    while (attempt < this.retryAttempts) {
      try {
        const provider = await this.getProviderForModel(model);
        this.checkRateLimit(provider);
        if (options.stream && !provider.supportsStreaming) {
          throw { message: `Streaming not supported by provider for model: ${model}`, type: 'invalid_request_error', param: 'stream', code: 'streaming_not_supported' };
        }
        const response = await provider.chat(messages, { ...options, model });
        this.updateRateLimit(provider);
        return response;
      } catch (error) {
        attempt++;
        lastError = error;
        
        // Handle transient errors differently
        if ((error.status === 429 || error.status === 503) && attempt < this.retryAttempts) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
          continue;
        } else if (error.status >= 500 && attempt < this.retryAttempts) {
          await this.sleep(this.retryDelay);
          continue;
        }
        if (error.provider) {
          // Only add error if provider isn't explicitly disabled
          const enableFlag = `ENABLE_${error.provider.replace('Provider', '').toUpperCase()}`;
          if (process.env[enableFlag] !== 'false') {
            this.providerErrors.set(error.provider, { 
              error: error.message, 
              timestamp: Date.now() 
            });
          }
          if (error.status === 401 || error.status === 403) {
            this.disableProvider({ constructor: { name: error.provider }});
          }
        }
        throw error;
      }
    }
    throw new Error(`Max retry attempts exceeded. Last error: ${lastError.message}`);
  }

  getProviderStatus() {
    return {
      available: this.providers.filter(p => p.enabled && this.isProviderEnabled(p)).map(p => p.constructor.name),
      disabled: Array.from(this.disabledProviders),
      errors: Object.fromEntries(this.providerErrors),
      rateLimits: Object.fromEntries(this.rateLimits)
    };
  }
}

export default new ProviderManager();