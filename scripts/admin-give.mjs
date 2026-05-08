import { initDb, pool } from '../src/db.mjs';
await initDb();
const [tgId, foxes='0', crystals='0'] = process.argv.slice(2);
if (!tgId) { console.log('Usage: npm run admin:give TG_ID FOXES CRYSTALS'); process.exit(1); }
await pool.query('UPDATE users SET foxes=foxes+$1, crystals=crystals+$2 WHERE tg_id=$3', [foxes, crystals, tgId]);
console.log('Done');
await pool.end();
