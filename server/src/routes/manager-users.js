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

router.get('/', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.full_name,
        u.username,
        u.email,
        u.account_status,
        u.is_active,
        u.created_at,
        (
          SELECT COUNT(*)::INTEGER
          FROM project_members pm
          WHERE pm.user_id = u.id
        ) AS project_count,
        (
          SELECT COUNT(*)::INTEGER
          FROM time_entries te
          WHERE te.user_id = u.id
        ) AS entry_count,
        (
          SELECT COALESCE(SUM(te.duration_minutes), 0)::INTEGER
          FROM time_entries te
          WHERE te.user_id = u.id
        ) AS total_minutes
      FROM users u
      WHERE u.role = 'member'
        AND u.account_status IN ('active', 'suspended')
      ORDER BY u.is_active DESC, u.full_name ASC
    `);

    return response.json({ users: result.rows });
  } catch (error) {
    console.error('Members query failed:', error.message);
    return response.status(500).json({ message: 'دریافت اعضا انجام نشد.' });
  }
});

router.get('/lifecycle-requests', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.user_id,
        r.requested_action,
        r.requested_by,
        r.requested_at,
        u.full_name AS member_name,
        u.username AS member_username,
        requester.full_name AS requested_by_name
      FROM member_lifecycle_requests r
      INNER JOIN users u ON u.id = r.user_id
      INNER JOIN users requester ON requester.id = r.requested_by
      WHERE r.status = 'pending'
      ORDER BY r.requested_at ASC
    `);

    return response.json({ requests: result.rows });
  } catch (error) {
    console.error('Lifecycle requests query failed:', error.message);
    return response.status(500).json({ message: 'دریافت درخواست‌های وضعیت عضو انجام نشد.' });
  }
});

const lifecycleSchema = z.object({
  action: z.enum(['suspend', 'reactivate']),
});

router.post('/:userId/lifecycle-requests', async (request, response) => {
  const userId = Number.parseInt(request.params.userId, 10);
  const validation = lifecycleSchema.safeParse(request.body);

  if (!Number.isInteger(userId) || userId <= 0) {
    return response.status(400).json({ message: 'شناسه عضو معتبر نیست.' });
  }

  if (!validation.success) {
    return response.status(400).json({ message: 'عملیات عضو معتبر نیست.' });
  }

  const desiredStatus = validation.data.action === 'suspend' ? 'active' : 'suspended';

  try {
    const memberResult = await pool.query(
      `SELECT id, full_name, account_status FROM users WHERE id = $1 AND role = 'member' LIMIT 1`,
      [userId],
    );

    if (memberResult.rowCount === 0) {
      return response.status(404).json({ message: 'عضو پیدا نشد.' });
    }

    if (memberResult.rows[0].account_status !== desiredStatus) {
      return response.status(409).json({
        message: validation.data.action === 'suspend'
          ? 'فقط حساب عضو فعال قابل غیرفعال‌سازی است.'
          : 'فقط حساب غیرفعال قابل فعال‌سازی مجدد است.',
      });
    }

    const result = await pool.query(
      `
        INSERT INTO member_lifecycle_requests (user_id, requested_action, requested_by)
        VALUES ($1, $2, $3)
        RETURNING id, user_id, requested_action, requested_by, status, requested_at
      `,
      [userId, validation.data.action, request.user.id],
    );

    return response.status(201).json({
      message: 'درخواست ثبت شد و تأیید مدیر دوم لازم است.',
      request: result.rows[0],
    });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({ message: 'برای این عضو یک درخواست در انتظار وجود دارد.' });
    }

    console.error('Lifecycle request creation failed:', error.message);
    return response.status(500).json({ message: 'ثبت درخواست وضعیت عضو انجام نشد.' });
  }
});

router.post('/lifecycle-requests/:requestId/confirm', async (request, response) => {
  const requestId = Number.parseInt(request.params.requestId, 10);

  if (!Number.isInteger(requestId) || requestId <= 0) {
    return response.status(400).json({ message: 'شناسه درخواست معتبر نیست.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const lifecycleResult = await client.query(
      `SELECT * FROM member_lifecycle_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [requestId],
    );

    if (lifecycleResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return response.status(404).json({ message: 'درخواست در انتظار پیدا نشد.' });
    }

    const lifecycleRequest = lifecycleResult.rows[0];

    if (String(lifecycleRequest.requested_by) === String(request.user.id)) {
      await client.query('ROLLBACK');
      return response.status(403).json({ message: 'تأیید باید توسط مدیر دوم انجام شود.' });
    }

    const nextStatus = lifecycleRequest.requested_action === 'suspend' ? 'suspended' : 'active';
    const nextIsActive = lifecycleRequest.requested_action === 'reactivate';

    const userResult = await client.query(
      `
        UPDATE users
        SET account_status = $1, is_active = $2, updated_at = NOW()
        WHERE id = $3 AND role = 'member'
        RETURNING id, full_name, username, email, account_status, is_active
      `,
      [nextStatus, nextIsActive, lifecycleRequest.user_id],
    );

    await client.query(
      `
        UPDATE member_lifecycle_requests
        SET status = 'completed', confirmed_by = $1, resolved_at = NOW()
        WHERE id = $2
      `,
      [request.user.id, requestId],
    );

    await client.query('COMMIT');

    return response.json({
      message: lifecycleRequest.requested_action === 'suspend'
        ? 'حساب عضو با تأیید هر دو مدیر غیرفعال شد.'
        : 'حساب عضو با تأیید هر دو مدیر دوباره فعال شد.',
      user: userResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Lifecycle request confirmation failed:', error.message);
    return response.status(500).json({ message: 'تأیید درخواست وضعیت عضو انجام نشد.' });
  } finally {
    client.release();
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
