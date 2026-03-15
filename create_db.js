const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_oAg85XMWTYyq@ep-young-sun-a8tlerv1-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
});

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
            id               SERIAL PRIMARY KEY,
            client_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
            title            TEXT NOT NULL,
            description      TEXT NOT NULL,
            budget_type      TEXT NOT NULL CHECK(budget_type IN ('fixed', 'hourly')),
            budget_min       REAL DEFAULT 0,
            budget_max       REAL DEFAULT 0,
            skills_required  TEXT NOT NULL,
            experience_level TEXT NOT NULL CHECK(experience_level IN ('beginner', 'intermediate', 'expert')),
            category         TEXT DEFAULT 'Software',
            status           TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'completed', 'cancelled')),
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            freelancer_id    INTEGER DEFAULT NULL REFERENCES users(id),
            updated_at       TIMESTAMPTZ DEFAULT NOW()
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
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS wallet_transactions (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            type        TEXT NOT NULL,
            amount      REAL NOT NULL,
            status      TEXT NOT NULL,
            tx_hash     TEXT DEFAULT '',
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );
`.split(';').map(s => s.trim()).filter(s => s.length > 0);

async function create() {
  await client.connect();
  for (const stmt of statements) {
      try {
          console.log('Running:', stmt.substring(0, 40));
          await client.query(stmt);
      } catch (err) {
          console.error('Failed:', err.message);
      }
  }
  console.log('Tables created.');
  await client.end();
}

create().catch(console.error);
