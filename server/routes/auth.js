const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query } = require('../config/database');
const { authenticate, generateToken } = require('../middleware/auth');
const { sendVerificationEmail } = require('../services/email');

// ── Multer config for avatar uploads ─────────────────────────────────────────
const avatarDir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
    }
});
const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
    }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
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

        // Check if user exists
        const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate verification token
        const verificationToken = uuidv4();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        // Insert user — RETURNING id works on Postgres; SQLite returns rows:[] so fallback to lastInsertRowid
        const result = await query(`
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

        const userId = (result.rows && result.rows[0]) ? result.rows[0].id : result.lastInsertRowid;

        // Send verification email (non-blocking)
        sendVerificationEmail(email, full_name, verificationToken).catch(console.error);

        // Generate token – allow login immediately even before email verification
        const token = generateToken(userId);

        const userRow = await query(
            'SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating, skills, bio, hourly_rate FROM users WHERE id = $1',
            [userId]
        );
        const user = userRow.rows[0];

        res.status(201).json({
            message: 'Registration successful! Check your email to verify your account.',
            token,
            user: { ...user, skills: JSON.parse(user.skills || '[]') }
        });
    } catch (error) {
        console.error('Register error:', error);
        const msg = process.env.NODE_ENV === 'development'
            ? (error.message || 'Server error during registration')
            : 'Server error during registration';
        res.status(500).json({ error: msg });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
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

        // Update online status
        await query('UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = $1', [user.id]);

        const token = generateToken(user.id);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                is_verified: user.is_verified,
                wallet_address: user.wallet_address,
                avatar: user.avatar,
                rating: user.rating,
                skills: JSON.parse(user.skills || '[]'),
                bio: user.bio,
                hourly_rate: user.hourly_rate,
                total_earnings: user.total_earnings,
                total_spent: user.total_spent
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// GET /api/auth/verify/:token
router.get('/verify/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const result = await query(
            'SELECT id, verification_expires FROM users WHERE verification_token = $1', [token]
        );
        if (result.rows.length === 0) return res.redirect('/?verified=invalid');

        const user = result.rows[0];
        if (new Date(user.verification_expires) < new Date()) {
            return res.redirect('/?verified=expired');
        }

        await query(
            'UPDATE users SET is_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = $1',
            [user.id]
        );
        res.redirect('/?verified=success');
    } catch (error) {
        console.error('Verify error:', error);
        res.redirect('/?verified=error');
    }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', authenticate, async (req, res) => {
    try {
        if (req.user.is_verified) {
            return res.json({ message: 'Email already verified' });
        }
        const verificationToken = uuidv4();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        await query(
            'UPDATE users SET verification_token = $1, verification_expires = $2 WHERE id = $3',
            [verificationToken, verificationExpires, req.user.id]
        );
        const userRow = await query('SELECT email, full_name FROM users WHERE id = $1', [req.user.id]);
        const user = userRow.rows[0];
        await sendVerificationEmail(user.email, user.full_name, verificationToken);

        res.json({ message: 'Verification email sent!' });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Failed to resend verification email' });
    }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
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
        // If new columns don't exist yet (first boot), fall back to base query
        try {
            const r2 = await query(
                'SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating, total_reviews, skills, bio, hourly_rate, total_earnings, total_spent, created_at FROM users WHERE id = $1',
                [req.user.id]
            );
            if (r2.rows.length === 0) return res.status(404).json({ error: 'User not found' });
            const u = r2.rows[0];
            res.json({ user: { ...u, skills: JSON.parse(u.skills || '[]') } });
        } catch (err2) {
            console.error('Me error:', err2);
            res.status(500).json({ error: 'Server error' });
        }
    }
});

// PUT /api/auth/profile
router.put('/profile', authenticate, async (req, res) => {
    try {
        const { full_name, bio, skills, hourly_rate, wallet_address, location, title, website, github } = req.body;

        await query(`
            UPDATE users SET
                full_name      = COALESCE($1, full_name),
                bio            = COALESCE($2, bio),
                skills         = COALESCE($3, skills),
                hourly_rate    = COALESCE($4, hourly_rate),
                wallet_address = COALESCE($5, wallet_address),
                location       = COALESCE($6, location),
                title          = COALESCE($7, title),
                website        = COALESCE($8, website),
                github         = COALESCE($9, github),
                updated_at     = NOW()
            WHERE id = $10
        `, [
            full_name || null,
            bio !== undefined ? bio : null,
            skills ? JSON.stringify(skills) : null,
            hourly_rate ?? null,
            wallet_address || null,
            location || null,
            title || null,
            website || null,
            github || null,
            req.user.id
        ]);

        const result = await query(`
            SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating,
                   skills, bio, hourly_rate, total_earnings, total_spent, location, title, website, github
            FROM users WHERE id = $1
        `, [req.user.id]);

        const user = result.rows[0];
        res.json({
            message: 'Profile updated successfully',
            user: { ...user, skills: JSON.parse(user.skills || '[]') }
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// POST /api/auth/avatar — Upload / change profile picture
router.post('/avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;

        // Delete old avatar file if it exists and is local
        const oldResult = await query('SELECT avatar FROM users WHERE id = $1', [req.user.id]);
        const oldAvatar = oldResult.rows[0]?.avatar;
        if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/')) {
            const oldPath = path.join(__dirname, '..', '..', oldAvatar);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        await query('UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, req.user.id]);

        const result = await query(
            'SELECT id, email, full_name, role, is_verified, wallet_address, avatar, rating, skills, bio, hourly_rate, total_earnings, total_spent, location, title, website, github FROM users WHERE id = $1',
            [req.user.id]
        );
        const user = result.rows[0];
        res.json({
            message: 'Avatar updated successfully',
            avatarUrl,
            user: { ...user, skills: JSON.parse(user.skills || '[]') }
        });
    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ error: error.message || 'Failed to upload avatar' });
    }
});

// DELETE /api/auth/avatar — Remove profile picture
router.delete('/avatar', authenticate, async (req, res) => {
    try {
        const result = await query('SELECT avatar FROM users WHERE id = $1', [req.user.id]);
        const oldAvatar = result.rows[0]?.avatar;
        if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/')) {
            const oldPath = path.join(__dirname, '..', '..', oldAvatar);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        await query('UPDATE users SET avatar = NULL WHERE id = $1', [req.user.id]);
        res.json({ message: 'Avatar removed' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove avatar' });
    }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
    try {
        await query('UPDATE users SET is_online = 0, last_seen = NOW() WHERE id = $1', [req.user.id]);
        res.json({ message: 'Logged out successfully' });
    } catch (e) {
        res.json({ message: 'Logged out' });
    }
});

// GET /api/auth/users/:id - Public profile
router.get('/users/:id', async (req, res) => {
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
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// GET /api/auth/users - Search/list users
router.get('/users', async (req, res) => {
    try {
        const { role, search, page, limit: lim } = req.query;
        const limitNum = parseInt(lim) || 20;
        const pageNum = parseInt(page) || 1;
        const offset = (pageNum - 1) * limitNum;

        const params = [];
        let conditions = '1=1';
        let idx = 1;

        if (role) {
            conditions += ` AND role = $${idx++}`;
            params.push(role);
        }
        if (search) {
            conditions += ` AND (full_name ILIKE $${idx} OR bio ILIKE $${idx} OR skills ILIKE $${idx})`;
            params.push(`%${search}%`);
            idx++;
        }

        params.push(limitNum, offset);
        const result = await query(`
            SELECT id, full_name, role, avatar, bio, skills, hourly_rate, rating,
                   total_reviews, is_online, created_at
            FROM users WHERE ${conditions}
            ORDER BY rating DESC, created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
        `, params);

        res.json({
            users: result.rows.map(u => ({ ...u, skills: JSON.parse(u.skills || '[]') }))
        });
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

module.exports = router;
