import { Usage, User, ApiKey } from '../database/models/index.js';
import { Op } from 'sequelize';

export const UsageService = {
    async logUsage({
        userId,
        apiKeyId,
        model,
        provider,
        requestType,
        tokensInput,
        tokensOutput,
        cost,
        status,
        errorMessage,
        ipAddress
    }) {
        try {
            // Create usage log
            const usage = await Usage.create({
                user_id: userId,
                api_key_id: apiKeyId,
                model,
                provider,
                request_type: requestType,
                tokens_input: tokensInput,
                tokens_output: tokensOutput,
                cost,
                status,
                error_message: errorMessage,
                ip_address: ipAddress
            });

            // Update user's total requests and costs
            if (status === 'success') {
                await User.increment(
                    {
                        total_requests: 1,
                        total_spent: cost
                    },
                    { where: { id: userId } }
                );

                // If demo user, decrement remaining requests
                await User.update(
                    {
                        demo_requests_remaining: sequelize.literal('demo_requests_remaining - 1')
                    },
                    {
                        where: {
                            id: userId,
                            is_demo: true,
                            demo_requests_remaining: { [Op.gt]: 0 }
                        }
                    }
                );
            }

            return usage;
        } catch (error) {
            console.error('Error logging usage:', error);
            throw error;
        }
    },

    async getUserStats(userId) {
        try {
            const stats = await Usage.findAll({
                where: {
                    user_id: userId,
                    status: 'success'
                },
                attributes: [
                    'model',
                    'provider',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'total_requests'],
                    [sequelize.fn('SUM', sequelize.col('tokens_input')), 'total_tokens_input'],
                    [sequelize.fn('SUM', sequelize.col('tokens_output')), 'total_tokens_output'],
                    [sequelize.fn('SUM', sequelize.col('cost')), 'total_cost']
                ],
                group: ['model', 'provider']
            });

            return stats;
        } catch (error) {
            console.error('Error getting user stats:', error);
            throw error;
        }
    },

    async getApiKeyStats(apiKeyId) {
        try {
            const stats = await Usage.findAll({
                where: {
                    api_key_id: apiKeyId,
                    status: 'success'
                },
                attributes: [
                    'model',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'total_requests'],
                    [sequelize.fn('SUM', sequelize.col('tokens_input')), 'total_tokens_input'],
                    [sequelize.fn('SUM', sequelize.col('tokens_output')), 'total_tokens_output'],
                    [sequelize.fn('SUM', sequelize.col('cost')), 'total_cost']
                ],
                group: ['model']
            });

            return stats;
        } catch (error) {
            console.error('Error getting API key stats:', error);
            throw error;
        }
    },

    async getDailyUsage(userId, days = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const dailyStats = await Usage.findAll({
                where: {
                    user_id: userId,
                    status: 'success',
                    created_at: {
                        [Op.gte]: startDate
                    }
                },
                attributes: [
                    [sequelize.fn('date_trunc', 'day', sequelize.col('created_at')), 'date'],
                    [sequelize.fn('COUNT', sequelize.col('id')), 'requests'],
                    [sequelize.fn('SUM', sequelize.col('cost')), 'cost']
                ],
                group: [sequelize.fn('date_trunc', 'day', sequelize.col('created_at'))],
                order: [[sequelize.fn('date_trunc', 'day', sequelize.col('created_at')), 'ASC']]
            });

            return dailyStats;
        } catch (error) {
            console.error('Error getting daily usage:', error);
            throw error;
        }
    }
};