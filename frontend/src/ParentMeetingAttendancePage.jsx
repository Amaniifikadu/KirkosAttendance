import { useEffect, useRef, useState } from "react";
import {
  ETHIOPIAN_MONTHS,
  ethiopianToGregorian,
  getEthiopianSundays,
  gregorianToEthiopian,
  isEthiopianSunday,
  localTodayAsGregorian,
  nextSundayAsEthiopian,
} from "./ethiopianCalendar";
import {
  attendancePercentage,
  buildAttendanceSlices,
  buildClassBars,
  buildMonthlyTrendPoints,
} from "./parentMeetingCharts";
import {
  moveStatusCount,
  persistInlineStatusChange,
} from "./parentMeetingAttendance";
import { apiFetch } from "./apiClient";
import { reportRefreshInterval, scheduleReportRefresh } from "./reportRefresh";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

async function apiRequest(path, token, options = {}) {
  const response = await apiFetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }
  return payload;
}

function SummaryCard({ label, value, tone = "" }) {
  return (
    <article className={`summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatEthiopianDate(gregorianDate) {
  const { year, month, day } = gregorianToEthiopian(gregorianDate);
  return `${day} ${ETHIOPIAN_MONTHS[month - 1]} ${year} ዓ.ም.`;
}

function numberOfDays({ year, month }) {
  return month === 13 ? (year % 4 === 3 ? 6 : 5) : 30;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function ClassAttendanceChart({ classes }) {
  const width = Math.max(480, classes.length * 64);
  const chartHeight = 170;
  const bars = buildClassBars(classes, width);
  return (
    <div className="parent-chart-scroll">
      <svg
        className="parent-bar-chart"
        viewBox={`0 0 ${width} 220`}
        role="img"
        aria-label="Attendance percentage by class"
      >
        {[0, 25, 50, 75, 100].map((value) => {
          const y = chartHeight - (value / 100) * chartHeight + 10;
          return (
            <g key={value}>
              <line x1="42" x2={width - 10} y1={y} y2={y} />
              <text x="34" y={y + 4} textAnchor="end">{value}%</text>
            </g>
          );
        })}
        {bars.map((bar) => {
          return (
            <g key={bar.classId}>
              <title>{`Class ${bar.classNumber} · ${bar.className}`}</title>
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx="4"
              />
              <text x={bar.x + bar.width / 2} y="202" textAnchor="middle">
                {bar.classNumber}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AttendancePie({ summary }) {
  const values = buildAttendanceSlices(summary);
  const stops = values.map(({ color, start, end }) => `${color} ${start}% ${end}%`);
  return (
    <div className="parent-pie-wrap">
      <div
        className="parent-pie-chart"
        role="img"
        aria-label={`Attendance statuses: ${values.map(({ label, value }) => `${label} ${value}`).join(", ")}`}
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      />
      <ul className="chart-legend">
        {values.map((item) => (
          <li key={item.key}>
            <span style={{ backgroundColor: item.color }} />
            {item.label}: {item.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EthiopianDateFields({
  value,
  onChange,
  legend,
  allowHistoricalNonSunday = false,
}) {
  const change = (field, rawValue) => {
    const next = { ...value, [field]: Number(rawValue) };
    if (field === "year" || field === "month") {
      next.day = Math.min(next.day, numberOfDays(next));
    }
    onChange(next);
  };

  return (
    <fieldset className="ethiopian-date-picker">
      <legend>{legend}</legend>
      <label>
        Year · ዓ.ም.
        <input
          type="number"
          min="1000"
          max="9999"
          value={value.year}
          onChange={(event) => change("year", event.target.value)}
        />
      </label>
      <label>
        Month
        <select
          value={value.month}
          onChange={(event) => change("month", event.target.value)}
        >
          {ETHIOPIAN_MONTHS.map((month, index) => (
            <option value={index + 1} key={month}>
              {month}
            </option>
          ))}
        </select>
      </label>
      <label>
        Day
        <select
          value={value.day}
          onChange={(event) => change("day", event.target.value)}
        >
          {(allowHistoricalNonSunday && !isEthiopianSunday(value)
            ? [value.day, ...getEthiopianSundays(value)]
            : getEthiopianSundays(value)
          ).map((day) => (
              <option
                value={day}
                key={day}
                disabled={day === value.day && !isEthiopianSunday(value)}
              >
                {day}
                {day === value.day && !isEthiopianSunday(value)
                  ? " · historical date (not valid for updates)"
                  : ""}
              </option>
            ))}
        </select>
      </label>
    </fieldset>
  );
}

export default function ParentMeetingAttendancePage({ token, role = "admin" }) {
  const [date, setDate] = useState(() =>
    nextSundayAsEthiopian(localTodayAsGregorian())
  );
  const [academicYear, setAcademicYear] = useState(date.year);
  const [academicMonth, setAcademicMonth] = useState(date.month);
  const [meetings, setMeetings] = useState([]);
  const [meetingId, setMeetingId] = useState("");
  const [historyTarget, setHistoryTarget] = useState("");
  const [editingMeeting, setEditingMeeting] = useState(null);
  const [editMeetingDate, setEditMeetingDate] = useState(null);
  const [students, setStudents] = useState([]);
  const [report, setReport] = useState(null);
  const [reportPeriod, setReportPeriod] = useState("month");
  const [annualClassNumber, setAnnualClassNumber] = useState("");
  const [annualReport, setAnnualReport] = useState(null);
  const [annualReportBusy, setAnnualReportBusy] = useState(false);
  const [followUps, setFollowUps] = useState([]);
  const [followUpPagination, setFollowUpPagination] = useState({
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 0,
  });
  const [followUpPage, setFollowUpPage] = useState(1);
  const [reportRevision, setReportRevision] = useState(0);
  const [classNumber, setClassNumber] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editingStudentIds, setEditingStudentIds] = useState([]);
  const [statusSavingStudentIds, setStatusSavingStudentIds] = useState([]);
  const statusUpdatesInProgress = useRef(new Set());
  const [rosterRevision, setRosterRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  let canonicalDate = "";
  let dateError = "";
  try {
    canonicalDate = ethiopianToGregorian(date);
    if (!isEthiopianSunday(date)) {
      dateError = "Parent meetings can only be scheduled on Sundays.";
    }
  } catch (dateValidationError) {
    dateError = dateValidationError.message;
  }
  let canonicalEditDate = "";
  let editDateError = "";
  if (editMeetingDate) {
    try {
      canonicalEditDate = ethiopianToGregorian(editMeetingDate);
      if (!isEthiopianSunday(editMeetingDate)) {
        editDateError = "Parent meetings can only be moved to Sundays.";
      }
    } catch (dateValidationError) {
      editDateError = dateValidationError.message;
    }
  }

  async function refreshMeetings(
    preferredId = "",
    reportYear = academicYear,
    reportMonth = academicMonth
  ) {
    const params = new URLSearchParams({
      academicYear: String(reportYear),
      academicMonth: String(reportMonth),
    });
    const payload = await apiRequest(`/api/parent-meetings?${params}`, token);
    setMeetings(payload.meetings);
    const selectedId =
      preferredId && payload.meetings.some(({ _id }) => _id === preferredId)
        ? preferredId
        : payload.meetings[0]?._id || "";
    setMeetingId(selectedId);
  }

  useEffect(() => {
    let active = true;
    setError("");
    const params = new URLSearchParams({
      academicYear: String(academicYear),
      academicMonth: String(academicMonth),
    });
    apiRequest(`/api/parent-meetings?${params}`, token)
      .then((payload) => {
        if (!active) return;
        setMeetings(payload.meetings);
        if (historyTarget && payload.meetings.some(({ _id }) => _id === historyTarget)) {
          setMeetingId(historyTarget);
          setHistoryTarget("");
        } else {
          setMeetingId((current) =>
            payload.meetings.some(({ _id }) => _id === current)
              ? current
              : payload.meetings[0]?._id || ""
          );
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, [token, academicYear, academicMonth, historyTarget]);

  useEffect(() => {
    if (!token) return undefined;
    return scheduleReportRefresh(async () => {
      if (reportPeriod === "year" && annualReport) {
        const annualParams = new URLSearchParams({
          academicYear: String(academicYear),
        });
        if (annualClassNumber) {
          annualParams.set("classNumber", annualClassNumber);
        }
        try {
          const payload = await apiRequest(
            `/api/parent-meetings/annual-report?${annualParams}`,
            token
          );
          setAnnualReport(payload);
        } catch (requestError) {
          setError(`Could not refresh the latest report: ${requestError.message}`);
        }
        return;
      }

      const params = new URLSearchParams({
        academicYear: String(academicYear),
        academicMonth: String(academicMonth),
      });
      try {
        const payload = await apiRequest(`/api/parent-meetings?${params}`, token);
        setMeetings(payload.meetings);
        setMeetingId((current) =>
          payload.meetings.some(({ _id }) => _id === current)
            ? current
            : payload.meetings[0]?._id || ""
        );
        setReportRevision((revision) => revision + 1);
      } catch (requestError) {
        setError(`Could not refresh the latest report: ${requestError.message}`);
      }
    }, { intervalMs: reportRefreshInterval() });
  }, [
    token,
    academicYear,
    academicMonth,
    reportPeriod,
    annualClassNumber,
    Boolean(annualReport),
  ]);

  useEffect(() => {
    if (!meetingId) {
      setReport(null);
      setFollowUps([]);
      return undefined;
    }
    let active = true;
    const reportParams = new URLSearchParams();
    if (classNumber) reportParams.set("classNumber", classNumber);
    const reportQuery = reportParams.toString();
    const suffix = reportQuery ? `?${reportQuery}` : "";
    const followUpParams = new URLSearchParams({
      page: String(followUpPage),
      pageSize: "100",
    });
    if (classNumber) followUpParams.set("classNumber", classNumber);
    Promise.all([
      apiRequest(`/api/parent-meetings/${meetingId}/report${suffix}`, token),
      apiRequest(`/api/parent-meetings/${meetingId}/follow-ups?${followUpParams}`, token),
    ])
      .then(([reportPayload, followUpPayload]) => {
        if (!active) return;
        setReport(reportPayload);
        setFollowUps(followUpPayload.followUps);
        setFollowUpPagination(followUpPayload.pagination);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, [token, meetingId, classNumber, followUpPage, reportRevision]);

  useEffect(() => {
    if (!meetingId || !classNumber) {
      setStudents([]);
      setPagination({ page: 1, pageSize: 100, total: 0, totalPages: 0 });
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "100",
    });
    if (classNumber) params.set("classNumber", classNumber);
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter) params.set("status", statusFilter);
    apiRequest(
      `/api/parent-meetings/${meetingId}/attendance?${params}`,
      token
    )
      .then((payload) => {
        if (active) {
          setStudents(payload.students);
          setPagination(payload.pagination);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.message);
          setStudents([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, meetingId, page, classNumber, search, statusFilter, rosterRevision]);

  const selectedMeeting = meetings.find(({ _id }) => _id === meetingId);
  function updateStudent(studentId, field, value) {
    setStudents((current) =>
      current.map((student) =>
        student.studentId === studentId
          ? { ...student, [field]: value }
          : student
      )
    );
  }

  function updateClassFilter(value) {
    setClassNumber(value);
    setPage(1);
    setFollowUpPage(1);
  }

  function toggleStudentEdit(studentId) {
    setEditingStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  }

  async function saveStudentStatus(student, status) {
    const { studentId } = student;
    if (
      student.status === status ||
      statusUpdatesInProgress.current.has(studentId)
    ) {
      return;
    }

    const previousStatus = student.status;
    statusUpdatesInProgress.current.add(studentId);
    setStatusSavingStudentIds((current) => [...current, studentId]);
    setError("");
    setNotice("");
    try {
      await persistInlineStatusChange({
        previousStatus,
        nextStatus: status,
        onStatusChange: (nextStatus) =>
          updateStudent(studentId, "status", nextStatus),
        save: (nextStatus) =>
          apiRequest(
            `/api/parent-meetings/${meetingId}/attendance`,
            token,
            {
              method: "PUT",
              body: JSON.stringify({
                statuses: [{ studentId, status: nextStatus }],
              }),
            }
          ),
      });
      setReport((current) => {
        if (!current) return current;
        const classes = current.classes.map((item) => {
          if (item.classNumber !== student.classNumber) return item;
          const updatedCounts = moveStatusCount(item, previousStatus, status);
          return {
            ...updatedCounts,
            attendancePercentage: item.totalStudents
              ? Number(((updatedCounts.present / item.totalStudents) * 100).toFixed(1))
              : 0,
          };
        });
        return {
          ...current,
          summary: moveStatusCount(current.summary, previousStatus, status),
          classes,
        };
      });
      setMeetings((current) =>
        current.map((meeting) =>
          meeting._id === meetingId
            ? {
                ...meeting,
                summary: moveStatusCount(meeting.summary, previousStatus, status),
              }
            : meeting
        )
      );
      setNotice(`${student.studentName}'s parent status saved.`);
      setReportRevision((revision) => revision + 1);
      setRosterRevision((revision) => revision + 1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      statusUpdatesInProgress.current.delete(studentId);
      setStatusSavingStudentIds((current) =>
        current.filter((id) => id !== studentId)
      );
    }
  }

  async function deleteStudentAttendance(student) {
    const confirmed = window.confirm(
      `Remove only ${student.studentName}'s parent-meeting attendance record? The student and lesson records will remain unchanged.`
    );
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(
        `/api/parent-meetings/${meetingId}/attendance/${student.studentId}`,
        token,
        { method: "DELETE" }
      );
      setNotice("Parent-meeting attendance record removed.");
      setReportRevision((revision) => revision + 1);
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "100",
      });
      if (classNumber) params.set("classNumber", classNumber);
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      const payload = await apiRequest(
        `/api/parent-meetings/${meetingId}/attendance?${params}`,
        token
      );
      setStudents(payload.students);
      setPagination(payload.pagination);
      setEditingStudentIds((current) =>
        current.filter((id) => id !== student.studentId)
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel(exportClassNumber = "") {
    setReportBusy(true);
    setError("");
    try {
      const classQuery = exportClassNumber
        ? `?classNumber=${encodeURIComponent(exportClassNumber)}`
        : "";
      const response = await apiFetch(
        `${API_BASE_URL}/api/parent-meetings/${meetingId}/export.xlsx${classQuery}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `Export failed (${response.status}).`);
      }
      const file = await response.blob();
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = exportClassNumber
        ? `parent-meeting-class-${exportClassNumber}-${academicYear}-${academicMonth}.xlsx`
        : `parent-meeting-all-classes-${academicYear}-${academicMonth}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setNotice("Excel report downloaded.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReportBusy(false);
    }
  }

  async function exportPdf(exportClassNumber = "") {
    setReportBusy(true);
    setError("");
    try {
      const classQuery = exportClassNumber
        ? `?classNumber=${encodeURIComponent(exportClassNumber)}`
        : "";
      const response = await apiFetch(
        `${API_BASE_URL}/api/parent-meetings/${meetingId}/export.pdf${classQuery}`,
        { headers: { Authorization: "Bearer " + token } }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `PDF export failed (${response.status}).`);
      }
      const file = await response.blob();
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = exportClassNumber
        ? `parent-meeting-class-${exportClassNumber}-${academicYear}-${academicMonth}.pdf`
        : `parent-meeting-all-classes-${academicYear}-${academicMonth}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setNotice("PDF report downloaded.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReportBusy(false);
    }
  }

  async function generateAnnualReport() {
    setAnnualReportBusy(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({
        academicYear: String(academicYear),
      });
      if (annualClassNumber) params.set("classNumber", annualClassNumber);
      const result = await apiRequest(
        `/api/parent-meetings/annual-report?${params}`,
        token
      );
      setAnnualReport(result);
      setNotice("Annual report generated.");
    } catch (requestError) {
      setError(requestError.message);
      setAnnualReport(null);
    } finally {
      setAnnualReportBusy(false);
    }
  }

  async function exportAnnualReport(format) {
    setReportBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        academicYear: String(annualReport.academicYear),
      });
      if (annualReport.classNumber) {
        params.set("classNumber", String(annualReport.classNumber));
      }
      const response = await apiFetch(
        `${API_BASE_URL}/api/parent-meetings/annual-report/export.${format}?${params}`,
        { headers: { Authorization: "Bearer " + token } }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `Annual export failed (${response.status}).`);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `parent-meeting-annual-${annualReport.academicYear}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setNotice(`Annual ${format.toUpperCase()} report downloaded.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReportBusy(false);
    }
  }

  function updateSearch(value) {
    setSearch(value);
    setPage(1);
  }

  function updateStatusFilter(value) {
    setStatusFilter(value);
    setPage(1);
  }

  async function createMeeting() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const dateParts = gregorianToEthiopian(canonicalDate);
      const payload = await apiRequest("/api/parent-meetings", token, {
        method: "POST",
        body: JSON.stringify({
          meetingDate: canonicalDate,
          academicYear: dateParts.year,
          academicMonth: dateParts.month,
        }),
      });
      setAcademicYear(dateParts.year);
      setAcademicMonth(dateParts.month);
      setClassNumber("");
      setSearch("");
      setPage(1);
      await refreshMeetings(
        payload.meeting._id,
        dateParts.year,
        dateParts.month
      );
      setNotice("Meeting created. Select a class or record attendance.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveAttendance() {
    if (!meetingId || statusUpdatesInProgress.current.size > 0) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = await apiRequest(
        `/api/parent-meetings/${meetingId}/attendance`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({
            statuses: students.map((student) => ({
              studentId: student.studentId,
              status: student.status,
              guardianName: student.guardianName,
              notes: student.notes,
            })),
          }),
        }
      );
      setNotice(payload.message);
      setEditingStudentIds([]);
      await refreshMeetings(meetingId);
      setReportRevision((revision) => revision + 1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function beginMeetingEdit(meeting) {
    setEditingMeeting(meeting);
    setEditMeetingDate(gregorianToEthiopian(meeting.meetingDate));
    setError("");
    setNotice("");
  }

  async function updateMeeting(event) {
    event.preventDefault();
    if (!editingMeeting) return;
    setReportBusy(true);
    setError("");
    setNotice("");
    try {
      const dateParts = gregorianToEthiopian(canonicalEditDate);
      await apiRequest(`/api/parent-meetings/${editingMeeting._id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          meetingDate: canonicalEditDate,
          academicYear: dateParts.year,
          academicMonth: dateParts.month,
        }),
      });
      setAcademicYear(dateParts.year);
      setAcademicMonth(dateParts.month);
      setEditingMeeting(null);
      setNotice("Meeting date updated.");
      try {
        await refreshMeetings(
          editingMeeting._id,
          dateParts.year,
          dateParts.month
        );
      } catch (refreshError) {
        setError(
          `Meeting was updated, but the report could not be refreshed: ${refreshError.message}`
        );
      }
    } catch (requestError) {
      setError(requestError.message || editDateError);
    } finally {
      setReportBusy(false);
    }
  }

  async function deleteMeeting(meeting) {
    const confirmed = window.confirm(
      `Delete the parent meeting on ${formatEthiopianDate(meeting.meetingDate)} and only its parent-meeting attendance records? Student records and lesson attendance will not be affected.`
    );
    if (!confirmed) return;

    setReportBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = await apiRequest(
        `/api/parent-meetings/${meeting._id}`,
        token,
        { method: "DELETE" }
      );
      setNotice(payload.message);
      if (editingMeeting?._id === meeting._id) setEditingMeeting(null);
      try {
        await refreshMeetings(meetingId === meeting._id ? "" : meetingId);
      } catch (refreshError) {
        setError(
          `Meeting was deleted, but the report could not be refreshed: ${refreshError.message}`
        );
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReportBusy(false);
    }
  }

  const summary = selectedMeeting?.summary || {
    totalStudents: 0,
    present: 0,
    absent: 0,
    permission: 0,
    notRecorded: 0,
  };
  const classSummaries = report?.classes || [];
  const rankedClasses = classSummaries.filter((item) => item.totalStudents > 0);
  const bestClass = [...rankedClasses].sort(
    (left, right) => right.attendancePercentage - left.attendancePercentage
  )[0];
  const lowestClass = [...rankedClasses].sort(
    (left, right) => left.attendancePercentage - right.attendancePercentage
  )[0];
  const reportSummary = report?.summary || summary;
  const overallAttendance = attendancePercentage(
    reportSummary.present,
    reportSummary.totalStudents
  );
  const selectedClassHistory = classNumber
    ? Object.values(report?.meetingHistory || {}).flat()
    : [];
  const printDate = selectedMeeting
    ? formatEthiopianDate(selectedMeeting.meetingDate)
    : `${ETHIOPIAN_MONTHS[academicMonth - 1]} ${academicYear} ዓ.ም.`;

  return (
    <section className="panel parent-meeting-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">FAMILY ENGAGEMENT</p>
          <h2>Parents' Meeting Attendance</h2>
          <p className="muted">
            Meeting records are separate from lesson and weekend attendance.
          </p>
        </div>
      </div>

      {role === "admin" && <section className="meeting-controls" aria-label="Meeting selection">
        <EthiopianDateFields
          value={date}
          onChange={setDate}
          legend="New meeting date · Ethiopian calendar (ዓ.ም.)"
        />
        <button
          className="secondary"
          onClick={createMeeting}
          disabled={saving || Boolean(dateError)}
        >
          Create meeting
        </button>
        {dateError && <p className="notice error">{dateError}</p>}
      </section>}

      {reportPeriod === "month" && <section className="panel monthly-meeting-report">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MONTHLY REPORT</p>
            <h2>
              {ETHIOPIAN_MONTHS[academicMonth - 1]} {academicYear} ·{" "}
              {meetings.length} meeting{meetings.length === 1 ? "" : "s"}
            </h2>
          </div>
        </div>
        {meetings.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Meeting date</th>
                  <th>Total students</th>
                  <th>Present</th>
                  <th>Absent</th>
                  <th>Permission</th>
                  <th>Not recorded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((meeting) => (
                  <tr key={meeting._id}>
                    <td>
                      <button
                        className="meeting-date-button"
                        type="button"
                        aria-current={meeting._id === meetingId ? "true" : undefined}
                        onClick={() => setMeetingId(meeting._id)}
                      >
                        {formatEthiopianDate(meeting.meetingDate)}
                      </button>
                    </td>
                    <td>{meeting.summary.totalStudents}</td>
                    <td>{meeting.summary.present}</td>
                    <td>{meeting.summary.absent}</td>
                    <td>{meeting.summary.permission}</td>
                    <td>{meeting.summary.notRecorded}</td>
                    <td>
                      {meeting.deletionState === "deleting" && (
                        <span className="notice warning" role="status">
                          Deletion incomplete
                        </span>
                      )}
                      {role === "admin" && <div className="meeting-row-actions">
                          <button
                            className="secondary"
                            type="button"
                            disabled={reportBusy || meeting.deletionState === "deleting"}
                            onClick={() => beginMeetingEdit(meeting)}
                          >
                            Edit
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            disabled={reportBusy}
                            onClick={() => deleteMeeting(meeting)}
                          >
                            {meeting.deletionState === "deleting" ? "Retry delete" : "Delete"}
                          </button>
                        </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No parent meetings recorded for this month.</p>
        )}
      </section>}

      <div className="meeting-report-filters">
        <label>
          Report period
          <select
            value={reportPeriod}
            onChange={(event) => {
              setReportPeriod(event.target.value);
              setAnnualReport(null);
              setAnnualClassNumber("");
            }}
          >
            <option value="month">Individual month</option>
            <option value="year">All Months — Annual Report</option>
          </select>
        </label>
        <label>
          Report · Ethiopian year
          <input
            type="number"
            min="1000"
            max="9999"
            value={academicYear}
            onChange={(event) => setAcademicYear(Number(event.target.value))}
          />
        </label>
        {reportPeriod === "month" && <label>
          Report · month
          <select
            value={academicMonth}
            onChange={(event) => setAcademicMonth(Number(event.target.value))}
          >
            {ETHIOPIAN_MONTHS.map((month, index) => (
              <option value={index + 1} key={month}>
                {month}
              </option>
            ))}
          </select>
        </label>}
        {reportPeriod === "month" && <label>
          Meeting date
          <select
            value={meetingId}
            onChange={(event) => setMeetingId(event.target.value)}
          >
            <option value="">Select a meeting</option>
            {meetings.map((meeting) => (
              <option value={meeting._id} key={meeting._id}>
                {formatEthiopianDate(meeting.meetingDate)}
              </option>
            ))}
          </select>
        </label>}
        {reportPeriod === "year" && (
          <>
            <label>
              Annual report class
              <select
                value={annualClassNumber}
                onChange={(event) => setAnnualClassNumber(event.target.value)}
              >
                <option value="">All Classes</option>
                {(classSummaries.length ? classSummaries : annualReport?.classes || [])
                  .map((item) => (
                    <option value={item.classNumber} key={item.classNumber}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              onClick={generateAnnualReport}
              disabled={annualReportBusy || !Number.isInteger(academicYear) || academicYear < 1000 || academicYear > 9999}
            >
              {annualReportBusy ? "Generating…" : "Generate Annual Report"}
            </button>
          </>
        )}
      </div>

      {reportPeriod === "month" && <section className="attendance-counts" aria-label="Selected meeting totals">
        <SummaryCard label="Total students" value={reportSummary.totalStudents} />
        <SummaryCard label="Present" value={reportSummary.present} tone="good" />
        <SummaryCard label="Absent" value={reportSummary.absent} tone="bad" />
        <SummaryCard label="Permission" value={reportSummary.permission} tone="permission" />
        <SummaryCard label="Not recorded" value={reportSummary.notRecorded} tone="warn" />
        <SummaryCard label="Overall attendance" value={formatPercent(overallAttendance)} />
        <SummaryCard label="Best performing class" value={bestClass?.name || "—"} tone="good" />
        <SummaryCard label="Lowest attendance class" value={lowestClass?.name || "—"} tone="bad" />
        <SummaryCard label="Completed meetings this year" value={report?.completedMeetingCount || 0} />
        <SummaryCard
          label="Selected Ethiopian month"
          value={`${ETHIOPIAN_MONTHS[(report?.currentEthiopianMonth || academicMonth) - 1]} ${report?.meeting?.academicYear || academicYear}`}
        />
      </section>}

      {annualReport && reportPeriod === "year" && (
        <section className="panel annual-report-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ANNUAL REPORT</p>
              <h2>
                {annualReport.selectedClassName} · {annualReport.academicYear} ዓ.ም.
              </h2>
              <p className="muted">
                Attendance percentage uses the sum of student-meeting opportunities,
                not an average of monthly percentages.
              </p>
            </div>
            {role === "admin" && (
              <div className="meeting-row-actions report-export-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={reportBusy}
                  onClick={() => exportAnnualReport("pdf")}
                >
                  Export Annual PDF
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={reportBusy}
                  onClick={() => exportAnnualReport("xlsx")}
                >
                  Export Annual Excel
                </button>
              </div>
            )}
          </div>
          <div className="attendance-counts">
            <SummaryCard label="Meetings" value={annualReport.summary.meetingCount} />
            <SummaryCard label="Unique students" value={annualReport.summary.totalStudents} />
            <SummaryCard label="Student-meeting records" value={annualReport.summary.totalStudentMeetings} />
            <SummaryCard label="Present" value={annualReport.summary.present} tone="good" />
            <SummaryCard label="Absent" value={annualReport.summary.absent} tone="bad" />
            <SummaryCard label="Permission" value={annualReport.summary.permission} tone="permission" />
            <SummaryCard label="Not recorded" value={annualReport.summary.notRecorded} tone="warn" />
            <SummaryCard label="Attendance" value={`${annualReport.summary.attendancePercentage}%`} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ethiopian month</th>
                  <th>Meetings</th>
                  <th>Unique students</th>
                  <th>Student-meeting records</th>
                  <th>Present</th>
                  <th>Absent</th>
                  <th>Permission</th>
                  <th>Not recorded</th>
                  <th>Attendance %</th>
                </tr>
              </thead>
              <tbody>
                {annualReport.monthly.map((item) => (
                  <tr key={item.academicMonth}>
                    <td>{ETHIOPIAN_MONTHS[item.academicMonth - 1]}</td>
                    <td>{item.meetingCount}</td>
                    <td>{item.totalStudents}</td>
                    <td>{item.totalStudentMeetings}</td>
                    <td>{item.present}</td>
                    <td>{item.absent}</td>
                    <td>{item.permission}</td>
                    <td>{item.notRecorded}</td>
                    <td>{item.attendancePercentage}%</td>
                  </tr>
                ))}
                <tr className="annual-total-row">
                  <th>Annual total</th>
                  <td>{annualReport.summary.meetingCount}</td>
                  <td>{annualReport.summary.totalStudents}</td>
                  <td>{annualReport.summary.totalStudentMeetings}</td>
                  <td>{annualReport.summary.present}</td>
                  <td>{annualReport.summary.absent}</td>
                  <td>{annualReport.summary.permission}</td>
                  <td>{annualReport.summary.notRecorded}</td>
                  <td>{annualReport.summary.attendancePercentage}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report && reportPeriod === "month" && (
        <>
          <section className="panel parent-report-visuals" aria-label="Meeting charts">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MEETING ANALYTICS</p>
                <h2>Class comparison and attendance mix</h2>
              </div>
              {role === "admin" && (
                <div className="meeting-row-actions report-export-actions">
                  <button className="secondary" type="button" disabled={reportBusy} onClick={exportExcel}>
                    Export Excel
                  </button>
                  <button className="secondary" type="button" disabled={reportBusy} onClick={() => exportPdf()}>
                    Export PDF
                  </button>
                </div>
              )}
            </div>
            <div className="parent-chart-grid">
              <div>
                <h3>Attendance by class</h3>
                <ClassAttendanceChart classes={classSummaries} />
              </div>
              <div>
                <h3>Attendance status distribution</h3>
                <AttendancePie summary={reportSummary} />
              </div>
            </div>
            <div className="parent-trend">
              <h3>Monthly attendance trend · {report.meeting.academicYear} ዓ.ም.</h3>
              <div className="parent-trend-scroll">
                <svg viewBox="0 0 780 200" role="img" aria-label="Monthly attendance trend">
                  <polyline
                    points={report.trend.map((item, index) => {
                      const x = 35 + index * 58;
                      const y = 160 - item.attendancePercentage * 1.35;
                      return `${x},${y}`;
                    }).join(" ")}
                  />
                  {buildMonthlyTrendPoints(report.trend).map((point) => (
                    <g key={point.month}>
                      <circle cx={point.x} cy={point.y} r="4" />
                      <text x={point.x} y="187" textAnchor="middle">
                        {ETHIOPIAN_MONTHS[point.month - 1]}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          </section>

          <section className="panel class-summary-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">CLASS-WISE REPORT</p>
                <h2>Meeting on {printDate}</h2>
              </div>
              {role === "admin" && (
                <div className="meeting-row-actions report-export-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={reportBusy}
                    onClick={() => exportPdf()}
                  >
                    Export All Classes PDF
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={reportBusy}
                    onClick={() => exportExcel()}
                  >
                    Export All Classes Excel
                  </button>
                </div>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Class</th><th>Total</th><th>Present</th><th>Absent</th>
                    <th>Permission</th><th>Not recorded</th><th>Attendance %</th><th>Quick actions</th>
                  </tr>
                </thead>
                <tbody>
                  {classSummaries.map((item) => (
                    <tr key={item.classId}>
                      <td>
                        <button
                          type="button"
                          className="meeting-date-button"
                          aria-pressed={String(item.classNumber) === classNumber}
                          onClick={() => updateClassFilter(String(item.classNumber))}
                        >
                          {item.name}
                        </button>
                      </td>
                      <td>{item.totalStudents}</td><td>{item.present}</td>
                      <td>{item.absent}</td><td>{item.permission}</td>
                      <td>{item.notRecorded}</td>
                      <td>{formatPercent(attendancePercentage(item.present, item.totalStudents))}</td>
                      <td>
                        <div className="meeting-row-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => updateClassFilter(String(item.classNumber))}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              updateClassFilter(String(item.classNumber));
                              window.setTimeout(() => {
                                document.getElementById("parent-meeting-details")?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                              }, 0);
                            }}
                          >
                            Edit
                          </button>
                          {role === "admin" && (
                            <>
                              <button
                                type="button"
                                className="secondary"
                                disabled={reportBusy}
                                onClick={() => exportPdf(String(item.classNumber))}
                              >
                                PDF
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={reportBusy}
                                onClick={() => exportExcel(String(item.classNumber))}
                              >
                                Excel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!classSummaries.length && <p className="muted">No classes are assigned or enrolled.</p>}
            </div>
          </section>

          {classNumber && (
            <section className="panel class-history-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">MEETING HISTORY</p>
                  <h2>
                    {classSummaries.find(
                      (item) => item.classNumber === Number(classNumber)
                    )?.name || `Class ${classNumber}`} timeline
                  </h2>
                </div>
              </div>
              <div className="meeting-history-list">
                {selectedClassHistory.map((historyMeeting) => (
                  <button
                    type="button"
                    className="secondary"
                    key={historyMeeting._id}
                    onClick={() => {
                      setHistoryTarget(historyMeeting._id);
                      setAcademicYear(historyMeeting.academicYear);
                      setAcademicMonth(historyMeeting.academicMonth);
                      setMeetingId(historyMeeting._id);
                    }}
                  >
                    {formatEthiopianDate(historyMeeting.meetingDate)}
                  </button>
                ))}
                {!selectedClassHistory.length && <p className="muted">No earlier meetings in this academic year.</p>}
              </div>
            </section>
          )}

          <section className="panel follow-up-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">FOLLOW-UP REQUIRED</p>
                <h2>Absent, permission, and repeat-absence list</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Class</th><th>Student Number</th><th>Student</th><th>Status</th><th>Consecutive Absences</th></tr></thead>
                <tbody>
                  {followUps.map((item) => (
                      <tr key={item.studentId} className={item.warning ? `absence-warning-${item.warning}` : ""}>
                        <td>
                          {classSummaries.find(
                            (summary) => summary.classNumber === item.classNumber
                          )?.name || `Class ${item.classNumber}`}
                        </td><td>{item.originalSerialNumber}</td>
                        <td>{item.studentName}</td><td>{item.status}</td>
                        <td>{item.consecutiveAbsences || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!followUps.length && <p className="muted">No follow-ups are needed for this meeting.</p>}
            </div>
            {followUpPagination.totalPages > 1 && (
              <div className="pagination">
                <button
                  type="button"
                  className="secondary"
                  disabled={followUpPage <= 1}
                  onClick={() => setFollowUpPage((current) => Math.max(1, current - 1))}
                >
                  Previous follow-ups
                </button>
                <span>
                  Page {followUpPagination.page} of {followUpPagination.totalPages}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={followUpPage >= followUpPagination.totalPages}
                  onClick={() =>
                    setFollowUpPage((current) =>
                      Math.min(followUpPagination.totalPages, current + 1)
                    )
                  }
                >
                  Next follow-ups
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice success" role="status">{notice}</p>}

      {editingMeeting && role === "admin" && (
        <form
          className="panel meeting-edit-form"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-parent-meeting-heading"
          onSubmit={updateMeeting}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">EDIT MEETING</p>
              <h2 id="edit-parent-meeting-heading">
                Update meeting on {formatEthiopianDate(editingMeeting.meetingDate)}
              </h2>
            </div>
          </div>
          <EthiopianDateFields
            value={editMeetingDate}
            onChange={setEditMeetingDate}
            legend="Meeting date · Ethiopian calendar (ዓ.ም.)"
            allowHistoricalNonSunday
          />
          {editDateError && <p className="notice error">{editDateError}</p>}
          <div className="attendance-actions">
            <button disabled={reportBusy || !canonicalEditDate || Boolean(editDateError)}>
              {reportBusy ? "Updating…" : "Save meeting changes"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={reportBusy}
              onClick={() => setEditingMeeting(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {meetingId && !classNumber && (
        <p className="notice info">
          Select a class from the class-wise report to open its searchable student details.
        </p>
      )}

      {meetingId && classNumber && (
        <>
          <div className="student-filters" id="parent-meeting-details">
            <label>
              Filter by class
              <select
                value={classNumber}
                onChange={(event) => updateClassFilter(event.target.value)}
              >
                <option value="">All classes</option>
                {classSummaries.map((item) => (
                  <option value={item.classNumber} key={item.classId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Search by student name or number
              <input
                type="search"
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                maxLength={100}
                placeholder="Name or student number"
              />
            </label>
            <label>
              Parent status
              <select
                value={statusFilter}
                onChange={(event) => updateStatusFilter(event.target.value)}
              >
                <option value="">All</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="permission">Permission</option>
                <option value="not_recorded">Not Recorded</option>
              </select>
            </label>
          </div>
          {loading ? (
            <p className="notice info" role="status">Loading students…</p>
          ) : (
            <div className="table-wrap parent-meeting-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Student number</th>
                    <th>Student name</th>
                    <th>Guardian status</th>
                    <th>Guardian name (optional)</th>
                    <th>Notes (optional)</th>
                    <th>Last updated</th>
                    <th>Edit</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.studentId}>
                      <td>
                        {classSummaries.find(
                          (item) => item.classNumber === student.classNumber
                        )?.name || `Class ${student.classNumber}`}
                      </td>
                      <td>{student.originalSerialNumber}</td>
                      <td>
                        {student.studentName}
                        {student.christianName && (
                          <span className="muted"> · {student.christianName}</span>
                        )}
                      </td>
                      <td>
                        <select
                          className={`attendance-status status-${student.status}`}
                          value={student.status}
                          disabled={saving || statusSavingStudentIds.includes(student.studentId)}
                          onChange={(event) =>
                            saveStudentStatus(student, event.target.value)
                          }
                          aria-label={`Parent attendance for ${student.studentName}`}
                        >
                          <option value="not_recorded">Not recorded</option>
                          <option value="present">Present</option>
                          <option value="absent">Absent</option>
                          <option value="permission">Permission</option>
                        </select>
                        {statusSavingStudentIds.includes(student.studentId) && (
                          <span className="muted" role="status">Saving…</span>
                        )}
                      </td>
                      <td>
                        <input
                          value={student.guardianName}
                          maxLength={200}
                          disabled={saving || statusSavingStudentIds.includes(student.studentId) || !editingStudentIds.includes(student.studentId)}
                          onChange={(event) =>
                            updateStudent(student.studentId, "guardianName", event.target.value)
                          }
                          aria-label={`Guardian name for ${student.studentName}`}
                        />
                      </td>
                      <td>
                        <input
                          value={student.notes}
                          maxLength={1000}
                          disabled={saving || statusSavingStudentIds.includes(student.studentId) || !editingStudentIds.includes(student.studentId)}
                          onChange={(event) =>
                            updateStudent(student.studentId, "notes", event.target.value)
                          }
                          aria-label={`Notes for ${student.studentName}`}
                        />
                      </td>
                      <td>
                        {student.lastUpdated
                          ? formatEthiopianDate(String(student.lastUpdated).slice(0, 10))
                          : "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          disabled={saving || statusSavingStudentIds.includes(student.studentId)}
                          onClick={() => toggleStudentEdit(student.studentId)}
                        >
                          {editingStudentIds.includes(student.studentId) ? "Done" : "Edit"}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="danger-button"
                          disabled={saving || statusSavingStudentIds.includes(student.studentId)}
                          onClick={() => deleteStudentAttendance(student)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!students.length && (
                <p className="notice info">No students match the selected filters.</p>
              )}
            </div>
          )}
          {pagination.totalPages > 1 && (
            <div className="pagination">
              <button
                className="secondary"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={loading || saving || page <= 1}
              >
                Previous
              </button>
              <span>
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} students
              </span>
              <button
                className="secondary"
                onClick={() =>
                  setPage((current) => Math.min(pagination.totalPages, current + 1))
                }
                disabled={loading || saving || page >= pagination.totalPages}
              >
                Next
              </button>
            </div>
          )}
          <div className="attendance-actions">
            <button
              onClick={saveAttendance}
              disabled={saving || loading || statusSavingStudentIds.length > 0}
            >
              {saving ? "Saving…" : "Save / update attendance"}
            </button>
          </div>
        </>
      )}
      {!meetingId && !error && (
        <p className="notice info">
          No meeting is scheduled for this Ethiopian month. Create one above to
          record attendance.
        </p>
      )}
    </section>
  );
}
