import dotenv from 'dotenv';
import { pool, initDb } from '../src/db.mjs';

dotenv.config();
await initDb();

const [, , code, foxesRaw, crystalsRaw, maxRaw] = process.argv;
if (!code || !foxesRaw || !crystalsRaw || !maxRaw) {
  console.log('Usage: npm run promo:create CODE FOXES CRYSTALS MAX_ACTIVATIONS');
  process.exit(1);
}

const foxes = Number(foxesRaw);
const crystals = Number(crystalsRaw);
const max = Number(maxRaw);

await pool.query(
  `INSERT INTO promo_codes (code, reward_foxes, reward_crystals, max_activations)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (code)
   DO UPDATE SET reward_foxes=$2, reward_crystals=$3, max_activations=$4`,
  [code, foxes, crystals, max]
);

console.log(`Promo saved: ${code} => ${foxes} foxes, ${crystals} crystals, ${max} activations`);
await pool.end();
