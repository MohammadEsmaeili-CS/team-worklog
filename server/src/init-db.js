import { readFile } from 'node:fs/promises';
import { pool } from './db.js';

const databaseFiles = [
  'schema.sql',
  'auth-update.sql',
  'lifecycle-update.sql',
];

try {
  for (const fileName of databaseFiles) {
    const sql = await readFile(
      new URL(`../database/${fileName}`, import.meta.url),
      'utf8',
    );

    await pool.query(sql);
    console.log(`Applied: ${fileName}`);
  }

  console.log('Database initialization completed successfully.');
} catch (error) {
  console.error('Database initialization failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
