const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'freelancer-hub-secret-key-dev-2024';

/**
 * Authentication middleware - verifies JWT token (async, works with Neon)
 */
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided. Please login.' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Get user from database
        const result = await query(
            'SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found. Please login again.' });
        }

        req.user = result.rows[0];
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired. Please login again.' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token. Please login again.' });
        }
        console.error('Auth middleware error:', error);
        return res.status(401).json({ error: 'Authentication failed. Please login again.' });
    }
}

/**
 * Optional auth - attaches user if token present, never blocks
 */
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);
            const result = await query(
                'SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating FROM users WHERE id = $1',
                [decoded.userId]
            );
            if (result.rows.length > 0) req.user = result.rows[0];
        }
    } catch (e) {
        // Ignore - user just won't be attached
    }
    next();
}

/**
 * Role-based access control
 */
function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'You do not have permission to perform this action' });
        }
        next();
    };
}

/**
 * Generate JWT token
 */
function generateToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { authenticate, optionalAuth, authorize, generateToken, JWT_SECRET };
