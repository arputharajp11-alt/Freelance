require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'freelancerhub.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('🌱 Seeding database with sample data...');

// ─── Initialize tables first (same as database.js) ───
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('client', 'freelancer', 'admin')),
        avatar TEXT DEFAULT NULL,
        bio TEXT DEFAULT '',
        skills TEXT DEFAULT '[]',
        hourly_rate REAL DEFAULT 0,
        wallet_address TEXT DEFAULT '',
        is_verified INTEGER DEFAULT 0,
        verification_token TEXT DEFAULT NULL,
        verification_expires DATETIME DEFAULT NULL,
        reset_token TEXT DEFAULT NULL,
        reset_expires DATETIME DEFAULT NULL,
        rating REAL DEFAULT 0,
        total_reviews INTEGER DEFAULT 0,
        total_earnings REAL DEFAULT 0,
        total_spent REAL DEFAULT 0,
        is_online INTEGER DEFAULT 0,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        skills_required TEXT DEFAULT '[]',
        budget_min REAL DEFAULT 0,
        budget_max REAL DEFAULT 0,
        budget_type TEXT DEFAULT 'fixed' CHECK(budget_type IN ('fixed', 'hourly')),
        duration TEXT DEFAULT '',
        experience_level TEXT DEFAULT 'intermediate' CHECK(experience_level IN ('beginner', 'intermediate', 'expert')),
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'submitted', 'completed', 'cancelled', 'disputed')),
        blockchain_project_id INTEGER DEFAULT NULL,
        escrow_amount REAL DEFAULT 0,
        escrow_tx_hash TEXT DEFAULT '',
        freelancer_id INTEGER DEFAULT NULL,
        deadline DATETIME DEFAULT NULL,
        attachments TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES users(id),
        FOREIGN KEY (freelancer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        freelancer_id INTEGER NOT NULL,
        cover_letter TEXT NOT NULL,
        proposed_amount REAL NOT NULL,
        estimated_duration TEXT DEFAULT '',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id),
        FOREIGN KEY (freelancer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        job_id INTEGER DEFAULT NULL,
        message TEXT NOT NULL,
        message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'file', 'system')),
        file_url TEXT DEFAULT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id),
        FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user1_id INTEGER NOT NULL,
        user2_id INTEGER NOT NULL,
        job_id INTEGER DEFAULT NULL,
        last_message TEXT DEFAULT '',
        last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user1_id) REFERENCES users(id),
        FOREIGN KEY (user2_id) REFERENCES users(id),
        FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT DEFAULT '',
        is_read INTEGER DEFAULT 0,
        email_sent INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        reviewer_id INTEGER NOT NULL,
        reviewee_id INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        comment TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id),
        FOREIGN KEY (reviewer_id) REFERENCES users(id),
        FOREIGN KEY (reviewee_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT DEFAULT '',
        amount REAL DEFAULT 0,
        tx_type TEXT NOT NULL CHECK(tx_type IN ('escrow_lock', 'escrow_release', 'escrow_refund', 'dispute')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'failed')),
        block_number INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_freelancer ON jobs(freelancer_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_proposals_job ON proposals(job_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_freelancer ON proposals(freelancer_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_job ON transactions(job_id);
`);

console.log('   ✅ Database tables initialized');

async function seed() {
    try {
        const salt = await bcrypt.genSalt(10);

        // Create sample users
        const users = [
            {
                email: 'client@demo.com',
                password: await bcrypt.hash('demo123', salt),
                full_name: 'Alex Johnson',
                role: 'client',
                bio: 'Tech entrepreneur looking for talented freelancers for various projects.',
                skills: '[]',
                hourly_rate: 0,
                is_verified: 1,
                wallet_address: '',
                total_spent: 0
            },
            {
                email: 'freelancer@demo.com',
                password: await bcrypt.hash('demo123', salt),
                full_name: 'Sarah Chen',
                role: 'freelancer',
                bio: 'Full-stack developer with 5+ years of experience in React, Node.js, and blockchain development.',
                skills: '["JavaScript", "React", "Node.js", "Solidity", "Web3"]',
                hourly_rate: 0.05,
                is_verified: 1,
                wallet_address: '',
                total_earnings: 0
            },
            {
                email: 'dev@demo.com',
                password: await bcrypt.hash('demo123', salt),
                full_name: 'Mike Rodriguez',
                role: 'freelancer',
                bio: 'UI/UX designer and frontend developer specializing in modern web applications.',
                skills: '["UI/UX", "Figma", "HTML/CSS", "React", "Tailwind"]',
                hourly_rate: 0.04,
                is_verified: 1,
                wallet_address: '',
                total_earnings: 0
            },
            {
                email: 'client2@demo.com',
                password: await bcrypt.hash('demo123', salt),
                full_name: 'Emma Wilson',
                role: 'client',
                bio: 'Startup founder building the next generation of DeFi applications.',
                skills: '[]',
                hourly_rate: 0,
                is_verified: 1,
                wallet_address: '',
                total_spent: 0
            }
        ];

        const insertUser = db.prepare(`
            INSERT OR IGNORE INTO users (email, password, full_name, role, bio, skills, hourly_rate, is_verified, wallet_address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const u of users) {
            insertUser.run(u.email, u.password, u.full_name, u.role, u.bio, u.skills, u.hourly_rate, u.is_verified, u.wallet_address);
        }
        console.log('   ✅ Users created');

        // Get user IDs
        const alex = db.prepare("SELECT id FROM users WHERE email = 'client@demo.com'").get();
        const sarah = db.prepare("SELECT id FROM users WHERE email = 'freelancer@demo.com'").get();
        const mike = db.prepare("SELECT id FROM users WHERE email = 'dev@demo.com'").get();
        const emma = db.prepare("SELECT id FROM users WHERE email = 'client2@demo.com'").get();

        if (!alex || !sarah || !mike || !emma) {
            console.log('   ⚠️  Could not find all users, skipping job seeding');
            return;
        }

        // Check if jobs already exist
        const existingJobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
        if (existingJobs.count > 0) {
            console.log('   ⚠️  Jobs already exist, skipping job seeding');
            console.log('');
            console.log('🎉 Seed data already present!');
            printAccounts();
            return;
        }

        // Create sample jobs
        const jobs = [
            {
                client_id: alex.id,
                title: 'Build a DeFi Dashboard',
                description: 'Need a responsive dashboard for tracking DeFi portfolio. Should integrate with MetaMask and show real-time token balances, transaction history, and yield farming positions. Must be built with React and Web3.js.',
                category: 'Web Development',
                skills_required: '["React", "Web3", "JavaScript", "DeFi"]',
                budget_min: 2,
                budget_max: 5,
                budget_type: 'fixed',
                duration: '2-4 weeks',
                experience_level: 'expert',
                status: 'open'
            },
            {
                client_id: alex.id,
                title: 'Smart Contract Audit',
                description: 'Looking for an experienced Solidity developer to audit our ERC-20 token contract and staking mechanism. Must have experience with security best practices and common vulnerability patterns.',
                category: 'Blockchain',
                skills_required: '["Solidity", "Security", "Smart Contracts", "Ethereum"]',
                budget_min: 3,
                budget_max: 8,
                budget_type: 'fixed',
                duration: '1-2 weeks',
                experience_level: 'expert',
                status: 'open'
            },
            {
                client_id: emma.id,
                title: 'Mobile App UI/UX Design',
                description: 'Need a modern and clean UI/UX design for a crypto wallet mobile app. Should include onboarding flow, wallet management, send/receive screens, and transaction history. Deliverables in Figma.',
                category: 'Design',
                skills_required: '["UI/UX", "Figma", "Mobile Design", "Crypto"]',
                budget_min: 1,
                budget_max: 3,
                budget_type: 'fixed',
                duration: '1-2 weeks',
                experience_level: 'intermediate',
                status: 'open'
            },
            {
                client_id: emma.id,
                title: 'Node.js REST API Development',
                description: 'Build a scalable REST API for a marketplace platform. Features include user authentication, product listings, order management, and payment integration. Must include comprehensive API documentation.',
                category: 'Backend Development',
                skills_required: '["Node.js", "Express", "MongoDB", "REST API"]',
                budget_min: 1.5,
                budget_max: 4,
                budget_type: 'fixed',
                duration: '2-3 weeks',
                experience_level: 'intermediate',
                status: 'open'
            },
            {
                client_id: alex.id,
                title: 'Landing Page Development',
                description: 'Create a stunning landing page for our new SaaS product. Must be responsive, fast-loading, and include animations. SEO optimized with proper meta tags.',
                category: 'Web Development',
                skills_required: '["HTML/CSS", "JavaScript", "Responsive Design", "SEO"]',
                budget_min: 0.5,
                budget_max: 1.5,
                budget_type: 'fixed',
                duration: '1 week',
                experience_level: 'beginner',
                status: 'open'
            },
            {
                client_id: emma.id,
                title: 'React Native Mobile App',
                description: 'Develop a cross-platform mobile app for iOS and Android using React Native. The app should include user authentication, push notifications, and offline support.',
                category: 'Mobile Development',
                skills_required: '["React Native", "JavaScript", "iOS", "Android"]',
                budget_min: 3,
                budget_max: 7,
                budget_type: 'fixed',
                duration: '4-6 weeks',
                experience_level: 'expert',
                status: 'open'
            }
        ];

        const insertJob = db.prepare(`
            INSERT INTO jobs (client_id, title, description, category, skills_required, budget_min, budget_max, budget_type, duration, experience_level, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const j of jobs) {
            insertJob.run(j.client_id, j.title, j.description, j.category, j.skills_required, j.budget_min, j.budget_max, j.budget_type, j.duration, j.experience_level, j.status);
        }
        console.log('   ✅ Jobs created');

        // Add sample proposals from Sarah to Alex's first job
        const firstJob = db.prepare("SELECT id FROM jobs WHERE client_id = ? LIMIT 1").get(alex.id);
        if (firstJob) {
            db.prepare(`
                INSERT OR IGNORE INTO proposals (job_id, freelancer_id, cover_letter, proposed_amount, estimated_duration)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                firstJob.id,
                sarah.id,
                'I have extensive experience building DeFi dashboards with React and Web3.js. I have worked on similar projects for Uniswap and Aave integrations. I can deliver a fully responsive, real-time dashboard within 3 weeks.',
                3.5,
                '3 weeks'
            );

            db.prepare(`
                INSERT OR IGNORE INTO proposals (job_id, freelancer_id, cover_letter, proposed_amount, estimated_duration)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                firstJob.id,
                mike.id,
                'I specialize in frontend development and have built multiple DeFi interfaces. My portfolio includes dashboards for yield farming protocols. I can complete this in 2.5 weeks with clean, maintainable code.',
                4.0,
                '2.5 weeks'
            );
            console.log('   ✅ Sample proposals created');
        }

        // Add welcome notifications
        const allUsers = db.prepare('SELECT id, role FROM users').all();
        for (const u of allUsers) {
            db.prepare(`
                INSERT INTO notifications (user_id, type, title, message, link)
                VALUES (?, 'system', ?, ?, ?)
            `).run(u.id, 'Welcome to FreelancerHub! 🎉',
                u.role === 'client'
                    ? 'Start by posting your first job and find talented freelancers.'
                    : 'Browse available jobs and submit your first proposal.',
                u.role === 'client' ? '/post-job.html' : '/jobs.html'
            );
        }
        console.log('   ✅ Welcome notifications created');

        console.log('');
        console.log('🎉 Seed data created successfully!');
        printAccounts();

    } catch (error) {
        console.error('❌ Seed error:', error.message);
        console.error(error.stack);
    } finally {
        db.close();
    }
}

function printAccounts() {
    console.log('');
    console.log('   Demo accounts:');
    console.log('   ├─ Client:     client@demo.com / demo123');
    console.log('   ├─ Client 2:   client2@demo.com / demo123');
    console.log('   ├─ Freelancer: freelancer@demo.com / demo123');
    console.log('   └─ Developer:  dev@demo.com / demo123');
    console.log('');
    console.log('   Next steps:');
    console.log('   1. npm start');
    console.log('   2. Open http://localhost:3000');
}

seed();
