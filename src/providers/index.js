// providers/index.js - manage all our lovely ai friends
import logger from '../utils/logger.js';

// Only import providers that are enabled via environment variables
const providers = [];

// Helper to dynamically import enabled providers
async function importProvider(name, path, noKeyRequired = false) {
  if (process.env[`ENABLE_${name.toUpperCase()}`] !== 'false') {
    try {
      const module = await import(path);
      providers.push({
        instance: module.default,
        name: `${name}Provider`,
        envKey: noKeyRequired ? null : `${name.toUpperCase()}_API_KEY`
      });
    } catch (error) {
      logger.error(`Failed to import ${name} provider:`, error);
    }
  }
}

// Import enabled providers
await importProvider('VOIDS', './voids.js');
await importProvider('OPENROUTER', './openrouter.js');
await importProvider('DREAMGEN', './dreamgen.js');
await importProvider('MENTION', './mention.js', true); // No API key needed
await importProvider('GOOGLE', './google.js');
await importProvider('GLAMA', './glama.js');
await importProvider('GROQ', './groq.js');
await importProvider('HUGGINGCHAT', './huggingchat.js', true); // Uses email/password
await importProvider('HACKCLUB', './hackclub.js', true); // No API key needed
await importProvider('OPENAI', './openai.js');
await importProvider('CLAUDE', './claude.js');
await importProvider('DEEPSEEK', './deepseek.js');
await importProvider('DEEPSEEK_FREE', './deepseek-free.js');
await importProvider('TOGETHER', './together.js');
await importProvider('PERPLEXITY', './perplexity.js');
await importProvider('CEREBRAS', './cerebras.js');
await importProvider('FIREWORKS', './fireworks.js');
await importProvider('MISTRAL', './mistral.js');
await importProvider('DEEPINFRA', './deepinfra.js');
await importProvider('COPILOT_MORE', './copilot-more.js', true); // Only needs URL
await importProvider('LLMUI', './llm-ui.js', true); // No API key needed

class ProviderManager {
  constructor() {
    this.providers = [];
    this.disabledProviders = new Set();
    this.providerErrors = new Map(); // Tracks errors for status
    this.rateLimits = new Map(); // { [providerName]: { timestamp: number, delay: number } } - Tracks last request time
    this.rateLimitedProviders = new Map(); // { [providerName]: { limitedUntil: number, reason: string } } - Tracks temporary rate limits
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    this.rateLimitCooldown = 60 * 60 * 1000; // 1 hour cooldown for rate limits
    
    // Use dynamically loaded providers
    this.providerConfigs = providers;

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
    const providerName = provider.constructor.name;
    if (this.disabledProviders.has(providerName)) {
        // logger.debug(`Provider ${providerName} is permanently disabled.`);
        return false; // Permanently disabled
    }
    // Check if temporarily rate-limited
    const limitInfo = this.rateLimitedProviders.get(providerName);
    if (limitInfo && Date.now() < limitInfo.limitedUntil) {
        // logger.debug(`Provider ${providerName} is temporarily rate-limited until ${new Date(limitInfo.limitedUntil).toISOString()}.`);
        return false; // Still rate-limited
    } else if (limitInfo) {
        // Cooldown expired, remove from rate-limited map
        this.rateLimitedProviders.delete(providerName);
        logger.info(`Provider rate limit cooldown expired: ${providerName}`);
        // Also clear related errors for status display
        if (this.providerErrors.has(providerName) && this.providerErrors.get(providerName).error.includes('rate limit')) {
            this.providerErrors.delete(providerName);
        }
    }
    return true; // Not disabled or rate-limited
  }

  // Sets a provider as rate-limited for a duration
  setProviderRateLimited(providerName, reason) {
    const limitedUntil = Date.now() + this.rateLimitCooldown;
    this.rateLimitedProviders.set(providerName, { limitedUntil, reason });
    logger.warn(`Provider ${providerName} is rate-limited until ${new Date(limitedUntil).toISOString()}. Reason: ${reason}`);
    // Add error for status display, ensuring it reflects the temporary nature
    this.providerErrors.set(providerName, {
        error: `Temporarily rate limited: ${reason}`, // Indicate temporary nature
        timestamp: Date.now()
    });
  }

  checkRateLimit(provider, operation = 'chat') {
    // Always skip rate limiting for model listing and health checks
    if (operation === 'models' || operation === 'health') {
      return;
    }

    // Skip if rate limiting is disabled globally
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      return;
    }

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
        this.checkRateLimit(provider, 'models');
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
        
