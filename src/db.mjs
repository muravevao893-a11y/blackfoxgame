import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureColumn(table, column, definition) {
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
}

export async function initDb() {
  console.log('[DB] Checking database schema...');

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  try {
    await pool.query(sql);
  } catch (err) {
    console.error('[DB] schema.sql failed, running emergency migrations...', err.message);
  }

  // Emergency migrations. Railway can keep an old PostgreSQL database between deploys,
  // and CREATE TABLE IF NOT EXISTS does not add columns to existing tables.
  await ensureColumn('users', 'foxes', 'NUMERIC NOT NULL DEFAULT 25000');
  await ensureColumn('users', 'crystals', 'NUMERIC NOT NULL DEFAULT 0');
  await ensureColumn('users', 'bank', 'NUMERIC NOT NULL DEFAULT 0');
  await ensureColumn('users', 'xp', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('users', 'level', 'INT NOT NULL DEFAULT 1');
  await ensureColumn('users', 'energy', 'INT NOT NULL DEFAULT 10');
  await ensureColumn('users', 'vip_level', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('users', 'vip_until', 'TIMESTAMP');
  await ensureColumn('users', 'is_banned', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureColumn('users', 'is_admin', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureColumn('users', 'last_bonus_at', 'TIMESTAMP');
  await ensureColumn('users', 'last_work_at', 'TIMESTAMP');
  await ensureColumn('users', 'last_luck_at', 'TIMESTAMP');
  await ensureColumn('users', 'garden_watered_at', 'TIMESTAMP');
  await ensureColumn('users', 'income_boost_until', 'TIMESTAMP');
  await ensureColumn('users', 'case_luck_until', 'TIMESTAMP');
  await ensureColumn('users', 'luck_charges', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('users', 'pass_premium', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureColumn('users', 'pass_xp', 'INT NOT NULL DEFAULT 0');

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='balance') THEN
        EXECUTE 'UPDATE users SET foxes = COALESCE(NULLIF(foxes, 25000), balance, foxes)';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='bcoins') THEN
        EXECUTE 'UPDATE users SET crystals = COALESCE(NULLIF(crystals, 0), bcoins, crystals)';
      END IF;
    END $$;
  `);

  await pool.query(`CREATE TABLE IF NOT EXISTS admin_actions (
    id SERIAL PRIMARY KEY,
    admin_tg_id BIGINT,
    target_tg_id BIGINT,
    action TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    meta TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);

  await ensureColumn('facilities', 'video_cards', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('facilities', 'max_video_cards', 'INT NOT NULL DEFAULT 10');
  await ensureColumn('facilities', 'tax_debt', 'NUMERIC NOT NULL DEFAULT 0');
  await ensureColumn('facilities', 'tax_limit', 'NUMERIC NOT NULL DEFAULT 5000000');
  await ensureColumn('facilities', 'account', 'NUMERIC NOT NULL DEFAULT 0');
  await ensureColumn('facilities', 'last_tick_at', 'TIMESTAMP');
  await ensureColumn('facilities', 'territory_m2', 'INT NOT NULL DEFAULT 120');
  await ensureColumn('facilities', 'business_m2', 'INT NOT NULL DEFAULT 120');
  await ensureColumn('facilities', 'trees_count', 'INT NOT NULL DEFAULT 10');
  await ensureColumn('facilities', 'water', 'INT NOT NULL DEFAULT 100');
  await ensureColumn('facilities', 'max_water', 'INT NOT NULL DEFAULT 100');

  console.log('[DB] Database schema is ready');
}

export async function requireUser(ctx) {
  const tgId = ctx.from?.id;
  if (!tgId) return null;
  const username = ctx.from.username || null;
  const firstName = ctx.from.first_name || null;
  let referrerId = null;
  const payload = ctx.startPayload || '';
  if (payload.startsWith('ref_')) {
    const refTg = Number(payload.slice(4));
    if (refTg && refTg !== tgId) {
      const rr = await pool.query('SELECT id FROM users WHERE tg_id=$1', [refTg]);
      referrerId = rr.rows[0]?.id || null;
    }
  }
  const r = await pool.query(`
    INSERT INTO users (tg_id, username, first_name, referrer_id)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (tg_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, updated_at=NOW()
    RETURNING *`, [tgId, username, firstName, referrerId]);
  const user = r.rows[0];
  if (referrerId && user.referrer_id === referrerId) {
    await pool.query('UPDATE users SET foxes=foxes+50000, crystals=crystals+1 WHERE id=$1', [referrerId]);
  }
  return user;
}

export async function logTx(userId, kind, amount = 0, meta = '') {
  await pool.query('INSERT INTO transactions(user_id, kind, amount, meta) VALUES ($1,$2,$3,$4)', [userId, kind, amount, meta]).catch(console.error);
}
