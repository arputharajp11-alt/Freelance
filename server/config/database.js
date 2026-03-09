/**
 * database.js — Dual-mode database adapter
 *  - Production / staging  → Neon PostgreSQL (DATABASE_URL in env)
 *  - Local fallback        → better-sqlite3 (SQLite file)
 *
 * All callers should use the exported `query(sql, params)` async function
 * OR the compatibility `db` shim that wraps SQLite synchronously.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const USE_NEON = !!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('placeholder');

/* ─── Neon / PostgreSQL connection ─────────────────────────────────────── */
let pgPool = null;

if (USE_NEON) {
    try {
        const { Pool } = require('pg');
        pgPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 10,
            idleTimeoutMillis: 30000,
        });
        pgPool.on('error', (err) => {
            console.error('❌ Neon pool error:', err.message);
        });
        console.log('🔗 Using Neon PostgreSQL database');
    } catch (e) {
        console.error('❌ Failed to initialize Neon pool:', e.message);
        process.exit(1);
    }
}

/* ─── SQLite fallback ───────────────────────────────────────────────────── */
let sqliteDb = null;

if (!USE_NEON) {
    const DB_PATH = path.join(__dirname, '..', '..', 'data', 'freelancerhub.db');
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const Database = require('better-sqlite3');
    sqliteDb = new Database(DB_PATH);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
    console.log('🗃️  Using SQLite database (local dev)');
}

/* ─── Universal async query helper ────────────────────────────────────── */
/**
 * Execute a SQL query.
 * @param {string} sql   - SQL with $1/$2/... placeholders (Postgres) OR ? (SQLite)
 * @param {Array}  params
 * @returns {Promise<{rows: Array, rowCount: number, lastInsertRowid: number|null}>}
 */
async function query(sql, params = []) {
    if (USE_NEON) {
        const result = await pgPool.query(sql, params);
        return {
            rows: result.rows,
            rowCount: result.rowCount,
            lastInsertRowid: result.rows[0]?.id ?? null,
        };
    } else {
        // SQLite – convert $N placeholders to ? and NOW() to CURRENT_TIMESTAMP
        const sqSql = sql
            .replace(/\$\d+/g, '?')
            .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
        const stmt = sqliteDb.prepare(sqSql);
        const lowerSql = sqSql.trim().toUpperCase();

        if (lowerSql.startsWith('SELECT') || lowerSql.startsWith('WITH')) {
            const rows = stmt.all(...params);
            return { rows, rowCount: rows.length, lastInsertRowid: null };
        } else if (lowerSql.includes('RETURNING')) {
            // INSERT/UPDATE with RETURNING — use .get() to fetch the returned row
            const row = stmt.get(...params);
            return {
                rows: row ? [row] : [],
                rowCount: row ? 1 : 0,
                lastInsertRowid: row?.id ?? null,
            };
        } else {
            const info = stmt.run(...params);
            return {
                rows: [],
                rowCount: info.changes,
                lastInsertRowid: info.lastInsertRowid ?? null,
            };
        }
    }
}

/* ─── Compatibility shim: db.prepare() ─────────────────────────────────── */
/**
 * Legacy synchronous shim so all existing route code continues to work.
 * Returns an object with .get(), .all(), .run() just like better-sqlite3.
 *
 * NOTE: This runs synchronously via the SQLite driver on local, and throws
 * a helpful error on Neon (routes should be migrated to async query()).
 */
const db = {
    prepare(sql) {
        if (!USE_NEON) {
            // Pure SQLite – works exactly like before
            const sqSql = sql.replace(/\$\d+/g, '?');
            return sqliteDb.prepare(sqSql);
        }

        // Neon – provide a synchronous shim that runs queries via a
        // blocking child-process trick. To keep things simple we wrap
        // the query through a SYNCHRONOUS deasync call.
        // For new code prefer the exported async query() instead.
        return {
            get: (...params) => {
                throw new Error(
                    `[DB] db.prepare().get() is not supported on Neon. Use async query() instead in route: ${sql.slice(0, 80)}`
                );
            },
            all: (...params) => {
                throw new Error(
                    `[DB] db.prepare().all() is not supported on Neon. Use async query() instead.`
                );
            },
            run: (...params) => {
                throw new Error(
                    `[DB] db.prepare().run() is not supported on Neon. Use async query() instead.`
                );
            },
        };
    },

    exec(sql) {
        if (!USE_NEON) return sqliteDb.exec(sql);
        // On Neon, exec() is used only from initializeDatabase() which is
        // already async – not via this shim. Safe to ignore here.
    },

    pragma(pragma) {
        if (!USE_NEON) return sqliteDb.pragma(pragma);
    },
};

/* ─── Schema creation ───────────────────────────────────────────────────── */

