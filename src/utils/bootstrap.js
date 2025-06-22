// bootstrap.js - initialize everything with sane defaults
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// track any configuration warnings
const warningMessages = [];
let warnings = 0;

function warnConfig(message) {
  warningMessages.push(message);
  warnings++;
  console.warn('⚠️  WARNING:', message);
}

function debugConfig(name, value) {
  if (process.env.DEBUG_MODE === 'true') {
    const maskedValue = value ? '****' + value.slice(-4) : 'undefined';
    console.log(`🔍 DEBUG: ${name} = ${maskedValue}`);
  }
}

function validateApiKey(key, name) {
  if (!key) return false;
  key = key.trim();
  if (key === '""' || key === "''") return false;
  debugConfig(name, key);
  return key.length > 0;
}

function validateApiKeySet(primaryKey, backupKey1, backupKey2, providerName) {
  const validKeys = [];
  if (validateApiKey(primaryKey, `${providerName}_API_KEY`)) {
    validKeys.push(primaryKey.trim());
  }
  if (validateApiKey(backupKey1, `${providerName}_BACKUP_KEY_1`)) {
    validKeys.push(backupKey1.trim());
  }
  if (validateApiKey(backupKey2, `${providerName}_BACKUP_KEY_2`)) {
    validKeys.push(backupKey2.trim());
  }
  return validKeys;
}

function getDefaultRateLimit() {
  return {
    window: 60000,    // 1 minute in ms
    max: 50,          // 50 requests per minute
    message: 'Too many requests, please try again later'
  };
}

function getSizeLimit(value, defaultValue) {
  if (!value) return defaultValue;
  if (typeof value === 'number') return value;
  
  const match = value.match(/^(\d+)(mb|kb|b)?$/i);
  if (!match) return defaultValue;

  const num = parseInt(match[1]);
  const unit = (match[2] || 'b').toLowerCase();

  switch (unit) {
    case 'mb': return num * 1024 * 1024;
    case 'kb': return num * 1024;
    case 'b': return num;
    default: return defaultValue;
  }
}

function readApiKeysFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // skip empty lines and comments
  } catch (error) {
    warnConfig(`failed to read api keys file ${filePath}: ${error.message}`);
    return [];
  }
}

