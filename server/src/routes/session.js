import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import 'dotenv/config';

import { pool } from '../db.js';

const router = Router();

const jwtSecret = process.env.JWT_SECRET;
const cookieName = process.env.COOKIE_NAME || 'team_session';

if (!jwtSecret || jwtSecret.length < 64) {
  throw new Error('JWT_SECRET is missing or too short in the .env file.');
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'تعداد تلاش‌های ورود زیاد است. کمی بعد دوباره تلاش کنید.',
  },
});

const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'نام کاربری یا ایمیل را وارد کنید.')
    .max(254),

  password: z
    .string()
    .min(1, 'رمز عبور را وارد کنید.')
    .max(100),
});

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
};

router.post('/login', loginLimiter, async (request, response) => {
  const validation = loginSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'نام کاربری یا ایمیل و رمز عبور را وارد کنید.',
    });
  }

  const { identifier, password } = validation.data;

  if (Buffer.byteLength(password, 'utf8') > 72) {
    return response.status(401).json({
      message: 'نام کاربری، ایمیل یا رمز عبور صحیح نیست.',
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
          password_hash,
          role,
          is_active,
          account_status,
          must_change_password
        FROM users
        WHERE LOWER(username) = LOWER($1)
           OR LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [identifier],
    );

    const user = result.rows[0];

    if (!user) {
      return response.status(401).json({
        message: 'نام کاربری، ایمیل یا رمز عبور صحیح نیست.',
      });
    }

    const passwordIsCorrect = await bcrypt.compare(
      password,
      user.password_hash,
    );

    if (!passwordIsCorrect) {
      return response.status(401).json({
        message: 'نام کاربری، ایمیل یا رمز عبور صحیح نیست.',
      });
    }

    if (user.account_status === 'pending') {
      return response.status(403).json({
        message: 'حساب شما هنوز توسط مدیر تأیید نشده است.',
      });
    }

    if (user.account_status !== 'active' || !user.is_active) {
      return response.status(403).json({
        message: 'حساب شما فعال نیست. با مدیر سامانه تماس بگیرید.',
      });
    }

    const token = jwt.sign(
      {
        role: user.role,
      },
      jwtSecret,
      {
        subject: String(user.id),
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      },
    );

    response.cookie(cookieName, token, cookieOptions);

    return response.json({
      message: 'ورود با موفقیت انجام شد.',
      user: {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        email: user.email,
        role: user.role,
        accountStatus: user.account_status,
        mustChangePassword: user.must_change_password,
      },
    });
  } catch (error) {
    console.error('Login failed:', error.message);

    return response.status(500).json({
      message: 'ورود انجام نشد. دوباره تلاش کنید.',
    });
  }
});

router.post('/logout', (_request, response) => {
  response.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });

  response.json({
    message: 'از حساب کاربری خارج شدید.',
  });
});

export default router;