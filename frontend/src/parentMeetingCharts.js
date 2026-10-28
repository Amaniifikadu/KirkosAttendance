export function attendancePercentage(present, totalStudents) {
  if (!Number.isFinite(present) || !Number.isFinite(totalStudents) || totalStudents <= 0) {
    return 0;
  }
  return Number(((present / totalStudents) * 100).toFixed(1));
}

export function buildClassBars(classes, width) {
  const chartHeight = 170;
  const barWidth = Math.min(34, Math.max(12, 420 / Math.max(classes.length, 1)));
  const step = (width - 80) / Math.max(classes.length, 1);
  return classes.map((item, index) => {
    const percentage = attendancePercentage(item.present, item.totalStudents);
    const height = percentage / 100 * chartHeight;
    return {
      classId: item.classId,
      classNumber: item.classNumber,
      className: item.name,
      percentage,
      x: 56 + index * step,
      y: chartHeight - height + 10,
      width: barWidth,
      height,
    };
  });
}

export function buildMonthlyTrendPoints(trend) {
  return trend.map((item, index) => ({
    month: item.academicMonth,
    label: item.monthName,
    x: 35 + index * 58,
    y: 160 - attendancePercentage(item.present, item.totalStudents) * 1.35,
    percentage: attendancePercentage(item.present, item.totalStudents),
  }));
}

export function buildAttendanceSlices(summary) {
  const items = [
    { key: "present", label: "Present", value: summary.present, color: "#2f855a" },
    { key: "absent", label: "Absent", value: summary.absent, color: "#c53030" },
    { key: "permission", label: "Permission", value: summary.permission, color: "#b7791f" },
    { key: "notRecorded", label: "Not recorded", value: summary.notRecorded, color: "#718096" },
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let start = 0;
  return items.map((item, index) => {
    const percentage = total ? item.value / total * 100 : 0;
    const end = total
      ? index === items.length - 1
        ? 100
        : Number((start + percentage).toFixed(10))
      : start;
    const slice = { ...item, percentage, start, end };
    start = end;
    return slice;
  });
}
