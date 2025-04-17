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

function loadApiKeys() {
    if (!process.env.REQUIRE_API_KEY || process.env.REQUIRE_API_KEY === 'false') {
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
    
    // check if rate limited
    if (rateData.requests.length >= currentRateLimit.maxRequests) {
        return res.status(429).json({
            error: {
                message: 'Too many requests, please try again later',
                type: 'rate_limit_error',
                code: 'rate_limit_exceeded'
            }
        });
    }
    
    // add current request
    rateData.requests.push(now);
    
    if (!process.env.REQUIRE_API_KEY || process.env.REQUIRE_API_KEY === 'false') {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({
            error: {
                message: 'Missing API key',
                type: 'auth_error',
                code: 'missing_api_key'
            }
        });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return res.status(401).json({
            error: {
                message: 'Invalid authentication format. Use: Bearer YOUR_API_KEY',
                type: 'auth_error',
                code: 'invalid_auth_format'
            }
        });
    }

    const apiKey = parts[1];
    if (!apiKeys.has(apiKey)) {
        return res.status(401).json({
            error: {
                message: 'Invalid API key',
                type: 'auth_error',
                code: 'invalid_api_key'
            }
        });
    }

    next();
}