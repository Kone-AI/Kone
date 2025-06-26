// server.js
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
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
import health from './utils/health.js';
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
        
        if (req.path !== '/health') { // Don't log health checks
            logger.debug('API Request', log);
        }
        
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
            // 1. System health checks
            if (req.headers['user-agent']?.includes('SylphHealthCheck')) {
                return true;
            }
            
            // 2. Local requests
            const ip = req.ip;
            if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
                return true;
            }
            
            // 3. Model listing endpoint
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
            health_checks: process.env.ENABLE_HEALTH_CHECKS !== 'false',
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

// Routes
app.get('/v1', (req, res) => {
    res.redirect('/docs');
});
// Google search endpoint
app.post('/v1/search', protectRoute, rateLimiter, async (req, res) => {
    try {
        const { query, include_urls = true, fetch_content = true } = req.body;
        
        if (!query) {
            return res.status(400).json({
                error: {
                    message: 'query is required',
                    type: 'invalid_request_error',
                    param: 'query',
                    code: 'query_required'
                }
            });
        }

        const startTime = Date.now();
        logger.info(`Search request: "${query}"`, { include_urls, fetch_content });
        let searchResults;

        // Try google-sr first
        try {
            logger.info(`Attempting google-sr search for: "${query}"`);
            const results = await search({
                query,
                resultTypes: [OrganicResult],
                requestConfig: {
                    params: { safe: "active" }
                }
            });

            searchResults = results
                .filter(result => result.type === 'ORGANIC')
                .map((result, index) => ({
                    index: index + 1,
                    title: result.title?.replace(/�/g, '') || 'No title available',
                    url: result.link || '',
                    snippet: result.description?.replace(/�/g, '') || 'No description available',
                    content: null
                }));

        } catch (googleError) {
            logger.warn('google-sr search failed, trying Vyntr:', googleError);

            try {
                const vyntrResponse = await fetch(`https://vyntr.com/api/v1/search?q=${encodeURIComponent(query)}`, {
                    headers: {
                        'Authorization': `Bearer ${process.env.VYNTR_API_KEY}`
                    }
                });

                if (!vyntrResponse.ok) {
                    throw new Error(`Vyntr API error: ${vyntrResponse.status}`);
                }

                const vyntrData = await vyntrResponse.json();
                searchResults = vyntrData.web.map((result, index) => ({
                    index: index + 1,
                    title: result.title || 'No title available',
                    url: result.url || '',
                    snippet: result.preview || 'No description available',
                    content: null
                }));

            } catch (vyntrError) {
                logger.error('Vyntr search also failed:', vyntrError);
                throw new Error('All search methods failed');
            }
        }

        // Limit to top 5 results
        searchResults = searchResults.slice(0, 5);

        // Fetch content if requested
        if (fetch_content) {
            logger.info(`Fetching content for ${searchResults.length} URLs`);
            const fetchPromises = searchResults.map(async (result) => {
                if (!result.url) return;

                try {
                    // Try Readability first
                    const contentResponse = await fetch(result.url, {
                        timeout: 10000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });

                    if (!contentResponse.ok) {
                        throw new Error(`HTTP ${contentResponse.status}`);
                    }

                    const html = await contentResponse.text();
                    const doc = new JSDOM(html, { url: result.url });
                    const reader = new Readability(doc.window.document);
                    const article = reader.parse();

                    if (article?.textContent) {
                        result.content = article.textContent;
                        return;
                    }

                    // Fallback to Puppeteer
                    logger.debug(`Readability failed for ${result.url}, trying Puppeteer`);
                    const browser = await puppeteer.launch({
                        headless: 'new',
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    
                    const page = await browser.newPage();
                    await page.goto(result.url, {
                        waitUntil: 'networkidle0',
                        timeout: 15000
                    });
                    
                    result.content = await page.evaluate(() => document.body.innerText);
                    await browser.close();

                } catch (error) {
                    logger.debug(`Content extraction failed for ${result.url}:`, error);
                    result.content = result.snippet; // Fallback to snippet
                }
            });
            
            await Promise.all(fetchPromises);
        }

        // Return final results
        const executionTime = Date.now() - startTime;
        logger.info(`Search completed in ${executionTime}ms`, {
            query,
            results: searchResults.length,
            with_content: fetch_content
        });

        res.json({
            query,
            results: searchResults,
            timing: `${executionTime}ms`
        });

    } catch (error) {
        logger.error('Search error:', error);
        res.status(500).json({
            error: {
                message: 'Failed to perform search',
                type: 'server_error',
                details: error.message
            }
        });
    }
}); // End of search endpoint

/**
 * Endpoint to fetch and extract content from a URL
 * Supports both Readability and Puppeteer fallback
 */
app.get('/v1/search/content', protectRoute, rateLimiter, async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({
                error: {
                    message: 'url parameter is required',
                    type: 'invalid_request_error',
                    param: 'url',
                    code: 'url_required'
                }
            });
        }

        let content = null;
        let title = null;
        let excerpt = null;

        try {
            // Try Readability first
            const response = await fetch(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await response.text();
            const doc = new JSDOM(html, { url });
            const reader = new Readability(doc.window.document);
            const article = reader.parse();

            if (article?.textContent) {
                content = article.textContent;
                title = article.title;
                excerpt = article.excerpt;
            }
        } catch (readabilityError) {
            logger.warn(`Readability failed for ${url}:`, readabilityError);
        }

        // Fallback to Puppeteer if needed
        if (!content) {
            try {
                const browser = await puppeteer.launch({
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const page = await browser.newPage();
                await page.goto(url, { waitUntil: 'networkidle0' });
                
                content = await page.evaluate(() => document.body.innerText);
                title = await page.evaluate(() => document.title);
                excerpt = content.substring(0, 200) + '...';
                
                await browser.close();
            } catch (puppeteerError) {
                logger.error(`Puppeteer failed for ${url}:`, puppeteerError);
                throw new Error('Content extraction failed');
            }
        }

        res.json({
            title,
            content,
            excerpt,
            url
        });

    } catch (error) {
        logger.error('Content extraction error:', error);
        res.status(500).json({
            error: {
                message: `Failed to extract content: ${error.message}`,
                type: 'server_error',
                details: error.toString()
            }
        });
    }
});

// Wikipedia search endpoint
app.post('/v1/search/wikipedia', protectRoute, rateLimiter, async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!query) {
            return res.status(400).json({
                error: {
                    message: 'query is required',
                    type: 'invalid_request_error',
                    param: 'query',
                    code: 'query_required'
                }
            });
        }

        // Search Wikipedia and get summary of first result
        const searchResults = await wiki.search(query);
        if (!searchResults.results || searchResults.results.length === 0) {
            return res.json({
                query,
                results: []
            });
        }

        // Get page summary for the top result
        const page = await wiki.page(searchResults.results[0].title);
        const summary = await page.summary();

        res.json({
            query,
            results: [{
                title: summary.title,
                extract: summary.extract,
                thumbnail: summary.thumbnail?.source || null,
                pageid: summary.pageid,
                url: page.fullurl
            }]
        });

    } catch (error) {
        logger.error('Wikipedia search error:', error);
        res.status(500).json({
            error: {
                message: 'Failed to search Wikipedia',
                type: 'server_error',
                details: error.message
            }
        });
    }
});

