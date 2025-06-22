import jwt from 'jsonwebtoken';
import { User, ApiKey } from '../database/models/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = '24h';

export const AuthService = {
    async registerUser(email, password) {
        try {
            const existingUser = await User.findOne({ where: { email } });
            if (existingUser) {
                throw new Error('Email already registered');
            }

            const user = await User.create({
                email,
                password,
                is_demo: true,
                demo_requests_remaining: 10
            });

            const token = this.generateToken(user);
            return { user, token };
        } catch (error) {
            throw error;
        }
    },

    async loginUser(email, password) {
        try {
            const user = await User.findOne({ where: { email } });
            if (!user) {
                throw new Error('User not found');
            }

            const isValidPassword = await user.validatePassword(password);
            if (!isValidPassword) {
                throw new Error('Invalid password');
            }

            // Update last login
            await user.update({ last_login: new Date() });

            const token = this.generateToken(user);
            return { user, token };
        } catch (error) {
            throw error;
        }
    },

    generateToken(user) {
        return jwt.sign(
            { 
                id: user.id,
                email: user.email,
                subscription_plan: user.subscription_plan
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
    },

    async createApiKey(userId, name = 'Default Key') {
        try {
            const user = await User.findByPk(userId);
            if (!user) {
                throw new Error('User not found');
            }

            if (user.subscription_plan === 'free') {
                throw new Error('API key creation requires a paid subscription');
            }

            const apiKey = await ApiKey.create({
                user_id: userId,
                name
            });

            return apiKey;
        } catch (error) {
            throw error;
        }
    },

    async listApiKeys(userId) {
        try {
            const keys = await ApiKey.findAll({
                where: { user_id: userId },
                attributes: ['id', 'key', 'name', 'total_requests', 'last_used_at', 'is_enabled', 'created_at']
            });
            return keys;
        } catch (error) {
            throw error;
        }
    },

    async revokeApiKey(userId, keyId) {
        try {
            const key = await ApiKey.findOne({
                where: {
                    id: keyId,
                    user_id: userId
                }
            });

            if (!key) {
                throw new Error('API key not found');
            }

            await key.update({ is_enabled: false });
            return key;
        } catch (error) {
            throw error;
        }
    },

    async validateToken(token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await User.findByPk(decoded.id);
            if (!user) {
                throw new Error('User not found');
            }
            return user;
        } catch (error) {
            throw error;
        }
    }
};