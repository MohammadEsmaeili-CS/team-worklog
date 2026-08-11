import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../db.js';
import {
  requireAuth,
  requireManager,
} from '../middleware/auth.js';

const router = Router();

const REQUIRED_APPROVALS = 2;

router.use(requireAuth, requireManager);

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),

  note: z
    .string()
    .trim()
    .max(1000, 'یادداشت مدیر بیش از حد طولانی است.')
    .optional()
    .default(''),
});

router.get('/pending', async (request, response) => {
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
            FROM approvals approval_count
            WHERE approval_count.time_entry_id = te.id
              AND approval_count.decision = 'approved'
          ) AS approval_count
        FROM time_entries te
        INNER JOIN users u
          ON u.id = te.user_id
        INNER JOIN projects p
          ON p.id = te.project_id
        WHERE te.status IN (
          'submitted',
          'partially_approved'
        )
          AND NOT EXISTS (
            SELECT 1
            FROM approvals own_approval
            WHERE own_approval.time_entry_id = te.id
              AND own_approval.manager_id = $1
          )
        ORDER BY
          te.work_date ASC,
          te.updated_at ASC
      `,
      [request.user.id],
    );

    return response.json({
      requiredApprovals: REQUIRED_APPROVALS,
      timeEntries: result.rows,
    });
  } catch (error) {
    console.error('Pending approvals query failed:', error.message);

    return response.status(500).json({
      message: 'دریافت فعالیت‌های منتظر تأیید انجام نشد.',
    });
  }
});

router.post('/:entryId', async (request, response) => {
  const { entryId } = request.params;

  if (!/^\d+$/.test(entryId)) {
    return response.status(400).json({
      message: 'شناسه فعالیت معتبر نیست.',
    });
  }

  const validation = decisionSchema.safeParse(request.body);

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
  const databaseDecision =
    decision === 'approve'
      ? 'approved'
      : 'rejected';

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const entryResult = await client.query(
      `
        SELECT
          id,
          user_id,
          project_id,
          title,
          status
        FROM time_entries
        WHERE id = $1
        FOR UPDATE
      `,
      [entryId],
    );

    const entry = entryResult.rows[0];

    if (!entry) {
      await client.query('ROLLBACK');

      return response.status(404).json({
        message: 'فعالیت پیدا نشد.',
      });
    }

    if (
      entry.status !== 'submitted' &&
      entry.status !== 'partially_approved'
    ) {
      await client.query('ROLLBACK');

      return response.status(409).json({
        message: 'این فعالیت در وضعیت قابل بررسی قرار ندارد.',
      });
    }

    const existingDecisionResult = await client.query(
      `
        SELECT decision
        FROM approvals
        WHERE time_entry_id = $1
          AND manager_id = $2
        LIMIT 1
      `,
      [entryId, request.user.id],
    );

    if (existingDecisionResult.rowCount > 0) {
      await client.query('ROLLBACK');

      return response.status(409).json({
        message: 'شما قبلاً درباره این فعالیت تصمیم گرفته‌اید.',
      });
    }

    await client.query(
      `
        INSERT INTO approvals (
          time_entry_id,
          manager_id,
          decision,
          note
        )
        VALUES (
          $1,
          $2,
          $3,
          NULLIF($4, '')
        )
      `,
      [
        entryId,
        request.user.id,
        databaseDecision,
        note,
      ],
    );

    let newStatus;
    let approvalCount = 0;

    if (databaseDecision === 'rejected') {
      newStatus = 'rejected';
    } else {
      const approvalCountResult = await client.query(
        `
          SELECT COUNT(*)::INTEGER AS approval_count
          FROM approvals
          WHERE time_entry_id = $1
            AND decision = 'approved'
        `,
        [entryId],
      );

      approvalCount =
        approvalCountResult.rows[0].approval_count;

      newStatus =
        approvalCount >= REQUIRED_APPROVALS
          ? 'approved'
          : 'partially_approved';
    }

    const updateResult = await client.query(
      `
        UPDATE time_entries
        SET
          status = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          user_id,
          project_id,
          title,
          status,
          updated_at
      `,
      [newStatus, entryId],
    );

    await client.query('COMMIT');

    return response.json({
      message:
        newStatus === 'approved'
          ? 'فعالیت با تأیید هر دو مدیر نهایی شد.'
          : newStatus === 'partially_approved'
            ? 'تأیید مدیر اول ثبت شد و تأیید مدیر دوم لازم است.'
            : 'فعالیت رد شد و برای اصلاح به عضو بازگشت.',
      approval: {
        managerId: request.user.id,
        decision: databaseDecision,
        approvalCount,
        requiredApprovals: REQUIRED_APPROVALS,
      },
      timeEntry: updateResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Approval decision failed:', error.message);

    return response.status(500).json({
      message: 'ثبت تصمیم مدیر انجام نشد.',
    });
  } finally {
    client.release();
  }
});

export default router;