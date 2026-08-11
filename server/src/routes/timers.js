import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.use((request, response, next) => {
  if (request.user.role !== 'member') {
    return response.status(403).json({
      message: 'زمان‌سنج فقط برای اعضای تیم قابل استفاده است.',
    });
  }

  return next();
});

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

const startTimerSchema = z.object({
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
});

router.get('/active', async (request, response) => {
  try {
    const result = await pool.query(
      `
        SELECT
          te.id,
          te.project_id,
          te.title,
          te.description,
          te.work_date,
          te.entry_method,
          te.started_at,
          te.status,
          p.title AS project_title,
          GREATEST(
            0,
            FLOOR(
              EXTRACT(EPOCH FROM (NOW() - te.started_at))
            )
          )::INTEGER AS elapsed_seconds
        FROM time_entries te
        INNER JOIN projects p
          ON p.id = te.project_id
        WHERE te.user_id = $1
          AND te.entry_method = 'timer'
          AND te.started_at IS NOT NULL
          AND te.ended_at IS NULL
        LIMIT 1
      `,
      [request.user.id],
    );

    return response.json({
      timer: result.rows[0] ?? null,
    });
  } catch (error) {
    console.error('Active timer query failed:', error.message);

    return response.status(500).json({
      message: 'دریافت زمان‌سنج فعال انجام نشد.',
    });
  }
});

router.post('/start', async (request, response) => {
  const validation = startTimerSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'اطلاعات زمان‌سنج معتبر نیست.',
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
  } = validation.data;

  try {
    const projectResult = await pool.query(
      `
        SELECT p.id
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

    const activeTimerResult = await pool.query(
      `
        SELECT id
        FROM time_entries
        WHERE user_id = $1
          AND entry_method = 'timer'
          AND started_at IS NOT NULL
          AND ended_at IS NULL
        LIMIT 1
      `,
      [request.user.id],
    );

    if (activeTimerResult.rowCount > 0) {
      return response.status(409).json({
        message: 'شما در حال حاضر یک زمان‌سنج فعال دارید.',
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
          started_at,
          ended_at,
          status
        )
        VALUES (
          $1,
          $2,
          $3,
          NULLIF($4, ''),
          $5,
          'timer',
          NULL,
          NOW(),
          NULL,
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
          started_at,
          ended_at,
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
      ],
    );

    return response.status(201).json({
      message: 'زمان‌سنج با موفقیت شروع شد.',
      timer: result.rows[0],
    });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({
        message: 'شما در حال حاضر یک زمان‌سنج فعال دارید.',
      });
    }

    console.error('Timer start failed:', error.message);

    return response.status(500).json({
      message: 'شروع زمان‌سنج انجام نشد.',
    });
  }
});

router.post('/:entryId/stop', async (request, response) => {
  const { entryId } = request.params;

  if (!/^\d+$/.test(entryId)) {
    return response.status(400).json({
      message: 'شناسه زمان‌سنج معتبر نیست.',
    });
  }

  try {
    const result = await pool.query(
      `
        UPDATE time_entries
        SET
          ended_at = NOW(),
          duration_minutes = LEAST(
            1440,
            GREATEST(
              1,
              CEIL(
                EXTRACT(EPOCH FROM (NOW() - started_at)) / 60.0
              )::INTEGER
            )
          ),
          status = 'draft',
          updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND entry_method = 'timer'
          AND started_at IS NOT NULL
          AND ended_at IS NULL
        RETURNING
          id,
          user_id,
          project_id,
          title,
          description,
          work_date,
          entry_method,
          duration_minutes,
          started_at,
          ended_at,
          status,
          created_at,
          updated_at
      `,
      [entryId, request.user.id],
    );

    const timer = result.rows[0];

    if (!timer) {
      return response.status(404).json({
        message: 'زمان‌سنج فعال متعلق به شما پیدا نشد.',
      });
    }

    return response.json({
      message: 'زمان‌سنج متوقف و مدت فعالیت ذخیره شد.',
      timeEntry: timer,
    });
  } catch (error) {
    console.error('Timer stop failed:', error.message);

    return response.status(500).json({
      message: 'توقف زمان‌سنج انجام نشد.',
    });
  }
});

export default router;