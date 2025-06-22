// server.js
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import wiki from 'wikipedia';
import { search, OrganicResult, ResultTypes } from 'google-sr';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import puppeteer from 'puppeteer';
import fs from 'fs';
import crypto from 'crypto';
import fetch from 'node-fetch';

import providers from './providers/index.js';
import logger from './utils/logger.js';
import protectRoute from './middleware/protect.js';
import maintenanceMiddleware from './middleware/maintenance.js';
import { trackInteraction } from './utils/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;

// Initialize express
const app = express();

// Apply maintenance middleware first
app.use(maintenanceMiddleware);

// Basic middleware
app.use(express.json({ limit: process.env.MAX_PAYLOAD_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_REQUEST_SIZE || '10mb' }));

// CORS configuration with proper error handling
const corsConfig = {
    origin: function(origin, callback) {
        const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
        
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    exposedHeaders: [
        'Content-Type',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Access-Control-Allow-Origin'
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
};

// Apply CORS middleware
app.use(cors(corsConfig));

// Additional CORS headers for all responses
app.use((req, res, next) => {
    // Set CORS headers for all responses
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', corsConfig.methods.join(','));
    res.header('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(','));
    res.header('Access-Control-Expose-Headers', corsConfig.exposedHeaders.join(','));
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Max-Age', corsConfig.maxAge);
        res.status(204).end();
        return;
    }
    next();
});

// Request logging
if (process.env.ENABLE_LOGGING !== 'false') {
    morgan.token('log-date', () => new Date().toISOString());
    app.use(morgan((tokens, req, res) => {
        const log = {
            method: tokens.method(req, res),
            url: tokens.url(req, res),
            status: tokens.status(req, res),
            responseTime: tokens['response-time'](req, res) + 'ms'
        };
        
        logger.debug('API Request', log);
        
        return process.env.DEBUG_MODE === 'true' ? 
            `${log.method} ${log.url} ${log.status} ${log.responseTime}` : 
            null;
    }));
}

// Configure rate limiting
const getRateLimiter = () => {
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
        return (req, res, next) => next();
    }

    // Parse rate limit settings
    const windowMs = Math.max(parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, 1000); // minimum 1 second
    const maxRequests = parseInt(process.env.RATE_LIMIT_REQUESTS) || 60;
    const rateType = process.env.RATE_LIMIT_TYPE?.toLowerCase() || 'ip';
    const trustProxy = process.env.TRUST_PROXY === 'true';

    // Log rate limit configuration
    logger.debug('Rate limit configuration:', {
        window: `${windowMs}ms`,
        maxRequests,
        type: rateType,
        trustProxy
    });

    return rateLimit({
        windowMs,
        max: maxRequests,
        standardHeaders: true,
        legacyHeaders: false,
        
        keyGenerator: (req) => {
            let key = '';
            
            // IP-based rate limiting
            if (rateType === 'ip' || rateType === 'both') {
                let clientIP;
                if (trustProxy && req.headers['x-forwarded-for']) {
                    clientIP = req.headers['x-forwarded-for'].split(',')[0].trim();
                } else {
                    clientIP = req.ip;
                }
                key += `ip:${clientIP}`;
            }
            
            // Token-based rate limiting
            if (rateType === 'token' || rateType === 'both') {
                const token = req.headers.authorization?.split(' ')[1] || 'anonymous';
                key += `${key ? '+' : ''}token:${token}`;
            }
            
            logger.debug('Rate limit key generated', {
                key,
                type: rateType,
                path: req.path,
                proxy: Boolean(req.headers['x-forwarded-for'])
            });
            
            return key;
        },
        
        // Skip rate limiting for specific cases
        skip: (req) => {
            // Local requests
            const ip = req.ip;
            if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
                return true;
            }
            
            // Model listing endpoint
            if (req.path === '/v1/models') {
                return true;
            }
            
            return false;
        },
        
        // Handler for when rate limit is hit
        handler: (req, res) => {
            logger.warn('Rate limit exceeded', {
                ip: req.ip,
                path: req.path,
                proxy_ip: req.headers['x-forwarded-for']
            });
            
            res.status(429).json({
                error: {
                    message: 'Too many requests, please try again later',
                    type: 'rate_limit_error',
                    code: 'rate_limit_exceeded'
                }
            });
        }
    });
};

// Initialize rate limiter
const rateLimiter = getRateLimiter();
if (process.env.DISABLE_RATE_LIMIT !== 'true') {
    const windowMs = Math.max(parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, 1000);
    const maxRequests = parseInt(process.env.RATE_LIMIT_REQUESTS) || 60;
    const rateType = process.env.RATE_LIMIT_TYPE?.toLowerCase() || 'ip';
    
    logger.info('Rate limiting enabled', {
        window: `${windowMs / 1000}s`,
        requests_per_window: maxRequests,
        limit_type: rateType,
        trust_proxy: process.env.TRUST_PROXY === 'true'
    });
} else {
    logger.warn('Rate limiting is disabled');
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/chat/index.html'));
});

