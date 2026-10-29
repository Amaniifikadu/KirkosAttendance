import { useEffect, useMemo, useRef, useState } from "react";
import {
  ETHIOPIAN_MONTHS,
  ethiopianToGregorian,
  gregorianToEthiopian,
  localTodayAsGregorian,
} from "./ethiopianCalendar";
import {
  createAdminAccount,
  validateAdminAccountForm,
} from "./adminAccountCreation";
import { apiFetch } from "./apiClient";
import { reportRefreshInterval, scheduleReportRefresh } from "./reportRefresh";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

async function apiRequest(path, token, options = {}) {
  const response = await apiFetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Request failed (${response.status}).`);
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function AdminAccountCreationPage({ token }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    setError("");
    setNotice("");
    const validation = validateAdminAccountForm({
      email,
      password,
      confirmPassword,
    });
    if (validation.error) {
      setError(validation.error);
      return;
    }

    setBusy(true);
    try {
      const result = await createAdminAccount(
        apiRequest,
        token,
        validation.email,
        password
      );
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setNotice(`Admin account created for ${result.account.email}.`);
    } catch (requestError) {
      if (requestError.status === 409) {
        setError("An Admin account with that email already exists. Use a different email.");
      } else if (requestError.status === 401 || requestError.status === 403) {
        setError("Your Admin session is no longer authorized. Sign in again and retry.");
      } else if (requestError.status >= 500) {
        setError("The server could not create the Admin account. Please try again later.");
      } else {
        setError(requestError.message || "Unable to create the Admin account.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel admin-account-panel">
      <p className="eyebrow">ADMINISTRATION</p>
      <h2>Create Admin Account</h2>
      <p className="muted">
        Create a separate administrator login. The new password is never shown
        after submission.
      </p>
      <form className="stack admin-account-form" onSubmit={submit} noValidate>
        <label>
          Admin email
          <input
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            disabled={busy}
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={busy}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="muted">
            At least 12 characters and no more than 72 UTF-8 bytes.
          </span>
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            disabled={busy}
            required
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        {error && <p className="notice error" role="alert">{error}</p>}
        {notice && <p className="notice success" role="status">{notice}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Creating Admin…" : "Create Admin"}
        </button>
      </form>
    </section>
  );
}

function currentEthiopianYear() {
  return gregorianToEthiopian(localTodayAsGregorian()).year;
}

function EthiopianDateFields({ value, onChange, label = "Date · ዓ.ም." }) {
  return (
    <fieldset className="ethiopian-date-picker">
      <legend>{label}</legend>
      <label>
        Year · ዓ.ም.
        <input
          type="number"
          min="1000"
          max="9999"
          value={value.year}
          onChange={(event) => onChange({ ...value, year: Number(event.target.value) })}
        />
      </label>
      <label>
        Month
        <select
          value={value.month}
          onChange={(event) => onChange({ ...value, month: Number(event.target.value) })}
        >
          {ETHIOPIAN_MONTHS.map((month, index) => (
            <option value={index + 1} key={month}>{month}</option>
          ))}
        </select>
      </label>
      <label>
        Day
        <select
          value={value.day}
          onChange={(event) => onChange({ ...value, day: Number(event.target.value) })}
        >
          {Array.from(
            { length: value.month === 13 ? (value.year % 4 === 3 ? 6 : 5) : 30 },
            (_, index) => index + 1
          ).map((day) => <option value={day} key={day}>{day}</option>)}
        </select>
      </label>
    </fieldset>
  );
}

function useClasses(token) {
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    apiRequest("/api/school/classes", token)
      .then((payload) => { if (active) setClasses(payload.classes); })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [token]);
  return { classes, setClasses, classError: error };
}

function useSubjects(token, classId) {
  const [subjects, setSubjects] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!classId) {
      setSubjects([]);
      return undefined;
    }
    let active = true;
    apiRequest(`/api/school/subjects?classId=${encodeURIComponent(classId)}`, token)
      .then((payload) => { if (active) setSubjects(payload.subjects); })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [token, classId]);
  return { subjects, setSubjects, subjectError: error };
}

function ClassSubjectFields({ classes, subjects, classId, setClassId, subjectId, setSubjectId }) {
  return (
    <>
      <label>
        Class
        <select value={classId} onChange={(event) => { setClassId(event.target.value); setSubjectId(""); }}>
          <option value="">Select class</option>
          {classes.map((item) => (
            <option value={item._id} key={item._id}>
              Class {item.classNumber} · {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Subject
        <select value={subjectId} disabled={!classId} onChange={(event) => setSubjectId(event.target.value)}>
          <option value="">Select subject</option>
          {subjects.map((item) => (
            <option value={item._id} key={item._id}>{item.name}</option>
          ))}
        </select>
      </label>
    </>
  );
}

export function SubjectAttendancePage({ token, role }) {
  const { classes, setClasses, classError } = useClasses(token);
  const [classId, setClassId] = useState("");
  const { subjects, setSubjects, subjectError } = useSubjects(token, classId);
  const [subjectId, setSubjectId] = useState("");
  const [academicYear, setAcademicYear] = useState(currentEthiopianYear());
  const [academicMonth, setAcademicMonth] = useState("");
  const [lessonDate, setLessonDate] = useState(() =>
    gregorianToEthiopian(localTodayAsGregorian())
  );
  const [lessons, setLessons] = useState([]);
  const [lesson, setLesson] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [classNumberInput, setClassNumberInput] = useState("");
  const [classNameInput, setClassNameInput] = useState("");
  const [subjectNameInput, setSubjectNameInput] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newChristianName, setNewChristianName] = useState("");
  const [roster, setRoster] = useState([]);
  const [accountRole, setAccountRole] = useState("student");
  const [accountUsername, setAccountUsername] = useState("");
  const [accountStudentId, setAccountStudentId] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [termId, setTermId] = useState("");
  const [terms, setTerms] = useState([]);

  const dateError = lessonDate ? "" : "Choose an Ethiopian date.";
  let canonicalDate = "";
  try {
    canonicalDate = ethiopianToGregorian(lessonDate);
  } catch {
    canonicalDate = "";
  }

  useEffect(() => {
    setSubjectId("");
    setLessons([]);
    setLesson(null);
  }, [classId]);

  useEffect(() => {
    apiRequest(`/api/school/terms?academicYear=${academicYear}`, token)
      .then((payload) => setTerms(payload.terms))
      .catch((requestError) => setError(requestError.message));
  }, [token, academicYear]);

  async function refreshLessons() {
    if (!classId || !subjectId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ classId, subjectId, academicYear: String(academicYear) });
      if (academicMonth) params.set("academicMonth", academicMonth);
      const payload = await apiRequest(`/api/lessons?${params}`, token);
      setLessons(payload.lessons);
      if (lesson && !payload.lessons.some(({ _id }) => _id === lesson.id)) setLesson(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshLessons();
  // Keep the reload tied to filter changes; lesson details are refreshed explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, classId, subjectId, academicYear, academicMonth]);

  async function loadLesson(id) {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest(`/api/lessons/${id}`, token);
      setLesson(payload.lesson);
      setStatuses(Object.fromEntries(payload.lesson.students.map((student) => [
        student.studentId,
        student.status,
      ])));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function scheduleLesson(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const dateParts = gregorianToEthiopian(canonicalDate);
      const payload = await apiRequest("/api/lessons", token, {
        method: "POST",
        body: JSON.stringify({
          classId,
          subjectId,
          lessonDate: canonicalDate,
          academicYear: dateParts.year,
          academicMonth: dateParts.month,
          ...(termId ? { termId } : {}),
        }),
      });
      setNotice("Lesson date added. Attendance is not finalized yet.");
      await refreshLessons();
      await loadLesson(payload.lesson.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitAttendance() {
    if (!lesson) return;
    if (lesson.students.some(({ studentId }) => !["present", "absent", "permission"].includes(statuses[studentId]))) {
      setError("Mark every student Present, Absent, or Permission before submitting.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/lessons/${lesson.id}/attendance`, token, {
        method: "PUT",
        body: JSON.stringify({
          statuses: lesson.students.map(({ studentId }) => ({
            studentId,
            status: statuses[studentId],
          })),
        }),
      });
      setNotice("Attendance submitted and lesson finalized.");
      await loadLesson(lesson.id);
      await refreshLessons();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelLesson(id) {
    if (!window.confirm("Cancel this unfinalized lesson? It will not count toward eligibility.")) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/lessons/${id}/cancel`, token, { method: "POST" });
      setNotice("Lesson cancelled.");
      setLesson(null);
      await refreshLessons();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createClass(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = await apiRequest("/api/school/classes", token, {
        method: "POST",
        body: JSON.stringify({ classNumber: Number(classNumberInput), name: classNameInput }),
      });
      setClasses((current) => [...current, {
        _id: payload.class.id,
        classNumber: payload.class.classNumber,
        name: payload.class.name,
      }].sort((a, b) => a.classNumber - b.classNumber));
      setClassId(payload.class.id);
      setClassNumberInput("");
      setClassNameInput("");
      setNotice("Class created.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createSubject(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = await apiRequest("/api/school/subjects", token, {
        method: "POST",
        body: JSON.stringify({ classId, name: subjectNameInput }),
      });
      setSubjects((current) => [...current, {
        _id: payload.subject.id,
        name: payload.subject.name,
        classId: payload.subject.classId,
      }]);
      setSubjectId(payload.subject.id);
      setSubjectNameInput("");
      setNotice("Subject created.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function loadRoster() {
    if (!classId) return;
    try {
      const payload = await apiRequest(`/api/school/classes/${classId}/students`, token);
      setRoster(payload.students);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    if (role === "admin" && classId) loadRoster();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, classId, role]);

  async function enrollStudent(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = await apiRequest(`/api/school/classes/${classId}/students`, token, {
        method: "POST",
        body: JSON.stringify({
          originalSerialNumber: newSerial,
          studentName: newStudentName,
          christianName: newChristianName,
        }),
      });
      setRoster((current) => [...current, {
        _id: payload.student.id,
        originalSerialNumber: payload.student.originalSerialNumber,
        studentName: payload.student.studentName,
        christianName: payload.student.christianName,
      }]);
      setAccountStudentId(payload.student.id);
      setNewSerial("");
      setNewStudentName("");
      setNewChristianName("");
      setNotice("Student added to the selected class.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createPortalAccount(event) {
    event.preventDefault();
    setError("");
    setAccountMessage("");
    try {
      const payload = await apiRequest("/api/school/accounts", token, {
        method: "POST",
        body: JSON.stringify({
          username: accountUsername,
          role: accountRole,
          ...(accountRole === "student"
            ? { studentId: accountStudentId }
            : { assignments: [{ classId, subjectIds: [subjectId] }] }),
        }),
      });
      setAccountMessage(
        `Account ${payload.account.username} created. One-time password: ${payload.temporaryPassword}. Copy it securely now; it will not be shown again.`
      );
      setAccountUsername("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  const lessonStatusCounts = lesson
    ? {
        present: lesson.students.filter(
          ({ studentId }) => statuses[studentId] === "present"
        ).length,
        absent: lesson.students.filter(
          ({ studentId }) => statuses[studentId] === "absent"
        ).length,
        permission: lesson.students.filter(
          ({ studentId }) => statuses[studentId] === "permission"
        ).length,
        notRecorded: lesson.students.filter(
          ({ studentId }) =>
            !["present", "absent", "permission"].includes(statuses[studentId])
        ).length,
      }
    : null;

  return (
    <section className="panel portal-panel">
      <div className="section-heading">
        <div><p className="eyebrow">SUBJECT ATTENDANCE</p><h2>Lessons and attendance</h2></div>
        <span className="pill">Dates stored as Gregorian YYYY-MM-DD</span>
      </div>
      {classError && <p className="notice error">{classError}</p>}
      {subjectError && <p className="notice error">{subjectError}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      {accountMessage && <p className="notice warning" role="status">{accountMessage}</p>}

      {role === "admin" && (
        <details className="management-box">
          <summary>Manage classes, subjects, student enrollment, and portal accounts</summary>
          <form className="portal-filters" onSubmit={createClass}>
            <label>New class number<input type="number" min="1" max="999" value={classNumberInput} onChange={(event) => setClassNumberInput(event.target.value)} required /></label>
            <label>New class name<input value={classNameInput} onChange={(event) => setClassNameInput(event.target.value)} maxLength="100" required /></label>
            <button>Create class</button>
          </form>
          <form className="portal-filters" onSubmit={createSubject}>
            <label>Subject name for selected class<input value={subjectNameInput} onChange={(event) => setSubjectNameInput(event.target.value)} maxLength="120" required disabled={!classId} /></label>
            <button disabled={!classId}>Add subject</button>
          </form>
          <form className="portal-filters" onSubmit={enrollStudent}>
            <label>Original student number<input value={newSerial} onChange={(event) => setNewSerial(event.target.value)} required disabled={!classId} /></label>
            <label>Student name<input value={newStudentName} onChange={(event) => setNewStudentName(event.target.value)} required disabled={!classId} /></label>
            <label>Christian name (optional)<input value={newChristianName} onChange={(event) => setNewChristianName(event.target.value)} disabled={!classId} /></label>
            <button disabled={!classId}>Enroll student</button>
          </form>
          <form className="portal-filters" onSubmit={createPortalAccount}>
            <label>Portal role<select value={accountRole} onChange={(event) => setAccountRole(event.target.value)}><option value="student">Student</option><option value="teacher">Teacher</option></select></label>
            <label>Username<input value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} minLength="3" maxLength="120" required /></label>
            {accountRole === "student" ? (
              <label>Student<select value={accountStudentId} onChange={(event) => setAccountStudentId(event.target.value)} required><option value="">Select student</option>{roster.map((student) => <option key={student._id} value={student._id}>{student.originalSerialNumber} · {student.studentName}</option>)}</select></label>
            ) : <span className="muted">Teacher will be assigned to the selected class and subject.</span>}
            <button disabled={!classId || (accountRole === "teacher" && !subjectId)}>Create portal account</button>
          </form>
        </details>
      )}

      <div className="portal-filters">
        <ClassSubjectFields {...{ classes, subjects, classId, setClassId, subjectId, setSubjectId }} />
        <label>Academic year · ዓ.ም.<input type="number" min="1000" max="9999" value={academicYear} onChange={(event) => setAcademicYear(Number(event.target.value))} /></label>
        <label>Month filter<select value={academicMonth} onChange={(event) => setAcademicMonth(event.target.value)}><option value="">All months · Academic year</option>{ETHIOPIAN_MONTHS.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}</select></label>
      </div>

      {role === "admin" && (
        <form className="portal-filters" onSubmit={scheduleLesson}>
          <EthiopianDateFields value={lessonDate} onChange={setLessonDate} label="Schedule lesson date · ዓ.ም." />
          <label>Academic term (optional)<select value={termId} onChange={(event) => setTermId(event.target.value)}><option value="">No term</option>{terms.map((term) => <option key={term._id} value={term._id}>{term.name}</option>)}</select></label>
          <button disabled={!classId || !subjectId || !canonicalDate || busy}>Add lesson date</button>
        </form>
      )}
      {role === "teacher" && (
        <form className="portal-filters" onSubmit={scheduleLesson}>
          <EthiopianDateFields value={lessonDate} onChange={setLessonDate} label="Schedule lesson date · ዓ.ም." />
          <button disabled={!classId || !subjectId || !canonicalDate || busy}>Add lesson date</button>
        </form>
      )}
      {canonicalDate && <p className="muted">Selected date maps to Gregorian <strong>{canonicalDate}</strong>.</p>}
      {dateError && <p className="notice error">{dateError}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Lesson date</th><th>Month</th><th>Roster</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {lessons.map((item) => (
              <tr key={item._id}>
                <td>{item.lessonDate}</td>
                <td>{ETHIOPIAN_MONTHS[item.academicMonth - 1]}</td>
                <td>{item.rosterCount}</td>
                <td>{item.status === "scheduled" ? "Attendance incomplete" : item.status}</td>
                <td>
                  <button className="secondary" onClick={() => loadLesson(item._id)}>Open</button>
                  {role === "admin" && item.status === "scheduled" && <button className="secondary" onClick={() => cancelLesson(item._id)}>Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="notice info">Loading lessons…</p>}
      {!loading && classId && subjectId && lessons.length === 0 && <p className="notice info">No lesson dates recorded for this filter.</p>}

      {lesson && (
        <section className="lesson-editor">
          <div className="section-heading">
            <div><h3>{lesson.lessonDate} · {lesson.status}</h3><p className="muted">{lesson.status === "scheduled" ? "Attendance is incomplete; this lesson is excluded from eligibility denominators." : "Finalized lesson; corrections do not remove it from eligibility calculations."}</p></div>
            <button className="secondary" onClick={() => setLesson(null)}>Close</button>
          </div>
          <div className="attendance-counts" aria-label="Lesson attendance totals">
            <article className="summary-card good"><span>Present</span><strong>{lessonStatusCounts.present}</strong></article>
            <article className="summary-card warn"><span>Absent</span><strong>{lessonStatusCounts.absent}</strong></article>
            <article className="summary-card permission"><span>Permission</span><strong>{lessonStatusCounts.permission}</strong></article>
            <article className="summary-card"><span>Not recorded</span><strong>{lessonStatusCounts.notRecorded}</strong></article>
          </div>
          {lesson.students.map((student) => (
            <div className="lesson-student" key={student.studentId}>
              <span><strong>#{student.originalSerialNumber}</strong> {student.studentName} {student.christianName}</span>
              <select
                aria-label={`Attendance for ${student.originalSerialNumber}`}
                className={`attendance-status status-${statuses[student.studentId] || "not_recorded"}`}
                value={statuses[student.studentId] || "not_recorded"}
                disabled={busy}
                onChange={(event) => setStatuses((current) => ({ ...current, [student.studentId]: event.target.value }))}
              >
                {lesson.status === "scheduled" && <option value="not_recorded">Not recorded</option>}
                <option value="present">Present</option><option value="absent">Absent</option>
                <option value="permission">Permission</option>
              </select>
            </div>
          ))}
          <button disabled={busy || !lesson.students.length} onClick={submitAttendance}>
            {lesson.status === "finalized" ? "Save corrections" : "Submit and finalize attendance"}
          </button>
        </section>
      )}
    </section>
  );
}

function flattenEligibility(groups) {
  return [
    ...(groups.eligible || []),
    ...(groups.notEligible || []),
    ...(groups.attendanceIncomplete || []),
    ...(groups.notEnoughData || []),
  ];
}

function downloadCsv(filename, rows) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = rows.map((row) => row.map(quote).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function EligibilityPage({ token, role }) {
  const { classes, classError } = useClasses(token);
  const [classId, setClassId] = useState("");
  const { subjects } = useSubjects(token, classId);
  const [subjectId, setSubjectId] = useState("");
  const [year, setYear] = useState(currentEthiopianYear());
  const [periodType, setPeriodType] = useState("year");
  const [month, setMonth] = useState("");
  const [termId, setTermId] = useState("");
  const [terms, setTerms] = useState([]);
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("studentNumber");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reportRefresh = useRef(null);
  const [termName, setTermName] = useState("");
  const [termStart, setTermStart] = useState(() => gregorianToEthiopian(localTodayAsGregorian()));
  const [termEnd, setTermEnd] = useState(() => gregorianToEthiopian(localTodayAsGregorian()));

  useEffect(() => {
    apiRequest(`/api/school/terms?academicYear=${year}`, token)
      .then((payload) => setTerms(payload.terms))
      .catch((requestError) => setError(requestError.message));
  }, [token, year]);

  async function loadEligibility() {
    if (!classId || !subjectId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ classId, subjectId, academicYear: String(year) });
      if (periodType === "month" && month) params.set("academicMonth", month);
      if (periodType === "term" && termId) params.set("termId", termId);
      const path = `/api/eligibility?${params}`;
      const fetchReport = () => apiRequest(path, token);
      reportRefresh.current = async () => {
        try {
          setResult(await fetchReport());
          setError("");
        } catch (requestError) {
          setError(`Could not refresh the latest report: ${requestError.message}`);
        }
      };
      setResult(await fetchReport());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!result) return undefined;
    return scheduleReportRefresh(
      () => reportRefresh.current?.(),
      { intervalMs: reportRefreshInterval() }
    );
  }, [token, Boolean(result)]);

  async function createTerm(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = await apiRequest("/api/school/terms", token, {
        method: "POST",
        body: JSON.stringify({
          academicYear: year,
          name: termName,
          startDate: ethiopianToGregorian(termStart),
          endDate: ethiopianToGregorian(termEnd),
        }),
      });
      setTerms((current) => [...current, payload.term]);
      setTermId(payload.term._id);
      setTermName("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  const matchingStudents = useMemo(() => {
    if (!result) return [];
    const needle = search.trim().toLocaleLowerCase();
    return flattenEligibility(result.groups)
      .filter((student) =>
        [student.studentNumber, student.fullName].some((value) =>
          value.toLocaleLowerCase().includes(needle)
        )
      )
      .sort((left, right) =>
        sortBy === "percentage"
          ? (right.attendancePercentage ?? -1) - (left.attendancePercentage ?? -1)
          : left.studentNumber.localeCompare(right.studentNumber, undefined, { numeric: true })
      );
  }, [result, search, sortBy]);

  function exportCsv() {
    if (!result) return;
    const rows = [[
      "Student number", "Full name", "Class", "Attended sessions",
      "Finalized sessions", "Attendance percentage", "Eligibility",
    ], ...matchingStudents.map((student) => [
      student.studentNumber,
      student.fullName,
      student.classNumber,
      student.attendedSessions,
      student.totalFinalizedSessions,
      student.attendancePercentage == null ? "" : `${student.attendancePercentage}%`,
      student.eligibility,
    ])];
    downloadCsv(`eligibility-${result.academicYear}-${result.subject.name}.csv`, rows);
  }

  const groups = result
    ? [
        ["Eligible students · >50%", result.groups.eligible],
        ["Not eligible · ≤50%", result.groups.notEligible],
        ["Attendance incomplete", result.groups.attendanceIncomplete],
        ["Not enough data", result.groups.notEnoughData],
      ]
    : [];
  const selectedIds = new Set(matchingStudents.map(({ studentId }) => studentId));
  return (
    <section className="panel portal-panel">
      <div className="section-heading"><div><p className="eyebrow">EXAM ELIGIBILITY</p><h2>Subject attendance eligibility</h2></div></div>
      {classError && <p className="notice error">{classError}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="portal-filters">
        <ClassSubjectFields {...{ classes, subjects, classId, setClassId, subjectId, setSubjectId }} />
        <label>Academic year · ዓ.ም.<input type="number" min="1000" max="9999" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
        <label>Period<select value={periodType} onChange={(event) => setPeriodType(event.target.value)}><option value="year">Whole academic year</option><option value="month">Month</option><option value="term">Term</option></select></label>
        {periodType === "month" && <label>Month<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="">Select month</option>{ETHIOPIAN_MONTHS.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>}
        {periodType === "term" && <label>Term<select value={termId} onChange={(event) => setTermId(event.target.value)}><option value="">Select term</option>{terms.map((term) => <option key={term._id} value={term._id}>{term.name}</option>)}</select></label>}
        <label>Search student<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or student number" /></label>
        <label>Sort by<select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="studentNumber">Student number</option><option value="percentage">Percentage, high to low</option></select></label>
        <button disabled={!classId || !subjectId || (periodType === "month" && !month) || (periodType === "term" && !termId) || loading} onClick={loadEligibility}>Calculate</button>
        <button className="secondary" disabled={!result} onClick={exportCsv}>Export CSV</button>
      </div>

      {role === "admin" && (
        <details className="management-box">
          <summary>Configure a school term for this Ethiopian academic year</summary>
          <form className="portal-filters" onSubmit={createTerm}>
            <label>Term name<input value={termName} onChange={(event) => setTermName(event.target.value)} required maxLength="80" /></label>
            <EthiopianDateFields value={termStart} onChange={setTermStart} label="Term start · ዓ.ም." />
            <EthiopianDateFields value={termEnd} onChange={setTermEnd} label="Term end · ዓ.ም." />
            <button>Create term</button>
          </form>
          <p className="muted small">Term dates are saved as canonical Gregorian dates. The backend rejects dates outside the selected Ethiopian year and overlapping terms.</p>
        </details>
      )}

      {loading && <p className="notice info">Calculating eligibility…</p>}
      {result && (
        <>
          <div className="summary-grid">
            <SummaryValue label="Finalized lessons" value={result.sessionCounts.finalized} />
            <SummaryValue label="Incomplete lessons" value={result.sessionCounts.incomplete} />
            <SummaryValue label="Cancelled lessons" value={result.sessionCounts.cancelled} />
            <SummaryValue label="Eligible" value={result.summary.eligible} />
            <SummaryValue label="Not eligible" value={result.summary.notEligible} />
          </div>
          {groups.map(([title, studentsInGroup]) => {
            const visible = studentsInGroup.filter(({ studentId }) => selectedIds.has(studentId));
            return (
              <section className="eligibility-group" key={title}>
                <h3>{title} <span className="muted">({visible.length})</span></h3>
                {title.startsWith("Attendance incomplete") && result.sessionCounts.incomplete > 0 && (
                  <p className="notice warning">Unfinalized lessons are excluded from percentages; these students are not classified in the ineligible group.</p>
                )}
                {visible.length > 0 && <div className="table-wrap"><table>
                  <thead><tr><th>Student number</th><th>Full name</th><th>Class</th><th>Attended</th><th>Finalized</th><th>Percentage</th><th>Eligibility</th></tr></thead>
                  <tbody>{visible.map((student) => <tr key={student.studentId}>
                    <td>{student.studentNumber}</td><td>{student.fullName}</td>
                    <td>{student.className || `Class ${student.classNumber}`}</td>
                    <td>{student.attendedSessions}</td><td>{student.totalFinalizedSessions}</td>
                    <td>{student.attendancePercentage == null ? "—" : `${student.attendancePercentage}%`}</td>
                    <td>{student.eligibility.replaceAll("_", " ")}</td>
                  </tr>)}</tbody>
                </table></div>}
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}

function SummaryValue({ label, value }) {
  return <article className="summary-card"><span>{label}</span><strong>{value}</strong></article>;
}

export function ExamsPage({ token }) {
  const { classes } = useClasses(token);
  const [classId, setClassId] = useState("");
  const { subjects } = useSubjects(token, classId);
  const [subjectId, setSubjectId] = useState("");
  const [year, setYear] = useState(currentEthiopianYear());
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [eligibility, setEligibility] = useState(null);
  const [marks, setMarks] = useState({});
  const [examName, setExamName] = useState("");
  const [maxMarks, setMaxMarks] = useState(100);
  const [examDate, setExamDate] = useState(() => gregorianToEthiopian(localTodayAsGregorian()));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadExams() {
    if (!classId || !subjectId) return;
    try {
      const params = new URLSearchParams({ classId, subjectId, academicYear: String(year) });
      const payload = await apiRequest(`/api/exams?${params}`, token);
      setExams(payload.exams);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    setExamId("");
    setEligibility(null);
    setMarks({});
    setExams([]);
    if (classId && subjectId) loadExams();
  }, [token, classId, subjectId, year]);

  async function loadEligibilityForExam(selectedId) {
    const exam = exams.find(({ _id }) => _id === selectedId);
    if (!exam) return;
    try {
      const params = new URLSearchParams({
        classId,
        subjectId,
        academicYear: String(exam.academicYear),
        academicMonth: String(exam.academicMonth),
      });
      const [result, markPayload] = await Promise.all([
        apiRequest(`/api/eligibility?${params}`, token),
        apiRequest(`/api/exams/${selectedId}/marks`, token),
      ]);
      setEligibility(result);
      const savedMarks = new Map(
        markPayload.marks.map(({ studentId, marks: score }) => [studentId, String(score)])
      );
      setMarks(Object.fromEntries(
        result.groups.eligible.map(({ studentId }) => [
          studentId,
          savedMarks.get(studentId) ?? "",
        ])
      ));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createExam(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const canonical = ethiopianToGregorian(examDate);
      const parts = gregorianToEthiopian(canonical);
      const payload = await apiRequest("/api/exams", token, {
        method: "POST",
        body: JSON.stringify({
          classId,
          subjectId,
          name: examName,
          examDate: canonical,
          academicYear: parts.year,
          academicMonth: parts.month,
          maxMarks: Number(maxMarks),
        }),
      });
      setNotice("Exam created. Eligibility remains separate from marks.");
      setExamName("");
      await loadExams();
      setExamId(payload.exam._id);
      const params = new URLSearchParams({
        classId,
        subjectId,
        academicYear: String(parts.year),
        academicMonth: String(parts.month),
      });
      const eligibilityPayload = await apiRequest(`/api/eligibility?${params}`, token);
      setEligibility(eligibilityPayload);
      setMarks(Object.fromEntries(
        eligibilityPayload.groups.eligible.map(({ studentId }) => [studentId, ""])
      ));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveMarks() {
    const entries = Object.entries(marks)
      .filter(([, value]) => value !== "")
      .map(([studentId, value]) => ({ studentId, marks: Number(value) }));
    if (!entries.length) {
      setError("Enter at least one mark for an eligible student.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = await apiRequest(`/api/exams/${examId}/marks`, token, {
        method: "PUT",
        body: JSON.stringify({ marks: entries }),
      });
      setNotice(`${payload.savedCount} eligible student mark(s) saved.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel portal-panel">
      <div className="section-heading"><div><p className="eyebrow">EXAM MANAGEMENT</p><h2>Exams and marks</h2></div><span className="pill">No eligibility overrides</span></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice success">{notice}</p>}
      <div className="portal-filters">
        <ClassSubjectFields {...{ classes, subjects, classId, setClassId, subjectId, setSubjectId }} />
        <label>Academic year · ዓ.ም.<input type="number" value={year} min="1000" max="9999" onChange={(event) => setYear(Number(event.target.value))} /></label>
        <label>Exam<select value={examId} onChange={(event) => { setExamId(event.target.value); loadEligibilityForExam(event.target.value); }}><option value="">Select exam</option>{exams.map((exam) => <option key={exam._id} value={exam._id}>{exam.name} · {exam.examDate}</option>)}</select></label>
      </div>
      <form className="portal-filters" onSubmit={createExam}>
        <label>Exam name<input value={examName} onChange={(event) => setExamName(event.target.value)} required maxLength="120" /></label>
        <label>Maximum marks<input type="number" min="0.01" max="10000" step="0.01" value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} required /></label>
        <EthiopianDateFields value={examDate} onChange={setExamDate} label="Exam date · ዓ.ም." />
        <button disabled={!classId || !subjectId || busy}>Create exam</button>
      </form>
      {eligibility && (
        <section className="lesson-editor">
          <h3>Marks may be recorded only for the eligible list</h3>
          <p className="muted">Attendance eligibility is recalculated by the backend before every save. No mark is generated or changed automatically.</p>
          {eligibility.groups.eligible.map((student) => (
            <label className="lesson-student" key={student.studentId}>
              <span>#{student.studentNumber} · {student.fullName} · {student.attendancePercentage}%</span>
              <input type="number" min="0" max={exams.find(({ _id }) => _id === examId)?.maxMarks || 100} step="0.01" value={marks[student.studentId] ?? ""} onChange={(event) => setMarks((current) => ({ ...current, [student.studentId]: event.target.value }))} />
            </label>
          ))}
          {eligibility.groups.attendanceIncomplete.length > 0 && <p className="notice warning">{eligibility.groups.attendanceIncomplete.length} student(s) have incomplete attendance data and are excluded from mark entry.</p>}
          <button disabled={busy || !examId} onClick={saveMarks}>Save marks</button>
        </section>
      )}
    </section>
  );
}

