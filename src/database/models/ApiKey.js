import { Model, DataTypes } from 'sequelize';
import sequelize from '../config.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

class ApiKey extends Model {
    static generateKey() {
        return `kone_${crypto.randomBytes(32).toString('hex')}`;
    }
}

ApiKey.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        defaultValue: ApiKey.generateKey
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    total_requests: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    last_used_at: {
        type: DataTypes.DATE
    },
    last_used_ip: {
        type: DataTypes.STRING
    },
    is_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    rate_limit: {
        type: DataTypes.INTEGER,
        defaultValue: 100 // requests per minute
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    sequelize,
    modelName: 'ApiKey',
    tableName: 'api_keys',
    timestamps: true,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ['key']
        },
        {
            fields: ['user_id']
        }
    ]
});

export default ApiKey;