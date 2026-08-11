import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

const workDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به شکل YYYY-MM-DD باشد.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);

    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, 'تاریخ واردشده معتبر نیست.');

const manualEntrySchema = z.object({
  projectId: z.coerce.number().int().positive(),

  title: z
    .string()
    .trim()
    .min(2, 'عنوان فعالیت باید حداقل 2 حرف باشد.')
    .max(200, 'عنوان فعالیت بیش از حد طولانی است.'),

  description: z
    .string()
    .trim()
    .max(5000, 'توضیحات فعالیت بیش از حد طولانی است.')
    .optional()
    .default(''),

  workDate: workDateSchema,

  durationMinutes: z.coerce
    .number()
    .int('مدت فعالیت باید عدد صحیح باشد.')
    .min(1, 'مدت فعالیت باید حداقل 1 دقیقه باشد.')
    .max(1440, 'مدت فعالیت نمی‌تواند بیشتر از 24 ساعت باشد.'),
});

router.get('/', async (request, response) => {
  const memberId =
    request.user.role === 'manager'
      ? null
      : request.user.id;

  try {
    const result = await pool.query(
      `
        SELECT
          te.id,
          te.user_id,
          te.project_id,
          te.title,
          te.description,
          te.work_date,
          te.entry_method,
          te.duration_minutes,
          te.started_at,
          te.ended_at,
          te.status,
          te.created_at,
          te.updated_at,
          u.full_name AS member_name,
          u.username AS member_username,
          p.title AS project_title,
          (
            SELECT COUNT(*)::INTEGER
            FROM approvals a
            WHERE a.time_entry_id = te.id
              AND a.decision = 'approved'
          ) AS approval_count,
          (
            SELECT COUNT(*)::INTEGER
            FROM approvals a
            WHERE a.time_entry_id = te.id
              AND a.decision = 'rejected'
          ) AS rejection_count
        FROM time_entries te
        INNER JOIN users u
          ON u.id = te.user_id
        INNER JOIN projects p
          ON p.id = te.project_id
        WHERE (
          $1::BIGINT IS NULL
          OR te.user_id = $1
        )
        ORDER BY
          te.work_date DESC,
          te.created_at DESC
      `,
      [memberId],
    );

    return response.json({
      timeEntries: result.rows,
    });
  } catch (error) {
    console.error('Time entries query failed:', error.message);

    return response.status(500).json({
      message: 'دریافت فعالیت‌ها انجام نشد.',
    });
  }
});

router.post('/manual', async (request, response) => {
  if (request.user.role !== 'member') {
    return response.status(403).json({
      message: 'ثبت فعالیت از این مسیر فقط برای اعضا امکان‌پذیر است.',
    });
  }

  const validation = manualEntrySchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'اطلاعات فعالیت معتبر نیست.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const {
    projectId,
    title,
    description,
    workDate,
    durationMinutes,
  } = validation.data;

  try {
    const projectResult = await pool.query(
      `
        SELECT p.id, p.title
        FROM projects p
        INNER JOIN project_members pm
          ON pm.project_id = p.id
        WHERE p.id = $1
          AND pm.user_id = $2
          AND p.status = 'active'
        LIMIT 1
      `,
      [projectId, request.user.id],
    );

    if (projectResult.rowCount === 0) {
      return response.status(403).json({
        message: 'این پروژه فعال نیست یا به شما اختصاص داده نشده است.',
      });
    }

    const result = await pool.query(
      `
        INSERT INTO time_entries (
          user_id,
          project_id,
          title,
          description,
          work_date,
          entry_method,
          duration_minutes,
          status
        )
        VALUES (
          $1,
          $2,
          $3,
          NULLIF($4, ''),
          $5,
          'manual',
          $6,
          'draft'
        )
        RETURNING
          id,
          user_id,
          project_id,
          title,
          description,
          work_date,
          entry_method,
          duration_minutes,
          status,
          created_at,
          updated_at
      `,
      [
        request.user.id,
        projectId,
        title,
        description,
        workDate,
        durationMinutes,
      ],
    );

    return response.status(201).json({
      message: 'پیش‌نویس فعالیت با موفقیت ذخیره شد.',
      timeEntry: result.rows[0],
    });
  } catch (error) {
    console.error('Manual time entry creation failed:', error.message);

    return response.status(500).json({
      message: 'ثبت فعالیت انجام نشد.',
    });
  }
});

export default router;