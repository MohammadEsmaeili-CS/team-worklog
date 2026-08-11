import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, 'رمز فعلی را وارد کنید.')
    .max(100),

  newPassword: z
    .string()
    .min(8, 'رمز جدید باید حداقل 8 کاراکتر باشد.')
    .max(100, 'رمز جدید بیش از حد طولانی است.'),
});

router.get('/me', (request, response) => {
  response.json({
    user: {
      id: request.user.id,
      fullName: request.user.full_name,
      username: request.user.username,
      email: request.user.email,
      role: request.user.role,
      accountStatus: request.user.account_status,
      mustChangePassword: request.user.must_change_password,
    },
  });
});

router.patch('/password', async (request, response) => {
  const validation = changePasswordSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'اطلاعات تغییر رمز معتبر نیست.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const { currentPassword, newPassword } = validation.data;

  if (
    Buffer.byteLength(currentPassword, 'utf8') > 72 ||
    Buffer.byteLength(newPassword, 'utf8') > 72
  ) {
    return response.status(400).json({
      message: 'رمز عبور بیش از حد طولانی است.',
    });
  }

  if (currentPassword === newPassword) {
    return response.status(400).json({
      message: 'رمز جدید باید با رمز فعلی متفاوت باشد.',
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT password_hash
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [request.user.id],
    );

    const user = result.rows[0];

    if (!user) {
      return response.status(404).json({
        message: 'حساب کاربری پیدا نشد.',
      });
    }

    const currentPasswordIsCorrect = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );

    if (!currentPasswordIsCorrect) {
      return response.status(400).json({
        message: 'رمز فعلی صحیح نیست.',
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await pool.query(
      `
        UPDATE users
        SET
          password_hash = $1,
          must_change_password = FALSE,
          updated_at = NOW()
        WHERE id = $2
      `,
      [newPasswordHash, request.user.id],
    );

    return response.json({
      message: 'رمز عبور با موفقیت تغییر کرد.',
      mustChangePassword: false,
    });
  } catch (error) {
    console.error('Password change failed:', error.message);

    return response.status(500).json({
      message: 'تغییر رمز عبور انجام نشد.',
    });
  }
});

export default router;