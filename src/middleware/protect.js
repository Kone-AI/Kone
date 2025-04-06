// middleware/protect.js - Authentication middleware
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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