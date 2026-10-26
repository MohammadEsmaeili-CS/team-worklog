import ExcelJS from 'exceljs';

const statusLabels = {
  draft: 'پیش‌نویس',
  submitted: 'منتظر تأیید',
  partially_approved: 'تأیید یک مدیر',
  approved: 'تأیید نهایی',
  rejected: 'ردشده',
};

const colors = {
  dark: 'FF252B55',
  primary: 'FF5B50F2',
  primaryLight: 'FFF0EEFF',
  green: 'FF138A67',
  greenLight: 'FFE9F8F2',
  border: 'FFDDE2EE',
  text: 'FF22283A',
  muted: 'FF6F778C',
  white: 'FFFFFFFF',
  alternate: 'FFF8F9FD',
  yellowLight: 'FFFFF4D9',
  redLight: 'FFFFE8E8',
};

const thinBorder = {
  top: {
    style: 'thin',
    color: { argb: colors.border },
  },
  bottom: {
    style: 'thin',
    color: { argb: colors.border },
  },
  left: {
    style: 'thin',
    color: { argb: colors.border },
  },
  right: {
    style: 'thin',
    color: { argb: colors.border },
  },
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

function styleTitle(worksheet, range, title) {
  worksheet.mergeCells(range);

  const titleCell = worksheet.getCell(
    range.split(':')[0],
  );

  titleCell.value = title;
  titleCell.font = {
    name: 'Tahoma',
    size: 17,
    bold: true,
    color: { argb: colors.white },
  };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: colors.dark },
  };
  titleCell.alignment = {
    horizontal: 'center',
    vertical: 'middle',
  };

  worksheet.getRow(1).height = 38;
}

function styleHeaderRow(row) {
  row.height = 30;

  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = {
      name: 'Tahoma',
      size: 10,
      bold: true,
      color: { argb: colors.white },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.primary },
    };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    cell.border = thinBorder;
  });
}

function styleDataRows(
  worksheet,
  firstRowNumber,
  lastRowNumber,
) {
  for (
    let rowNumber = firstRowNumber;
    rowNumber <= lastRowNumber;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    row.height = 27;

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = {
        name: 'Tahoma',
        size: 9,
        color: { argb: colors.text },
      };
      cell.alignment = {
        horizontal: 'right',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = thinBorder;

      if (rowNumber % 2 === 0) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colors.alternate },
        };
      }
    });
  }
}

function createFilterDescription(filters) {
  const descriptions = [];

  if (filters.startDate) {
    descriptions.push(`از تاریخ ${filters.startDate}`);
  }

  if (filters.endDate) {
    descriptions.push(`تا تاریخ ${filters.endDate}`);
  }

  if (filters.memberUsername !== 'all') {
    descriptions.push(
      `عضو: ${filters.memberUsername}`,
    );
  }

  if (filters.projectTitle !== 'all') {
    descriptions.push(
      `پروژه: ${filters.projectTitle}`,
    );
  }

  if (filters.status !== 'all') {
    descriptions.push(
      `وضعیت: ${
        statusLabels[filters.status] || filters.status
      }`,
    );
  }

  return descriptions.length
    ? descriptions.join(' | ')
    : 'تمام فعالیت‌ها بدون فیلتر';
}

function addReportInformation(
  worksheet,
  range,
  filters,
) {
  worksheet.mergeCells(range);

  const informationCell = worksheet.getCell(
    range.split(':')[0],
  );

  informationCell.value = `فیلتر گزارش: ${createFilterDescription(
    filters,
  )}`;

  informationCell.font = {
    name: 'Tahoma',
    size: 9,
    color: { argb: colors.muted },
  };

  informationCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: colors.primaryLight },
  };

  informationCell.alignment = {
    horizontal: 'right',
    vertical: 'middle',
  };

  worksheet.getRow(2).height = 28;
}

