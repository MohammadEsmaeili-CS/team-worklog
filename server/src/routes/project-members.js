import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../db.js';
import {
  requireAuth,
  requireManager,
} from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireManager);

const assignmentSchema = z.object({
  memberIds: z
    .array(z.coerce.number().int().positive())
    .max(200, 'تعداد اعضای انتخاب‌شده بیش از حد مجاز است.'),
});

router.get('/available-members', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        full_name,
        username,
        email
      FROM users
      WHERE role = 'member'
        AND account_status = 'active'
        AND is_active = TRUE
      ORDER BY full_name ASC
    `);

    return response.json({
      members: result.rows,
    });
  } catch (error) {
    console.error('Available members query failed:', error.message);

    return response.status(500).json({
      message: 'دریافت اعضای فعال انجام نشد.',
    });
  }
});

router.get('/:projectId/members', async (request, response) => {
  const { projectId } = request.params;

  if (!/^\d+$/.test(projectId)) {
    return response.status(400).json({
      message: 'شناسه پروژه معتبر نیست.',
    });
  }

  try {
    const projectResult = await pool.query(
      `
        SELECT id, title, status
        FROM projects
        WHERE id = $1
        LIMIT 1
      `,
      [projectId],
    );

    if (projectResult.rowCount === 0) {
      return response.status(404).json({
        message: 'پروژه پیدا نشد.',
      });
    }

    const membersResult = await pool.query(
      `
        SELECT
          u.id,
          u.full_name,
          u.username,
          u.email,
          pm.assigned_at
        FROM project_members pm
        INNER JOIN users u
          ON u.id = pm.user_id
        WHERE pm.project_id = $1
        ORDER BY u.full_name ASC
      `,
      [projectId],
    );

    return response.json({
      project: projectResult.rows[0],
      members: membersResult.rows,
    });
  } catch (error) {
    console.error('Project members query failed:', error.message);

    return response.status(500).json({
      message: 'دریافت اعضای پروژه انجام نشد.',
    });
  }
});

router.put('/:projectId/members', async (request, response) => {
  const { projectId } = request.params;

  if (!/^\d+$/.test(projectId)) {
    return response.status(400).json({
      message: 'شناسه پروژه معتبر نیست.',
    });
  }

  const validation = assignmentSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'فهرست اعضا معتبر نیست.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const memberIds = [
    ...new Set(
      validation.data.memberIds.map((memberId) => String(memberId)),
    ),
  ];

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const projectResult = await client.query(
      `
        SELECT id, title, status
        FROM projects
        WHERE id = $1
        LIMIT 1
      `,
      [projectId],
    );

    if (projectResult.rowCount === 0) {
      await client.query('ROLLBACK');

      return response.status(404).json({
        message: 'پروژه پیدا نشد.',
      });
    }

    if (projectResult.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      return response.status(409).json({
        message: 'اعضای پروژه تکمیل‌شده یا بایگانی‌شده قابل تغییر نیستند.',
      });
    }

    if (memberIds.length > 0) {
      const validMembersResult = await client.query(
        `
          SELECT id
          FROM users
          WHERE id = ANY($1::BIGINT[])
            AND role = 'member'
            AND account_status = 'active'
            AND is_active = TRUE
        `,
        [memberIds],
      );

      if (validMembersResult.rowCount !== memberIds.length) {
        await client.query('ROLLBACK');

        return response.status(400).json({
          message: 'یک یا چند عضو انتخاب‌شده معتبر یا فعال نیستند.',
        });
      }
    }

    await client.query(
      `
        DELETE FROM project_members
        WHERE project_id = $1
      `,
      [projectId],
    );

    if (memberIds.length > 0) {
      await client.query(
        `
          INSERT INTO project_members (
            project_id,
            user_id
          )
          SELECT
            $1,
            UNNEST($2::BIGINT[])
        `,
        [projectId, memberIds],
      );
    }

    const membersResult = await client.query(
      `
        SELECT
          u.id,
          u.full_name,
          u.username,
          u.email,
          pm.assigned_at
        FROM project_members pm
        INNER JOIN users u
          ON u.id = pm.user_id
        WHERE pm.project_id = $1
        ORDER BY u.full_name ASC
      `,
      [projectId],
    );

    await client.query('COMMIT');

    return response.json({
      message: 'اعضای پروژه با موفقیت به‌روزرسانی شدند.',
      project: projectResult.rows[0],
      members: membersResult.rows,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Project member assignment failed:', error.message);

    return response.status(500).json({
      message: 'اختصاص اعضا به پروژه انجام نشد.',
    });
  } finally {
    client.release();
  }
});

export default router;