app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/docs.html'));
});

app.get('/models', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/models.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/chat/index.html'));
});

// Static files
app.use(express.static('public', {
    extensions: ['html']
}));

// API routes
app.get('/v1/models', async (req, res) => {
    try {
        const models = await providers.getAvailableModels();
        
        // Add health status to models
        const healthStatus = health.getStatus();
        const healthMap = new Map(healthStatus.map(h => [h.model, h]));

        // Group models by provider and count them
        // Count models per provider using owned_by field
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


        const modelsWithHealth = sortedModels.map(model => {
            const healthData = healthMap.get(model.id) || {
                status: 'unknown',
                latency: null,
                lastCheck: null
            };
            return {
                ...model,
                health: {
                    status: healthData.status,
                    latency: healthData.latency,
                    lastCheck: healthData.lastCheck
                }
            };
        });

        res.json({
            object: 'list',
            data: modelsWithHealth
        });
    } catch (error) {
        logger.error('Error getting models:', error);
        res.status(500).json({
            error: {
                message: error.message,
                type: 'server_error'
            }
        });
    }
});

app.post('/v1/chat/completions', protectRoute, rateLimiter, async (req, res) => {
    try {
        const { model, messages, stream, ...options } = req.body;
        
        // Extract API key from authorization header if present
        let apiKey = null;
        if (req.headers.authorization) {
            const authParts = req.headers.authorization.split(' ');
            if (authParts.length === 2 && authParts[0].toLowerCase() === 'bearer') {
                apiKey = authParts[1];
            }
        }

        if (!model) {
            return res.status(400).json({
                error: {
                    message: 'model is required',
                    type: 'invalid_request_error',
                    param: 'model',
                    code: 'model_required'
                }
            });
        }

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: {
                    message: 'messages must be a non-empty array',
                    type: 'invalid_request_error',
                    param: 'messages',
                    code: 'invalid_messages'
                }
            });
        }

        const requestStartTime = Date.now();
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const response = await providers.chat(model, messages, { stream, ...options });
        const latency = Date.now() - requestStartTime;
        
        // Track request in stats if successful
        trackInteraction({
            requestId,
            provider: model.split('/')[0],
            model,
            messages,
            response,
            startTime: requestStartTime,
            apiKey
        });

        if (stream) {
            // Set SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            // Set CORS headers specifically for SSE
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Type');

            for await (const chunk of response) {
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            // Set headers for regular JSON response
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(','));
            res.json(response);
        }

    } catch (error) {
        // Enhanced error logging with details
        logger.error('Chat error:', {
            message: error.message,
            type: error.type || 'server_error',
            status: error.status || 500,
            code: error.code,
            param: error.param,
            model: req.body?.model,
            path: req.path,
            clientIP: req.ip,
            timestamp: new Date().toISOString()
        });
        
        // Extract API key for stats tracking even on error
        let apiKey = null;
        if (req.headers.authorization) {
            const authParts = req.headers.authorization.split(' ');
            if (authParts.length === 2 && authParts[0].toLowerCase() === 'bearer') {
                apiKey = authParts[1];
            }
        }
        
        // Track failed request in stats - Fix undefined requestStartTime error
        const errorTimestamp = Date.now();
        trackInteraction({
            requestId: `req_${errorTimestamp}_${Math.random().toString(36).substring(2, 9)}`,
            provider: req.body?.model?.split('/')[0] || 'unknown',
            model: req.body?.model || 'unknown',
            messages: req.body?.messages,
            error,
            startTime: errorTimestamp, // Use current timestamp instead of undefined requestStartTime
            apiKey
        });
        
        const status = error.status || 500;
        const errorResponse = {
            error: {
                message: error.message,
                type: error.type || 'server_error',
                param: error.param,
                code: error.code
            }
        };

        // Set CORS headers even for error responses
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(','));
        res.status(status).json(errorResponse);
    }
});

