import { initDb, pool } from '../src/db.mjs';
await initDb();
console.log('Database initialized');
await pool.end();
