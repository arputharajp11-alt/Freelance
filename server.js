require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

// Import modules
const { initializeDatabase, query } = require('./server/config/database');
const { initializeEmail } = require('./server/services/email');
const { initializeSocket } = require('./server/socket');

// Import routes
const authRoutes = require('./server/routes/auth');
const jobRoutes = require('./server/routes/jobs');
const chatRoutes = require('./server/routes/chat');
const notificationRoutes = require('./server/routes/notifications');
const blockchainRoutes = require('./server/routes/blockchain');
const walletRoutes = require('./server/routes/wallet');

// ── CORS Configuration ───────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    // Netlify production URL
    'https://arjunlight.netlify.app',
    // Allow any *.netlify.app subdomain (previews, branch deploys)
    /^https:\/\/[\w-]+\.netlify\.app$/,
    // Allow FRONTEND_URL env var if set in Render dashboard
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (Postman, curl, server-to-server, mobile)
        if (!origin) return callback(null, true);
        const allowed = ALLOWED_ORIGINS.some(o =>
            typeof o === 'string' ? o === origin : o.test(origin)
        );
        if (allowed) callback(null, true);
        else {
            // In production, log CORS rejections but don't hard-fail to avoid
            // breaking legitimate browsers with unusual headers
            console.warn(`CORS: origin ${origin} not in allowlist`);
            callback(null, process.env.NODE_ENV !== 'production');
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            const ok = ALLOWED_ORIGINS.some(o =>
                typeof o === 'string' ? o === origin : o.test(origin)
            );
            cb(ok ? null : new Error('CORS blocked'), ok);
        },
        methods: ['GET', 'POST'],
        credentials: true,
    }
});

// ── Middleware ────────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads/avatars', express.static(path.join(__dirname, 'uploads', 'avatars')));

// ── API Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/blockchain', blockchainRoutes);
app.use('/api/wallet', walletRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Stats endpoint (async)
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
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// SPA catch-all
app.get('*', (req, res) => {
    const requestedFile = path.join(__dirname, 'public', req.path);
    if (require('fs').existsSync(requestedFile + '.html')) {
        return res.sendFile(requestedFile + '.html');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Initialize and start ─────────────────────────────────────────────────
async function start() {
    try {
        // Initialize database (creates tables on first run)
        await initializeDatabase();

        // Initialize email service
        await initializeEmail();

        // Initialize Socket.IO
        initializeSocket(io);

        // Ensure upload directory exists
        const uploadDir = path.join(__dirname, 'uploads');
        if (!require('fs').existsSync(uploadDir)) {
            require('fs').mkdirSync(uploadDir, { recursive: true });
        }

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log('');
            console.log('🚀 ═══════════════════════════════════════════════');
            console.log('🚀  FreelancerHub Server Running!');
            console.log('🚀 ═══════════════════════════════════════════════');
            console.log(`🌐  URL: http://localhost:${PORT}`);
            console.log(`📡  API: http://localhost:${PORT}/api`);
            console.log(`🗄️   DB:  Neon PostgreSQL`);
            console.log('🚀 ═══════════════════════════════════════════════');
            console.log('');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

start();