// Health check endpoint with rate limit override
app.get('/health', async (req, res) => {
    // Store original rate limit settings
    const originalWindow = process.env.RATE_LIMIT_WINDOW;
    const originalRequests = process.env.RATE_LIMIT_REQUESTS;

    try {
        // Only override rate limits if current settings are higher
        const currentWindow = parseInt(process.env.RATE_LIMIT_WINDOW) || 60000;
        const currentRequests = parseInt(process.env.RATE_LIMIT_REQUESTS) || 60;
        const healthWindow = parseInt(process.env.HEALTH_CHECK_DELAY) || 2600;
        const healthRequests = 5;

        if (currentWindow > healthWindow || currentRequests > healthRequests) {
            process.env.RATE_LIMIT_WINDOW = healthWindow.toString();
            process.env.RATE_LIMIT_REQUESTS = healthRequests.toString();

            logger.debug('Overriding rate limits for health check:', {
                from: {
                    window: `${currentWindow}ms`,
                    requests: currentRequests
                },
                to: {
                    window: `${healthWindow}ms`,
                    requests: healthRequests
                }
            });
        } else {
            logger.debug('Keeping current rate limits for health check:', {
                window: `${currentWindow}ms`,
                requests: currentRequests
            });
        }

        const providerStatus = providers.getProviderStatus();
        const modelHealthStatus = health.getStatus();
        
        // Set CORS headers
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', corsConfig.methods.join(','));
        res.setHeader('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(','));
        
        res.json({
            status: 'ok',
            providers: providerStatus,
            models: modelHealthStatus
        });
    } finally {
        // Restore original rate limit settings
        process.env.RATE_LIMIT_WINDOW = originalWindow;
        process.env.RATE_LIMIT_REQUESTS = originalRequests;

        logger.debug('Restored rate limits:', {
            window: `${originalWindow}ms`,
            max_requests: originalRequests
        });
    }
});
/**
 * Sell.app integration endpoints for handling donations and API key provisioning
 */

// Verify Cloudflare Turnstile token
async function verifyTurnstileToken(token, remoteip) {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            secret: process.env.TURNSTILE_SECRET_KEY,
            response: token,
            remoteip
        })
    });
    
    if (!response.ok) {
        logger.error('Turnstile verification request failed:', {
            status: response.status,
            statusText: response.statusText
        });
        throw new Error('Failed to verify security token');
    }
    
    const result = await response.json();
    if (!result.success) {
        logger.error('Turnstile verification failed:', {
            errorCodes: result['error-codes'],
            hostname: result.hostname,
            action: result.action,
            cdata: result.cdata
        });
        throw new Error('Security verification failed');
    }
    
    return result;
}

