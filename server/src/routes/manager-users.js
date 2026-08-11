import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { pool } from '../db.js';
import {
  requireAuth,
  requireManager,
} from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireManager);

const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z
    .string()
    .trim()
    .max(500, 'یادداشت مدیر بیش از حد طولانی است.')
    .optional()
    .default(''),
});

router.get('/pending', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        full_name,
        username,
        email,
        role,
        account_status,
        created_at
      FROM users
      WHERE role = 'member'
        AND account_status = 'pending'
      ORDER BY created_at ASC
    `);

    return response.json({
      users: result.rows,
    });
  } catch (error) {
    console.error('Pending users query failed:', error.message);

    return response.status(500).json({
      message: 'دریافت کاربران در انتظار تأیید انجام نشد.',
    });
  }
});

router.patch('/:userId/review', async (request, response) => {
  const { userId } = request.params;

  if (!/^\d+$/.test(userId)) {
    return response.status(400).json({
      message: 'شناسه کاربر معتبر نیست.',
    });
  }

  const validation = reviewSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'تصمیم مدیر معتبر نیست.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const { decision, note } = validation.data;
  const newStatus = decision === 'approve' ? 'active' : 'rejected';
  const isActive = decision === 'approve';

  try {
    const result = await pool.query(
      `
        UPDATE users
        SET
          account_status = $1,
          is_active = $2,
          reviewed_by = $3,
          reviewed_at = NOW(),
          review_note = NULLIF($4, ''),
          updated_at = NOW()
        WHERE id = $5
          AND role = 'member'
          AND account_status = 'pending'
        RETURNING
          id,
          full_name,
          username,
          email,
          role,
          is_active,
          account_status,
          reviewed_by,
          reviewed_at,
          review_note
      `,
      [
        newStatus,
        isActive,
        request.user.id,
        note,
        userId,
      ],
    );

    const user = result.rows[0];

    if (!user) {
      return response.status(404).json({
        message: 'عضو در انتظار تأیید پیدا نشد.',
      });
    }

    return response.json({
      message:
        decision === 'approve'
          ? 'حساب عضو تأیید و فعال شد.'
          : 'درخواست عضویت رد شد.',
      user,
    });
  } catch (error) {
    console.error('User review failed:', error.message);

    return response.status(500).json({
      message: 'بررسی حساب عضو انجام نشد.',
    });
  }
});

const resetPasswordSchema = z.object({
  temporaryPassword: z
    .string()
    .min(8, 'رمز موقت باید حداقل 8 کاراکتر باشد.')
    .max(100, 'رمز موقت بیش از حد طولانی است.'),
});

router.patch('/:userId/password', async (request, response) => {
  const userId = Number.parseInt(request.params.userId, 10);

  if (!Number.isInteger(userId) || userId <= 0) {
    return response.status(400).json({
      message: 'شناسه کاربر معتبر نیست.',
    });
  }

  const parsedBody = resetPasswordSchema.safeParse(request.body);

  if (!parsedBody.success) {
    return response.status(400).json({
      message:
        parsedBody.error.issues[0]?.message ||
        'اطلاعات بازنشانی رمز معتبر نیست.',
    });
  }

  try {
    const userResult = await pool.query(
      `
        SELECT
          id,
          full_name,
          username,
          email,
          role,
          account_status
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId],
    );

    if (userResult.rowCount === 0) {
      return response.status(404).json({
        message: 'کاربر موردنظر پیدا نشد.',
      });
    }

    const member = userResult.rows[0];

    if (member.role !== 'member') {
      return response.status(403).json({
        message: 'رمز حساب مدیر از این بخش قابل بازنشانی نیست.',
      });
    }

    if (member.account_status !== 'active') {
      return response.status(409).json({
        message: 'فقط رمز اعضای فعال قابل بازنشانی است.',
      });
    }

    const passwordHash = await bcrypt.hash(
      parsedBody.data.temporaryPassword,
      12,
    );

    const updateResult = await pool.query(
      `
        UPDATE users
        SET
          password_hash = $1,
          must_change_password = TRUE,
          updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          full_name,
          username,
          email,
          must_change_password
      `,
      [passwordHash, userId],
    );

    return response.json({
      message:
        'رمز عضو بازنشانی شد. عضو باید پس از ورود، رمز خود را تغییر دهد.',
      user: updateResult.rows[0],
    });
  } catch (error) {
    console.error('Manager password reset error:', error);

    return response.status(500).json({
      message: 'بازنشانی رمز عضو با خطا مواجه شد.',
    });
  }
});

export default router;