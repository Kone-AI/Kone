// Maintenance mode middleware
const maintenanceMiddleware = (req, res, next) => {
    if (process.env.MAINTENANCE_MODE === 'true') {
        const message = process.env.MAINTENANCE_MESSAGE || 'Service is temporarily under maintenance.';
        return res.status(503).json({
            error: {
                message,
                type: 'maintenance_mode',
                code: 'service_unavailable'
            }
        });
    }
    next();
};

export default maintenanceMiddleware;