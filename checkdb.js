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
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS proposals (
            id               SERIAL PRIMARY KEY,
            job_id           INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
            freelancer_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
            cover_letter     TEXT NOT NULL,
            bid_amount       REAL NOT NULL,
            estimated_days   INTEGER NOT NULL,
            status           TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS messages (
            id               SERIAL PRIMARY KEY,
            conversation_id  INTEGER NOT NULL,
            sender_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
            receiver_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
            message          TEXT NOT NULL,
            is_read          BOOLEAN DEFAULT false,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS conversations (
            id               SERIAL PRIMARY KEY,
            user1_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
            user2_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
            last_message     TEXT,
            last_message_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id               SERIAL PRIMARY KEY,
            user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
            title            TEXT NOT NULL,
            message          TEXT NOT NULL,
            link             TEXT DEFAULT NULL,
            type             TEXT DEFAULT 'info',
            is_read          BOOLEAN DEFAULT false,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id               SERIAL PRIMARY KEY,
            job_id           INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
            reviewer_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
            reviewee_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
            rating           INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            comment          TEXT NOT NULL,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id               SERIAL PRIMARY KEY,
            job_id           INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
            sender_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
            receiver_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            amount           REAL NOT NULL,
            status           TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
            tx_hash          TEXT DEFAULT NULL,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS wallet_transactions (
            id               SERIAL PRIMARY KEY,
            user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
            amount           REAL NOT NULL,
            type             TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal')),
            status           TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
            tx_hash          TEXT DEFAULT NULL,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        )
    `.split(';').map(s => s.trim()).filter(s => s.length > 0);

async function check() {
  await client.connect();
  
  for (const stmt of statements) {
      try {
          console.log('Executing:', stmt.substring(0, 50) + '...');
          await client.query(stmt);
      } catch (err) {
          console.error('FAILED query:', stmt.substring(0, 30));
          console.error(err);
      }
  }

  const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log('--- Tables in Public Schema ---');
  console.table(res.rows);
  await client.end();
}

check().catch(console.error);
