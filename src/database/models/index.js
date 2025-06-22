import User from './User.js';
import ApiKey from './ApiKey.js';
import Usage from './Usage.js';

// Define relationships
User.hasMany(ApiKey, {
    foreignKey: 'user_id',
    as: 'apiKeys'
});
ApiKey.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

User.hasMany(Usage, {
    foreignKey: 'user_id',
    as: 'usageLogs'
});
Usage.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

ApiKey.hasMany(Usage, {
    foreignKey: 'api_key_id',
    as: 'usageLogs'
});
Usage.belongsTo(ApiKey, {
    foreignKey: 'api_key_id',
    as: 'apiKey'
});

export {
    User,
    ApiKey,
    Usage
};