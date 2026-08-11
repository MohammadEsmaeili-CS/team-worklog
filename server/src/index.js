import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import 'dotenv/config';

import { pool } from './db.js';
import authRouter from './routes/auth.js';

const app = express();
const port = Number(process.env.PORT) || 4000;
import sessionRouter from './routes/session.js';
import managerUsersRouter from './routes/manager-users.js';
import accountRouter from './routes/account.js';

import projectsRouter from './routes/projects.js';
import projectMembersRouter from './routes/project-members.js';

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN,
    credentials: true,
  }),
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS database_user,
        NOW() AS database_time
    `);

    response.json({
      status: 'ok',
      database: result.rows[0],
    });
  } catch (error) {
    console.error('Database connection failed:', error.message);

    response.status(500).json({
      status: 'error',
      message: 'Database connection failed',
    });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/auth', sessionRouter);
app.use('/api/manager/users', managerUsersRouter);
app.use('/api/account', accountRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects', projectMembersRouter);

app.use((_request, response) => {
  response.status(404).json({
    message: 'مسیر درخواستی پیدا نشد.',
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});