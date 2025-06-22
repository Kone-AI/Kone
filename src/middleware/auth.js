import { ApiKey, User } from '../database/models/index.js';
import rateLimit from 'express-rate-limit';

// Rate limit for public chat API
export const chatRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 requests per window
    message: {
        error: {
            message: 'Too many requests from this IP, please try again later',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded'
        }
    }
});

// Rate limit for API endpoints
export const apiRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: {
        error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded'
        }
    },
    keyGenerator: (req) => {
        return req.headers['x-api-key'] || req.ip;
    }
});

// Middleware to validate API key
export const validateApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({
            error: {
                message: 'API key is required',
                type: 'auth_error',
                code: 'missing_api_key'
            }
        });
    }

    try {
        const keyRecord = await ApiKey.findOne({
            where: { key: apiKey, is_enabled: true },
            include: [{
                model: User,
                as: 'user',
                attributes: ['subscription_plan', 'id']
            }]
        });

        if (!keyRecord) {
            return res.status(401).json({
                error: {
                    message: 'Invalid API key',
                    type: 'auth_error',
                    code: 'invalid_api_key'
                }
            });
        }

        // Update last used information
        await keyRecord.update({
            last_used_at: new Date(),
            last_used_ip: req.ip,
            total_requests: keyRecord.total_requests + 1
        });

        // Attach API key and user info to request
        req.apiKey = keyRecord;
        req.user = keyRecord.user;

        next();
    } catch (error) {
        console.error('Error validating API key:', error);
        return res.status(500).json({
            error: {
                message: 'Internal server error',
                type: 'server_error',
                code: 'internal_error'
            }
        });
    }
};

// Middleware to check if user is in demo mode
export const checkDemoLimit = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: {
                message: 'Authentication required',
                type: 'auth_error',
                code: 'auth_required'
            }
        });
    }

    if (req.user.is_demo && req.user.demo_requests_remaining <= 0) {
        return res.status(403).json({
            error: {
                message: 'Demo request limit reached. Please upgrade to continue.',
                type: 'limit_error',
                code: 'demo_limit_reached'
            }
        });
    }

    next();
};