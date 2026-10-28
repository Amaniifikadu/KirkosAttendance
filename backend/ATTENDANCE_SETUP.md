# Attendance setup and behavior

Attendance is registered only when an administrator creates a draft session.
Attendance records are individual per-student documents; unrecorded students
have no Attendance document. Dates are stored as canonical Gregorian
`YYYY-MM-DD` strings. The frontend accepts Ethiopian calendar dates and converts
them to this canonical date using the platform's ICU Ethiopic calendar data.

## Unique indexes: inspection and proposed plan

The models use `autoIndex: false`; defining an index in Mongoose does not create
it in MongoDB. Some write routes check for specific indexes and fail closed if
they are missing. Do not infer that an index is missing from this document:
inspect the intended database first, compare the live index's ordered key,
`unique` option, name, and any partial filter with this table, and preserve
existing indexes unless an approved change is needed.

Use `mongosh` connected to the intended database for read-only inspection:

```javascript
db.classes.getIndexes();
db.students.getIndexes();
db.attendances.getIndexes();
db.attendancesessions.getIndexes();
db.subjects.getIndexes();
db.academicterms.getIndexes();
db.subjectlessons.getIndexes();
db.subjectattendances.getIndexes();
db.useraccounts.getIndexes();
db.exams.getIndexes();
db.exammarks.getIndexes();
db.admins.getIndexes();
db.importbatches.getIndexes();
```

If a collection does not exist, report it as absent; these inspection commands
do not create collections. `getIndexes()` includes the default `_id_` index,
which is not a substitute for any application index below. Do not create or
modify indexes as part of preflight. For any subsequently approved unique
index, check existing data for duplicate key combinations first; a unique
index build fails when conflicting data already exists.

The following is the proposed index plan based on the current model
declarations and write-route checks. `1` means ascending key order. Names shown
are the names required by route checks or the names declared by the model.
`Class`'s three indexes have no explicit model name, so MongoDB's generated
names are shown.

| Collection | Index name | Exact key | Unique | Purpose / write path |
|---|---|---|---|---|
| `classes` | `classNumber_1` | `{ classNumber: 1 }` | Yes | Prevent duplicate class numbers; class creation route checks this index. |
| `classes` | `name_1` | `{ name: 1 }` | Yes | Prevent duplicate class names; class creation route checks this index. |
| `classes` | `sheetName_1` | `{ sheetName: 1 }` | Yes | Keep class worksheet names unique; class creation route checks this index. |
| `students` | `unique_student_serial_per_class` | `{ classNumber: 1, originalSerialNumber: 1 }` | Yes | Student number is unique within a class; manual enrollment and workbook import rely on this identity. |
| `attendances` | `unique_student_attendance_per_date` | `{ studentId: 1, attendanceDate: 1 }` | Yes | At most one legacy attendance status per student/date; attendance write route checks this index. |
| `attendancesessions` | `unique_attendance_session_per_class_date` | `{ classNumber: 1, attendanceDate: 1 }` | Yes | At most one legacy session per class/date; attendance write route checks this index. |
| `subjects` | `unique_subject_name_per_class` | `{ classId: 1, nameKey: 1 }` | Yes | Prevent duplicate normalized subject names within a class; subject creation checks this index. |
| `academicterms` | `unique_term_per_academic_year` | `{ academicYear: 1, nameKey: 1 }` | Yes | Prevent duplicate normalized term names within an Ethiopian academic year; term creation checks this index. |
| `subjectlessons` | `unique_subject_lesson_date` | `{ classId: 1, subjectId: 1, lessonDate: 1 }` | Yes | Prevent duplicate lesson dates for a class/subject; lesson creation checks this index. |
| `subjectattendances` | `unique_student_attendance_per_subject_lesson` | `{ lessonId: 1, studentId: 1 }` | Yes | Prevent duplicate student records for one lesson; lesson submission checks this index. |
| `useraccounts` | `unique_portal_username` | `{ username: 1 }` | Yes | Prevent duplicate portal usernames; account provisioning checks this index. |
| `useraccounts` | `unique_student_portal_account` | `{ studentId: 1 }` | Yes, partial | Allow at most one account per student while excluding non-student accounts. Required partial filter: `{ role: "student", studentId: { $type: "objectId" } }`; account provisioning checks the key and uniqueness. |
| `exams` | `unique_exam_name_per_subject_year` | `{ classId: 1, subjectId: 1, academicYear: 1, nameKey: 1 }` | Yes | Prevent duplicate normalized exam names within class/subject/year; exam creation checks this index. |
| `exammarks` | `unique_student_mark_per_exam` | `{ examId: 1, studentId: 1 }` | Yes | Prevent duplicate mark documents per exam/student; mark submission checks this index. |
| `admins` | `unique_admin_email` | `{ email: 1 }` | Yes | Prevent duplicate administrator email accounts. |
| `admins` | `one_initial_admin_only` | `{ bootstrapKey: 1 }` | Yes | Enforce uniqueness of the initial-admin bootstrap key. |
| `importbatches` | `unique_imported_workbook` | `{ fileHash: 1 }` | Yes | Prevent importing the same workbook hash more than once. |

