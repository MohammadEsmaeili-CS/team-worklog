import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../api';

const statusLabels = {
  draft: 'پیش‌نویس',
  submitted: 'منتظر تأیید',
  partially_approved: 'تأیید یک مدیر',
  approved: 'تأیید نهایی',
  rejected: 'نیازمند اصلاح',
};

function getToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatDuration(totalMinutes = 0) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) {
    return `${hours} ساعت و ${minutes} دقیقه`;
  }

  if (hours) {
    return `${hours} ساعت`;
  }

  return `${minutes} دقیقه`;
}

function formatTimer(totalSeconds = 0) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

const initialManualForm = {
  projectId: '',
  title: '',
  description: '',
  workDate: getToday(),
  hours: '',
  minutes: '',
};

const initialTimerForm = {
  projectId: '',
  title: '',
  description: '',
  workDate: getToday(),
};

function MemberDashboard({
  user,
  onLogout,
  logoutPending,
}) {
  const [projects, setProjects] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [activeTimer, setActiveTimer] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [manualForm, setManualForm] =
    useState(initialManualForm);
  const [timerForm, setTimerForm] =
    useState(initialTimerForm);
  const [editingEntryId, setEditingEntryId] =
    useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadDashboard = useCallback(async () => {

    try {
      const [
        projectsResult,
        entriesResult,
        timerResult,
      ] = await Promise.all([
        api.get('/projects'),
        api.get('/time-entries'),
        api.get('/timers/active'),
      ]);

      setProjects(projectsResult.projects);
      setTimeEntries(entriesResult.timeEntries);
      setActiveTimer(timerResult.timer);
      setElapsedSeconds(
        timerResult.timer?.elapsed_seconds ?? 0,
      );

      const firstProjectId =
        projectsResult.projects[0]?.id ?? '';

      setManualForm((currentForm) => ({
        ...currentForm,
        projectId:
          currentForm.projectId || firstProjectId,
      }));

      setTimerForm((currentForm) => ({
        ...currentForm,
        projectId:
          currentForm.projectId || firstProjectId,
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

 useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  loadDashboard();
}, [loadDashboard]);

  useEffect(() => {
    if (!activeTimer) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(
        (currentSeconds) => currentSeconds + 1,
      );
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeTimer]);

  const statistics = useMemo(() => {
    return timeEntries.reduce(
      (result, entry) => {
        result.totalMinutes +=
          entry.duration_minutes ?? 0;

        if (entry.status === 'approved') {
          result.approved += 1;
        } else if (
          entry.status === 'submitted' ||
          entry.status === 'partially_approved'
        ) {
          result.pending += 1;
        } else {
          result.drafts += 1;
        }

        return result;
      },
      {
        totalMinutes: 0,
        approved: 0,
        pending: 0,
        drafts: 0,
      },
    );
  }, [timeEntries]);

  function updateManualForm(event) {
    const { name, value } = event.target;

    setManualForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function updateTimerForm(event) {
    const { name, value } = event.target;

    setTimerForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function resetManualForm() {
    setEditingEntryId(null);

    setManualForm({
      ...initialManualForm,
      projectId: projects[0]?.id ?? '',
    });
  }

  function startEditing(entry) {
    const duration = entry.duration_minutes ?? 0;

    setEditingEntryId(entry.id);
    setManualForm({
      projectId: entry.project_id,
      title: entry.title,
      description: entry.description ?? '',
      workDate: entry.work_date,
      hours: String(Math.floor(duration / 60)),
      minutes: String(duration % 60),
    });

    window.scrollTo({
      top: 420,
      behavior: 'smooth',
    });

    setMessage('');
    setError('');
  }

  async function saveManualEntry(event) {
    event.preventDefault();

    const durationMinutes =
      Number(manualForm.hours || 0) * 60 +
      Number(manualForm.minutes || 0);

    if (durationMinutes < 1) {
      setError('مدت فعالیت باید حداقل یک دقیقه باشد.');
      return;
    }

    setWorking(true);
    setMessage('');
    setError('');

    const payload = {
      projectId: Number(manualForm.projectId),
      title: manualForm.title,
      description: manualForm.description,
      workDate: manualForm.workDate,
      durationMinutes,
    };

    try {
      if (editingEntryId) {
        const result = await api.patch(
          `/time-entries/${editingEntryId}`,
          payload,
        );

        setMessage(result.message);
      } else {
        const result = await api.post(
          '/time-entries/manual',
          payload,
        );

        setMessage(result.message);
      }

      resetManualForm();
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function submitEntry(entryId) {
    setWorking(true);
    setMessage('');
    setError('');

    try {
      const result = await api.post(
        `/time-entries/${entryId}/submit`,
      );

      setMessage(result.message);
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function startTimer(event) {
    event.preventDefault();
    setWorking(true);
    setMessage('');
    setError('');

    try {
      const result = await api.post('/timers/start', {
        projectId: Number(timerForm.projectId),
        title: timerForm.title,
        description: timerForm.description,
        workDate: timerForm.workDate,
      });

      setActiveTimer({
        ...result.timer,
        project_title:
          projects.find(
            (project) =>
              String(project.id) ===
              String(timerForm.projectId),
          )?.title ?? '',
      });

      setElapsedSeconds(0);
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function stopTimer() {
    if (!activeTimer) {
      return;
    }

    setWorking(true);
    setMessage('');
    setError('');

    try {
      const result = await api.post(
        `/timers/${activeTimer.id}/stop`,
      );

      setMessage(result.message);
      setActiveTimer(null);
      setElapsedSeconds(0);

      setTimerForm({
        ...initialTimerForm,
        projectId: projects[0]?.id ?? '',
      });

      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-screen" dir="rtl">
        <div className="loading-spinner" />
        <p>در حال آماده‌سازی داشبورد...</p>
      </div>
    );
  }

  return (
    <main className="dashboard-shell member-dashboard" dir="rtl">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="brand-mark small">ک</div>

          <div>
            <strong>کارنما</strong>
            <span>پنل عضو تیم</span>
          </div>
        </div>

        <div className="user-menu">
          <div>
            <strong>{user.fullName}</strong>
            <span>@{user.username}</span>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={onLogout}
            disabled={logoutPending}
          >
            خروج
          </button>
        </div>
      </header>

      <div className="dashboard-container">
        <section className="member-hero">
          <div>
            <p className="eyebrow">داشبورد شخصی</p>
            <h1>سلام {user.fullName}</h1>
            <p>
              فعالیت‌ها و زمان صرف‌شده در پروژه‌های خودت
              را از این صفحه مدیریت کن.
            </p>
          </div>

          <div className="privacy-badge">
            <strong>حریم خصوصی فعال</strong>
            <span>
              فقط شما و مدیران به فعالیت‌ها دسترسی دارید.
            </span>
          </div>
        </section>

        {message && (
          <div className="alert success dashboard-alert">
            {message}
          </div>
        )}

        {error && (
          <div className="alert error dashboard-alert">
            {error}
          </div>
        )}

        <section className="stats-grid">
          <article className="stat-card">
            <span>زمان ثبت‌شده</span>
            <strong>
              {formatDuration(statistics.totalMinutes)}
            </strong>
          </article>

          <article className="stat-card">
            <span>تأیید نهایی</span>
            <strong>{statistics.approved}</strong>
          </article>

          <article className="stat-card">
            <span>منتظر تأیید</span>
            <strong>{statistics.pending}</strong>
          </article>

          <article className="stat-card">
            <span>پیش‌نویس و اصلاح</span>
            <strong>{statistics.drafts}</strong>
          </article>
        </section>

        {projects.length === 0 ? (
          <section className="empty-state panel-card">
            <h2>هنوز پروژه‌ای به شما اختصاص داده نشده</h2>
            <p>
              پس از اختصاص پروژه توسط مدیر، امکان ثبت
              فعالیت فعال می‌شود.
            </p>
          </section>
        ) : (
          <section className="entry-tools-grid">
            <article className="panel-card">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">
                    {editingEntryId
                      ? 'ویرایش فعالیت'
                      : 'ثبت دستی'}
                  </p>
                  <h2>
                    {editingEntryId
                      ? 'اصلاح فعالیت'
                      : 'فعالیت جدید'}
                  </h2>
                </div>

                {editingEntryId && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={resetManualForm}
                  >
                    انصراف
                  </button>
                )}
              </div>

              <form
                className="dashboard-form"
                onSubmit={saveManualEntry}
              >
                <label>
                  پروژه
                  <select
                    name="projectId"
                    value={manualForm.projectId}
                    onChange={updateManualForm}
                    required
                  >
                    {projects.map((project) => (
                      <option
                        key={project.id}
                        value={project.id}
                      >
                        {project.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  عنوان فعالیت
                  <input
                    name="title"
                    value={manualForm.title}
                    onChange={updateManualForm}
                    placeholder="مثلاً تهیه گزارش هفتگی"
                    required
                  />
                </label>

                <label>
                  توضیحات
                  <textarea
                    name="description"
                    value={manualForm.description}
                    onChange={updateManualForm}
                    placeholder="شرح مختصر فعالیت"
                    rows="3"
                  />
                </label>

                <div className="form-row">
                  <label>
                    تاریخ
                    <input
                      type="date"
                      name="workDate"
                      value={manualForm.workDate}
                      onChange={updateManualForm}
                      required
                    />
                  </label>

                  <div className="duration-fields">
                    <label>
                      ساعت
                      <input
                        type="number"
                        name="hours"
                        min="0"
                        max="23"
                        value={manualForm.hours}
                        onChange={updateManualForm}
                        placeholder="0"
                      />
                    </label>

                    <label>
                      دقیقه
                      <input
                        type="number"
                        name="minutes"
                        min="0"
                        max="59"
                        value={manualForm.minutes}
                        onChange={updateManualForm}
                        placeholder="0"
                      />
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={working}
                >
                  {working
                    ? 'در حال ذخیره...'
                    : editingEntryId
                      ? 'ذخیره تغییرات'
                      : 'ذخیره پیش‌نویس'}
                </button>
              </form>
            </article>

            <article className="panel-card timer-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">زمان‌سنج</p>
                  <h2>ثبت خودکار زمان</h2>
                </div>
              </div>

              {activeTimer ? (
                <div className="active-timer">
                  <span className="live-indicator">
                    در حال اجرا
                  </span>

                  <strong className="timer-clock">
                    {formatTimer(elapsedSeconds)}
                  </strong>

                  <h3>{activeTimer.title}</h3>
                  <p>
                    {activeTimer.project_title}
                  </p>

                  <button
                    type="button"
                    className="stop-button"
                    onClick={stopTimer}
                    disabled={working}
                  >
                    توقف و ذخیره زمان
                  </button>
                </div>
              ) : (
                <form
                  className="dashboard-form"
                  onSubmit={startTimer}
                >
                  <label>
                    پروژه
                    <select
                      name="projectId"
                      value={timerForm.projectId}
                      onChange={updateTimerForm}
                      required
                    >
                      {projects.map((project) => (
                        <option
                          key={project.id}
                          value={project.id}
                        >
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    عنوان فعالیت
                    <input
                      name="title"
                      value={timerForm.title}
                      onChange={updateTimerForm}
                      placeholder="کاری که شروع می‌کنید"
                      required
                    />
                  </label>

                  <label>
                    توضیحات
                    <textarea
                      name="description"
                      value={timerForm.description}
                      onChange={updateTimerForm}
                      placeholder="توضیحات اختیاری"
                      rows="3"
                    />
                  </label>

                  <label>
                    تاریخ
                    <input
                      type="date"
                      name="workDate"
                      value={timerForm.workDate}
                      onChange={updateTimerForm}
                      required
                    />
                  </label>

                  <button
                    type="submit"
                    className="timer-button"
                    disabled={working}
                  >
                    شروع زمان‌سنج
                  </button>
                </form>
              )}
            </article>
          </section>
        )}

        <section className="panel-card entries-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">سوابق من</p>
              <h2>فعالیت‌های ثبت‌شده</h2>
            </div>

            <span className="count-badge">
              {timeEntries.length} فعالیت
            </span>
          </div>

          {timeEntries.length === 0 ? (
            <div className="empty-state compact">
              <p>هنوز فعالیتی ثبت نشده است.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="entries-table">
                <thead>
                  <tr>
                    <th>فعالیت</th>
                    <th>پروژه</th>
                    <th>تاریخ</th>
                    <th>روش ثبت</th>
                    <th>مدت</th>
                    <th>وضعیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>

                <tbody>
                  {timeEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="فعالیت">
                        <strong>{entry.title}</strong>
                        <span>
                          {entry.description || 'بدون توضیح'}
                        </span>
                      </td>

                      <td data-label="پروژه">{entry.project_title}</td>
                      <td data-label="تاریخ">{entry.work_date}</td>

                      <td data-label="روش ثبت">
                        {entry.entry_method === 'timer'
                          ? 'زمان‌سنج'
                          : 'دستی'}
                      </td>

                      <td data-label="مدت">
                        {formatDuration(
                          entry.duration_minutes ?? 0,
                        )}
                      </td>

                      <td data-label="وضعیت">
                        <span
                          className={`status-badge ${entry.status}`}
                        >
                          {statusLabels[entry.status] ||
                            entry.status}
                        </span>
                      </td>

                      <td data-label="عملیات">
                        <div className="row-actions">
                          {entry.status !== 'approved' && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                startEditing(entry)
                              }
                              disabled={working}
                            >
                              ویرایش
                            </button>
                          )}

                          {(entry.status === 'draft' ||
                            entry.status === 'rejected') && (
                            <button
                              type="button"
                              className="submit-button"
                              onClick={() =>
                                submitEntry(entry.id)
                              }
                              disabled={working}
                            >
                              ارسال
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default MemberDashboard;
