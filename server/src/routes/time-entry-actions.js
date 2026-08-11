import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.use((request, response, next) => {
  if (request.user.role !== 'member') {
    return response.status(403).json({
      message: 'این عملیات فقط برای اعضای تیم امکان‌پذیر است.',
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

const updateEntrySchema = z
  .object({
    projectId: z.coerce.number().int().positive().optional(),

    title: z
      .string()
      .trim()
      .min(2, 'عنوان فعالیت باید حداقل 2 حرف باشد.')
      .max(200, 'عنوان فعالیت بیش از حد طولانی است.')
      .optional(),

    description: z
      .string()
      .trim()
      .max(5000, 'توضیحات فعالیت بیش از حد طولانی است.')
      .optional(),

    workDate: workDateSchema.optional(),

    durationMinutes: z.coerce
      .number()
      .int('مدت فعالیت باید عدد صحیح باشد.')
      .min(1, 'مدت فعالیت باید حداقل 1 دقیقه باشد.')
      .max(1440, 'مدت فعالیت نمی‌تواند بیشتر از 24 ساعت باشد.')
      .optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    'حداقل یک مورد برای ویرایش لازم است.',
  );

function validEntryId(entryId) {
  return /^\d+$/.test(entryId);
}

router.patch('/:entryId', async (request, response) => {
  const { entryId } = request.params;

  if (!validEntryId(entryId)) {
    return response.status(400).json({
      message: 'شناسه فعالیت معتبر نیست.',
    });
  }

  const validation = updateEntrySchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      message: 'اطلاعات ویرایش معتبر نیست.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const entryResult = await client.query(
      `
        SELECT
          id,
          project_id,
          title,
          description,
          work_date,
          entry_method,
          duration_minutes,
          started_at,
          ended_at,
          status
        FROM time_entries
        WHERE id = $1
          AND user_id = $2
        FOR UPDATE
      `,
      [entryId, request.user.id],
    );

    const entry = entryResult.rows[0];

    if (!entry) {
      await client.query('ROLLBACK');

      return response.status(404).json({
        message: 'فعالیت متعلق به شما پیدا نشد.',
      });
    }

    if (entry.status === 'approved') {
      await client.query('ROLLBACK');

      return response.status(409).json({
        message: 'فعالیت تأییدشده دیگر قابل ویرایش نیست.',
      });
    }

    if (
      entry.entry_method === 'timer' &&
      entry.started_at &&
      !entry.ended_at
    ) {
      await client.query('ROLLBACK');

      return response.status(409).json({
        message: 'ابتدا زمان‌سنج فعال را متوقف کنید.',
      });
    }

    const updatedData = {
      projectId:
        validation.data.projectId ?? Number(entry.project_id),
      title:
        validation.data.title ?? entry.title,
      description:
        validation.data.description ?? entry.description ?? '',
      workDate:
        validation.data.workDate ?? entry.work_date,
      durationMinutes:
        validation.data.durationMinutes ?? entry.duration_minutes,
    };

    const projectResult = await client.query(
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
      [updatedData.projectId, request.user.id],
    );

    if (projectResult.rowCount === 0) {
      await client.query('ROLLBACK');

      return response.status(403).json({
        message: 'پروژه انتخاب‌شده فعال نیست یا به شما اختصاص ندارد.',
      });
    }

    await client.query(
      `
        DELETE FROM approvals
        WHERE time_entry_id = $1
      `,
      [entryId],
    );

    const updateResult = await client.query(
      `
        UPDATE time_entries
        SET
          project_id = $1,
          title = $2,
          description = NULLIF($3, ''),
          work_date = $4,
          duration_minutes = $5,
          status = 'draft',
          updated_at = NOW()
        WHERE id = $6
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
        updatedData.projectId,
        updatedData.title,
        updatedData.description,
        updatedData.workDate,
        updatedData.durationMinutes,
        entryId,
      ],
    );

    await client.query('COMMIT');

    return response.json({
      message: 'فعالیت ویرایش و تأییدهای قبلی آن پاک شد.',
      timeEntry: updateResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Time entry update failed:', error.message);

    return response.status(500).json({
      message: 'ویرایش فعالیت انجام نشد.',
    });
  } finally {
    client.release();
  }
});

router.post('/:entryId/submit', async (request, response) => {
  const { entryId } = request.params;

  if (!validEntryId(entryId)) {
    return response.status(400).json({
      message: 'شناسه فعالیت معتبر نیست.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const entryResult = await client.query(
      `
        SELECT
          id,
          entry_method,
          duration_minutes,
          started_at,
          ended_at,
          status
        FROM time_entries
        WHERE id = $1
          AND user_id = $2
        FOR UPDATE
      `,
      [entryId, request.user.id],
    );

    const entry = entryResult.rows[0];

    if (!entry) {
      await client.query('ROLLBACK');

      return response.status(404).json({
        message: 'فعالیت متعلق به شما پیدا نشد.',
      });
    }

    if (entry.status === 'approved') {
      await client.query('ROLLBACK');

      return response.status(409).json({
        message: 'این فعالیت قبلاً تأیید نهایی شده است.',
      });
    }

    if (
      entry.status === 'submitted' ||
      entry.status === 'partially_approved'
    ) {
      await client.query('ROLLBACK');

      return response.status(409).json({
        message: 'این فعالیت قبلاً برای تأیید ارسال شده است.',
      });
    }

    if (
      entry.entry_method === 'timer' &&
      entry.started_at &&
      !entry.ended_at
    ) {
      await client.query('ROLLBACK');

      return response.status(409).json({
        message: 'پیش از ارسال، زمان‌سنج را متوقف کنید.',
      });
    }

    if (!entry.duration_minutes || entry.duration_minutes < 1) {
      await client.query('ROLLBACK');

      return response.status(400).json({
        message: 'مدت فعالیت معتبر نیست.',
      });
    }

    await client.query(
      `
        DELETE FROM approvals
        WHERE time_entry_id = $1
      `,
      [entryId],
    );

    const updateResult = await client.query(
      `
        UPDATE time_entries
        SET
          status = 'submitted',
          updated_at = NOW()
        WHERE id = $1
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
      [entryId],
    );

    await client.query('COMMIT');

    return response.json({
      message: 'فعالیت برای تأیید هر دو مدیر ارسال شد.',
      timeEntry: updateResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Time entry submission failed:', error.message);

    return response.status(500).json({
      message: 'ارسال فعالیت برای تأیید انجام نشد.',
    });
  } finally {
    client.release();
  }
});

export default router;