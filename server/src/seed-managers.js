import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { pool } from './db.js';

const managers = [
  {
    fullName: process.env.MANAGER_1_NAME,
    username: process.env.MANAGER_1_USERNAME,
    email: process.env.MANAGER_1_EMAIL,
    password: process.env.MANAGER_1_PASSWORD,
  },
  {
    fullName: process.env.MANAGER_2_NAME,
    username: process.env.MANAGER_2_USERNAME,
    email: process.env.MANAGER_2_EMAIL,
    password: process.env.MANAGER_2_PASSWORD,
  },
];

try {
  for (const manager of managers) {
    const values = [
      manager.fullName,
      manager.username,
      manager.email,
      manager.password,
    ];

    if (values.some((value) => !value?.trim())) {
      throw new Error('Manager information is incomplete in the .env file.');
    }

    if (bcrypt.truncates(manager.password)) {
      throw new Error(
        `Password is too long for manager: ${manager.username}`,
      );
    }

    const existingUser = await pool.query(
      `
        SELECT id
        FROM users
        WHERE LOWER(username) = LOWER($1)
           OR LOWER(email) = LOWER($2)
        LIMIT 1
      `,
      [manager.username, manager.email],
    );

    if (existingUser.rowCount > 0) {
      console.log(`Skipped existing manager: ${manager.username}`);
      continue;
    }

    const passwordHash = await bcrypt.hash(manager.password, 12);

    const result = await pool.query(
      `
        INSERT INTO users (
          full_name,
          username,
          email,
          password_hash,
          role,
          is_active,
          account_status,
          must_change_password,
          reviewed_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'manager',
          TRUE,
          'active',
          TRUE,
          NOW()
        )
        RETURNING
          id,
          full_name,
          username,
          email,
          role,
          account_status
      `,
      [
        manager.fullName,
        manager.username,
        manager.email,
        passwordHash,
      ],
    );

    console.log('Created manager:', result.rows[0]);
  }

  console.log('Manager seeding completed successfully.');
} catch (error) {
  console.error('Manager seeding failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}