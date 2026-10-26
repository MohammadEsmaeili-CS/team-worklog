import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../db.js';
import {
  requireAuth,
  requireManager,
} from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به شکل YYYY-MM-DD باشد.');

const createProjectSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, 'عنوان پروژه باید حداقل 2 حرف باشد.')
      .max(150, 'عنوان پروژه بیش از حد طولانی است.'),

    description: z
      .string()
      .trim()
      .max(2000, 'توضیحات پروژه بیش از حد طولانی است.')
      .optional()
      .default(''),

    startDate: dateSchema.nullable().optional().default(null),
    endDate: dateSchema.nullable().optional().default(null),
  })
  .refine(
    (data) =>
      !data.startDate ||
      !data.endDate ||
      data.endDate >= data.startDate,
    {
      path: ['endDate'],
      message: 'تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.',
    },
  );

router.get('/', async (request, response) => {
  try {
    let result;

    if (request.user.role === 'manager') {
      result = await pool.query(`
        SELECT
          p.id,
          p.title,
          p.description,
          p.status,
          p.start_date,
          p.end_date,
          p.created_at,
          p.updated_at,
          u.full_name AS created_by_name,
          (
            SELECT COUNT(*)::INTEGER
            FROM project_members pm
            WHERE pm.project_id = p.id
          ) AS member_count
        FROM projects p
        INNER JOIN users u
          ON u.id = p.created_by
        ORDER BY p.created_at DESC
      `);
    } else {
      result = await pool.query(
        `
          SELECT
            p.id,
            p.title,
            p.description,
            p.status,
            p.start_date,
            p.end_date,
            p.created_at,
            p.updated_at,
            u.full_name AS created_by_name
          FROM projects p
          INNER JOIN users u
            ON u.id = p.created_by
          INNER JOIN project_members pm
            ON pm.project_id = p.id
          WHERE pm.user_id = $1
            AND p.status = 'active'
          ORDER BY p.created_at DESC
        `,
        [request.user.id],
      );
    }

    return response.json({
      projects: result.rows,
    });
  } catch (error) {
    console.error('Projects query failed:', error.message);

    return response.status(500).json({
      message: 'دریافت پروژه‌ها انجام نشد.',
    });
  }
});

router.post('/', requireManager, async (request, response) => {
  const validation = createProjectSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'اطلاعات پروژه معتبر نیست.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const {
    title,
    description,
    startDate,
    endDate,
  } = validation.data;

  try {
    const result = await pool.query(
      `
        INSERT INTO projects (
          title,
          description,
          status,
          created_by,
          start_date,
          end_date
        )
        VALUES (
          $1,
          NULLIF($2, ''),
          'active',
          $3,
          $4,
          $5
        )
        RETURNING
          id,
          title,
          description,
          status,
          created_by,
          start_date,
          end_date,
          created_at,
          updated_at
      `,
      [
        title,
        description,
        request.user.id,
        startDate,
        endDate,
      ],
    );

    return response.status(201).json({
      message: 'پروژه با موفقیت ایجاد شد.',
      project: result.rows[0],
    });
  } catch (error) {
    console.error('Project creation failed:', error.message);

    return response.status(500).json({
      message: 'ایجاد پروژه انجام نشد.',
    });
  }
});

const projectStatusSchema = z.object({
  status: z.enum(['active', 'completed', 'archived']),
});

router.patch('/:projectId/status', requireManager, async (request, response) => {
  const projectId = Number.parseInt(request.params.projectId, 10);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return response.status(400).json({ message: 'شناسه پروژه معتبر نیست.' });
  }

  const validation = projectStatusSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({ message: 'وضعیت پروژه معتبر نیست.' });
  }

  try {
    const result = await pool.query(
      `
        UPDATE projects
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, title, description, status, start_date, end_date, updated_at
      `,
      [validation.data.status, projectId],
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ message: 'پروژه پیدا نشد.' });
    }

    const messages = {
      active: 'پروژه دوباره فعال شد.',
      completed: 'پروژه به‌عنوان تکمیل‌شده ثبت شد.',
      archived: 'پروژه بایگانی شد و دیگر فعالیت جدید نمی‌پذیرد.',
    };

    return response.json({
      message: messages[validation.data.status],
      project: result.rows[0],
    });
  } catch (error) {
    console.error('Project status update failed:', error.message);
    return response.status(500).json({ message: 'تغییر وضعیت پروژه انجام نشد.' });
  }
});

router.delete('/:projectId', requireManager, async (request, response) => {
  const projectId = Number.parseInt(request.params.projectId, 10);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return response.status(400).json({ message: 'شناسه پروژه معتبر نیست.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const projectResult = await client.query(
      `SELECT id, title FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );

    if (projectResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return response.status(404).json({ message: 'پروژه پیدا نشد.' });
    }

    const usageResult = await client.query(
      `
        SELECT
          (SELECT COUNT(*)::INTEGER FROM project_members WHERE project_id = $1) AS member_count,
          (SELECT COUNT(*)::INTEGER FROM time_entries WHERE project_id = $1) AS entry_count
      `,
      [projectId],
    );

    const usage = usageResult.rows[0];

    if (usage.member_count > 0 || usage.entry_count > 0) {
      await client.query('ROLLBACK');
      return response.status(409).json({
        message: 'این پروژه عضو یا فعالیت ثبت‌شده دارد و فقط قابل بایگانی است.',
      });
    }

    await client.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await client.query('COMMIT');

    return response.json({ message: 'پروژه خالی به‌صورت دائمی حذف شد.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Project deletion failed:', error.message);
    return response.status(500).json({ message: 'حذف پروژه انجام نشد.' });
  } finally {
    client.release();
  }
});

export default router;
