/**
 * FreelancerHub — Netlify Serverless Function
 * ─────────────────────────────────────────────
 * This file wraps the entire Express app as a Netlify Function.
 * All /api/* requests from the frontend are routed here.
 * The Neon PostgreSQL database is used via DATABASE_URL env var.
 */

'use strict';

const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');

// ── Neon Serverless driver (HTTP-based, no TCP – works perfectly in Lambda) ─
const { neon } = require('@neondatabase/serverless');

// Lazily initialize the Neon client so a missing DATABASE_URL doesn't crash
// the entire Lambda at module-load time (which would make EVERY route 502).
const DB_REPLICAS = [
    'postgresql://neondb_owner:npg_dosGg6JuPeh8@ep-morning-sunset-ad9jl49v-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    'postgresql://neondb_owner:npg_EaWh5NQO3RxD@ep-rapid-shape-a85pl2zm-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require',
    'postgresql://neondb_owner:npg_yw2sMjXOm7eK@ep-fragrant-paper-abfu385z-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
];

let _sqlClients = [];

function getSqlClients() {
    if (_sqlClients.length > 0) return _sqlClients;
    
    // Prioritize DB 1 as primary
    const urls = [...DB_REPLICAS];
    
    // Add env URL if it's not already in the list
    const envUrl = process.env.DATABASE_URL;
    if (envUrl && !urls.includes(envUrl)) {
        urls.push(envUrl);
    }
    
    _sqlClients = urls.map(url => ({
        url,
        execute: neon(url)
    }));
    return _sqlClients;
}

async function query(queryText, params = []) {
    const clients = getSqlClients();
    let lastError = null;

    for (const client of clients) {
        try {
            const result = await client.execute(queryText, params);
            return {
                rows: result,
                rowCount: result.length,
                lastInsertRowid: result[0]?.id ?? null,
            };
        } catch (err) {
            console.error(`[DB Failover] Failed on ${client.url.split('@')[1]}:`, err.message);
            lastError = err;
            // Continue to next replica
        }
    }

    throw new Error(`All database replicas failed. Last error: ${lastError?.message}`);
}

// ── JWT helpers ───────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'freelancer-hub-secret-key-dev-2024';

function generateToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided. Please login.' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
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
        if (error.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired. Please login again.' });
        if (error.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token. Please login again.' });
        return res.status(401).json({ error: 'Authentication failed.' });
    }
}

function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Permission denied' });
        next();
    };
}

// ── Nodemailer (Gmail SMTP) ───────────────────────────────────────────────
const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
    if (_transporter) return _transporter;
    const emailUser = process.env.EMAIL_USER || 'arjuninfosolution0711@gmail.com';
    const emailPass = process.env.EMAIL_PASS || 'oeqlgibeolxhrjwt';
    const emailHost = process.env.EMAIL_HOST || 'smtp.gmail.com';
    const emailPort = process.env.EMAIL_PORT || '587';
    if (emailUser && emailPass) {
        _transporter = nodemailer.createTransport({
            host: emailHost,
            port: parseInt(emailPort),
            secure: false, // TLS
            auth: {
                user: emailUser,
                pass: emailPass,
            },
        });
    }
    return _transporter;
}

async function sendEmail({ to, subject, html }) {
    try {
        const transporter = getTransporter();
        if (!transporter) {
            console.log('[Email] No SMTP config — skipping email to:', to);
            return false;
        }
        const from = process.env.EMAIL_FROM || 'Freelancer <arjuninfosolution0711@gmail.com>';
        await transporter.sendMail({ from, to, subject, html });
        console.log('[Email] Sent to:', to, '| Subject:', subject);
        return true;
    } catch (err) {
        console.error('[Email] Failed to send email:', err.message);
        return false;
    }
}

// ── Express app ───────────────────────────────────────────────────────────
const app = express();