// Config endpoint
app.get('/v1/config', (req, res) => {
    const publicConfig = {
        require_api_key: process.env.REQUIRE_API_KEY === 'true',
        rate_limiting: {
            enabled: process.env.DISABLE_RATE_LIMIT !== 'true',
            requests: parseInt(process.env.RATE_LIMIT_REQUESTS) || 60,
            window_ms: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000
        },
        features: {
            logging: process.env.ENABLE_LOGGING !== 'false'
        },
        limits: {
            max_tokens: process.env.MAX_TOKENS || 'infinite',
            max_request_size: process.env.MAX_REQUEST_SIZE || '10mb',
            max_concurrent: parseInt(process.env.MAX_CONCURRENT) || 50,
            request_timeout: parseInt(process.env.REQUEST_TIMEOUT) || 120000
        },
        defaults: {
            model: process.env.DEFAULT_MODEL || false,
            temperature: parseFloat(process.env.DEFAULT_TEMPERATURE) || 0.7
        },
        providers: providers.getProviderStatus()
    };
    res.json(publicConfig);
});

// API routes
app.get('/v1/models', async (req, res) => {
    try {
        const models = await providers.getAvailableModels();

        // Group models by provider and count them
        const providerCounts = new Map();
        models.forEach(model => {
            const provider = model.owned_by || 'Unknown';
            providerCounts.set(provider, (providerCounts.get(provider) || 0) + 1);
        });

        // Sort models by provider's model count (ascending) and then provider name
        const sortedModels = [...models].sort((a, b) => {
            const aCount = providerCounts.get(a.owned_by) || 0;
            const bCount = providerCounts.get(b.owned_by) || 0;
            
            // First sort by model count (ascending)
            if (aCount !== bCount) {
                return aCount - bCount;
            }
            
            // Then sort alphabetically by provider name for equal counts
            const aProvider = a.owned_by || 'Unknown';
            const bProvider = b.owned_by || 'Unknown';
            return aProvider.localeCompare(bProvider);
        });

        res.json(sortedModels);
    } catch (error) {
        logger.error('Error fetching models:', error);
        res.status(500).json({
            error: {
                message: 'Failed to fetch available models',
                type: 'server_error',
                details: error.message
            }
        });
    }
});

// Static files
app.use(express.static('public', {
    extensions: ['html']
}));

// 404 handler
app.use((req, res, next) => {
    // Only handle HTML requests with 404, let API requests go to error handler
    if (req.accepts('html')) {
        res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
    } else {
        next();
    }
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);

    // Ensure CORS headers are set for error responses
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', corsConfig.methods.join(','));
    res.setHeader('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(','));
    
    // Send error response
    res.status(500).json({
        error: {
            message: 'Internal server error',
            type: 'server_error'
        }
    });
});

// Start server
async function startServer() {
    try {
        // Load environment variables and check for .env file
        const envConfig = dotenv.config();
        if (envConfig.error) {
            if (envConfig.error.code === 'ENOENT') {
                logger.error('CRITICAL: .env file not found. This file is required for server configuration.');
                logger.error('Please create a .env file based on .env.example and populate it with necessary values.');
            } else {
                logger.error('CRITICAL: Failed to load .env file.', envConfig.error);
            }
            logger.error('Server startup aborted due to missing or unreadable .env file.');
            process.exit(1);
        }
        logger.info('.env file loaded successfully.');

        logger.startup('Server');

        // Start HTTP server
        const server = app.listen(port, () => {
            logger.info(`Server running on port ${port}`);
        });

        // Check maintenance mode
        if (process.env.MAINTENANCE_MODE === 'true') {
            logger.warn('Server started in maintenance mode', {
                message: process.env.MAINTENANCE_MESSAGE || 'Service is temporarily under maintenance.'
            });
            return;
        }

        // Initialize providers
        const status = providers.getProviderStatus();
        logger.debug(`Providers initialized`, {
            available: status.available,
            total: status.available.length
        });

        if (status.errors && Object.keys(status.errors).length > 0) {
            logger.warn('Provider initialization errors:', status.errors);
        }

        // Cleanup function
        function cleanup() {
            logger.debug('Shutting down...');
            server.close(() => {
                logger.info('Server closed');
                setTimeout(() => process.exit(0), 100);
            });
        }

        // Handle graceful shutdown
        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();