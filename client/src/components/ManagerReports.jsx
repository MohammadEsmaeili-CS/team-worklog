import { useMemo, useState } from 'react';

const statusLabels = {
  draft: 'پیش‌نویس',
  submitted: 'منتظر تأیید',
  partially_approved: 'تأیید یک مدیر',
  approved: 'تأیید نهایی',
  rejected: 'ردشده',
};

const initialFilters = {
  startDate: '',
  endDate: '',
  memberUsername: 'all',
  projectTitle: 'all',
  status: 'all',
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

function escapeCsvCell(value) {
  const normalizedValue = String(value ?? '').replace(
    /"/g,
    '""',
  );

  return `"${normalizedValue}"`;
}

function ManagerReports({ timeEntries }) {
  const [filters, setFilters] = useState(initialFilters);
  const [exportingExcel, setExportingExcel] =
    useState(false);

  const members = useMemo(() => {
    const uniqueMembers = new Map();

    timeEntries.forEach((entry) => {
      uniqueMembers.set(entry.member_username, {
        username: entry.member_username,
        name: entry.member_name,
      });
    });

    return [...uniqueMembers.values()].sort(
      (first, second) =>
        first.name.localeCompare(second.name, 'fa'),
    );
  }, [timeEntries]);

  const projects = useMemo(() => {
    return [
      ...new Set(
        timeEntries.map(
          (entry) => entry.project_title,
        ),
      ),
    ]
      .filter(Boolean)
      .sort((first, second) =>
        first.localeCompare(second, 'fa'),
      );
  }, [timeEntries]);

  const filteredEntries = useMemo(() => {
    return timeEntries.filter((entry) => {
      const workDate = String(entry.work_date).slice(
        0,
        10,
      );

      if (
        filters.startDate &&
        workDate < filters.startDate
      ) {
        return false;
      }

      if (
        filters.endDate &&
        workDate > filters.endDate
      ) {
        return false;
      }

      if (
        filters.memberUsername !== 'all' &&
        entry.member_username !==
          filters.memberUsername
      ) {
        return false;
      }

      if (
        filters.projectTitle !== 'all' &&
        entry.project_title !== filters.projectTitle
      ) {
        return false;
      }

      if (
        filters.status !== 'all' &&
        entry.status !== filters.status
      ) {
        return false;
      }

      return true;
    });
  }, [filters, timeEntries]);

  const reportStatistics = useMemo(() => {
    const totalMinutes = filteredEntries.reduce(
      (sum, entry) =>
        sum + (entry.duration_minutes ?? 0),
      0,
    );

    const approvedMinutes = filteredEntries
      .filter(
        (entry) => entry.status === 'approved',
      )
      .reduce(
        (sum, entry) =>
          sum + (entry.duration_minutes ?? 0),
        0,
      );

    const memberCount = new Set(
      filteredEntries.map(
        (entry) => entry.member_username,
      ),
    ).size;

    return {
      totalMinutes,
      approvedMinutes,
      memberCount,
      entryCount: filteredEntries.length,
    };
  }, [filteredEntries]);

  const memberSummary = useMemo(() => {
    const summary = new Map();

    filteredEntries.forEach((entry) => {
      const currentSummary = summary.get(
        entry.member_username,
      ) ?? {
        username: entry.member_username,
        name: entry.member_name,
        entryCount: 0,
        totalMinutes: 0,
        approvedMinutes: 0,
      };

      currentSummary.entryCount += 1;
      currentSummary.totalMinutes +=
        entry.duration_minutes ?? 0;

      if (entry.status === 'approved') {
        currentSummary.approvedMinutes +=
          entry.duration_minutes ?? 0;
      }

      summary.set(
        entry.member_username,
        currentSummary,
      );
    });

    return [...summary.values()].sort(
      (first, second) =>
        first.name.localeCompare(second.name, 'fa'),
    );
  }, [filteredEntries]);

  function updateFilter(event) {
    const { name, value } = event.target;

    setFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  function clearFilters() {
    setFilters(initialFilters);
  }

  function downloadCsv() {
    if (filteredEntries.length === 0) {
      return;
    }

    const headers = [
      'نام عضو',
      'نام کاربری',
      'عنوان فعالیت',
      'توضیحات',
      'پروژه',
      'تاریخ',
      'روش ثبت',
      'مدت به دقیقه',
      'تعداد تأیید',
      'وضعیت',
    ];

    const rows = filteredEntries.map((entry) => [
      entry.member_name,
      entry.member_username,
      entry.title,
      entry.description || '',
      entry.project_title,
      entry.work_date,
      entry.entry_method === 'timer'
        ? 'زمان‌سنج'
        : 'دستی',
      entry.duration_minutes ?? 0,
      `${entry.approval_count ?? 0} از 2`,
      statusLabels[entry.status] || entry.status,
    ]);

    const csvContent = [headers, ...rows]
      .map((row) =>
        row.map(escapeCsvCell).join(','),
      )
      .join('\r\n');

    const csvBlob = new Blob(
      [`\uFEFF${csvContent}`],
      {
        type: 'text/csv;charset=utf-8;',
      },
    );

    const downloadUrl =
      window.URL.createObjectURL(csvBlob);

    const downloadLink =
      document.createElement('a');

    const today = new Date()
      .toISOString()
      .slice(0, 10);

    downloadLink.href = downloadUrl;
    downloadLink.download =
      `team-worklog-report-${today}.csv`;

    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    window.URL.revokeObjectURL(downloadUrl);
  }

  async function downloadExcel() {
    if (
      filteredEntries.length === 0 ||
      exportingExcel
    ) {
      return;
    }

    setExportingExcel(true);

    try {
      const { exportManagerExcel } = await import(
        '../utils/export-manager-excel'
      );

      await exportManagerExcel({
        entries: filteredEntries,
        memberSummary,
        statistics: reportStatistics,
        filters,
      });
    } catch {
      window.alert(
        'ساخت فایل Excel با خطا مواجه شد.',
      );
    } finally {
      setExportingExcel(false);
    }
  }

  return (
    <section className="panel-card reports-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            گزارش مدیریتی
          </span>

          <h2>گزارش زمان و فعالیت اعضا</h2>
        </div>

        <span className="count-badge">
          {filteredEntries.length} فعالیت
        </span>
      </div>

      <div className="report-filters">
        <label>
          از تاریخ

          <input
            type="date"
            name="startDate"
            value={filters.startDate}
            onChange={updateFilter}
          />
        </label>

        <label>
          تا تاریخ

          <input
            type="date"
            name="endDate"
            value={filters.endDate}
            onChange={updateFilter}
          />
        </label>

        <label>
          عضو

          <select
            name="memberUsername"
            value={filters.memberUsername}
            onChange={updateFilter}
          >
            <option value="all">تمام اعضا</option>

            {members.map((member) => (
              <option
                value={member.username}
                key={member.username}
              >
                {member.name} ({member.username})
              </option>
            ))}
          </select>
        </label>

        <label>
          پروژه

          <select
            name="projectTitle"
            value={filters.projectTitle}
            onChange={updateFilter}
          >
            <option value="all">
              تمام پروژه‌ها
            </option>

            {projects.map((projectTitle) => (
              <option
                value={projectTitle}
                key={projectTitle}
              >
                {projectTitle}
              </option>
            ))}
          </select>
        </label>

        <label>
          وضعیت

          <select
            name="status"
            value={filters.status}
            onChange={updateFilter}
          >
            <option value="all">
              تمام وضعیت‌ها
            </option>

            <option value="draft">
              پیش‌نویس
            </option>

            <option value="submitted">
              منتظر تأیید
            </option>

            <option value="partially_approved">
              تأیید یک مدیر
            </option>

            <option value="approved">
              تأیید نهایی
            </option>

            <option value="rejected">
              ردشده
            </option>
          </select>
        </label>
      </div>

      <div className="report-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={clearFilters}
        >
          پاک‌کردن فیلترها
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={downloadCsv}
          disabled={filteredEntries.length === 0}
        >
          دریافت فایل CSV
        </button>

        <button
          type="button"
          className="primary-button"
          onClick={downloadExcel}
          disabled={
            filteredEntries.length === 0 ||
            exportingExcel
          }
        >
          {exportingExcel
            ? 'در حال ساخت Excel...'
            : 'دریافت Excel حرفه‌ای'}
        </button>
      </div>

      <div className="report-statistics">
        <article>
          <span>تعداد فعالیت</span>

          <strong>
            {reportStatistics.entryCount}
          </strong>
        </article>

        <article>
          <span>تعداد اعضا</span>

          <strong>
            {reportStatistics.memberCount}
          </strong>
        </article>

        <article>
          <span>کل زمان گزارش</span>

          <strong>
            {formatDuration(
              reportStatistics.totalMinutes,
            )}
          </strong>
        </article>

        <article className="approved-report-stat">
          <span>زمان تأیید نهایی</span>

          <strong>
            {formatDuration(
              reportStatistics.approvedMinutes,
            )}
          </strong>
        </article>
      </div>

      <div className="report-summary">
        <h3>خلاصه عملکرد اعضا</h3>

        {memberSummary.length === 0 ? (
          <div className="empty-state compact">
            <p>
              فعالیتی مطابق فیلترهای انتخاب‌شده
              وجود ندارد.
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="manager-table report-table">
              <thead>
                <tr>
                  <th>عضو</th>
                  <th>تعداد فعالیت</th>
                  <th>کل زمان</th>
                  <th>زمان تأیید نهایی</th>
                </tr>
              </thead>

              <tbody>
                {memberSummary.map((member) => (
                  <tr key={member.username}>
                    <td>
                      <strong>{member.name}</strong>
                      <small>@{member.username}</small>
                    </td>

                    <td>{member.entryCount}</td>

                    <td>
                      {formatDuration(
                        member.totalMinutes,
                      )}
                    </td>

                    <td>
                      {formatDuration(
                        member.approvedMinutes,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default ManagerReports;