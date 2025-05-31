// middleware/protect.js - Authentication middleware with rate limiting
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// rate limit settings
const defaultRateLimit = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100 // default max requests per window
};

let currentRateLimit = { ...defaultRateLimit };

// health check rate limit wrapper
export function setHealthCheckRateLimit() {
    // store previous settings
    const previousSettings = { ...currentRateLimit };
    
    // set health check specific limits
    currentRateLimit.windowMs = process.env.HEALTH_CHECK_DELAY || 60000; // 1 minute default
    currentRateLimit.maxRequests = 5;
    
    return () => {
        // restore original settings
        currentRateLimit = previousSettings;
    };
}

// Authentication mode
const AUTH_MODES = {
    NO_KEYS: 'no_keys',          // No API keys required for any request
    KEYS_BYPASS_RATELIMITS: 'keys_bypass_ratelimits', // Keys allow bypassing rate limits
    KEYS_REQUIRED: 'keys_required'      // Keys required for all requests (default)
};

// Default to KEYS_REQUIRED for backward compatibility
const authMode = process.env.AUTH_MODE || AUTH_MODES.KEYS_REQUIRED;

function loadApiKeys() {
    // Only load keys if we're using them
    if (authMode === AUTH_MODES.NO_KEYS) {
        return new Set();
    }

    try {
        const keysPath = process.env.API_KEYS_FILE || path.join(__dirname, '../../keys.txt');
        const content = fs.readFileSync(keysPath, 'utf8');
        return new Set(content.split('\n').filter(key => key.trim()));
    } catch (error) {
        console.error('Failed to load API keys:', error);
        return new Set();
    }
}

const apiKeys = loadApiKeys();

export default function protectRoute(req, res, next) {
    // check rate limit
    const clientIp = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // initialize or get rate limit data for this IP
    if (!global.rateLimits) global.rateLimits = new Map();
    if (!global.rateLimits.has(clientIp)) {
        global.rateLimits.set(clientIp, {
            requests: [],
            blocked: false
        });
    }
    
    const rateData = global.rateLimits.get(clientIp);
    
    // clean up old requests outside current window
    rateData.requests = rateData.requests.filter(time =>
        now - time < currentRateLimit.windowMs
    );
    
    // Check for API key to determine if rate limits should be bypassed
    const authHeader = req.headers.authorization;
    const hasValidKey = authHeader && checkApiKey(authHeader);
    
    // If using keys for rate limit bypass and user has a valid key
    const shouldBypassRateLimit = authMode === AUTH_MODES.KEYS_BYPASS_RATELIMITS && hasValidKey;
    
    // Apply rate limits unless we should bypass them
    if (!shouldBypassRateLimit) {
        if (rateData.requests.length >= currentRateLimit.maxRequests) {
            return res.status(429).json({
                error: {
                    message: 'Too many requests, please try again later',
                    type: 'rate_limit_error',
                    code: 'rate_limit_exceeded'
                }
            });
        }
        
        // add current request to count
        rateData.requests.push(now);
    }
    
    // No keys required mode - proceed without auth check
    if (authMode === AUTH_MODES.NO_KEYS) {
        return next();
    }
    
    // In KEYS_BYPASS_RATELIMITS mode, we already checked the key validity above
    if (authMode === AUTH_MODES.KEYS_BYPASS_RATELIMITS && hasValidKey) {
        return next();
    }
    
    // Handle KEYS_REQUIRED mode
    if (authMode === AUTH_MODES.KEYS_REQUIRED) {
        // API key is required
        if (!authHeader) {
            return res.status(401).json({
                error: {
                    message: 'Missing API key',
                    type: 'auth_error',
                    code: 'missing_api_key'
                }
            });
        }

        // Key must be valid
        if (!hasValidKey) {
            return res.status(401).json({
                error: {
                    message: 'Invalid API key',
                    type: 'auth_error',
                    code: 'invalid_api_key'
                }
            });
        }
    }
    
    // For KEYS_BYPASS_RATELIMITS mode with invalid/missing key, we've already
    // applied rate limiting above and we'll proceed with the request

    next();
}

// Helper function to check API key validity
function checkApiKey(authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return false;
    }

    const apiKey = parts[1];
    return apiKeys.has(apiKey);
}