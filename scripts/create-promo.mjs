import { initDb, pool } from '../src/db.mjs';
await initDb();
const [code, foxes='0', crystals='0', max='100'] = process.argv.slice(2);
if (!code) { console.log('Usage: npm run promo:create CODE FOXES CRYSTALS MAX'); process.exit(1); }
await pool.query('INSERT INTO promo_codes(code,reward_foxes,reward_crystals,max_activations) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO UPDATE SET reward_foxes=$2,reward_crystals=$3,max_activations=$4', [code.toUpperCase(), foxes, crystals, max]);
console.log('Promo ready:', code.toUpperCase());
await pool.end();
