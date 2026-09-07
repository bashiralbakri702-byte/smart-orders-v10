import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await client.connect();

  const schema = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await client.query(schema);
  await client.query(`
    INSERT INTO roles (name) VALUES ('admin'), ('sales'), ('warehouse'), ('delivery')
    ON CONFLICT (name) DO NOTHING;
  `);

  const migration = await fs.readFile(new URL('./smart-orders-v10-migration.sql', import.meta.url), 'utf8');
  await client.query(migration);

  console.log('Smart Orders V10 database setup completed successfully.');
} catch (error) {
  console.error('Database setup failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
