import dotenv from 'dotenv';
import { pool, initDb } from '../src/db.mjs';

dotenv.config();
await initDb();

const [, , tgIdRaw, amountRaw] = process.argv;
if (!tgIdRaw || !amountRaw) {
  console.log('Usage: npm run admin:give TG_ID AMOUNT');
  process.exit(1);
}

const tgId = Number(tgIdRaw);
const amount = Number(amountRaw);

const result = await pool.query('UPDATE users SET foxes = foxes + $1 WHERE tg_id = $2 RETURNING username, foxes', [amount, tgId]);
if (!result.rows.length) {
  console.log('User not found. The user must launch the bot first.');
} else {
  console.log(`Given ${amount} foxes to ${result.rows[0].username || tgId}. New balance: ${result.rows[0].foxes}`);
}
await pool.end();
