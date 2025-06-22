// providers/index.js - manage all our lovely ai friends
import logger from '../utils/logger.js';

// Only import providers that are enabled via environment variables
const providers = [];

// Helper to dynamically import enabled providers
async function importProvider(name, path, noKeyRequired = false) {
  try {
    // Only proceed if provider is enabled or not explicitly disabled
    if (process.env[`ENABLE_${name.toUpperCase()}`] !== 'false') {
      logger.debug(`Importing provider ${name} from ${path}`);
      
      // Import the module
      const module = await import(path);
      
      if (!module.default) {
        throw new Error(`No default export found in ${path}`);
      }

      // Create provider config
      const config = {
        instance: module.default,
        name: `${name}Provider`,
        envKey: noKeyRequired ? null : `${name.toUpperCase()}_API_KEY`
      };

      // Add to providers array
      providers.push(config);
      logger.debug(`Successfully imported ${name} provider`);
    } else {
      logger.debug(`Provider ${name} is disabled via environment variable`);
    }
  } catch (error) {
    logger.error(`Failed to import ${name} provider: ${error.message}`);
    if (error.stack) {
      logger.debug(`Stack trace for ${name} provider:`, error.stack);
    }
  }
}

// Import enabled providers
await importProvider('VOIDS', './voids.js');
await importProvider('OPENROUTER', './openrouter.js');
await importProvider('GOOGLE', './google.js');
await importProvider('GROQ', './groq.js');
// Import providers in specific order, with HackClub first
await importProvider('HACKCLUB', './hackclub.js', true); // No API key needed
await importProvider('MISTRAL', './mistral.js');
await importProvider('COPILOT_MORE', './copilot-more.js', true); // Only needs URL

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
            provider: config.name,
            flag: enableFlag,
            value: process.env[enableFlag]
          });
          this.disabledProviders.add(config.name);
          continue;
        }

        // Check if API key is required and present
        if (config.envKey && !process.env[config.envKey]) {
          logger.debug(`Provider disabled due to missing API key:`, {
            provider: config.name,
            requiredKey: config.envKey
          });
          this.disabledProviders.add(config.name);
          continue;
        }

        // Initialize provider
        const provider = new config.instance();
        this.providers.push(provider);

        logger.debug(`Provider initialized:`, {
          name: config.name,
          hasKey: config.envKey ? !!process.env[config.envKey] : 'not required'
        });

      } catch (error) {
        logger.error(`Failed to initialize provider:`, {
          provider: config.name,
          error: error.message
        });
        this.providerErrors.set(config.name, error.message);
        this.disabledProviders.add(config.name);
      }
    }

    // Log initialization summary
    logger.info(`Provider initialization complete:`, {
      total: this.providerConfigs.length,
      active: this.providers.length,
      disabled: this.disabledProviders.size
    });
  }

  getProviderStatus() {
    const available = [];
    const unavailable = [];
    const errors = {};

    for (const config of this.providerConfigs) {
      const name = config.name.replace('Provider', '');
      const isDisabled = this.disabledProviders.has(config.name);
      const error = this.providerErrors.get(config.name);
      const rateLimitInfo = this.rateLimitedProviders.get(name);

      if (isDisabled || error || rateLimitInfo) {
        unavailable.push(name);
        if (error) errors[name] = error;
        if (rateLimitInfo) errors[name] = `Rate limited until ${new Date(rateLimitInfo.limitedUntil).toISOString()}`;
      } else {
        available.push(name);
      }
    }

    return {
      available,
      unavailable,
      errors: Object.keys(errors).length > 0 ? errors : null
    };
  }

  async getAvailableModels() {
    const models = [];
    const seenModels = new Set();

    for (const provider of this.providers) {
      try {
        const providerModels = await provider.listModels();
        
        for (const model of providerModels) {
          // Skip if we've already seen this model ID
          if (seenModels.has(model.id)) continue;
          seenModels.add(model.id);
          
          // Add to models list
          models.push(model);
        }
      } catch (error) {
        logger.error(`Failed to get models from provider ${provider.constructor.name}:`, error);
      }
    }

    return models;
  }

  async chat(model, messages, options = {}) {
    const { stream = false, temperature = 0.7 } = options;
    let attempts = 0;
    let lastError = null;

    while (attempts < this.retryAttempts) {
      for (const provider of this.providers) {
        try {
          // Check if provider supports this model
          const supported = await provider.supportsModel(model);
          if (!supported) continue;

          // Check if provider is rate limited
          const providerName = provider.constructor.name.replace('Provider', '');
          const rateLimitInfo = this.rateLimitedProviders.get(providerName);
          
          if (rateLimitInfo && Date.now() < rateLimitInfo.limitedUntil) {
            logger.debug(`Provider ${providerName} is rate limited:`, rateLimitInfo);
            continue;
          }

          // Enforce rate limits if configured
          const lastRequest = this.rateLimits.get(providerName);
          if (lastRequest) {
            const timeSinceLastRequest = Date.now() - lastRequest.timestamp;
            if (timeSinceLastRequest < lastRequest.delay) {
              const waitTime = lastRequest.delay - timeSinceLastRequest;
              logger.debug(`Waiting ${waitTime}ms before next request to ${providerName}`);
              await this.sleep(waitTime);
            }
          }

          // Make the request
          const response = await provider.chat(model, messages, { stream, temperature });
          
          // Update rate limit tracking
          this.rateLimits.set(providerName, {
            timestamp: Date.now(),
            delay: provider.minRequestInterval || 1000
          });

          return response;

        } catch (error) {
          lastError = error;
          
          // Handle rate limits
          if (error.status === 429 || error.message?.includes('rate limit')) {
            const providerName = provider.constructor.name.replace('Provider', '');
            this.rateLimitedProviders.set(providerName, {
              limitedUntil: Date.now() + this.rateLimitCooldown,
              reason: error.message
            });
            logger.warn(`Rate limit hit for ${providerName}:`, error.message);
            continue;
          }
          
          logger.error(`Provider ${provider.constructor.name} failed:`, error);
        }
      }

      // If we get here, all providers failed
      attempts++;
      if (attempts < this.retryAttempts) {
        logger.debug(`All providers failed, retrying in ${this.retryDelay}ms (attempt ${attempts + 1}/${this.retryAttempts})`);
        await this.sleep(this.retryDelay);
      }
    }

    // If we get here, all retries failed
    throw lastError || new Error('All providers failed to process the request');
  }
}

export default new ProviderManager();
