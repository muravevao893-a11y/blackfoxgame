import { initDb, pool } from '../src/db.mjs';
await initDb();
const [tgId] = process.argv.slice(2);
if (!tgId) { console.log('Usage: npm run admin:make TG_ID'); process.exit(1); }
const r = await pool.query('UPDATE users SET is_admin=TRUE WHERE tg_id=$1 RETURNING tg_id, username, first_name', [tgId]);
if (!r.rows[0]) {
  console.log('User not found. Ask this Telegram user to send /start to the bot first.');
  process.exit(1);
}
console.log(`Admin enabled for ${r.rows[0].username ? '@'+r.rows[0].username : r.rows[0].tg_id}`);
await pool.end();