        // Handle rate limits vs other errors
        if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
            this.setProviderRateLimited(provider.constructor.name, error.message);
        } else if (error.status !== 503) { // Don't disable for 503 (Service Unavailable)
            this.disableProvider(provider);
        }
        // No need for updateRateLimit here as setProviderRateLimited handles the cooldown implicitly
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
        this.checkRateLimit(provider, 'models');
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
        // Handle rate limits vs other errors
        if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
            this.setProviderRateLimited(provider.constructor.name, error.message);
        } else if (error.status !== 503) { // Don't disable for 503
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
    
    // Add detailed logging before validation
    messages.forEach((msg, index) => {
        try {
            this.validateMessage(msg);
        } catch (validationError) {
            logger.error(`Message validation failed for message at index ${index}:`, {
                messageContent: JSON.stringify(msg), // Log the problematic message
                validationError: validationError.message,
                model: model
            });
            // Re-throw the original error but attach context
            validationError.message = `Invalid message content at index ${index}: ${validationError.message}`;
            validationError.status = 500; // Internal server error due to bad data structure
            validationError.type = 'server_error';
            throw validationError;
        }
    });

    this.validateOptions(options);
    let attempt = 0;
    let lastError = null;
    while (attempt < this.retryAttempts) {
      try {
        const provider = await this.getProviderForModel(model);
        this.checkRateLimit(provider, 'chat');

        // Check for streaming support
        if (options.stream) {
          if (provider.supportsStreaming === true) {
            // Provider supports streaming, call it directly
            const responseStream = await provider.chat(messages, { ...options, model });
            this.updateRateLimit(provider); // Update rate limit after successful call initiation
            return responseStream; // Return the async generator
          } else {
            // Provider does NOT support streaming, implement fake streaming
            logger.debug(`Provider ${provider.constructor.name} does not support streaming for ${model}. Faking stream.`);
            // Call without stream option
            const fullResponse = await provider.chat(messages, { ...options, stream: false, model });
            this.updateRateLimit(provider);
            // Convert the full response to a stream
            return this._fakeStreamResponse(fullResponse, model);
          }
        } else {
          // Non-streaming request
          const response = await provider.chat(messages, { ...options, model });
          this.updateRateLimit(provider);
          return response;
        }
      } catch (error) {
        attempt++;
        lastError = error;
        
        // Handle transient errors differently
        // Handle transient errors (including rate limits for retry purposes)
        if ((error.status === 429 || error.status === 503 || error.message.toLowerCase().includes('rate limit')) && attempt < this.retryAttempts) {
            // If it's a rate limit error, mark the provider as rate limited
            if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
                // Get provider name - might need to fetch it again if error doesn't contain it
                let providerName = error.provider;
                if (!providerName) {
                    try {
                        // Attempt to get provider name from the model, handle potential failure
                        const failedProvider = await this.getProviderForModel(model);
                        providerName = failedProvider.constructor.name;
                    } catch (e) {
                        logger.warn(`Could not determine provider name for rate limit error on model ${model}`);
                    }
                }
                if (providerName) {
                    this.setProviderRateLimited(providerName, error.message);
                }
            }
            // Apply delay and retry
            const delay = this.retryDelay * Math.pow(2, attempt - 1);
            logger.debug(`Transient error for ${model} (attempt ${attempt}/${this.retryAttempts}), retrying in ${delay}ms...`, { error: error.message, status: error.status });
            await this.sleep(delay);
            continue;
        } else if (error.status >= 500 && error.status !== 503 && attempt < this.retryAttempts) { // Exclude 503 from generic 500 retry
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
          // Disable provider on fatal auth errors (401/403), but not for rate limits (429)
          if ((error.status === 401 || error.status === 403) && error.provider) {
            this.disableProvider({ constructor: { name: error.provider }});
          }
        }
        throw error;
      }
    }
    throw new Error(`Max retry attempts exceeded. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  // Helper function to simulate streaming from a full response
  async* _fakeStreamResponse(fullResponse, model) {
    const completionId = fullResponse.id || `fake-${Date.now()}`;
    const created = fullResponse.created || Date.now();
    const choice = fullResponse.choices?.[0];

    if (!choice || !choice.message || typeof choice.message.content !== 'string') {
      logger.error('Cannot fake stream: Invalid full response format.', fullResponse);
      // Yield a single error chunk? Or just end? Let's end.
      return;
    }

    const content = choice.message.content;
    const finishReason = choice.finish_reason || 'stop';

    // 1. Yield initial role chunk
    yield {
      id: completionId,
      object: 'chat.completion.chunk',
      created: created,
      model: model, // Use the requested model name
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: '' }, // Start with role and empty content
        finish_reason: null
      }]
    };

    // 2. Yield content chunks (split into smaller parts for simulation)
    // Simple split by word, could be more sophisticated (e.g., by sentence or token count estimate)
    const words = content.split(/(\s+)/); // Split by space, keeping spaces
    for (let i = 0; i < words.length; i++) {
       // Add a small delay to simulate network latency
       await this.sleep(10); // 10ms delay between chunks

       yield {
         id: completionId,
         object: 'chat.completion.chunk',
         created: created,
         model: model,
         choices: [{
           index: 0,
           delta: { content: words[i] },
           finish_reason: null
         }]
       };
    }


    // 3. Yield final chunk with finish reason
    yield {
      id: completionId,
      object: 'chat.completion.chunk',
      created: created,
      model: model,
      choices: [{
        index: 0,
        delta: {}, // Empty delta
        finish_reason: finishReason
      }]
    };
  }


  getProviderStatus() {
    return {
      // Combine permanently disabled and temporarily rate-limited providers for status
      available: this.providers.filter(p => p.enabled && this.isProviderEnabled(p)).map(p => p.constructor.name),
      disabled: Array.from(this.disabledProviders),
      rate_limited: Object.fromEntries(Array.from(this.rateLimitedProviders.entries()).map(([name, info]) => [name, { until: new Date(info.limitedUntil).toISOString(), reason: info.reason }])),
      errors: Object.fromEntries(this.providerErrors),
      // rateLimits map is internal timing detail, maybe not needed in public status
    };
  }
}

export default new ProviderManager();
