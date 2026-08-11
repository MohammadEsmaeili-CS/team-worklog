import pg from 'pg';
import 'dotenv/config';

const { Pool, types } = pg;

// PostgreSQL DATE must remain YYYY-MM-DD without timezone conversion.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});