function downloadWorkbook(buffer) {
  const blob = new Blob([buffer], {
    type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const downloadUrl =
    window.URL.createObjectURL(blob);

  const downloadLink =
    document.createElement('a');

  const today = new Date()
    .toISOString()
    .slice(0, 10);

  downloadLink.href = downloadUrl;
  downloadLink.download =
    `team-worklog-report-${today}.xlsx`;

  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();

  window.URL.revokeObjectURL(downloadUrl);
}

export async function exportManagerExcel({
  entries,
  memberSummary,
  statistics,
  filters,
}) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'کارنما';
  workbook.company = 'کارنما';
  workbook.created = new Date();
  workbook.modified = new Date();

  const summarySheet = workbook.addWorksheet(
    'خلاصه اعضا',
    {
      views: [
        {
          state: 'frozen',
          ySplit: 4,
          rightToLeft: true,
        },
      ],
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    },
  );

  summarySheet.properties.defaultRowHeight = 22;
  summarySheet.columns = [
    { width: 28 },
    { width: 20 },
    { width: 16 },
    { width: 18 },
    { width: 24 },
    { width: 20 },
    { width: 25 },
  ];

  styleTitle(
    summarySheet,
    'A1:G1',
    'گزارش عملکرد و زمان اعضای تیم',
  );

  addReportInformation(
    summarySheet,
    'A2:G2',
    filters,
  );

  const summaryHeader = summarySheet.getRow(4);

  summaryHeader.values = [
    'نام عضو',
    'نام کاربری',
    'تعداد فعالیت',
    'کل زمان (دقیقه)',
    'کل زمان',
    'زمان تأییدشده (دقیقه)',
    'زمان تأیید نهایی',
  ];

  styleHeaderRow(summaryHeader);

  memberSummary.forEach((member) => {
    summarySheet.addRow([
      member.name,
      member.username,
      member.entryCount,
      member.totalMinutes,
      formatDuration(member.totalMinutes),
      member.approvedMinutes,
      formatDuration(member.approvedMinutes),
    ]);
  });

  const summaryFirstDataRow = 5;
  const summaryLastDataRow = summarySheet.rowCount;

  if (summaryLastDataRow >= summaryFirstDataRow) {
    styleDataRows(
      summarySheet,
      summaryFirstDataRow,
      summaryLastDataRow,
    );
  }

  const totalRow = summarySheet.addRow([
    'جمع کل گزارش',
    '',
    statistics.entryCount,
    statistics.totalMinutes,
    formatDuration(statistics.totalMinutes),
    statistics.approvedMinutes,
    formatDuration(statistics.approvedMinutes),
  ]);

  totalRow.height = 30;

  totalRow.eachCell(
    { includeEmpty: true },
    (cell) => {
      cell.font = {
        name: 'Tahoma',
        size: 10,
        bold: true,
        color: { argb: colors.green },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colors.greenLight },
      };
      cell.alignment = {
        horizontal: 'right',
        vertical: 'middle',
      };
      cell.border = thinBorder;
    },
  );

  summarySheet.autoFilter = {
    from: 'A4',
    to: `G${Math.max(
      4,
      summaryLastDataRow,
    )}`,
  };

  const detailsSheet = workbook.addWorksheet(
    'جزئیات فعالیت‌ها',
    {
      views: [
        {
          state: 'frozen',
          ySplit: 4,
          rightToLeft: true,
        },
      ],
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    },
  );

  detailsSheet.properties.defaultRowHeight = 22;
  detailsSheet.columns = [
    { width: 27 },
    { width: 20 },
    { width: 30 },
    { width: 42 },
    { width: 25 },
    { width: 16 },
    { width: 15 },
    { width: 17 },
    { width: 15 },
    { width: 20 },
  ];

  styleTitle(
    detailsSheet,
    'A1:J1',
    'جزئیات فعالیت‌های ثبت‌شده',
  );

  addReportInformation(
    detailsSheet,
    'A2:J2',
    filters,
  );

  const detailsHeader = detailsSheet.getRow(4);

  detailsHeader.values = [
    'نام عضو',
    'نام کاربری',
    'عنوان فعالیت',
    'توضیحات',
    'پروژه',
    'تاریخ',
    'روش ثبت',
    'مدت (دقیقه)',
    'تعداد تأیید',
    'وضعیت',
  ];

  styleHeaderRow(detailsHeader);

  entries.forEach((entry) => {
    detailsSheet.addRow([
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
      entry.approval_count ?? 0,
      statusLabels[entry.status] || entry.status,
    ]);
  });

  const detailsFirstDataRow = 5;
  const detailsLastDataRow = detailsSheet.rowCount;

  if (detailsLastDataRow >= detailsFirstDataRow) {
    styleDataRows(
      detailsSheet,
      detailsFirstDataRow,
      detailsLastDataRow,
    );

    for (
      let rowNumber = detailsFirstDataRow;
      rowNumber <= detailsLastDataRow;
      rowNumber += 1
    ) {
      const statusCell =
        detailsSheet.getCell(`J${rowNumber}`);

      const entry =
        entries[rowNumber - detailsFirstDataRow];

      const statusColor =
        entry.status === 'approved'
          ? colors.greenLight
          : entry.status === 'rejected'
            ? colors.redLight
            : colors.yellowLight;

      statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: statusColor },
      };

      statusCell.font = {
        name: 'Tahoma',
        size: 9,
        bold: true,
        color: {
          argb:
            entry.status === 'approved'
              ? colors.green
              : colors.text,
        },
      };
    }
  }

  detailsSheet.autoFilter = {
    from: 'A4',
    to: `J${Math.max(
      4,
      detailsLastDataRow,
    )}`,
  };

  const workbookBuffer =
    await workbook.xlsx.writeBuffer();

  downloadWorkbook(workbookBuffer);
}
