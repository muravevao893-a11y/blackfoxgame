import dotenv from 'dotenv';
import { initDb, pool } from '../src/db.mjs';

dotenv.config();
await initDb();
console.log('Database initialized');
await pool.end();
