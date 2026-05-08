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

export async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
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
