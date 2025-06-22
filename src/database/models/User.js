import { Model, DataTypes } from 'sequelize';
import bcrypt from 'bcrypt';
import sequelize from '../config.js';
import { v4 as uuidv4 } from 'uuid';

class User extends Model {
    static async hashPassword(password) {
        const salt = await bcrypt.genSalt(10);
        return bcrypt.hash(password, salt);
    }

    async validatePassword(password) {
        return bcrypt.compare(password, this.password);
    }
}

User.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    subscription_plan: {
        type: DataTypes.ENUM('free', 'basic', 'premium'),
        defaultValue: 'free'
    },
    total_requests: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    total_spent: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    is_demo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    demo_requests_remaining: {
        type: DataTypes.INTEGER,
        defaultValue: 10
    },
    last_login: {
        type: DataTypes.DATE
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
    modelName: 'User',
    tableName: 'users',
    timestamps: true,
    underscored: true,
    hooks: {
        beforeCreate: async (user) => {
            if (user.password) {
                user.password = await User.hashPassword(user.password);
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                user.password = await User.hashPassword(user.password);
            }
        }
    }
});

export default User;