/**
 * Create invoice endpoint
 * @route POST /api/create-invoice
 * @param {number} amount - Donation amount (min $3)
 * @param {string} email - User email for API key delivery
 * @param {string} paymentMethod - Payment method selection
 * @param {string} [coupon] - Optional coupon code
 * @param {string} turnstileToken - Cloudflare Turnstile verification token
 */
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, email, paymentMethod, coupon, turnstileToken } = req.body;
        
        // Validate basic inputs
        if (!amount || amount < 3) {
            return res.status(400).json({ error: 'Minimum donation amount is $3' });
        }
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        if (!turnstileToken) {
            return res.status(400).json({ error: 'Security verification failed' });
        }
        
        // Verify Turnstile token
        try {
            await verifyTurnstileToken(turnstileToken, req.ip);
        } catch (error) {
            logger.error('Turnstile verification failed:', error);
            return res.status(400).json({ error: 'Security verification failed' });
        }
        
        if (!turnstileToken) {
            return res.status(400).json({ error: 'Security verification failed' });
        }
        
        // Verify Turnstile token
        const turnstileResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                secret: process.env.TURNSTILE_SECRET,
                response: turnstileToken,
                remoteip: req.ip
            })
        });
        
        const turnstileResult = await turnstileResponse.json();
        if (!turnstileResult.success) {
            return res.status(400).json({ error: 'Security verification failed' });
        }
        
        // Create Sell.app invoice
        const sellAppResponse = await fetch('https://sell.app/api/v1/invoices', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.SELLAPP_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                product_id: '293927', // The product ID for "choose your price"
                gateway: paymentMethod,
                email: email,
                value: amount.toString(),
                coupon_code: coupon || null
            })
        });
        
        if (!sellAppResponse.ok) {
            const errorData = await sellAppResponse.json();
            logger.error('Sell.app invoice creation error:', errorData);
            throw new Error(errorData.message || 'Failed to create invoice');
        }
        
        const invoiceData = await sellAppResponse.json();
        res.json({
            id: invoiceData.data.id,
            status: invoiceData.data.status
        });
        
    } catch (error) {
        logger.error('Create invoice error:', error);
        res.status(500).json({ error: error.message || 'Failed to create invoice' });
    }
});