export function StudentPortalPage({ token }) {
  const [year, setYear] = useState(currentEthiopianYear());
  const [month, setMonth] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let requestInProgress = false;
    let initialLoad = true;
    const params = new URLSearchParams({ academicYear: String(year) });
    if (month) params.set("academicMonth", month);
    const refresh = async () => {
      if (!active || requestInProgress) return;
      requestInProgress = true;
      if (initialLoad) setLoading(true);
      try {
        const payload = await apiRequest(`/api/auth/portal/me?${params}`, token);
        if (active) {
          setDashboard(payload);
          setError("");
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        requestInProgress = false;
        if (active && initialLoad) {
          initialLoad = false;
          setLoading(false);
        }
      }
    };
    void refresh();
    const stopPolling = scheduleReportRefresh(refresh, {
      intervalMs: reportRefreshInterval(),
    });
    return () => {
      active = false;
      stopPolling();
    };
  }, [token, year, month]);

  return (
    <section className="panel portal-panel">
      <div className="section-heading"><div><p className="eyebrow">STUDENT PORTAL</p><h2>My attendance and results</h2></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="portal-filters">
        <label>Academic year · ዓ.ም.<input type="number" min="1000" max="9999" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
        <label>Month<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="">Whole academic year</option>{ETHIOPIAN_MONTHS.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
      </div>
      {loading && <p className="notice info">Loading your portal…</p>}
      {dashboard && (
        <>
          <div className="student-profile">
            <h3>{dashboard.student.fullName}</h3>
            <p>Class {dashboard.student.classNumber} · {dashboard.student.className}</p>
            <p>Student number {dashboard.student.studentNumber}</p>
          </div>
          <div className="portal-subject-grid">
            {dashboard.subjects.map((subject) => (
              <article className="summary-card" key={subject.subjectId}>
                <span>{subject.subjectName}</span>
                <strong>{subject.attendancePercentage == null ? "Not enough data" : `${subject.attendancePercentage}%`}</strong>
                <p>{subject.attendedSessions} present / {subject.totalFinalizedSessions} finalized</p>
                {subject.incompleteSessions > 0 && <p className="notice warning">{subject.incompleteSessions} incomplete lesson(s); eligibility is pending.</p>}
                <p>Eligibility: {subject.eligibility.replaceAll("_", " ")}</p>
                <ul>{subject.history.map((record) => <li key={record.lessonDate}>{record.lessonDate}: {record.status}</li>)}</ul>
              </article>
            ))}
          </div>
          <section className="eligibility-group">
            <h3>My examination results</h3>
            {dashboard.results.length === 0 ? <p className="muted">No recorded results for this period.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Subject</th><th>Exam</th><th>Date</th><th>Result</th></tr></thead>
                <tbody>{dashboard.results.map((result, index) => <tr key={`${result.examName}-${index}`}><td>{result.subjectName}</td><td>{result.examName}</td><td>{result.examDate}</td><td>{result.marks} / {result.maxMarks}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

export function PasswordChange({ token, onChanged }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/auth/portal/password", token, {
        method: "PUT",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="login-card">
      <p className="eyebrow">FIRST SIGN-IN</p>
      <h1>Change your temporary password</h1>
      <form className="stack" onSubmit={submit}>
        <label>Temporary password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
        <label>New password (12–72 bytes)<input type="password" autoComplete="new-password" minLength="12" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
        {error && <p className="notice error">{error}</p>}
        <button disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
      </form>
    </section>
  );
}
