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

export default router;