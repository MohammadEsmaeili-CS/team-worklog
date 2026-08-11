import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../api';

const statusLabels = {
  draft: 'پیش‌نویس',
  submitted: 'منتظر تأیید',
  partially_approved: 'تأیید یک مدیر',
  approved: 'تأیید نهایی',
  rejected: 'ردشده',
};

const initialProjectForm = {
  title: '',
  description: '',
  startDate: '',
  endDate: '',
};

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

function ManagerDashboard({
  user,
  onLogout,
  logoutPending,
}) {
  const [projects, setProjects] = useState([]);
  const [availableMembers, setAvailableMembers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [projectForm, setProjectForm] =
    useState(initialProjectForm);
  const [selectedProjectId, setSelectedProjectId] =
    useState('');
  const [selectedMemberIds, setSelectedMemberIds] =
    useState([]);
  const [approvalNotes, setApprovalNotes] = useState({});
  const [passwordResetForm, setPasswordResetForm] = useState({
  userId: '',
  temporaryPassword: '',
  confirmPassword: '',
});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    try {
      const [
        projectsResult,
        membersResult,
        pendingUsersResult,
        approvalsResult,
        entriesResult,
      ] = await Promise.all([
        api.get('/projects'),
        api.get('/projects/available-members'),
        api.get('/manager/users/pending'),
        api.get('/approvals/pending'),
        api.get('/time-entries'),
      ]);

      setProjects(projectsResult.projects);
      setAvailableMembers(membersResult.members);
      setPendingUsers(pendingUsersResult.users);
      setPendingApprovals(approvalsResult.timeEntries);
      setTimeEntries(entriesResult.timeEntries);

      const firstProjectId =
        projectsResult.projects[0]?.id ?? '';

      setSelectedProjectId(firstProjectId);

      if (firstProjectId) {
        const projectMembersResult = await api.get(
          `/projects/${firstProjectId}/members`,
        );

        setSelectedMemberIds(
          projectMembersResult.members.map(
            (member) => String(member.id),
          ),
        );
      } else {
        setSelectedMemberIds([]);
      }
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

  const statistics = useMemo(() => {
    const totalMinutes = timeEntries.reduce(
      (sum, entry) =>
        sum + (entry.duration_minutes ?? 0),
      0,
    );

    return {
      totalMinutes,
      activeProjects: projects.filter(
        (project) => project.status === 'active',
      ).length,
      pendingApprovals: pendingApprovals.length,
      pendingUsers: pendingUsers.length,
    };
  }, [
    pendingApprovals.length,
    pendingUsers.length,
    projects,
    timeEntries,
  ]);

  function updateProjectForm(event) {
    const { name, value } = event.target;

    setProjectForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function updateApprovalNote(entryId, value) {
    setApprovalNotes((currentNotes) => ({
      ...currentNotes,
      [entryId]: value,
    }));
  }

  async function chooseProject(projectId) {
    setSelectedProjectId(projectId);
    setSelectedMemberIds([]);
    setWorking(true);
    setMessage('');
    setError('');

    try {
      const result = await api.get(
        `/projects/${projectId}/members`,
      );

      setSelectedMemberIds(
        result.members.map((member) => String(member.id)),
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  function toggleMember(memberId) {
    const normalizedId = String(memberId);

    setSelectedMemberIds((currentIds) => {
      if (currentIds.includes(normalizedId)) {
        return currentIds.filter(
          (currentId) => currentId !== normalizedId,
        );
      }

      return [...currentIds, normalizedId];
    });
  }

  async function createProject(event) {
    event.preventDefault();
    setWorking(true);
    setMessage('');
    setError('');

    try {
      const result = await api.post('/projects', {
        title: projectForm.title,
        description: projectForm.description,
        startDate: projectForm.startDate || null,
        endDate: projectForm.endDate || null,
      });

      setMessage(result.message);
      setProjectForm(initialProjectForm);
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function saveProjectMembers() {
    if (!selectedProjectId) {
      return;
    }

    setWorking(true);
    setMessage('');
    setError('');

    try {
      const result = await api.put(
        `/projects/${selectedProjectId}/members`,
        {
          memberIds: selectedMemberIds.map(Number),
        },
      );

      setMessage(result.message);
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function reviewUser(userId, decision) {
    setWorking(true);
    setMessage('');
    setError('');

    try {
      const result = await api.patch(
        `/manager/users/${userId}/review`,
        {
          decision,
          note: '',
        },
      );

      setMessage(result.message);
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

async function resetMemberPassword(event) {
  event.preventDefault();

  if (!passwordResetForm.userId) {
    setError('ابتدا عضو موردنظر را انتخاب کنید.');
    return;
  }

  if (passwordResetForm.temporaryPassword.length < 8) {
    setError('رمز موقت باید حداقل 8 کاراکتر باشد.');
    return;
  }

  if (
    passwordResetForm.temporaryPassword !==
    passwordResetForm.confirmPassword
  ) {
    setError('رمز موقت و تکرار آن یکسان نیستند.');
    return;
  }

  setWorking(true);
  setMessage('');
  setError('');

  try {
   const result = await api.patch(
  `/manager/users/${passwordResetForm.userId}/password`,
  {
    temporaryPassword:
      passwordResetForm.temporaryPassword,
  },
);

    setMessage(result.message);

    setPasswordResetForm({
      userId: '',
      temporaryPassword: '',
      confirmPassword: '',
    });
  } catch (requestError) {
    setError(requestError.message);
  } finally {
    setWorking(false);
  }
}

  async function reviewEntry(entryId, decision) {
    const note = approvalNotes[entryId] ?? '';

    if (decision === 'reject' && !note.trim()) {
      setError('برای رد فعالیت، دلیل رد را وارد کنید.');
      return;
    }

    setWorking(true);
    setMessage('');
    setError('');

    try {
      const result = await api.post(
        `/approvals/${entryId}`,
        {
          decision,
          note,
        },
      );

      setMessage(result.message);

      setApprovalNotes((currentNotes) => {
        const nextNotes = { ...currentNotes };
        delete nextNotes[entryId];
        return nextNotes;
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
        <p>در حال آماده‌سازی پنل مدیریت...</p>
      </div>
    );
  }

  return (
    <main className="dashboard-shell manager-dashboard" dir="rtl">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="brand-mark small">TS</div>

          <div>
            <strong>سامانه مدیریت فعالیت تیم</strong>
            <span>پنل مدیریت</span>
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
        <section className="manager-hero">
          <div>
            <p className="eyebrow">مرکز مدیریت</p>
            <h1>سلام {user.fullName}</h1>
            <p>
              پروژه‌ها، اعضا و فعالیت‌های ثبت‌شده تیم را
              از این صفحه مدیریت و بررسی کنید.
            </p>
          </div>

          <div className="manager-access-badge">
            <strong>دسترسی مدیریتی</strong>
            <span>
              مشاهده فعالیت تمام اعضا و ثبت تصمیم‌های تأیید
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
          <article className="stat-card manager-primary-stat">
            <span>کل زمان ثبت‌شده</span>
            <strong>
              {formatDuration(statistics.totalMinutes)}
            </strong>
          </article>

          <article className="stat-card">
            <span>پروژه فعال</span>
            <strong>{statistics.activeProjects}</strong>
          </article>

          <article className="stat-card">
            <span>منتظر تأیید شما</span>
            <strong>{statistics.pendingApprovals}</strong>
          </article>

          <article className="stat-card">
            <span>عضو منتظر فعال‌سازی</span>
            <strong>{statistics.pendingUsers}</strong>
          </article>
        </section>

        <section className="manager-grid">
          <article className="panel-card approvals-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">بررسی عملکرد</p>
                <h2>فعالیت‌های منتظر تأیید شما</h2>
              </div>

              <span className="count-badge">
                {pendingApprovals.length} مورد
              </span>
            </div>

            {pendingApprovals.length === 0 ? (
              <div className="empty-state compact">
                <p>فعالیتی منتظر تصمیم شما نیست.</p>
              </div>
            ) : (
              <div className="approval-list">
                {pendingApprovals.map((entry) => (
                  <article
                    className="approval-card"
                    key={entry.id}
                  >
                    <div className="approval-main">
                      <div>
                        <strong>{entry.title}</strong>
                        <p>
                          {entry.description || 'بدون توضیح'}
                        </p>
                      </div>

                      <span
                        className={`status-badge ${entry.status}`}
                      >
                        {entry.approval_count} از ۲ تأیید
                      </span>
                    </div>

                    <div className="approval-meta">
                      <span>
                        عضو: {entry.member_name}
                      </span>
                      <span>
                        پروژه: {entry.project_title}
                      </span>
                      <span>
                        زمان:{' '}
                        {formatDuration(
                          entry.duration_minutes,
                        )}
                      </span>
                      <span>تاریخ: {entry.work_date}</span>
                    </div>

                    <textarea
                      value={approvalNotes[entry.id] ?? ''}
                      onChange={(event) =>
                        updateApprovalNote(
                          entry.id,
                          event.target.value,
                        )
                      }
                      placeholder="یادداشت مدیر یا دلیل رد فعالیت"
                      rows="2"
                    />

                    <div className="approval-actions">
                      <button
                        type="button"
                        className="approve-button"
                        onClick={() =>
                          reviewEntry(entry.id, 'approve')
                        }
                        disabled={working}
                      >
                        تأیید فعالیت
                      </button>

                      <button
                        type="button"
                        className="reject-button"
                        onClick={() =>
                          reviewEntry(entry.id, 'reject')
                        }
                        disabled={working}
                      >
                        رد فعالیت
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </article>

          <article className="panel-card pending-users-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">اعضای جدید</p>
                <h2>در انتظار فعال‌سازی</h2>
              </div>

              <span className="count-badge">
                {pendingUsers.length} نفر
              </span>
            </div>

            {pendingUsers.length === 0 ? (
              <div className="empty-state compact">
                <p>حساب جدیدی منتظر تأیید نیست.</p>
              </div>
            ) : (
              <div className="pending-users-list">
                {pendingUsers.map((pendingUser) => (
                  <article
                    className="pending-user-card"
                    key={pendingUser.id}
                  >
                    <div>
                      <strong>
                        {pendingUser.full_name}
                      </strong>
                      <span>
                        @{pendingUser.username}
                      </span>
                      <span>{pendingUser.email}</span>
                    </div>

                    <div>
                      <button
                        type="button"
                        className="approve-button small"
                        onClick={() =>
                          reviewUser(
                            pendingUser.id,
                            'approve',
                          )
                        }
                        disabled={working}
                      >
                        تأیید
                      </button>

                      <button
                        type="button"
                        className="reject-button small"
                        onClick={() =>
                          reviewUser(
                            pendingUser.id,
                            'reject',
                          )
                        }
                        disabled={working}
                      >
                        رد
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        <section className="project-management-grid">
          <article className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">پروژه‌ها</p>
                <h2>ایجاد پروژه جدید</h2>
              </div>
            </div>

            <form
              className="dashboard-form"
              onSubmit={createProject}
            >
              <label>
                عنوان پروژه
                <input
                  name="title"
                  value={projectForm.title}
                  onChange={updateProjectForm}
                  placeholder="عنوان پروژه"
                  required
                />
              </label>

              <label>
                توضیحات
                <textarea
                  name="description"
                  value={projectForm.description}
                  onChange={updateProjectForm}
                  placeholder="شرح پروژه"
                  rows="3"
                />
              </label>

              <div className="form-row">
                <label>
                  تاریخ شروع
                  <input
                    type="date"
                    name="startDate"
                    value={projectForm.startDate}
                    onChange={updateProjectForm}
                  />
                </label>

                <label>
                  تاریخ پایان
                  <input
                    type="date"
                    name="endDate"
                    value={projectForm.endDate}
                    onChange={updateProjectForm}
                  />
                </label>
              </div>

              <button
                type="submit"
                className="primary-button"
                disabled={working}
              >
                ایجاد پروژه
              </button>
            </form>
          </article>

          <article className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">اعضای پروژه</p>
                <h2>اختصاص اعضا</h2>
              </div>
            </div>

            {projects.length === 0 ? (
              <div className="empty-state compact">
                <p>ابتدا یک پروژه ایجاد کنید.</p>
              </div>
            ) : (
              <>
                <label className="standalone-label">
                  پروژه
                  <select
                    value={selectedProjectId}
                    onChange={(event) =>
                      chooseProject(event.target.value)
                    }
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

                <div className="members-selection">
                  {availableMembers.length === 0 ? (
                    <p>عضو فعالی وجود ندارد.</p>
                  ) : (
                    availableMembers.map((member) => {
                      const selected =
                        selectedMemberIds.includes(
                          String(member.id),
                        );

                      return (
                        <label
                          className={`member-checkbox ${
                            selected ? 'selected' : ''
                          }`}
                          key={member.id}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              toggleMember(member.id)
                            }
                          />

                          <div>
                            <strong>
                              {member.full_name}
                            </strong>
                            <span>@{member.username}</span>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>

                <button
                  type="button"
                  className="primary-button full-width"
                  onClick={saveProjectMembers}
                  disabled={working}
                >
                  ذخیره اعضای پروژه
                </button>
              </>
            )}
          </article>
        </section>

<section className="panel-card password-reset-panel">
  <div className="panel-heading">
    <div>
      <span className="eyebrow">امنیت حساب اعضا</span>
      <h2>بازنشانی رمز عبور</h2>
    </div>

    <span className="count-badge">
      {availableMembers.length} عضو
    </span>
  </div>

  <form
    className="dashboard-form"
    onSubmit={resetMemberPassword}
  >
    <label>
      عضو
      <select
        value={passwordResetForm.userId}
        onChange={(event) =>
          setPasswordResetForm((currentForm) => ({
            ...currentForm,
            userId: event.target.value,
          }))
        }
        disabled={working}
      >
        <option value="">عضو را انتخاب کنید</option>

        {availableMembers.map((member) => (
          <option value={member.id} key={member.id}>
            {member.full_name} ({member.username})
          </option>
        ))}
      </select>
    </label>

    <div className="form-row">
      <label>
        رمز موقت جدید
        <input
          type="password"
          value={passwordResetForm.temporaryPassword}
          onChange={(event) =>
            setPasswordResetForm((currentForm) => ({
              ...currentForm,
              temporaryPassword: event.target.value,
            }))
          }
          minLength="8"
          maxLength="100"
          autoComplete="new-password"
          placeholder="حداقل 8 کاراکتر"
          disabled={working}
        />
      </label>

      <label>
        تکرار رمز موقت
        <input
          type="password"
          value={passwordResetForm.confirmPassword}
          onChange={(event) =>
            setPasswordResetForm((currentForm) => ({
              ...currentForm,
              confirmPassword: event.target.value,
            }))
          }
          minLength="8"
          maxLength="100"
          autoComplete="new-password"
          placeholder="رمز موقت را دوباره وارد کنید"
          disabled={working}
        />
      </label>
    </div>

    <p className="password-reset-help">
      پس از بازنشانی، رمز موقت را به‌صورت خصوصی به عضو
      بدهید. عضو باید بعد از ورود، رمز شخصی جدیدی انتخاب کند.
    </p>

    <button
      className="primary-button full-width"
      type="submit"
      disabled={working || availableMembers.length === 0}
    >
      {working
        ? 'در حال بازنشانی...'
        : 'بازنشانی رمز عضو'}
    </button>
  </form>
</section>

        <section className="panel-card entries-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">گزارش تیم</p>
              <h2>تمام فعالیت‌های اعضا</h2>
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
              <table className="entries-table manager-table">
                <thead>
                  <tr>
                    <th>عضو</th>
                    <th>فعالیت</th>
                    <th>پروژه</th>
                    <th>تاریخ</th>
                    <th>روش</th>
                    <th>مدت</th>
                    <th>تأییدها</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>

                <tbody>
                  {timeEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <strong>{entry.member_name}</strong>
                        <span>
                          @{entry.member_username}
                        </span>
                      </td>

                      <td>
                        <strong>{entry.title}</strong>
                        <span>
                          {entry.description || 'بدون توضیح'}
                        </span>
                      </td>

                      <td>{entry.project_title}</td>
                      <td>{entry.work_date}</td>

                      <td>
                        {entry.entry_method === 'timer'
                          ? 'زمان‌سنج'
                          : 'دستی'}
                      </td>

                      <td>
                        {formatDuration(
                          entry.duration_minutes ?? 0,
                        )}
                      </td>

                      <td>
                        {entry.approval_count} از ۲
                      </td>

                      <td>
                        <span
                          className={`status-badge ${entry.status}`}
                        >
                          {statusLabels[entry.status] ||
                            entry.status}
                        </span>
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

export default ManagerDashboard;