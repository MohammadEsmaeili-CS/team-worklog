import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db.js';

const router = Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.',
  },
});

const registrationSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'نام و نام خانوادگی باید حداقل 2 حرف باشد.')
    .max(100, 'نام و نام خانوادگی بیش از حد طولانی است.'),

  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'نام کاربری باید حداقل 3 حرف باشد.')
    .max(40, 'نام کاربری بیش از حد طولانی است.')
    .regex(
      /^[a-z0-9._-]+$/,
      'نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد.',
    ),

  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('آدرس ایمیل معتبر نیست.')
    .max(254, 'آدرس ایمیل بیش از حد طولانی است.'),

  password: z
    .string()
    .min(8, 'رمز عبور باید حداقل 8 کاراکتر باشد.')
    .max(100, 'رمز عبور بیش از حد طولانی است.'),
});

router.post('/register', registerLimiter, async (request, response) => {
  const validation = registrationSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'اطلاعات ثبت‌نام معتبر نیست.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const { fullName, username, email, password } = validation.data;

  if (Buffer.byteLength(password, 'utf8') > 72) {
    return response.status(400).json({
      message: 'رمز عبور بیش از حد طولانی است.',
    });
  }

  try {
    const existingUser = await pool.query(
      `
        SELECT id
        FROM users
        WHERE LOWER(username) = LOWER($1)
           OR LOWER(email) = LOWER($2)
        LIMIT 1
      `,
      [username, email],
    );

    if (existingUser.rowCount > 0) {
      return response.status(409).json({
        message: 'این نام کاربری یا ایمیل قبلاً ثبت شده است.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

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
          must_change_password
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'member',
          FALSE,
          'pending',
          FALSE
        )
        RETURNING
          id,
          full_name,
          username,
          email,
          role,
          account_status,
          created_at
      `,
      [fullName, username, email, passwordHash],
    );

    return response.status(201).json({
      message: 'ثبت‌نام انجام شد و حساب در انتظار تأیید مدیر است.',
      user: result.rows[0],
    });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({
        message: 'این نام کاربری یا ایمیل قبلاً ثبت شده است.',
      });
    }

    console.error('Registration failed:', error.message);

    return response.status(500).json({
      message: 'ثبت‌نام انجام نشد. دوباره تلاش کنید.',
    });
  }
});

export default router;