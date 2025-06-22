import sequelize from '../config.js';
import { User, ApiKey, Usage } from '../models/index.js';

async function runMigrations() {
    try {
        // Test database connection
        await sequelize.authenticate();
        console.log('Database connection established successfully.');

        // Sync all models with database
        await sequelize.sync({ alter: true });
        console.log('Database migrations completed successfully.');

        // Close database connection
        await sequelize.close();
        process.exit(0);
    } catch (error) {
        console.error('Error running migrations:', error);
        process.exit(1);
    }
}

runMigrations();