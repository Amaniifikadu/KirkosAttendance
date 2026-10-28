import { useEffect, useState } from "react";
import {
  ETHIOPIAN_MONTHS,
  ethiopianToGregorian,
  gregorianToEthiopian,
  localTodayAsGregorian,
} from "./ethiopianCalendar";
import {
  // Temporarily disabled — can be re-enabled later.
  // AdminAccountCreationPage,
  EligibilityPage,
  ExamsPage,
  PasswordChange,
  StudentPortalPage,
  SubjectAttendancePage,
} from "./PortalPages";
import ParentMeetingAttendancePage from "./ParentMeetingAttendancePage";
import {
  getLoginRequest,
  getRegistrationGuidance,
} from "./authLanding";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

async function readApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }
  return payload;
}

function Login({ onLogin }) {
  const [flow, setFlow] = useState("signin");
  const [accountType, setAccountType] = useState("admin");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const request = getLoginRequest(accountType, identity, password);
      const response = await fetch(
        `${API_BASE_URL}${request.path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        }
      );
      const result = await readApiResponse(response);
      setPassword("");
      onLogin({
        token: result.token,
        role: result.role || "admin",
        mustChangePassword: Boolean(result.mustChangePassword),
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-card auth-card">
      <p className="eyebrow">KIRKOS SUNDAY SCHOOL</p>
      <h1>Welcome to Kirkos Attendance</h1>
      <div className="auth-tabs" role="tablist" aria-label="Account options">
        <button
          type="button"
          role="tab"
          aria-selected={flow === "signin"}
          className={flow === "signin" ? "auth-tab active" : "auth-tab"}
          onClick={() => { setFlow("signin"); setError(""); }}
        >
          Sign In
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={flow === "signup"}
          className={flow === "signup" ? "auth-tab active" : "auth-tab"}
          onClick={() => { setFlow("signup"); setError(""); }}
        >
          Create Account
        </button>
      </div>
      <label className="auth-account-type">
        Account type
        <select
          value={accountType}
          onChange={(event) => {
            setAccountType(event.target.value);
            setIdentity("");
            setPassword("");
            setError("");
          }}
        >
          <option value="admin">Administrator</option>
          <option value="teacher">Teacher</option>
          <option value="student">Student</option>
        </select>
      </label>
      {flow === "signin" ? (
        <>
          <p className="muted">
            {accountType === "admin"
              ? "Sign in with your administrator email and password."
              : "Use the username and password provided by your administrator. A temporary password must be changed at first sign-in."}
          </p>
          <form onSubmit={submit} className="stack">
            <label>
              {accountType === "admin" ? "Email" : "Username"}
              <input
                type={accountType === "admin" ? "email" : "text"}
                autoComplete="username"
                value={identity}
                onChange={(event) => setIdentity(event.target.value)}
                maxLength={accountType === "admin" ? 254 : 120}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error && <p className="notice error" role="alert">{error}</p>}
            <button disabled={busy}>
              {busy ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </>
      ) : (
        <div className="auth-registration-guidance" role="status">
          <h2>{getRegistrationGuidance(accountType).heading}</h2>
          <p>{getRegistrationGuidance(accountType).message}</p>
          {accountType !== "admin" && (
            <p className="muted">
              Already have an account? Choose <strong>Sign In</strong> above.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ImportPage({ token, role, onSignOut }) {
  const [activePage, setActivePage] = useState(role === "admin" ? "dashboard" : "subjects");
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [classOptions, setClassOptions] = useState([]);

  useEffect(() => {
    if (role !== "admin") return undefined;
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/attendance/classes`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(readApiResponse)
      .then((payload) => setClassOptions(payload.classes))
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      });
    return () => controller.abort();
  }, [role, token]);

  async function createPreview(event) {
    event.preventDefault();
    if (!file) return;

    setBusy(true);
    setError("");
    setPreview(null);
    setResult(null);
    setConfirmation("");
    setAcknowledged(false);
    try {
      const form = new FormData();
      form.append("workbook", file);
      const response = await fetch(`${API_BASE_URL}/api/students/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      setPreview(await readApiResponse(response));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/students/import/confirm`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          confirmation,
        }),
      });
      setResult(await readApiResponse(response));
      setPreview(null);
      setFile(null);
      setConfirmation("");
      setAcknowledged(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const canImport =
    preview &&
    !preview.alreadyImported &&
    preview.summary.newRows > 0 &&
    acknowledged &&
    confirmation === "IMPORT" &&
    !busy;

  const pageTitle = {
    dashboard: "Dashboard",
    import: "Student workbook import",
    students: "Student List",
    attendance: "Attendance Registration",
    subjects: "Lessons",
    eligibility: "Eligibility",
    exams: "Exams & Marks",
    parentMeetings: "Parents' Meeting Attendance",
    adminAccounts: "Create Admin Account",
  }[activePage] || "Dashboard";

  const navigationItems = [
    { id: "dashboard", label: "Dashboard" },
    ...(role === "admin"
      ? [
          { id: "attendance", label: "Attendance Registration" },
          // Temporarily disabled — can be re-enabled later.
          // { id: "adminAccounts", label: "Create Admin Account" },
        ]
      : []),
    ...(role === "admin" || role === "teacher"
      ? [{ id: "parentMeetings", label: "Parents' Meeting Attendance" }]
      : []),
    { id: "subjects", label: "Lessons" },
    { id: "eligibility", label: "Eligibility" },
    { id: "exams", label: "Exams & Marks" },
    ...(role === "admin"
      ? [
          { id: "students", label: "Student List" },
          { id: "import", label: "Excel Import" },
        ]
      : []),
  ];

  function toggleNavigation() {
    if (window.matchMedia("(max-width: 760px)").matches) {
      setMobileNavigationOpen((open) => !open);
    } else {
      setNavigationCollapsed((collapsed) => !collapsed);
    }
  }

  function navigateTo(page) {
    setActivePage(page);
    setMobileNavigationOpen(false);
  }

  const isMobileViewport = window.matchMedia("(max-width: 760px)").matches;

  return (
    <main className={`admin-shell${navigationCollapsed ? " nav-collapsed" : ""}`}>
      <header className="topbar">
        <button
          className="menu-toggle secondary"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={
            isMobileViewport ? mobileNavigationOpen : !navigationCollapsed
          }
          onClick={toggleNavigation}
        >
          ☰
        </button>
        <div>
          <p className="eyebrow">KIRKOS SUNDAY SCHOOL</p>
          <h1>{pageTitle}</h1>
        </div>
      </header>

      <div className={`workspace-layout${mobileNavigationOpen ? " mobile-nav-open" : ""}`}>
        <button
          className="navigation-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavigationOpen(false)}
        />
        <aside className="navigation-drawer" aria-label="Main navigation">
          <nav className="admin-nav">
            {navigationItems.map(({ id, label }) => (
              <button
                key={id}
                className={activePage === id ? "active" : "secondary"}
                aria-current={activePage === id ? "page" : undefined}
                onClick={() => navigateTo(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <button className="secondary sign-out-button" onClick={onSignOut}>
            Sign out
          </button>
        </aside>

        <div className="workspace-content">
      {activePage === "dashboard" ? (
        <section className="panel dashboard-panel">
          <p className="eyebrow">KIRKOS SUNDAY SCHOOL</p>
          <h2>Welcome to Kirkos Attendance</h2>
          <p className="muted">
            Use the navigation to manage lesson attendance, student records,
            exams, and parent meeting reports.
          </p>
          <div className="dashboard-links">
            {navigationItems
              .filter(({ id }) => id !== "dashboard")
              .map(({ id, label }) => (
                <button
                  className="secondary"
                  key={id}
                  onClick={() => navigateTo(id)}
                >
                  {label}
                </button>
              ))}
          </div>
        </section>
      ) : /* Temporarily disabled — can be re-enabled later:
      activePage === "adminAccounts" && role === "admin" ? (
        <AdminAccountCreationPage token={token} />
      ) : */ activePage === "parentMeetings" ? (
        <ParentMeetingAttendancePage token={token} role={role} />
      ) : activePage === "subjects" ? (
        <SubjectAttendancePage token={token} role={role} />
      ) : activePage === "eligibility" ? (
        <EligibilityPage token={token} role={role} />
      ) : activePage === "exams" ? (
        <ExamsPage token={token} role={role} />
      ) : activePage === "students" ? (
        <StudentList token={token} classOptions={classOptions} />
      ) : activePage === "attendance" ? (
        <AttendancePage token={token} classOptions={classOptions} />
      ) : (
        <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">STEP 1</p>
            <h2>Choose and preview a workbook</h2>
          </div>
          <span className="pill">No database changes during preview</span>
        </div>
        <form className="upload-row" onSubmit={createPreview}>
          <label className="file-picker">
            <span>{file ? file.name : "Select the 12-class .xlsx workbook"}</span>
            <input
              type="file"
              accept=".xlsx"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <button disabled={!file || busy}>
            {busy ? "Please wait…" : "Preview workbook"}
          </button>
        </form>
        <p className="muted small">
          Uploads are limited to 10 MB. Phone fields are not shown in the
          preview.
        </p>
      </section>

      {error && <p className="notice error">{error}</p>}

      {preview && (
        <>
          <section className="summary-grid" aria-label="Preview totals">
            <SummaryCard label="Worksheets" value={preview.summary.sheetCount} />
            <SummaryCard label="Rows found" value={preview.summary.totalRows} />
            <SummaryCard label="Existing · skipped" value={preview.summary.existingRows} />
            <SummaryCard label="New · eligible" value={preview.summary.newRows} tone="good" />
            <SummaryCard label="Workbook duplicates" value={preview.summary.duplicateRows} tone={preview.summary.duplicateRows ? "warn" : "good"} />
            <SummaryCard label="Invalid rows" value={preview.summary.invalidRows} tone={preview.summary.invalidRows ? "warn" : "good"} />
          </section>

          {preview.alreadyImported && (
            <p className="notice error">
              This exact workbook has already been imported. Import is disabled.
            </p>
          )}

          {preview.summary.classRecordsMissing > 0 && (
            <p className="notice info">
              {preview.summary.classRecordsMissing} class records are not yet
              present. They will be created only after the confirmed import
              transaction begins.
            </p>
          )}

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">CLASS-BY-CLASS</p>
                <h2>Worksheet results</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Workbook worksheet</th>
                    <th>Rows</th>
                    <th>Existing</th>
                    <th>New</th>
                    <th>Workbook duplicates</th>
                    <th>Invalid</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.classes.map((item) => (
                    <tr key={item.classNumber}>
                      <td>{item.displayName}</td>
                      <td lang="am">{item.sheetName}</td>
                      <td>{item.totalRows}</td>
                      <td>{item.existingRows}</td>
                      <td>{item.newRows}</td>
                      <td>{item.duplicateRows}</td>
                      <td>{item.invalidRows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {preview.newRows.length > 0 && (
            <section className="panel">
              <p className="eyebrow">ELIGIBLE TO INSERT</p>
              <h2>Verify new class and student numbers</h2>
              <p className="muted">
                Only these {preview.summary.newRows} valid rows can be inserted.
                Existing students, workbook duplicates, and invalid rows will
                not be inserted.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Worksheet</th>
                      <th>Student number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.newRows.map((row) => (
                      <tr key={`${row.classNumber}-${row.worksheetRow}`}>
                        <td>{row.className || `Class ${row.classNumber}`}</td>
                        <td lang="am">{row.sheetName}</td>
                        <td>{row.originalSerialNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {preview.detailsTruncated && (
            <p className="notice info">
              Some row details are not shown because the preview reached its
              display limit. The summary counts include all rows.
            </p>
          )}

          {preview.duplicateRows.length > 0 && (
            <section className="panel">
              <p className="eyebrow">WORKBOOK DUPLICATES</p>
              <h2>Repeated class and student numbers</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Class #</th>
                      <th>Worksheet</th>
                      <th>Student number</th>
                      <th>Workbook row</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.duplicateRows.map((row) => (
                      <tr key={`${row.classNumber}-${row.worksheetRow}`}>
                        <td>{row.className || `Class ${row.classNumber}`}</td>
                        <td lang="am">{row.sheetName}</td>
                        <td>{row.originalSerialNumber}</td>
                        <td>{row.worksheetRow}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {preview.invalidRows.length > 0 && (
            <section className="panel">
              <p className="eyebrow">VALIDATION</p>
              <h2>Rows requiring attention</h2>
              <p className="muted">
                Invalid rows will be skipped. Review the row number and issue
                before confirming.
              </p>
              <div className="issue-list">
                {preview.invalidRows.map((row, index) => (
                  <article className="issue-row" key={`${row.classNumber}-${row.worksheetRow}-${index}`}>
                    <strong lang="am">{row.sheetName}</strong>
                    <span>{row.className || `Class ${row.classNumber}`} · row {row.worksheetRow}</span>
                    <ul>
                      {row.issues.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          )}

          {!preview.alreadyImported && (
            <section className="panel confirm-panel">
              <div>
                <p className="eyebrow">STEP 2 · EXPLICIT CONFIRMATION</p>
                <h2>Import {preview.summary.newRows} new students</h2>
                <p className="muted">
                  {preview.summary.existingRows} existing students,
                  {preview.summary.duplicateRows} workbook duplicates, and{" "}
                  {preview.summary.invalidRows} invalid rows will be skipped.
                  Existing students are never overwritten. New identities are
                  checked again in the database transaction before insertion.
                </p>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I reviewed the class totals and validation warnings.
              </label>
              <label className="phrase-entry">
                Type <code>IMPORT</code> to confirm
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button className="danger-button" disabled={!canImport} onClick={confirmImport}>
                {busy ? "Importing…" : "Confirm and import"}
              </button>
            </section>
          )}
        </>
      )}

      {result && (
        <section className="result-card" role="status">
          <p className="eyebrow">IMPORT RESULT</p>
          <h2>{result.message}</h2>
          <div className="result-counts">
            <span>Inserted <strong>{result.insertedCount}</strong></span>
            <span>Skipped <strong>{result.skippedCount}</strong></span>
            <span>Failed <strong>{result.failedCount}</strong></span>
          </div>
        </section>
      )}
        </>
      )}
        </div>
      </div>
    </main>
  );
}

function StudentList({ token, classOptions }) {
  const [classNumber, setClassNumber] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [students, setStudents] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (classNumber) params.set("classNumber", classNumber);
    if (search.trim()) params.set("search", search.trim());

    setLoading(true);
    setError("");
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/students?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }
        );
        const payload = await readApiResponse(response);
        setStudents(payload.students);
        setPagination(payload.pagination);
      } catch (requestError) {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
          setStudents([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [token, classNumber, search, page]);

  function updateClassFilter(value) {
    setClassNumber(value);
    setPage(1);
  }

  function updateSearch(value) {
    setSearch(value);
    setPage(1);
  }

  return (
    <section className="panel student-list-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ROSTER</p>
          <h2>Student List</h2>
          <p className="muted">
            {pagination.total} student{pagination.total === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="student-filters">
        <label>
          Class · ክፍል
          <select
            value={classNumber}
            onChange={(event) => updateClassFilter(event.target.value)}
          >
            <option value="">All classes</option>
            {classOptions.map(({ classNumber, name }) => (
              <option value={classNumber} key={classNumber}>
                Class {classNumber} · {name}
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
      </div>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <p className="notice info" role="status">
          Loading students…
        </p>
      )}

      {!loading && !error && students.length === 0 && (
        <p className="notice info" role="status">
          {search || classNumber
            ? "No students match the selected filters."
            : "No students were found."}
        </p>
      )}

      {!loading && students.length > 0 && (
        <>
          <div className="table-wrap student-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Class · ክፍል</th>
                  <th>Student number</th>
                  <th>Student name</th>
                  <th>Christian name</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr
                    key={`${student.classNumber}-${student.originalSerialNumber}`}
                  >
                    <td>
                      Class {student.classNumber} ·{" "}
                      {classOptions.find(
                        ({ classNumber }) => classNumber === student.classNumber
                      )?.name || `ክፍል ${student.classNumber}`}
                    </td>
                    <td>{student.originalSerialNumber}</td>
                    <td>{student.studentName}</td>
                    <td>{student.christianName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="student-card-list">
            {students.map((student) => (
              <article
                className="student-card"
                key={`${student.classNumber}-${student.originalSerialNumber}`}
              >
                <strong>
                  Class {student.classNumber} ·{" "}
                  {classOptions.find(
                    ({ classNumber }) => classNumber === student.classNumber
                  )?.name || `ክፍል ${student.classNumber}`}
                </strong>
                <span>Student number: {student.originalSerialNumber}</span>
                <span>Student name: {student.studentName}</span>
                {student.christianName && (
                  <span>Christian name: {student.christianName}</span>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {pagination.totalPages > 1 && (
        <nav className="pagination" aria-label="Student list pages">
          <button
            className="secondary"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={loading || page <= 1}
          >
            Previous
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            className="secondary"
            onClick={() =>
              setPage((current) =>
                Math.min(pagination.totalPages, current + 1)
              )
            }
            disabled={loading || page >= pagination.totalPages}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

function AttendancePage({ token, classOptions }) {
  const [classNumber, setClassNumber] = useState("1");
  const [ethiopianDate, setEthiopianDate] = useState(() =>
    gregorianToEthiopian(localTodayAsGregorian())
  );
  const [students, setStudents] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [savedStatuses, setSavedStatuses] = useState({});
  const [session, setSession] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  let attendanceDate = "";
  let dateError = "";
  try {
    attendanceDate = ethiopianToGregorian(ethiopianDate);
  } catch (dateValidationError) {
    dateError = dateValidationError.message;
  }

  useEffect(() => {
    if (!attendanceDate) {
      setStudents([]);
      setStatuses({});
      setSavedStatuses({});
      setSession(null);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNotice("");
    const params = new URLSearchParams({
      classNumber,
      attendanceDate,
    });
    setStudents([]);
    setStatuses({});
    setSavedStatuses({});
    setSession(null);
    fetch(`${API_BASE_URL}/api/attendance/session?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(readApiResponse)
      .then((payload) => {
        const loadedStatuses = Object.fromEntries(
          payload.students.map((student) => [student.studentId, student.status])
        );
        setStudents(payload.students);
        setStatuses(loadedStatuses);
        setSavedStatuses(loadedStatuses);
        setSession(payload.session);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
          setStudents([]);
          setStatuses({});
          setSavedStatuses({});
          setSession(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [token, classNumber, attendanceDate]);

  const presentCount = students.filter(
    ({ studentId }) => statuses[studentId] === "present"
  ).length;
  const absentCount = students.filter(
    ({ studentId }) => statuses[studentId] === "absent"
  ).length;
  const permissionCount = students.filter(
    ({ studentId }) => statuses[studentId] === "permission"
  ).length;
  const notRecordedCount =
    students.length - presentCount - absentCount - permissionCount;
  const hasUnsavedChanges = students.some(
    ({ studentId }) => statuses[studentId] !== savedStatuses[studentId]
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleStudents = students.filter((student) =>
    [
      student.studentName,
      student.christianName,
      student.originalSerialNumber,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch))
  );
  const dayOfWeek = attendanceDate
    ? new Date(`${attendanceDate}T00:00:00.000Z`).getUTCDay()
    : null;
  const isScheduledDay = dayOfWeek === 0 || dayOfWeek === 6;

  function updateEthiopianDate(field, value) {
    setEthiopianDate((current) => ({
      ...current,
      [field]: Number(value),
    }));
  }

  function updateStatus(studentId, status) {
    setStatuses((current) => ({ ...current, [studentId]: status }));
    setNotice("");
  }

  async function persistAttendance(action) {
    if (action === "complete") {
      if (notRecordedCount > 0) {
        setError("Mark every student Present, Absent, or Permission before completing.");
        return;
      }
      if (!isScheduledDay) {
        setError("Attendance sessions can be completed only for Saturday or Sunday dates.");
        return;
      }
      const confirmed = window.confirm(
        `Complete attendance for ${students.length} students on ${attendanceDate}? Only completed sessions count as scheduled attendance.`
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/attendance/session/${action}`,
        {
          method: action === "complete" ? "POST" : "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            classNumber: Number(classNumber),
            attendanceDate,
            statuses: students.map(({ studentId }) => ({
              studentId,
              status: statuses[studentId] || "not_recorded",
            })),
          }),
        }
      );
      const payload = await readApiResponse(response);
      const saved = Object.fromEntries(
        payload.students.map((student) => [student.studentId, student.status])
      );
      setStudents(payload.students);
      setStatuses(saved);
      setSavedStatuses(saved);
      setSession(payload.session);
      setNotice(payload.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel attendance-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ATTENDANCE</p>
          <h2>Attendance Registration</h2>
          <p className="muted">
            Only completed Saturday/Sunday sessions are counted in future
            attendance reports. Unrecorded students are never assumed absent.
          </p>
        </div>
        {session && (
          <span
            className={`pill ${session.status === "complete" ? "complete" : ""}`}
          >
            {session.status === "complete" ? "Completed session" : "Draft session"}
          </span>
        )}
      </div>

      <div className="attendance-filters">
        <label>
          Class · ክፍል
          <select
            value={classNumber}
            disabled={saving}
            onChange={(event) => setClassNumber(event.target.value)}
          >
            {classOptions.map(({ classNumber, name }) => (
              <option value={classNumber} key={classNumber}>
                Class {classNumber} · {name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="ethiopian-date-picker">
          <legend>Attendance date · Ethiopian calendar (ዓ.ም.)</legend>
          <label>
            Year · ዓ.ም.
            <input
              type="number"
              min="1000"
              max="9999"
              value={ethiopianDate.year}
              disabled={saving}
              onChange={(event) => updateEthiopianDate("year", event.target.value)}
            />
          </label>
          <label>
            Month
            <select
              value={ethiopianDate.month}
              disabled={saving}
              onChange={(event) => updateEthiopianDate("month", event.target.value)}
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
              value={ethiopianDate.day}
              disabled={saving}
              onChange={(event) => updateEthiopianDate("day", event.target.value)}
            >
              {Array.from(
                {
                  length:
                    ethiopianDate.month === 13
                      ? ethiopianDate.year % 4 === 3
                        ? 6
                        : 5
                      : 30,
                },
                (_, index) => index + 1
              ).map((day) => (
                <option value={day} key={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <label>
          Search by student name or number
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or student number"
          />
        </label>
      </div>

      {dateError && (
        <p className="notice error" role="alert">
          {dateError}
        </p>
      )}
      {attendanceDate && (
        <p className="muted canonical-date">
          Canonical Gregorian date sent to server: <strong>{attendanceDate}</strong>
        </p>
      )}
      {hasUnsavedChanges && (
        <p className="notice unsaved-notice" role="status">
          Unsaved attendance changes
        </p>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      {loading && <p className="notice info" role="status">Loading attendance…</p>}

      {!loading && !dateError && !error && (
        <>
          <div className="attendance-counts" aria-label="Attendance totals">
            <SummaryCard label="Total students" value={students.length} />
            <SummaryCard label="Present" value={presentCount} tone="good" />
            <SummaryCard label="Absent" value={absentCount} tone="warn" />
            <SummaryCard label="Permission" value={permissionCount} tone="permission" />
            <SummaryCard
              label="Not recorded"
              value={notRecordedCount}
              tone={notRecordedCount ? "bad" : "good"}
            />
          </div>

          <div className="attendance-actions">
            <button
              className="secondary"
              disabled={loading || saving || !attendanceDate}
              onClick={() => persistAttendance("draft")}
            >
              {saving ? "Saving…" : session?.status === "complete" ? "Save Corrections" : "Save Draft"}
            </button>
            {session?.status !== "complete" && (
              <button
                disabled={
                  loading ||
                  saving ||
                  !students.length ||
                  notRecordedCount > 0 ||
                  !isScheduledDay ||
                  !attendanceDate
                }
                onClick={() => persistAttendance("complete")}
              >
                Complete Attendance
              </button>
            )}
          </div>

          {!isScheduledDay && (
            <p className="notice info">
              This date is not a Saturday or Sunday. You may save a draft, but
              cannot complete a scheduled attendance session.
            </p>
          )}

          {!students.length && (
            <p className="notice info" role="status">
              No students are enrolled in this class for the selected session.
            </p>
          )}

          {students.length > 0 && (
            <div className="attendance-student-list">
              {visibleStudents.map((student) => (
                <article className="attendance-student" key={student.studentId}>
                  <div className="attendance-student-identity">
                    <strong>#{student.originalSerialNumber}</strong>
                    <span>{student.studentName}</span>
                    {student.christianName && (
                      <span className="muted">{student.christianName}</span>
                    )}
                  </div>
                  <label>
                    Attendance status
                    <select
                      className={`attendance-status status-${statuses[student.studentId] || "not_recorded"}`}
                      value={statuses[student.studentId] || "not_recorded"}
                      disabled={loading || saving}
                      onChange={(event) =>
                        updateStatus(student.studentId, event.target.value)
                      }
                      aria-label={`Attendance for ${student.studentName}`}
                    >
                      <option
                        value="not_recorded"
                        disabled={session?.status === "complete"}
                      >
                        Not recorded
                      </option>
                      <option value="present">Present</option>
                      <option value="absent">Absent</option>
                      <option value="permission">Permission</option>
                    </select>
                  </label>
                </article>
              ))}
              {visibleStudents.length === 0 && (
                <p className="notice info">No students match this search.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SummaryCard({ label, value, tone = "" }) {
  return (
    <article className={`summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  if (
    ["teacher", "student"].includes(session?.role) &&
    session.mustChangePassword
  ) {
    return (
      <div className="login-shell">
        <PasswordChange
          token={session.token}
          onChanged={() => setSession((current) => ({ ...current, mustChangePassword: false }))}
        />
      </div>
    );
  }
  if (session?.role === "student") {
    return (
      <main className="admin-shell">
        <header className="topbar">
          <div><p className="eyebrow">KIRKOS SUNDAY SCHOOL</p><h1>Student Portal</h1></div>
          <button className="secondary" onClick={() => setSession(null)}>Sign out</button>
        </header>
        <StudentPortalPage token={session.token} />
      </main>
    );
  }
  return session ? (
    <ImportPage
      token={session.token}
      role={session.role}
      onSignOut={() => setSession(null)}
    />
  ) : (
    <div className="login-shell">
      <Login onLogin={setSession} />
    </div>
  );
}