const ALLOWED = [
    'https://arjunlight.netlify.app',
    /^https:\/\/[\w-]+\.netlify\.app$/,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
];

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const ok = ALLOWED.some(o => typeof o === 'string' ? o === origin : o.test(origin));
        cb(null, ok || true); // permissive for cross-origin support
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// AUTH ROUTES
// ============================================================
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, full_name, role, skills, hourly_rate, bio } = req.body;
        if (!email || !password || !full_name || !role) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (!['client', 'freelancer'].includes(role)) {
            return res.status(400).json({ error: 'Role must be client or freelancer' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = uuidv4();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        // Use only the core columns that definitely exist in any schema version
        let result;
        try {
            result = await query(`
                INSERT INTO users (email, password, full_name, role, skills, hourly_rate, bio, verification_token, verification_expires)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
            `, [
                email, hashedPassword, full_name, role,
                JSON.stringify(skills || []),
                hourly_rate || 0,
                bio || '',
                verificationToken,
                verificationExpires
            ]);
        } catch (insertErr) {
            // Fallback: insert without optional columns that may be missing
            result = await query(`
                INSERT INTO users (email, password, full_name, role)
                VALUES ($1, $2, $3, $4)
                RETURNING id
            `, [email, hashedPassword, full_name, role]);
        }

        const userId = result.rows[0].id;
        const token = generateToken(userId);

        const userRow = await query(
            'SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating, skills, bio, hourly_rate FROM users WHERE id = $1',
            [userId]
        );
        const user = userRow.rows[0];

        // Send welcome + verification email (fire-and-forget)
        const verifyUrl = `https://arjunlight.netlify.app/verify-email.html?token=${verificationToken}`;
        sendEmail({
            to: email,
            subject: 'Welcome to Freelancer! Please verify your email 🎉',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Freelancer! 🚀</h1>
                    </div>
                    <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <p style="font-size: 16px; color: #333;">Hi <strong>${full_name}</strong>,</p>
                        <p style="font-size: 16px; color: #555;">Your account has been created as a <strong>${role}</strong>. Please verify your email to unlock all features.</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${verifyUrl}" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: bold;">✅ Verify My Email</a>
                        </div>
                        <p style="font-size: 14px; color: #888;">This verification link expires in 24 hours. If you did not create this account, you can ignore this email.</p>
                        <p style="font-size: 14px; color: #888; text-align: center;">— The Freelancer Team</p>
                    </div>
                </div>
            `
        }).catch(() => {});

        res.status(201).json({
            message: 'Registration successful! Welcome to FreelancerHub.',
            token,
            user: { ...user, skills: JSON.parse(user.skills || '[]') }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: error.message || 'Server error during registration' });
    }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Best-effort: update online status — never crash login if columns are missing
        try {
            await query('UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1', [user.id]);
        } catch (e) { /* is_online/last_seen may not exist yet */ }

        const token = generateToken(user.id);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name || '',
                role: user.role,
                is_verified: user.is_verified || false,
                wallet_address: user.wallet_address || '',
                avatar: user.avatar || null,
                rating: user.rating || 0,
                skills: JSON.parse(user.skills || '[]'),
                bio: user.bio || '',
                hourly_rate: user.hourly_rate || 0,
                total_earnings: user.total_earnings || 0,
                total_spent: user.total_spent || 0
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticate, async (req, res) => {
    try {
        const result = await query(`
            SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating,
                   total_reviews, skills, bio, hourly_rate, total_earnings, total_spent,
                   location, title, website, github, created_at
            FROM users WHERE id = $1
        `, [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = result.rows[0];
        res.json({ user: { ...user, skills: JSON.parse(user.skills || '[]') } });
    } catch (error) {
        console.error('Me error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/auth/profile
app.put('/api/auth/profile', authenticate, async (req, res) => {
    try {
        const { full_name, bio, skills, hourly_rate, wallet_address, location, title, website, github } = req.body;
        await query(`
            UPDATE users SET
                full_name = COALESCE($1, full_name), bio = COALESCE($2, bio),
                skills = COALESCE($3, skills), hourly_rate = COALESCE($4, hourly_rate),
                wallet_address = COALESCE($5, wallet_address), location = COALESCE($6, location),
                title = COALESCE($7, title), website = COALESCE($8, website),
                github = COALESCE($9, github), updated_at = NOW()
            WHERE id = $10
        `, [
            full_name || null, bio !== undefined ? bio : null,
            skills ? JSON.stringify(skills) : null, hourly_rate ?? null,
            wallet_address || null, location || null, title || null,
            website || null, github || null, req.user.id
        ]);
        const result = await query(
            'SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating, skills, bio, hourly_rate, total_earnings, total_spent, location, title, website, github FROM users WHERE id = $1',
            [req.user.id]
        );
        const user = result.rows[0];
        res.json({ message: 'Profile updated successfully', user: { ...user, skills: JSON.parse(user.skills || '[]') } });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authenticate, async (req, res) => {
    try {
        await query('UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1', [req.user.id]);
        res.json({ message: 'Logged out successfully' });
    } catch (e) {
        res.json({ message: 'Logged out' });
    }
});

// GET /api/auth/users/:id
app.get('/api/auth/users/:id', async (req, res) => {
    try {
        const result = await query(`
            SELECT id, full_name, role, avatar, bio, skills, hourly_rate, rating,
                   total_reviews, total_earnings, is_online, last_seen, created_at
            FROM users WHERE id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = result.rows[0];
        res.json({ user: { ...user, skills: JSON.parse(user.skills || '[]') } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// GET /api/auth/users
app.get('/api/auth/users', async (req, res) => {
    try {
        const { role, search, page, limit: lim } = req.query;
        const limitNum = parseInt(lim) || 20;
        const pageNum = parseInt(page) || 1;
        const offset = (pageNum - 1) * limitNum;
        const params = [];
        let conditions = '1=1';
        let idx = 1;
        if (role) { conditions += ` AND role = $${idx++}`; params.push(role); }
        if (search) {
            conditions += ` AND (full_name ILIKE $${idx} OR bio ILIKE $${idx} OR skills ILIKE $${idx})`;
            params.push(`%${search}%`); idx++;
        }
        params.push(limitNum, offset);
        const result = await query(`
            SELECT id, full_name, role, avatar, bio, skills, hourly_rate, rating, total_reviews, is_online, created_at
            FROM users WHERE ${conditions} ORDER BY rating DESC, created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
        `, params);
        res.json({ users: result.rows.map(u => ({ ...u, skills: JSON.parse(u.skills || '[]') })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const result = await query('SELECT id, full_name FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            // Don't reveal whether email exists
            return res.json({ message: 'If that email exists, a reset link has been sent.' });
        }

        const user = result.rows[0];
        const resetToken = uuidv4();
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

        await query('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3',
            [resetToken, resetExpires, user.id]);

        const resetUrl = `https://arjunlight.netlify.app/reset-password.html?token=${resetToken}`;

        await sendEmail({
            to: email,
            subject: 'Reset Your Freelancer Password',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">Password Reset Request</h1>
                    </div>
                    <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <p style="font-size: 16px; color: #333;">Hi <strong>${user.full_name}</strong>,</p>
                        <p style="font-size: 16px; color: #555;">We received a request to reset your password. Click the button below to set a new password:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetUrl}" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: bold;">Reset Password</a>
                        </div>
                        <p style="font-size: 14px; color: #888;">This link expires in 1 hour. If you did not request this, please ignore this email.</p>
                        <p style="font-size: 14px; color: #888; text-align: center;">— The Freelancer Team</p>
                    </div>
                </div>
            `
        });

        res.json({ message: 'If that email exists, a reset link has been sent.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const result = await query(
            'SELECT id, email, full_name FROM users WHERE reset_token = $1 AND reset_expires > NOW()',
            [token]
        );
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const user = result.rows[0];
        const hashedPassword = await bcrypt.hash(password, 10);
        await query('UPDATE users SET password = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2',
            [hashedPassword, user.id]);

        sendEmail({
            to: user.email,
            subject: 'Your Freelancer Password Has Been Reset',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <p>Hi <strong>${user.full_name}</strong>,</p>
                    <p>Your password has been successfully reset. If you did not do this, please contact us immediately.</p>
                    <p>— The Freelancer Team</p>
                </div>
            `
        }).catch(() => {});

        res.json({ message: 'Password reset successfully! You can now login.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// GET /api/auth/verify-email?token=...
app.get('/api/auth/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: 'Verification token is required' });

        const result = await query(
            'SELECT id, email, full_name FROM users WHERE verification_token = $1 AND verification_expires > NOW()',
            [token]
        );
        if (result.rows.length === 0) {
            // Check if already verified
            const alreadyVerified = await query('SELECT id FROM users WHERE verification_token = $1', [token]);
            if (alreadyVerified.rows.length > 0) {
                return res.status(400).json({ error: 'already_verified', message: 'Email already verified. Please login.' });
            }
            return res.status(400).json({ error: 'expired', message: 'Verification link has expired. Request a new one.' });
        }

        const user = result.rows[0];
        await query('UPDATE users SET is_verified = true, verification_token = NULL, verification_expires = NULL WHERE id = $1', [user.id]);

        sendEmail({
            to: user.email,
            subject: '✅ Email Verified — Welcome to Freelancer!',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
                    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 26px;">Email Verified! 🎉</h1>
                    </div>
                    <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <p style="font-size: 16px; color: #333;">Hi <strong>${user.full_name}</strong>,</p>
                        <p style="font-size: 16px; color: #555;">Your email has been successfully verified. You now have full access to Freelancer!</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="https://arjunlight.netlify.app/dashboard.html" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: bold;">Go to Dashboard</a>
                        </div>
                        <p style="font-size: 14px; color: #888; text-align: center;">— The Freelancer Team</p>
                    </div>
                </div>
            `
        }).catch(() => {});

        res.json({ message: 'Email verified successfully! You can now login.' });
    } catch (error) {
        console.error('Verify email error:', error);
        res.status(500).json({ error: 'Failed to verify email' });
    }
});

// POST /api/auth/resend-verification
app.post('/api/auth/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const result = await query('SELECT id, full_name, is_verified FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.json({ message: 'If that email exists, a verification link has been sent.' });
        }

        const user = result.rows[0];
        if (user.is_verified) {
            return res.status(400).json({ error: 'Email is already verified. Please login.' });
        }

        const verificationToken = uuidv4();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        await query('UPDATE users SET verification_token = $1, verification_expires = $2 WHERE id = $3',
            [verificationToken, verificationExpires, user.id]);

        const verifyUrl = `https://arjunlight.netlify.app/verify-email.html?token=${verificationToken}`;

        await sendEmail({
            to: email,
            subject: 'Verify Your Freelancer Email',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">Verify Your Email</h1>
                    </div>
                    <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <p style="font-size: 16px; color: #333;">Hi <strong>${user.full_name}</strong>,</p>
                        <p style="font-size: 16px; color: #555;">Click the button below to verify your email address:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${verifyUrl}" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: bold;">Verify Email</a>
                        </div>
                        <p style="font-size: 14px; color: #888;">This link expires in 24 hours.</p>
                        <p style="font-size: 14px; color: #888; text-align: center;">— The Freelancer Team</p>
                    </div>
                </div>
            `
        });

        res.json({ message: 'Verification email sent! Check your inbox.' });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Failed to send verification email' });
    }
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', authenticate, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const result = await query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(current_password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);
        await query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [hashedPassword, req.user.id]);

        res.json({ message: 'Password changed successfully!' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// ============================================================
// JOBS ROUTES
// ============================================================

async function creditWallet(userId, amount, description, jobId = null, txHash = '') {
    try {
        await query(`
            INSERT INTO wallet_transactions (user_id, type, amount, description, job_id, tx_hash, status)
            VALUES ($1, 'credit', $2, $3, $4, $5, 'completed')
        `, [userId, amount, description, jobId, txHash]);
    } catch (err) { console.error('creditWallet error:', err); }
}

// GET /api/jobs/my/posted
app.get('/api/jobs/my/posted', authenticate, async (req, res) => {
    try {
        const result = await query(`
            SELECT j.*, u.full_name as freelancer_name,
                   (SELECT COUNT(*) FROM proposals WHERE job_id = j.id) as proposal_count
            FROM jobs j LEFT JOIN users u ON j.freelancer_id = u.id
            WHERE j.client_id = $1 ORDER BY j.created_at DESC
        `, [req.user.id]);
        res.json({ jobs: result.rows.map(j => ({ ...j, skills_required: JSON.parse(j.skills_required || '[]') })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch jobs' });
    }
});

// GET /api/jobs/my/applied
app.get('/api/jobs/my/applied', authenticate, async (req, res) => {
    try {
        const result = await query(`
            SELECT j.*, p.status as proposal_status, p.proposed_amount, p.cover_letter,
                   u.full_name as client_name
            FROM proposals p JOIN jobs j ON p.job_id = j.id JOIN users u ON j.client_id = u.id
            WHERE p.freelancer_id = $1 ORDER BY p.created_at DESC
        `, [req.user.id]);
        res.json({ jobs: result.rows.map(j => ({ ...j, skills_required: JSON.parse(j.skills_required || '[]') })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch applied jobs' });
    }
});

// GET /api/jobs
app.get('/api/jobs', async (req, res) => {
    try {
        const { status, category, search, min_budget, max_budget, experience, page, limit: lim } = req.query;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(lim) || 20;
        const offset = (pageNum - 1) * limitNum;
        const params = [];
        let conditions = '1=1';
        let idx = 1;

        if (status && status !== 'all') { conditions += ` AND j.status = $${idx++}`; params.push(status); }
        else { conditions += ` AND j.status != $${idx++}`; params.push('cancelled'); }
        if (category) { conditions += ` AND j.category = $${idx++}`; params.push(category); }
        if (search) {
            conditions += ` AND (j.title ILIKE $${idx} OR j.description ILIKE $${idx})`;
            params.push(`%${search}%`); idx++;
        }
        if (min_budget) { conditions += ` AND j.budget_max >= $${idx++}`; params.push(parseFloat(min_budget)); }
        if (max_budget) { conditions += ` AND j.budget_min <= $${idx++}`; params.push(parseFloat(max_budget)); }
        if (experience) { conditions += ` AND j.experience_level = $${idx++}`; params.push(experience); }

        const countResult = await query(`SELECT COUNT(*) as total FROM jobs j WHERE ${conditions}`, [...params]);
        const total = parseInt(countResult.rows[0].total);

        params.push(limitNum, offset);
        const result = await query(`
            SELECT j.*, u.full_name as client_name,
                   (SELECT COUNT(*) FROM proposals WHERE job_id = j.id) as proposal_count
            FROM jobs j JOIN users u ON j.client_id = u.id
            WHERE ${conditions} ORDER BY j.created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
        `, params);

        res.json({
            jobs: result.rows.map(j => ({ ...j, skills_required: JSON.parse(j.skills_required || '[]') })),
            pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('List jobs error:', error);
        res.status(500).json({ error: 'Failed to fetch jobs' });
    }
});

// GET /api/jobs/:id
app.get('/api/jobs/:id', async (req, res) => {
    try {
        const jobResult = await query(`
            SELECT j.*, u.full_name as client_name, u.avatar as client_avatar,
                   f.full_name as freelancer_name
            FROM jobs j JOIN users u ON j.client_id = u.id LEFT JOIN users f ON j.freelancer_id = f.id
            WHERE j.id = $1
        `, [req.params.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        const job = jobResult.rows[0];

        const proposalsResult = await query(`
            SELECT p.*, u.full_name, u.avatar, u.rating, u.skills, u.bio, u.total_reviews
            FROM proposals p JOIN users u ON p.freelancer_id = u.id
            WHERE p.job_id = $1 ORDER BY p.created_at DESC
        `, [req.params.id]);

        res.json({
            job: { ...job, skills_required: JSON.parse(job.skills_required || '[]') },
            proposals: proposalsResult.rows.map(p => ({ ...p, skills: JSON.parse(p.skills || '[]') }))
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch job details' });
    }
});

// POST /api/jobs
app.post('/api/jobs', authenticate, authorize('client'), async (req, res) => {
    try {
        const { title, description, category, skills_required, budget_min, budget_max, budget_type, duration, experience_level, deadline } = req.body;
        if (!title || !description || !category) {
            return res.status(400).json({ error: 'Title, description, and category are required' });
        }
        const result = await query(`
            INSERT INTO jobs (client_id, title, description, category, skills_required, budget_min, budget_max, budget_type, duration, experience_level, deadline)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
        `, [req.user.id, title, description, category, JSON.stringify(skills_required || []),
        budget_min || 0, budget_max || 0, budget_type || 'fixed',
        duration || '', experience_level || 'intermediate', deadline || null]);

        const job = result.rows[0];
        res.status(201).json({ message: 'Job posted successfully!', job: { ...job, skills_required: JSON.parse(job.skills_required || '[]') } });
    } catch (error) {
        console.error('Create job error:', error);
        res.status(500).json({ error: 'Failed to create job' });
    }
});

// POST /api/jobs/:id/apply
app.post('/api/jobs/:id/apply', authenticate, authorize('freelancer'), async (req, res) => {
    try {
        const { cover_letter, proposed_amount, estimated_duration } = req.body;
        const jobId = req.params.id;
        if (!cover_letter || !proposed_amount) {
            return res.status(400).json({ error: 'Cover letter and proposed amount are required' });
        }
        const jobResult = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        if (jobResult.rows[0].status !== 'open') return res.status(400).json({ error: 'Job is no longer accepting proposals' });

        const existing = await query('SELECT id FROM proposals WHERE job_id = $1 AND freelancer_id = $2', [jobId, req.user.id]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'You already applied to this job' });

        await query(`
            INSERT INTO proposals (job_id, freelancer_id, cover_letter, proposed_amount, estimated_duration)
            VALUES ($1, $2, $3, $4, $5)
        `, [jobId, req.user.id, cover_letter, proposed_amount, estimated_duration || '']);

        const job = jobResult.rows[0];
        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, 'new_proposal', $2, $3, $4)
        `, [job.client_id, `New proposal on: ${job.title}`, `${req.user.full_name} submitted a proposal`, `/job-detail.html?id=${jobId}`]);

        res.status(201).json({ message: 'Proposal submitted successfully!' });
    } catch (error) {
        console.error('Apply error:', error);
        res.status(500).json({ error: 'Failed to submit proposal' });
    }
});

// POST /api/jobs/:id/hire/:freelancerId
app.post('/api/jobs/:id/hire/:freelancerId', authenticate, authorize('client'), async (req, res) => {
    try {
        const { id: jobId, freelancerId } = req.params;
        const jobResult = await query('SELECT * FROM jobs WHERE id = $1 AND client_id = $2', [jobId, req.user.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found or not yours' });
        if (jobResult.rows[0].status !== 'open') return res.status(400).json({ error: 'Job is no longer open' });

        await query(`UPDATE jobs SET freelancer_id = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
            [parseInt(freelancerId), jobId]);
        await query("UPDATE proposals SET status = 'accepted' WHERE job_id = $1 AND freelancer_id = $2", [jobId, freelancerId]);
        await query("UPDATE proposals SET status = 'rejected' WHERE job_id = $1 AND freelancer_id != $2", [jobId, freelancerId]);

        const conversationId = `job_${jobId}_${Math.min(req.user.id, parseInt(freelancerId))}_${Math.max(req.user.id, parseInt(freelancerId))}`;
        await query(`INSERT INTO conversations (id, user1_id, user2_id, job_id) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
            [conversationId, req.user.id, parseInt(freelancerId), parseInt(jobId)]);

        await query(`INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, 'hired', $2, $3, $4)`,
            [parseInt(freelancerId), `You've been hired!`, `You've been hired for: ${jobResult.rows[0].title}`, `/dashboard.html`]);

        res.json({ message: 'Freelancer hired successfully!', conversationId });
    } catch (error) {
        console.error('Hire error:', error);
        res.status(500).json({ error: 'Failed to hire freelancer' });
    }
});

// POST /api/jobs/:id/submit
app.post('/api/jobs/:id/submit', authenticate, authorize('freelancer'), async (req, res) => {
    try {
        const jobId = req.params.id;
        const jobResult = await query('SELECT * FROM jobs WHERE id = $1 AND freelancer_id = $2', [jobId, req.user.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found or not assigned to you' });
        if (jobResult.rows[0].status !== 'in_progress') return res.status(400).json({ error: 'Job is not in progress' });

        await query("UPDATE jobs SET status = 'submitted', updated_at = NOW() WHERE id = $1", [jobId]);
        const job = jobResult.rows[0];
        await query(`INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, 'work_submitted', $2, $3, $4)`,
            [job.client_id, 'Work Submitted', `Work submitted for: ${job.title}`, `/job-detail.html?id=${jobId}`]);

        res.json({ message: 'Work submitted successfully!' });
    } catch (error) {
        console.error('Submit error:', error);
        res.status(500).json({ error: 'Failed to submit work' });
    }
});

// POST /api/jobs/:id/complete
app.post('/api/jobs/:id/complete', authenticate, authorize('client'), async (req, res) => {
    try {
        const jobId = req.params.id;
        const jobResult = await query('SELECT * FROM jobs WHERE id = $1 AND client_id = $2', [jobId, req.user.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found or not yours' });
        if (jobResult.rows[0].status !== 'submitted') return res.status(400).json({ error: 'Work not submitted yet' });

        const job = jobResult.rows[0];
        await query("UPDATE jobs SET status = 'completed', updated_at = NOW() WHERE id = $1", [jobId]);

        if (job.escrow_amount > 0) {
            await query('UPDATE users SET total_earnings = total_earnings + $1 WHERE id = $2', [job.escrow_amount, job.freelancer_id]);
            await query('UPDATE users SET total_spent = total_spent + $1 WHERE id = $2', [job.escrow_amount, job.client_id]);
            await creditWallet(job.freelancer_id, job.escrow_amount, `Payment for: ${job.title}`, parseInt(jobId), '');
        }

        await query(`INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, 'payment_released', $2, $3, $4)`,
            [job.freelancer_id, 'Payment Released! 🎉', `Payment released for: ${job.title}`, `/dashboard.html`]);

        res.json({ message: 'Project completed! Payment released.' });
    } catch (error) {
        console.error('Complete error:', error);
        res.status(500).json({ error: 'Failed to complete project' });
    }
});

// ============================================================
// NOTIFICATIONS ROUTES
// ============================================================

// GET /api/notifications
app.get('/api/notifications', authenticate, async (req, res) => {
    try {
        const { unread_only, limit: lim, page } = req.query;
        const limitNum = parseInt(lim) || 50;
        const offset = ((parseInt(page) || 1) - 1) * limitNum;
        const params = [req.user.id];
        let conditions = 'user_id = $1';
        if (unread_only === 'true') { conditions += ' AND is_read = false'; }

        const countResult = await query(`SELECT COUNT(*) as c FROM notifications WHERE is_read = false AND user_id = $1`, [req.user.id]);
        const result = await query(`
            SELECT * FROM notifications WHERE ${conditions}
            ORDER BY created_at DESC LIMIT $2 OFFSET $3
        `, [req.user.id, limitNum, offset]);

        res.json({
            notifications: result.rows,
            unread_total: parseInt(countResult.rows[0].c || 0)
        });
    } catch (error) {
        console.error('Notifications error:', error.message);
        // Return empty gracefully instead of 500
        res.json({ notifications: [], unread_total: 0 });
    }
});

// PUT /api/notifications/:id/read
app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
    try {
        await query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ message: 'Marked as read' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

// PUT /api/notifications/read-all
app.put('/api/notifications/read-all', authenticate, async (req, res) => {
    try {
        await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update notifications' });
    }
});

// ============================================================
// WALLET ROUTES
// ============================================================

// GET /api/wallet
app.get('/api/wallet', authenticate, async (req, res) => {
    try {
        const userResult = await query('SELECT total_earnings, total_spent FROM users WHERE id = $1', [req.user.id]);
        const txResult = await query(`
            SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20
        `, [req.user.id]);
        const user = userResult.rows[0];
        const credits = txResult.rows.filter(t => t.type === 'credit' || t.type === 'deposit').reduce((s, t) => s + parseFloat(t.amount), 0);
        const debits = txResult.rows.filter(t => t.type === 'debit' || t.type === 'withdrawal').reduce((s, t) => s + parseFloat(t.amount), 0);

        res.json({
            wallet: {
                balance: Math.max(0, credits - debits),
                total_earned: user.total_earnings || 0,
                total_spent: user.total_spent || 0,
                pending_count: txResult.rows.filter(t => t.status === 'pending').length
            },
            transactions: txResult.rows
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch wallet' });
    }
});

// POST /api/wallet/withdraw
app.post('/api/wallet/withdraw', authenticate, async (req, res) => {
    try {
        const { amount, wallet_address } = req.body;
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        await query(`
            INSERT INTO wallet_transactions (user_id, type, amount, description, status)
            VALUES ($1, 'withdrawal', $2, $3, 'pending')
        `, [req.user.id, amount, `Withdrawal request of ${amount} ETH`]);
        res.json({ message: `Withdrawal of ${amount} ETH requested successfully!` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process withdrawal' });
    }
});

// POST /api/wallet/deposit
app.post('/api/wallet/deposit', authenticate, async (req, res) => {
    try {
        const { amount, tx_hash } = req.body;
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        await query(`
            INSERT INTO wallet_transactions (user_id, type, amount, description, tx_hash, status)
            VALUES ($1, 'deposit', $2, $3, $4, 'completed')
        `, [req.user.id, amount, `Deposit of ${amount} ETH`, tx_hash || '']);
        await query('UPDATE users SET total_earnings = total_earnings + $1 WHERE id = $2', [amount, req.user.id]);
        res.json({ message: `Deposit of ${amount} ETH successful!` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process deposit' });
    }
});

// GET /api/wallet/transactions
app.get('/api/wallet/transactions', authenticate, async (req, res) => {
    try {
        const { type } = req.query;
        let sql = 'SELECT * FROM wallet_transactions WHERE user_id = $1';
        const params = [req.user.id];
        if (type) { sql += ' AND type = $2'; params.push(type); }
        sql += ' ORDER BY created_at DESC LIMIT 50';
        const result = await query(sql, params);
        res.json({ transactions: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// ============================================================
// CHAT ROUTES
// ============================================================

// GET /api/chat/conversations
app.get('/api/chat/conversations', authenticate, async (req, res) => {
    try {
        // Try the full query with is_online first, fallback to simpler query
        let result;
        try {
            result = await query(`
                SELECT c.*,
                       CASE WHEN c.user1_id = $1 THEN u2.full_name ELSE u1.full_name END as other_name,
                       CASE WHEN c.user1_id = $1 THEN u2.avatar ELSE u1.avatar END as other_avatar,
                       CASE WHEN c.user1_id = $1 THEN u2.is_online ELSE u1.is_online END as other_online,
                       CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END as other_id,
                       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.receiver_id = $1 AND m.is_read = false) as unread_count
                FROM conversations c
                JOIN users u1 ON c.user1_id = u1.id JOIN users u2 ON c.user2_id = u2.id
                WHERE c.user1_id = $1 OR c.user2_id = $1
                ORDER BY c.last_message_at DESC
            `, [req.user.id]);
        } catch (innerErr) {
            // Fallback: query without is_online (column might not exist on old rows)
            console.warn('[chat/conversations] Full query failed, using fallback:', innerErr.message);
            result = await query(`
                SELECT c.*,
                       CASE WHEN c.user1_id = $1 THEN u2.full_name ELSE u1.full_name END as other_name,
                       CASE WHEN c.user1_id = $1 THEN u2.avatar ELSE u1.avatar END as other_avatar,
                       false as other_online,
                       CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END as other_id,
                       0 as unread_count
                FROM conversations c
                JOIN users u1 ON c.user1_id = u1.id JOIN users u2 ON c.user2_id = u2.id
                WHERE c.user1_id = $1 OR c.user2_id = $1
                ORDER BY c.last_message_at DESC
            `, [req.user.id]);
        }
        res.json({ conversations: result.rows });
    } catch (error) {
        console.error('Chat conversations error:', error.message);
        res.json({ conversations: [] });
    }
});

// GET /api/chat/messages/:conversationId
app.get('/api/chat/messages/:conversationId', authenticate, async (req, res) => {
    try {
        const result = await query(`
            SELECT m.*, u.full_name as sender_name, u.avatar as sender_avatar
            FROM messages m JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1 ORDER BY m.created_at ASC LIMIT 100
        `, [req.params.conversationId]);
        
        try {
            await query('UPDATE messages SET is_read = true WHERE conversation_id = $1 AND receiver_id = $2 AND is_read = false',
                [req.params.conversationId, req.user.id]);
        } catch (updateErr) {
            console.warn('[chat/messages] Failed to update is_read status:', updateErr.message);
        }
        
        res.json({ messages: result.rows });
    } catch (error) {
        console.error('[chat/messages] Error fetching messages:', error.message);
        res.json({ messages: [] });
    }
});

// POST /api/chat/messages
app.post('/api/chat/messages', authenticate, async (req, res) => {
    try {
        const { conversation_id, message, receiver_id } = req.body;
        if (!conversation_id || !message) {
            return res.status(400).json({ error: 'conversation_id and message are required' });
        }

        const convResult = await query('SELECT * FROM conversations WHERE id = $1', [conversation_id]);
        let actualReceiverId = receiver_id;
        if (convResult.rows.length > 0) {
            const conv = convResult.rows[0];
            actualReceiverId = conv.user1_id === req.user.id ? conv.user2_id : conv.user1_id;
        }

        await query(`INSERT INTO messages (conversation_id, sender_id, receiver_id, message) VALUES ($1, $2, $3, $4)`,
            [conversation_id, req.user.id, actualReceiverId || receiver_id, message]);
        await query(`UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2`,
            [message.substring(0, 100), conversation_id]);

        res.status(201).json({ message: 'Message sent' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// GET /api/chat/unread
app.get('/api/chat/unread', authenticate, async (req, res) => {
    try {
        const result = await query('SELECT COUNT(*) as unread FROM messages WHERE receiver_id = $1 AND is_read = false', [req.user.id]);
        res.json({ unread: parseInt(result.rows[0].unread) });
    } catch (error) {
        res.json({ unread: 0 });
    }
});

// ============================================================
// HEALTH / STATS ROUTES
// ============================================================

app.get('/api/health', async (req, res) => {
    const clients = getSqlClients();
    let dbOk = false;
    let dbDetails = [];

    for (const client of clients) {
        try {
            await client.execute('SELECT 1');
            dbDetails.push({ url: client.url.split('@')[1], status: 'connected' });
            dbOk = true;
        } catch (e) {
            dbDetails.push({ url: client.url.split('@')[1], status: 'error', error: e.message });
        }
    }

    const transporter = getTransporter();
    const emailConfigured = !!transporter;

    res.status(dbOk ? 200 : 503).json({
        status: dbOk ? 'ok' : 'all_dbs_failed',
        timestamp: new Date().toISOString(),
        databases: dbDetails,
        email: emailConfigured ? `configured (${process.env.EMAIL_USER || 'arjuninfosolution0711@gmail.com'})` : 'not configured',
    });
});

app.get('/api/stats', async (req, res) => {
    try {
        const [usersResult, jobsResult, activeResult, completedResult, flResult] = await Promise.all([
            query('SELECT COUNT(*) as count FROM users'),
            query('SELECT COUNT(*) as count FROM jobs'),
            query("SELECT COUNT(*) as count FROM jobs WHERE status = 'open'"),
            query("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'"),
            query("SELECT COUNT(*) as count FROM users WHERE role = 'freelancer'"),
        ]);
        res.json({
            totalUsers: parseInt(usersResult.rows[0].count),
            totalJobs: parseInt(jobsResult.rows[0].count),
            activeJobs: parseInt(activeResult.rows[0].count),
            completedJobs: parseInt(completedResult.rows[0].count),
            totalFreelancers: parseInt(flResult.rows[0].count),
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// 404 for unmatched /api routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ============================================================
// DATABASE TABLE INITIALIZATION (runs once per cold start)
// ============================================================
let tablesEnsured = false;

async function ensureTablesExist() {
    if (tablesEnsured) return;
    tablesEnsured = true;

    const statements = `
        CREATE TABLE IF NOT EXISTS users (
            id               SERIAL PRIMARY KEY,
            email            TEXT UNIQUE NOT NULL,
            password         TEXT NOT NULL,
            full_name        TEXT NOT NULL,
            role             TEXT NOT NULL CHECK(role IN ('client', 'freelancer', 'admin')),
            avatar           TEXT DEFAULT NULL,
            bio              TEXT DEFAULT '',
            skills           TEXT DEFAULT '[]',
            hourly_rate      REAL DEFAULT 0,
            wallet_address   TEXT DEFAULT '',
            is_verified      BOOLEAN DEFAULT false,
            verification_token TEXT DEFAULT NULL,
            verification_expires TIMESTAMPTZ DEFAULT NULL,
            reset_token      TEXT DEFAULT NULL,
            reset_expires    TIMESTAMPTZ DEFAULT NULL,
            rating           REAL DEFAULT 0,
            total_reviews    INTEGER DEFAULT 0,
            total_earnings   REAL DEFAULT 0,
            total_spent      REAL DEFAULT 0,
            is_online        BOOLEAN DEFAULT false,
            last_seen        TIMESTAMPTZ DEFAULT NOW(),
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW(),
            location         TEXT DEFAULT '',
            title            TEXT DEFAULT '',
            website          TEXT DEFAULT '',
            github           TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS jobs (
            id                    SERIAL PRIMARY KEY,
            client_id             INTEGER NOT NULL REFERENCES users(id),
            title                 TEXT NOT NULL,
            description           TEXT NOT NULL,
            category              TEXT NOT NULL,
            skills_required       TEXT DEFAULT '[]',
            budget_min            REAL DEFAULT 0,
            budget_max            REAL DEFAULT 0,
            budget_type           TEXT DEFAULT 'fixed',
            duration              TEXT DEFAULT '',
            experience_level      TEXT DEFAULT 'intermediate',
            status                TEXT DEFAULT 'open',
            blockchain_project_id INTEGER DEFAULT NULL,
            escrow_amount         REAL DEFAULT 0,
            escrow_tx_hash        TEXT DEFAULT '',
            freelancer_id         INTEGER DEFAULT NULL REFERENCES users(id),
            deadline              TIMESTAMPTZ DEFAULT NULL,
            attachments           TEXT DEFAULT '[]',
            created_at            TIMESTAMPTZ DEFAULT NOW(),
            updated_at            TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS proposals (
            id                 SERIAL PRIMARY KEY,
            job_id             INTEGER NOT NULL REFERENCES jobs(id),
            freelancer_id      INTEGER NOT NULL REFERENCES users(id),
            cover_letter       TEXT NOT NULL,
            proposed_amount    REAL NOT NULL,
            estimated_duration TEXT DEFAULT '',
            status             TEXT DEFAULT 'pending',
            created_at         TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS messages (
            id              SERIAL PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            sender_id       INTEGER NOT NULL REFERENCES users(id),
            receiver_id     INTEGER NOT NULL REFERENCES users(id),
            job_id          INTEGER DEFAULT NULL REFERENCES jobs(id),
            message         TEXT NOT NULL,
            message_type    TEXT DEFAULT 'text',
            file_url        TEXT DEFAULT NULL,
            is_read         BOOLEAN DEFAULT false,
            created_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS conversations (
            id              TEXT PRIMARY KEY,
            user1_id        INTEGER NOT NULL REFERENCES users(id),
            user2_id        INTEGER NOT NULL REFERENCES users(id),
            job_id          INTEGER DEFAULT NULL REFERENCES jobs(id),
            last_message    TEXT DEFAULT '',
            last_message_at TIMESTAMPTZ DEFAULT NOW(),
            created_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            type        TEXT NOT NULL,
            title       TEXT NOT NULL,
            message     TEXT NOT NULL,
            link        TEXT DEFAULT '',
            is_read     BOOLEAN DEFAULT false,
            email_sent  BOOLEAN DEFAULT false,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS wallet_transactions (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            type        TEXT NOT NULL,
            amount      REAL NOT NULL,
            description TEXT NOT NULL,
            job_id      INTEGER DEFAULT NULL REFERENCES jobs(id),
            tx_hash     TEXT DEFAULT '',
            status      TEXT DEFAULT 'completed',
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `.split(';').map(s => s.trim()).filter(s => s.length > 0);

    const migrations = [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS github TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_earnings REAL DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_spent REAL DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW()`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS skills TEXT DEFAULT '[]'`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate REAL DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT DEFAULT NULL`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMPTZ DEFAULT NULL`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT DEFAULT NULL`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ DEFAULT NULL`,
    ];

    const clients = getSqlClients();
    for (const client of clients) {
        const sqlFn = client.execute;
        console.log(`[DB Init] Ensuring tables on ${client.url.split('@')[1]}`);
        for (const stmt of statements) {
            try { await sqlFn(stmt); } catch (e) { /* table may already exist */ }
        }

        for (const m of migrations) {
            try { await sqlFn(m); } catch (e) { /* column may already exist */ }
        }
    }
}

// ── Initialise DB tables on cold start (runs once per Lambda container) ─────
// Hardcoded DB_REPLICAS mean this always runs — fire-and-forget, never blocks requests.
ensureTablesExist().catch(err => {
    console.error('DB init error on cold start:', err.message);
});

// ── Netlify Function export ───────────────────────────────────────────────
const handler = serverless(app);

module.exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
        return await handler(event, context);
    } catch (err) {
        console.error('Unhandled handler error:', err);
        return {
            statusCode: 503,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Service unavailable', details: err.message }),
        };
    }
};
