import jwt from 'jsonwebtoken';
import 'dotenv/config';

import { pool } from '../db.js';

const jwtSecret = process.env.JWT_SECRET;
const cookieName = process.env.COOKIE_NAME || 'team_session';

if (!jwtSecret || jwtSecret.length < 64) {
  throw new Error('JWT_SECRET is missing or too short in the .env file.');
}

export async function requireAuth(request, response, next) {
  const token = request.cookies?.[cookieName];

  if (!token) {
    return response.status(401).json({
      message: 'برای انجام این کار ابتدا وارد حساب خود شوید.',
    });
  }

  let payload;

  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return response.status(401).json({
      message: 'نشست کاربری معتبر نیست. دوباره وارد شوید.',
    });
  }

  if (
    typeof payload !== 'object' ||
    !payload.sub ||
    !/^\d+$/.test(String(payload.sub))
  ) {
    return response.status(401).json({
      message: 'نشست کاربری معتبر نیست.',
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          id,
          full_name,
          username,
          email,
          role,
          is_active,
          account_status,
          must_change_password
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [payload.sub],
    );

    const user = result.rows[0];

    if (
      !user ||
      !user.is_active ||
      user.account_status !== 'active'
    ) {
      return response.status(401).json({
        message: 'حساب کاربری فعال نیست.',
      });
    }

    request.user = user;
    return next();
  } catch (error) {
    console.error('Authentication check failed:', error.message);

    return response.status(500).json({
      message: 'بررسی حساب کاربری انجام نشد.',
    });
  }
}

export function requireManager(request, response, next) {
  if (!request.user || request.user.role !== 'manager') {
    return response.status(403).json({
      message: 'فقط مدیران به این بخش دسترسی دارند.',
    });
  }

  return next();
}