import { Model, DataTypes } from 'sequelize';
import sequelize from '../config.js';
import { v4 as uuidv4 } from 'uuid';

class Usage extends Model {}

Usage.init({
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
    api_key_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'api_keys',
            key: 'id'
        }
    },
    model: {
        type: DataTypes.STRING,
        allowNull: false
    },
    provider: {
        type: DataTypes.STRING,
        allowNull: false
    },
    request_type: {
        type: DataTypes.ENUM('chat', 'completion', 'other'),
        defaultValue: 'chat'
    },
    tokens_input: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    tokens_output: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    cost: {
        type: DataTypes.DECIMAL(10, 6),
        defaultValue: 0
    },
    status: {
        type: DataTypes.ENUM('success', 'error'),
        allowNull: false
    },
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    ip_address: {
        type: DataTypes.STRING,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    sequelize,
    modelName: 'Usage',
    tableName: 'usage_logs',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [
        {
            fields: ['user_id']
        },
        {
            fields: ['api_key_id']
        },
        {
            fields: ['model']
        },
        {
            fields: ['created_at']
        }
    ]
});

export default Usage;