app.post('/api/create-checkout', async (req, res) => {
    try {
        const { invoiceId } = req.body;
        
        if (!invoiceId) {
            return res.status(400).json({ error: 'Invoice ID is required' });
        }
        
        // Create checkout session
        const checkoutResponse = await fetch(`https://sell.app/api/v1/invoices/${invoiceId}/checkout-session`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.SELLAPP_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        if (!checkoutResponse.ok) {
            const errorData = await checkoutResponse.json();
            logger.error('Sell.app checkout session error:', errorData);
            throw new Error(errorData.message || 'Failed to create checkout session');
        }
        
        const checkoutData = await checkoutResponse.json();
        res.json({
            checkoutUrl: checkoutData.data.url
        });
        
    } catch (error) {
        logger.error('Create checkout session error:', error);
        res.status(500).json({ error: error.message || 'Failed to create checkout session' });
    }
});

// Donation success page
app.get('/donated', async (req, res) => {
    try {
        const { email, orderId } = req.query;
        
        if (!email || !orderId) {
            return res.status(400).send('Missing required parameters');
        }
        
        // Fetch order details from Sell.app
        const orderResponse = await fetch(`https://sell.app/api/v1/orders/${orderId}`, {
            headers: {
                'Authorization': `Bearer ${process.env.SELLAPP_API_KEY}`,
                'Accept': 'application/json'
            }
        });
        
        if (!orderResponse.ok) {
            logger.error('Failed to fetch order:', await orderResponse.text());
            return res.status(500).send('Failed to verify order');
        }
        
        const orderData = await orderResponse.json();
        
        // Verify order email matches provided email
        if (orderData.data.customer_email !== email) {
            logger.error('Email mismatch for order', {orderId, provided: email, actual: orderData.data.customer_email});
            return res.status(403).send('Invalid email for this order');
        }
        
        // Check if order is recent (within 30 minutes)
        const orderTime = new Date(orderData.data.created_at).getTime();
        const now = Date.now();
        const isRecent = (now - orderTime) < 30 * 60 * 1000; // 30 minutes
        
        // Create cache directory if it doesn't exist
        const cacheDir = path.join(__dirname, '../cache');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        
        // Check if coupon was already generated for this order
        const couponCacheFile = path.join(cacheDir, `coupon-${orderId}.json`);
        let couponCode = null;
        
        if (fs.existsSync(couponCacheFile)) {
            // Read existing coupon from cache
            try {
                const cacheData = JSON.parse(fs.readFileSync(couponCacheFile, 'utf8'));
                couponCode = cacheData.code;
            } catch (err) {
                logger.error('Error reading coupon cache:', err);
            }
        } else if (isRecent) {
            // Generate new coupon for recent orders on first visit
            try {
                const couponResponse = await fetch('https://sell.app/api/v1/coupons', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.SELLAPP_API_KEY}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        code: `THANK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
                        type: 'percentage',
                        value: '40',
                        max_uses: 1,
                        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 1 week from now
                        products: ['293927'] // The product ID for donations
                    })
                });
                
                if (couponResponse.ok) {
                    const couponData = await couponResponse.json();
                    couponCode = couponData.data.code;
                    
                    // Cache the coupon code
                    fs.writeFileSync(couponCacheFile, JSON.stringify({
                        code: couponCode,
                        created: new Date().toISOString()
                    }));
                } else {
                    logger.error('Failed to create coupon:', await couponResponse.text());
                }
            } catch (err) {
                logger.error('Error creating coupon:', err);
            }
        }
        
        // Generate API key for the user
        const apiKey = `sk-${crypto.randomBytes(16).toString('hex')}`;
        
        // Add API key to keys.txt
        try {
            const keysPath = process.env.API_KEYS_FILE || path.join(__dirname, '../keys.txt');
            fs.appendFileSync(keysPath, apiKey + '\n');
            logger.info(`Added API key for ${email} (Order ${orderId})`);
        } catch (err) {
            logger.error('Error adding API key:', err);
        }
        
        // Send thank you page with API key and coupon if generated
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <title>Thank You - Sylph</title>
                <link rel="stylesheet" href="/styles.css">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <script defer src="https://analytics.minoa.cat/script.js" data-website-id="dba618bd-576d-4166-a280-e38df64bf53f"></script>
                <style>
                    .thank-you-container {
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 2rem;
                    }
                    .key-container {
                        background: var(--card-bg);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 1.5rem;
                        margin: 2rem 0;
                        text-align: center;
                    }
                    .key-display {
                        font-family: monospace;
                        background: rgba(0,0,0,0.2);
                        padding: 1rem;
                        border-radius: 6px;
                        margin: 1rem 0;
                        word-break: break-all;
                        border: 1px solid var(--border);
                    }
                    .copy-button {
                        background: var(--button-bg);
                        color: var(--text);
                        border: 1px solid var(--border);
                        padding: 0.5rem 1rem;
                        border-radius: 6px;
                        cursor: pointer;
                        transition: all 0.3s ease;
                    }
                    .copy-button:hover {
                        background: var(--button-hover);
                        border-color: var(--hover-border);
                    }
                    .coupon-section {
                        margin-top: 2rem;
                        padding: 1.5rem;
                        border: 1px solid rgba(255, 215, 0, 0.3);
                        background: rgba(255, 215, 0, 0.1);
                        border-radius: 8px;
                    }
                </style>
            </head>
            <body>
                <div class="thank-you-container">
                    <h1 class="site-header" onclick="location.href='/'">/thank-you</h1>
                    <h2>Thank You for Supporting Sylph!</h2>
                    <p>Your contribution helps keep this service running for everyone.</p>
                    
                    <div class="key-container">
                        <h3>Your API Key</h3>
                        <p>Use this key to bypass rate limits. Add it as a Bearer token in the Authorization header.</p>
                        <div class="key-display" id="api-key">${apiKey}</div>
                        <button class="copy-button" onclick="copyApiKey()">Copy API Key</button>
                    </div>
                    
                    ${couponCode ? `
                    <div class="coupon-section">
                        <h3>Special Offer</h3>
                        <p>Here's a 40% discount coupon for your next donation (valid for one week):</p>
                        <div class="key-display" id="coupon-code">${couponCode}</div>
                        <button class="copy-button" onclick="copyCouponCode()">Copy Coupon Code</button>
                    </div>
                    ` : ''}
                    
                    <div style="margin-top: 3rem; text-align: center;">
                        <a href="/" class="button">Return to Homepage</a>
                    </div>
                </div>
                
                <script>
                    function copyApiKey() {
                        const apiKey = document.getElementById('api-key').textContent;
                        navigator.clipboard.writeText(apiKey)
                            .then(() => alert('API key copied to clipboard'))
                            .catch(() => alert('Failed to copy API key'));
                    }
                    
                    ${couponCode ? `
                    function copyCouponCode() {
                        const couponCode = document.getElementById('coupon-code').textContent;
                        navigator.clipboard.writeText(couponCode)
                            .then(() => alert('Coupon code copied to clipboard'))
                            .catch(() => alert('Failed to copy coupon code'));
                    }
                    ` : ''}
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        logger.error('Donation success page error:', error);
        res.status(500).send('An error occurred while processing your donation information.');
    }
});

// X-Frame-Options middleware to prevent site from being loaded in iframes
app.use((req, res, next) => {
    // Only apply X-Frame-Options to non-API routes
    if (!req.path.startsWith('/v1/') && req.path !== '/docs') {
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    }
    next();
});

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

        // Start health checks
        if (process.env.ENABLE_HEALTH_CHECKS !== 'false') {
            const interval = parseInt(process.env.HEALTH_CHECK_INTERVAL) * 1000 || 7200000;
            
            health.startHealthChecks((model, result) => {
                const status = result.status === 'operational' ? 'healthy' : 'unhealthy';
                /*
                logger.debug(`[Health] Model ${model} ${status}:`, {
                    latency: result.latency,
                    error: result.error,
                    attempts: result.attempts,
                    response: result.response?.slice(0, 100) + (result.response?.length > 100 ? '...' : '') || 'null'
                }); 
                */
            }, interval);

            logger.debug('Health checks initialized', {
                interval: `${interval/1000}s`,
                delay: `${parseInt(process.env.HEALTH_CHECK_DELAY) || 2600}ms`
            });
        }

        // Cleanup function
        function cleanup() {
            logger.debug('Shutting down...');
            health.stopHealthChecks();
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