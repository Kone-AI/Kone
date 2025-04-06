// Logger utility with color support and consistent formatting
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

class Logger {
    constructor() {
        // separate debug mode from debug logging
        this.DEBUG = process.env.DEBUG_MODE === 'true';
        this.DEBUG_LOGGING = process.env.DEBUG_LOGGING !== 'false';
        
        // colors for different log levels
        this.colors = {
            debug: chalk.blue,
            info: chalk.green,
            warn: chalk.yellow,
            error: chalk.red
        };

        // ensure logs directory exists
        this.logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    format(level, message, data = {}, forFile = false) {
        const timestamp = new Date().toISOString();
        const prefix = forFile ?
            `[${level.toUpperCase()}]` :
            this.colors[level](`[${level.toUpperCase()}]`);

        // Format data if present
        const details = Object.keys(data).length > 0
            ? '\n' + JSON.stringify(data, null, 2).split('\n').map(line => '  ' + line).join('\n')
            : '';

        // for file logging we want the timestamp
        return forFile ?
            `${timestamp} ${prefix} ${message}${details}` :
            `${prefix} ${message}${details}`;
    }

    // write to log file
    async writeToFile(level, message, data = {}) {
        try {
            const logFile = path.join(this.logsDir, `${level}.log`);
            const logMessage = this.format(level, message, data, true) + '\n';
            await fs.promises.appendFile(logFile, logMessage);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    debug(message, data = {}) {
        // always write debug logs to file
        this.writeToFile('debug', message, data);
        
        // only show in terminal if debug logging is enabled
        if (this.DEBUG_LOGGING) {
            console.log(this.format('debug', message, data));
        }
    }

    info(message, data = {}) {
        this.writeToFile('info', message, data);
        console.log(this.format('info', message, data));
    }

    warn(message, data = {}) {
        this.writeToFile('warn', message, data);
        console.warn(this.format('warn', message, data));
    }

    error(message, data = {}) {
        this.writeToFile('error', message, data);
        console.error(this.format('error', message, data));
    }

    // Clean startup logging
    startup(component, status, data = {}) {
        const message = `Starting ${component}...`;
        
        // write to startup.log
        this.writeToFile('startup', message, { status, ...data });
        
        if (status === 'success') {
            this.info(`${message} OK`, data);
        } else if (status === 'warning') {
            this.warn(`${message} WARNING`, data);
        } else if (status === 'error') {
            this.error(`${message} FAILED`, data);
        } else {
            this.info(message, data);
        }
    }
}

// create a singleton instance
export default new Logger();