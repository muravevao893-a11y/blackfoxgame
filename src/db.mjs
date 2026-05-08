import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Add it to .env');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

export async function initDb() {
  const schema = fs.readFileSync(path.join(process.cwd(), 'src/schema.sql'), 'utf8');
  await pool.query(schema);
}

export async function requireUser(ctx) {
  const tgId = ctx.from.id;
  const username = ctx.from.username || null;
  const firstName = ctx.from.first_name || null;

  const payload = ctx.startPayload || '';
  const refTgId = payload.startsWith('ref_') ? Number(payload.replace('ref_', '')) : null;
  let referrerId = null;

  if (refTgId && refTgId !== tgId) {
    const ref = await pool.query('SELECT id FROM users WHERE tg_id = $1', [refTgId]);
    referrerId = ref.rows[0]?.id || null;
  }

  const result = await pool.query(
    `
    INSERT INTO users (tg_id, username, first_name, referrer_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (tg_id)
    DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, updated_at = NOW()
    RETURNING *
    `,
    [tgId, username, firstName, referrerId]
  );

  const user = result.rows[0];

  if (referrerId && user.created_at && Math.abs(new Date(user.created_at) - new Date(user.updated_at)) < 3000) {
    await pool.query('UPDATE users SET foxes = foxes + 15000, crystals = crystals + 5 WHERE id = $1', [referrerId]);
  }

  return user;
}

export async function logTx(userId, kind, amount, meta = '') {
  await pool.query('INSERT INTO transactions (user_id, kind, amount, meta) VALUES ($1, $2, $3, $4)', [userId, kind, amount, meta]);
}