function validateEnvironment() {
  console.log('🔄 Validating environment configuration...');
  
  const config = {
    // Authentication
    apiKey: process.env.API_KEY,
    apiKeys: [],
    adminKey: process.env.ADMIN_KEY,
    requireApiKey: process.env.REQUIRE_API_KEY === 'true',

    // Provider Configuration
    providers: {
      openrouter: {
        enabled: process.env.ENABLE_OPENROUTER !== 'false',
        apiKeys: validateApiKeySet(
          process.env.OPENROUTER_API_KEY,
          process.env.OPENROUTER_BACKUP_KEY_1,
          process.env.OPENROUTER_BACKUP_KEY_2,
          'OPENROUTER'
        )
      },
      google: {
        enabled: process.env.ENABLE_GOOGLE !== 'false',
        apiKeys: validateApiKeySet(
          process.env.GOOGLE_API_KEY,
          process.env.GOOGLE_BACKUP_KEY_1,
          process.env.GOOGLE_BACKUP_KEY_2,
          'GOOGLE'
        )
      },
      groq: {
        enabled: process.env.ENABLE_GROQ !== 'false',
        apiKeys: validateApiKeySet(
          process.env.GROQ_API_KEY,
          process.env.GROQ_BACKUP_KEY_1,
          process.env.GROQ_BACKUP_KEY_2,
          'GROQ'
        )
      },
      hackclub: {
        enabled: process.env.ENABLE_HACKCLUB !== 'false'
      },
      voids: {
        enabled: process.env.ENABLE_VOIDS !== 'false'
      },
      mistral: {
        enabled: process.env.ENABLE_MISTRAL !== 'false',
        apiKeys: validateApiKeySet(
          process.env.MISTRAL_API_KEY,
          process.env.MISTRAL_BACKUP_KEY_1,
          process.env.MISTRAL_BACKUP_KEY_2,
          'MISTRAL'
        )
      }
    },

    // Security Settings
    trustProxy: process.env.TRUST_PROXY === 'true',
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
    maintenanceMode: process.env.MAINTENANCE_MODE === 'true',
    maintenanceMessage: process.env.MAINTENANCE_MESSAGE || 'System is down for maintenance',

    // Rate Limiting
    rateLimit: {
      enabled: process.env.DISABLE_RATE_LIMIT !== 'true',
      requests: parseInt(process.env.RATE_LIMIT_REQUESTS) || 50,
      window: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
      type: process.env.RATE_LIMIT_TYPE || 'ip'
    },

    // Size Limits
    maxRequestSize: process.env.MAX_REQUEST_SIZE || '50mb',
    maxHeaderSize: process.env.MAX_HEADER_SIZE || '10kb',
    maxPayloadSize: process.env.MAX_PAYLOAD_SIZE || '50mb',

    // Feature Flags
    debugMode: process.env.DEBUG_MODE === 'true',
    logging: {
      enabled: process.env.ENABLE_LOGGING !== 'false',
      requests: process.env.LOG_REQUESTS !== 'false',
      responses: process.env.LOG_RESPONSES !== 'false',
      errors: process.env.LOG_ERRORS !== 'false'
    },
    stats: {
      enabled: process.env.ENABLE_STATS !== 'false'
    },

    // Performance
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 30000,
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT) || 100,
    cacheDuration: parseInt(process.env.CACHE_DURATION) || 300,

    // Monitoring
    metrics: {
      enabled: process.env.ENABLE_METRICS === 'true',
      port: parseInt(process.env.METRICS_PORT) || 9090
    },

    // Defaults
    defaults: {
      model: process.env.DEFAULT_MODEL === 'false' ? null : (process.env.DEFAULT_MODEL || 'hackclub/llama-3.3-70b-versatile'),
      temperature: process.env.DEFAULT_TEMPERATURE?.toLowerCase() === 'def' ||
                  process.env.DEFAULT_TEMPERATURE?.toLowerCase() === 'default' ? null :
                  parseFloat(process.env.DEFAULT_TEMPERATURE) || 0.7,
      maxTokens: process.env.MAX_TOKENS?.toLowerCase() === 'inf' ||
                process.env.MAX_TOKENS?.toLowerCase() === 'infinite' ? null :
                parseInt(process.env.MAX_TOKENS) || 8192
    }
  };

  console.log('🔍 Checking provider configurations...');

  // Validate each provider's configuration
  Object.entries(config.providers).forEach(([name, provider]) => {
    // Skip providers that are explicitly disabled
    if (process.env[`ENABLE_${name.toUpperCase()}`] === 'false') {
      console.log(`👎 Provider ${name} disabled by config`);
      provider.enabled = false;
      return;
    }

    // Validate enabled providers
    if (!['hackclub', 'voids'].includes(name)) {
      if (!provider.apiKeys?.length) {
        provider.enabled = false;
        console.log(`❌ Provider ${name} missing API key(s)`);
      } else {
        console.log(`✅ Provider ${name} has ${provider.apiKeys.length} API key(s)`);
      }
    }
  });

  // Validate Authentication
  if (process.env.API_KEYS_FILE) {
    const keys = readApiKeysFromFile(process.env.API_KEYS_FILE);
    if (keys.length > 0) {
      config.apiKeys = keys;
      // if API_KEY is also set, add it to the list
      if (config.apiKey) {
        config.apiKeys.push(config.apiKey);
      }
      config.apiKey = null; // we're using the keys array instead
    } else {
      warnConfig('API_KEYS_FILE specified but no valid keys found');
    }
  }

  if (config.requireApiKey && !config.apiKey && config.apiKeys.length === 0) {
    warnConfig('Neither API_KEY nor valid API_KEYS_FILE provided');
  }

  if (!config.adminKey) {
    warnConfig('ADMIN_KEY not set - admin endpoints will be disabled');
  }

  // Parse Size Limits
  config.parsedMaxRequestSize = getSizeLimit(config.maxRequestSize, 50 * 1024 * 1024);
  config.parsedMaxHeaderSize = getSizeLimit(config.maxHeaderSize, 10 * 1024);
  config.parsedMaxPayloadSize = getSizeLimit(config.maxPayloadSize, 50 * 1024 * 1024);

  // Validate Performance Settings
  if (config.requestTimeout < 1000) {
    warnConfig('Request timeout too low, setting to 1000ms minimum');
    config.requestTimeout = 1000;
  }
  if (config.maxConcurrent < 1) {
    warnConfig('Max concurrent requests too low, setting to 1 minimum');
    config.maxConcurrent = 1;
  }

  // Create Required Directories
  if (config.logging.enabled) {
    const logsDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) {
      try {
        fs.mkdirSync(logsDir, { recursive: true });
      } catch (error) {
        warnConfig(`Failed to create logs directory: ${error.message}`);
        config.logging.enabled = false;
      }
    }
  }

  if (config.stats.enabled) {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (error) {
        warnConfig(`Failed to create data directory: ${error.message}`);
        config.stats.enabled = false;
      }
    }
  }

  console.log('✨ Environment configuration validated');
  return config;
}

function initialize() {
  try {
    const config = validateEnvironment();
    
    // Set validated config values back to process.env
    process.env.PORT = process.env.PORT || '3000';
    process.env.RATE_LIMIT_REQUESTS = config.rateLimit.requests.toString();
    process.env.RATE_LIMIT_WINDOW = config.rateLimit.window.toString();
    process.env.DEBUG_MODE = config.debugMode.toString();
    process.env.ENABLE_LOGGING = config.logging.enabled.toString();
    process.env.ENABLE_STATS = config.stats.enabled.toString();

    return { warnings, warningMessages, config };
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  }
}

export {
  initialize,
  validateEnvironment,
  getDefaultRateLimit,
  getSizeLimit,
  readApiKeysFromFile
};