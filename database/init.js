import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const sql = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await client.query(sql);
  await client.query(`
    INSERT INTO roles (name) VALUES ('admin'), ('sales'), ('warehouse'), ('delivery')
    ON CONFLICT (name) DO NOTHING;
  `);
  console.log('Database initialized.');
} finally {
  await client.end();
}