const CREATE_TABLES_POSTGRES = `
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
        is_verified      INTEGER DEFAULT 0,
        verification_token TEXT DEFAULT NULL,
        verification_expires TIMESTAMPTZ DEFAULT NULL,
        reset_token      TEXT DEFAULT NULL,
        reset_expires    TIMESTAMPTZ DEFAULT NULL,
        rating           REAL DEFAULT 0,
        total_reviews    INTEGER DEFAULT 0,
        total_earnings   REAL DEFAULT 0,
        total_spent      REAL DEFAULT 0,
        is_online        INTEGER DEFAULT 0,
        last_seen        TIMESTAMPTZ DEFAULT NOW(),
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
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
        budget_type           TEXT DEFAULT 'fixed' CHECK(budget_type IN ('fixed', 'hourly')),
        duration              TEXT DEFAULT '',
        experience_level      TEXT DEFAULT 'intermediate' CHECK(experience_level IN ('beginner', 'intermediate', 'expert')),
        status                TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'submitted', 'completed', 'cancelled', 'disputed')),
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
        status             TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
        created_at         TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
        id              SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id       INTEGER NOT NULL REFERENCES users(id),
        receiver_id     INTEGER NOT NULL REFERENCES users(id),
        job_id          INTEGER DEFAULT NULL REFERENCES jobs(id),
        message         TEXT NOT NULL,
        message_type    TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'file', 'system')),
        file_url        TEXT DEFAULT NULL,
        is_read         INTEGER DEFAULT 0,
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
        is_read     INTEGER DEFAULT 0,
        email_sent  INTEGER DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reviews (
        id          SERIAL PRIMARY KEY,
        job_id      INTEGER NOT NULL REFERENCES jobs(id),
        reviewer_id INTEGER NOT NULL REFERENCES users(id),
        reviewee_id INTEGER NOT NULL REFERENCES users(id),
        rating      INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        comment     TEXT DEFAULT '',
        created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id           SERIAL PRIMARY KEY,
        job_id       INTEGER NOT NULL REFERENCES jobs(id),
        tx_hash      TEXT NOT NULL,
        from_address TEXT NOT NULL,
        to_address   TEXT DEFAULT '',
        amount       REAL DEFAULT 0,
        tx_type      TEXT NOT NULL CHECK(tx_type IN ('escrow_lock', 'escrow_release', 'escrow_refund', 'dispute')),
        status       TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'failed')),
        block_number INTEGER DEFAULT 0,
        created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        type        TEXT NOT NULL CHECK(type IN ('credit', 'debit', 'withdrawal', 'deposit')),
        amount      REAL NOT NULL,
        description TEXT NOT NULL,
        job_id      INTEGER DEFAULT NULL REFERENCES jobs(id),
        tx_hash     TEXT DEFAULT '',
        status      TEXT DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'failed')),
        created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_client      ON jobs(client_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_freelancer  ON jobs(freelancer_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_proposals_job    ON proposals(job_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_fl     ON proposals(freelancer_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv    ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_u  ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_job ON transactions(job_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_user      ON wallet_transactions(user_id);
`;

const CREATE_TABLES_SQLITE = `
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        location TEXT DEFAULT '',
        title TEXT DEFAULT '',
        website TEXT DEFAULT '',
        github TEXT DEFAULT ''
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
    CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('credit', 'debit', 'withdrawal', 'deposit')),
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        job_id INTEGER DEFAULT NULL,
        tx_hash TEXT DEFAULT '',
        status TEXT DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'failed')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_client      ON jobs(client_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_freelancer  ON jobs(freelancer_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_proposals_job    ON proposals(job_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_fl     ON proposals(freelancer_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv    ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_u  ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_job ON transactions(job_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_user      ON wallet_transactions(user_id);
`;

/* ─── Initialize database tables ────────────────────────────────────────── */
async function initializeDatabase() {
    try {
        if (USE_NEON) {
            const client = await pgPool.connect();
            try {
                // Run each statement individually (pg doesn't support multi-statement exec)
                const statements = CREATE_TABLES_POSTGRES
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);

                for (const stmt of statements) {
                    await client.query(stmt);
                }
                console.log('✅ Neon database tables initialized successfully');
            } finally {
                client.release();
            }
        } else {
            sqliteDb.exec(CREATE_TABLES_SQLITE);
            // Run migrations for existing DBs (columns added after initial schema)
            const migrations = [
                `ALTER TABLE users ADD COLUMN location TEXT DEFAULT ''`,
                `ALTER TABLE users ADD COLUMN title TEXT DEFAULT ''`,
                `ALTER TABLE users ADD COLUMN website TEXT DEFAULT ''`,
                `ALTER TABLE users ADD COLUMN github TEXT DEFAULT ''`,
            ];
            for (const sql of migrations) {
                try { sqliteDb.prepare(sql).run(); } catch (e) { /* column already exists */ }
            }
            console.log('✅ SQLite database tables initialized successfully');
        }
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
        throw err;
    }
}

module.exports = { db, query, initializeDatabase, USE_NEON, pgPool };