The table documents model-defined constraints and route-checked indexes; it is
not evidence that any particular deployment has or lacks them. Several
non-unique query-support indexes are also declared in models and are omitted
because they do not enforce uniqueness.

## Session and historical roster policy

Saving a draft may record a subset of enrolled students. A session can be
completed only for a Saturday or Sunday and only when every currently enrolled
student has an explicit `present` or `absent` record. Only sessions with status
`complete` and a roster snapshot count as scheduled sessions for future
attendance percentages. Dates without a completed session are not in the
denominator.

The completed session stores `rosterStudentIds` as a snapshot. If a student is
later moved to another class, the past session continues to represent the
student's original enrollment for that date. Completed sessions can be corrected
between present and absent, but saving cannot remove a status, change the
session's completion state, or add new students to its historical roster.

The transaction-based save and completion endpoints require a MongoDB
deployment that supports transactions, such as an Atlas replica set.

## Admin API

All endpoints require the existing admin bearer token:

- `GET /api/attendance/session?classNumber=1&attendanceDate=2026-10-24`
  loads the roster and any saved statuses for that canonical date.
- `PUT /api/attendance/session/draft` saves partial statuses. Each status entry
  is `{ "studentId": "<ObjectId>", "status": "present|absent|not_recorded" }`.
- `POST /api/attendance/session/complete` requires an explicit present/absent
  status for every currently enrolled student and records the completion-time
  roster snapshot.

The completed-session endpoint rejects weekday dates. A completed session can
be corrected through the draft-save endpoint using present/absent statuses; that
endpoint never reopens or downgrades it.

## Subject lessons and examination eligibility

Subject-based records are separate from the legacy class/date attendance
collections. A `SubjectLesson` represents one actual class/subject/date session;
its canonical `lessonDate` is Gregorian `YYYY-MM-DD`, while `academicYear` and
`academicMonth` are derived and validated using the Ethiopian calendar.
Cancelled lessons are not counted. Scheduled-but-unfinalized lessons are
reported as incomplete and do not place affected students in the ineligible
group. Eligibility is strictly greater than 50%; exactly 50% is not eligible.
The denominator is the student's finalized lessons for that subject and
selected month, term, or Ethiopian academic year. A lesson stores a roster
snapshot when scheduled; later class membership changes do not rewrite that
lesson's historical roster.

Use the inspection commands and proposed index plan above. Do not apply index
changes without explicit approval. Before any approved unique index build on an
existing collection, check for duplicate key combinations and review its impact.

## Subject API and portal

All IDs below are MongoDB ObjectIds. Admin endpoints use the existing admin
bearer token; teacher endpoints require a provisioned teacher token and a
matching class/subject assignment; student endpoints use only the student ID
bound to the authenticated account.

- `GET/POST /api/school/classes`; admin also has
  `POST /api/school/classes/:classId/students` for individual manual enrollment.
- `GET/POST /api/school/subjects`; creating subjects is admin-only.
- `GET/POST /api/school/terms`; term ranges are configured per Ethiopian
  academic year by an admin and stored as canonical Gregorian bounds.
- `POST /api/school/accounts` provisions a teacher or student account. Its
  randomly generated temporary password is returned once and must be delivered
  securely by the administrator; the user must change it at first sign-in.
- `POST /api/auth/portal/login` and `PUT /api/auth/portal/password`.
- `GET/POST /api/lessons`, `GET /api/lessons/:lessonId`,
  `PUT /api/lessons/:lessonId/attendance`, and admin-only
  `POST /api/lessons/:lessonId/cancel`.
- `GET /api/eligibility?classId=...&subjectId=...&academicYear=...`; add
  `academicMonth=1..13` or a configured `termId` to filter the period.
- `GET/POST /api/exams`, `GET /api/exams/:examId/marks`, and
  `PUT /api/exams/:examId/marks`. Marks are accepted only for eligible students;
  there is no override workflow.
- `GET /api/auth/portal/me` returns only the authenticated student's profile,
  own attendance, and own recorded marks.

Manual enrollment requires only the existing student number and name fields;
the workbook importer remains limited to its existing configured worksheets.
