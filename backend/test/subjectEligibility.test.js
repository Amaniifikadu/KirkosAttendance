const assert = require("node:assert/strict");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Class = require("../src/models/Class");
const Student = require("../src/models/Student");
const SubjectLesson = require("../src/models/SubjectLesson");
const SubjectAttendance = require("../src/models/SubjectAttendance");
const Subject = require("../src/models/Subject");
const AcademicTerm = require("../src/models/AcademicTerm");
const UserAccount = require("../src/models/UserAccount");
const Exam = require("../src/models/Exam");
const ExamMark = require("../src/models/ExamMark");
const { parseCanonicalDate } = require("../src/services/academicCalendar");
const {
  authenticateAccount,
  authorizeAccountRoles,
  requireChangedPassword,
} = require("../src/middleware/authenticateAccount");
const { TOKEN_ISSUER } = require("../src/middleware/authenticateAdmin");
const errorHandler = require("../src/middleware/errorHandler");
const {
  classifyAttendance,
  evaluateStudentEligibility,
  getEligibility,
  historicalRosterIds,
} = require("../src/services/eligibility");
const { hasTeacherAccess } = require("../src/services/subjectAccess");
const {
  parseRosterStatuses,
  submitLessonAttendance,
} = require("../src/services/subjectLessons");
const schoolRoutes = require("../src/routes/school.routes");
const subjectLessonsRoutes = require("../src/routes/subjectLessons.routes");
const eligibilityRoutes = require("../src/routes/eligibility.routes");
const examsRoutes = require("../src/routes/exams.routes");
const portalRoutes = require("../src/routes/portal.routes");
const { validateTeacherAssignments } = schoolRoutes;

const student = {
  _id: new mongoose.Types.ObjectId("111111111111111111111111"),
  classNumber: 2,
  originalSerialNumber: "5",
  studentName: "Example",
  christianName: "Learner",
};
const TEST_SECRET = "subject-portal-tests-secret-with-more-than-32-bytes";

function lesson(id, rosterStudentIds = [student._id]) {
  return {
    _id: new mongoose.Types.ObjectId(id),
    rosterStudentIds,
  };
}

function recordMap(lessons, statuses) {
  return new Map(
    lessons.map((entry, index) => [
      `${entry._id}:${student._id}`,
      statuses[index],
    ])
  );
}

test("eligibility threshold is strictly greater than 50 percent", () => {
  assert.equal(classifyAttendance({ attended: 3, total: 5 }).status, "eligible");
  assert.equal(classifyAttendance({ attended: 1, total: 2 }).status, "not_eligible");
  assert.equal(classifyAttendance({ attended: 2, total: 5 }).status, "not_eligible");
});

test("zero finalized sessions report not enough data", () => {
  assert.deepEqual(classifyAttendance({ attended: 0, total: 0 }), {
    status: "not_enough_data",
    percentage: null,
  });
  const result = evaluateStudentEligibility({
    student,
    finalizedLessons: [],
    incompleteLessons: [],
    recordByLessonStudent: new Map(),
  });
  assert.equal(result.eligibility, "not_enough_data");
  assert.equal(result.attendancePercentage, null);
  assert.equal(result.className, "ኢየሉጣ (ቅድመ መደበኛ)");
});

test("permission is not counted present but remains in the finalized lesson denominator", () => {
  const finalized = [lesson("222222222222222222222220")];
  const result = evaluateStudentEligibility({
    student,
    finalizedLessons: finalized,
    incompleteLessons: [],
    recordByLessonStudent: recordMap(finalized, ["permission"]),
  });
  assert.equal(result.attendedSessions, 0);
  assert.equal(result.totalFinalizedSessions, 1);
  assert.equal(result.attendancePercentage, 0);
  assert.equal(result.eligibility, "not_eligible");
});

test("unfinalized lessons are separate from eligible and ineligible classification", () => {
  const finalized = [lesson("222222222222222222222221"), lesson("222222222222222222222222")];
  const pending = [lesson("222222222222222222222223")];
  const result = evaluateStudentEligibility({
    student,
    finalizedLessons: finalized,
    incompleteLessons: pending,
    recordByLessonStudent: recordMap(finalized, ["present", "absent"]),
  });
  assert.equal(result.eligibility, "attendance_incomplete");
  assert.equal(result.totalFinalizedSessions, 2);
  assert.equal(result.incompleteSessions, 1);
  assert.equal(result.attendancePercentage, null);
});

test("attendance calculations use only the supplied subject lesson set", () => {
  const subjectLessons = [
    lesson("333333333333333333333331"),
    lesson("333333333333333333333332"),
  ];
  const subjectA = evaluateStudentEligibility({
    student,
    finalizedLessons: subjectLessons,
    incompleteLessons: [],
    recordByLessonStudent: recordMap(subjectLessons, ["present", "absent"]),
  });
  const subjectB = evaluateStudentEligibility({
    student,
    finalizedLessons: [lesson("333333333333333333333333")],
    incompleteLessons: [],
    recordByLessonStudent: recordMap(
      [lesson("333333333333333333333333")],
      ["present"]
    ),
  });
  assert.equal(subjectA.totalFinalizedSessions, 2);
  assert.equal(subjectA.eligibility, "not_eligible");
  assert.equal(subjectB.totalFinalizedSessions, 1);
  assert.equal(subjectB.eligibility, "eligible");
});

test("cancelled lessons and their records do not change eligibility or denominator", async () => {
  const classId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const subjectId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const finalizedLessons = [
    {
      _id: new mongoose.Types.ObjectId("ccccccccccccccccccccccc1"),
      status: "finalized",
      rosterStudentIds: [student._id],
    },
    {
      _id: new mongoose.Types.ObjectId("ccccccccccccccccccccccc2"),
      status: "finalized",
      rosterStudentIds: [student._id],
    },
  ];
  const cancelledLesson = {
    _id: new mongoose.Types.ObjectId("ccccccccccccccccccccccc3"),
    status: "cancelled",
    rosterStudentIds: [student._id],
  };
  const originalMethods = {
    classFindById: Class.findById,
    subjectFindOne: Subject.findOne,
    lessonFind: SubjectLesson.find,
    attendanceFind: SubjectAttendance.find,
    studentAggregate: Student.aggregate,
  };

  try {
    Class.findById = () => ({
      lean: async () => ({ _id: classId, classNumber: 2 }),
    });
    Subject.findOne = () => ({
      lean: async () => ({ _id: subjectId, name: "Subject", classId }),
    });
    SubjectLesson.find = () => ({
      lean: async () => [...finalizedLessons, cancelledLesson],
    });
    Student.aggregate = async () => [student];

    for (const cancelledStatus of ["present", "absent"]) {
      const attendanceRecords = [
        {
          lessonId: finalizedLessons[0]._id,
          studentId: student._id,
          status: "present",
        },
        {
          lessonId: finalizedLessons[1]._id,
          studentId: student._id,
          status: "absent",
        },
        {
          lessonId: cancelledLesson._id,
          studentId: student._id,
          status: cancelledStatus,
        },
      ];
      let requestedLessonIds;
      SubjectAttendance.find = ({ lessonId }) => {
        requestedLessonIds = lessonId.$in.map(String);
        return {
          select() {
            return this;
          },
          lean: async () => attendanceRecords.filter(({ lessonId: id }) =>
            lessonId.$in.some((requestedId) => String(requestedId) === String(id))
          ),
        };
      };

      const result = await getEligibility({
        classId,
        subjectId,
        academicYear: 2019,
        academicMonth: 2,
      });
      assert.deepEqual(
        requestedLessonIds.sort(),
        finalizedLessons.map(({ _id }) => String(_id)).sort()
      );
      assert.equal(result.sessionCounts.finalized, 2);
      assert.equal(result.sessionCounts.cancelled, 1);
      assert.equal(result.groups.notEligible[0].totalFinalizedSessions, 2);
      assert.equal(result.groups.notEligible[0].attendedSessions, 1);
      assert.equal(result.groups.notEligible[0].attendancePercentage, 50);
      assert.equal(result.groups.notEligible[0].eligibility, "not_eligible");
      assert.equal(result.groups.eligible.length, 0);
    }
  } finally {
    Class.findById = originalMethods.classFindById;
    Subject.findOne = originalMethods.subjectFindOne;
    SubjectLesson.find = originalMethods.lessonFind;
    SubjectAttendance.find = originalMethods.attendanceFind;
    Student.aggregate = originalMethods.studentAggregate;
  }
});

test("historical eligibility includes prior rosters but excludes cancelled lesson rosters", () => {
  const transferredStudentId = new mongoose.Types.ObjectId("111111111111111111111112");
  const pendingStudentId = new mongoose.Types.ObjectId("111111111111111111111113");
  const cancelledStudentId = new mongoose.Types.ObjectId("111111111111111111111114");
  const roster = historicalRosterIds([
    { status: "finalized", rosterStudentIds: [transferredStudentId, student._id] },
    { status: "scheduled", rosterStudentIds: [transferredStudentId, pendingStudentId] },
    { status: "cancelled", rosterStudentIds: [cancelledStudentId] },
  ]);
  assert.deepEqual(
    roster.map(String).sort(),
    [String(transferredStudentId), String(student._id), String(pendingStudentId)].sort()
  );
});

test("teacher assignment validation rejects malformed class and subject IDs", () => {
  assert.deepEqual(
    validateTeacherAssignments([{
      classId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      subjectIds: ["bbbbbbbbbbbbbbbbbbbbbbbb"],
    }]),
    [{ classId: "aaaaaaaaaaaaaaaaaaaaaaaa", subjectIds: ["bbbbbbbbbbbbbbbbbbbbbbbb"] }]
  );
  for (const assignments of [
    [null],
    [{ classId: "invalid", subjectIds: ["bbbbbbbbbbbbbbbbbbbbbbbb"] }],
    [{ classId: "aaaaaaaaaaaaaaaaaaaaaaaa", subjectIds: ["invalid"] }],
    [{ classId: "aaaaaaaaaaaaaaaaaaaaaaaa", subjectIds: [] }],
  ]) {
    assert.throws(() => validateTeacherAssignments(assignments), { statusCode: 400 });
  }
});

test("a finalized lesson missing a student's record is classified incomplete", () => {
  const finalized = [lesson("444444444444444444444441")];
  const result = evaluateStudentEligibility({
    student,
    finalizedLessons: finalized,
    incompleteLessons: [],
    recordByLessonStudent: new Map(),
  });
  assert.equal(result.eligibility, "attendance_incomplete");
  assert.equal(result.totalFinalizedSessions, 0);
  assert.equal(result.incompleteSessions, 1);
});

test("lesson roster submission requires one explicit status per roster student", () => {
  const first = "111111111111111111111111";
  const second = "111111111111111111111112";
  const result = parseRosterStatuses(
    [
      { studentId: first, status: "present" },
      { studentId: second, status: "absent" },
    ],
    [first, second]
  );
  assert.equal(result.size, 2);
  assert.equal(
    parseRosterStatuses(
      [
        { studentId: first, status: "permission" },
        { studentId: second, status: "present" },
      ],
      [first, second]
    ).get(first),
    "permission"
  );
  assert.throws(
    () => parseRosterStatuses([{ studentId: first, status: "present" }], [first, second]),
    { statusCode: 422 }
  );
  assert.throws(
    () => parseRosterStatuses([{ studentId: "111111111111111111111113", status: "present" }], [first]),
    { statusCode: 422 }
  );
});

test("Ethiopian date-derived academic period and teacher subject permissions are validated", () => {
  assert.deepEqual(parseCanonicalDate("2026-10-24"), {
    date: new Date("2026-10-24T00:00:00.000Z"),
    academicYear: 2019,
    academicMonth: 2,
  });
  const classId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const subjectId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const teacher = {
    role: "teacher",
    assignments: [{ classId, subjectIds: [subjectId] }],
  };
  assert.equal(hasTeacherAccess(teacher, classId, subjectId), true);
  assert.equal(hasTeacherAccess(teacher, classId, "cccccccccccccccccccccccc"), false);
});

test("subject and lesson records have unique keys scoped to their actual identity", () => {
  for (const model of [SubjectAttendance]) {
    assert.deepEqual(model.schema.path("status").enumValues, [
      "present",
      "absent",
      "permission",
    ]);
  }
  const expected = [
    [Subject, { classId: 1, nameKey: 1 }],
    [SubjectLesson, { classId: 1, subjectId: 1, lessonDate: 1 }],
    [SubjectAttendance, { lessonId: 1, studentId: 1 }],
    [AcademicTerm, { academicYear: 1, nameKey: 1 }],
    [UserAccount, { username: 1 }],
    [Exam, { classId: 1, subjectId: 1, academicYear: 1, nameKey: 1 }],
    [ExamMark, { examId: 1, studentId: 1 }],
  ];
  for (const [model, fields] of expected) {
    assert.ok(
      model.schema.indexes().some(
        ([keys, options]) =>
          options.unique === true &&
          Object.keys(fields).length === Object.keys(keys).length &&
          Object.entries(fields).every(([key, value]) => keys[key] === value)
      ),
      `${model.modelName} should declare its unique key`
    );
  }
});

test("portal authentication binds student data to the account, not a supplied student ID", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousFindOne = UserAccount.findOne;
  process.env.JWT_SECRET = TEST_SECRET;
  const accountId = new mongoose.Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaa1");
  const boundStudentId = new mongoose.Types.ObjectId("bbbbbbbbbbbbbbbbbbbbbbb1");
  const otherStudentId = "ccccccccccccccccccccccc1";
  UserAccount.findOne = () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: accountId,
      username: "student-portal",
      role: "student",
      studentId: boundStudentId,
      assignments: [],
      mustChangePassword: false,
    }),
  });

  const app = express();
  app.get(
    "/private",
    authenticateAccount,
    authorizeAccountRoles("student"),
    requireChangedPassword,
    (req, res) => res.json({ studentId: String(req.account.studentId) })
  );
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const token = jwt.sign(
      { role: "student" },
      TEST_SECRET,
      {
        algorithm: "HS256",
        subject: String(accountId),
        issuer: TOKEN_ISSUER,
        expiresIn: "5m",
      }
    );
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/private?studentId=${otherStudentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.studentId, String(boundStudentId));
    assert.notEqual(payload.studentId, otherStudentId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    UserAccount.findOne = previousFindOne;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("portal login enforces selected roles and portal account creation stays admin-only", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousFindOne = UserAccount.findOne;
  const previousCompare = bcrypt.compare;
  process.env.JWT_SECRET = TEST_SECRET;
  const accountId = new mongoose.Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaa2");
  UserAccount.findOne = () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: accountId,
      username: "teacher-portal",
      passwordHash: "test-hash",
      role: "teacher",
      assignments: [],
      mustChangePassword: true,
    }),
  });
  bcrypt.compare = async () => true;

  const app = express();
  app.use(express.json());
  app.use("/api/auth/portal", portalRoutes);
  app.use("/api/school", schoolRoutes);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = async (expectedRole) => fetch(`${base}/api/auth/portal/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "teacher-portal",
        password: "temporary-password",
        expectedRole,
      }),
    });
    const teacherLogin = await login("teacher");
    const teacherPayload = await teacherLogin.json();
    assert.equal(teacherLogin.status, 200);
    assert.equal(teacherPayload.role, "teacher");
    assert.equal(teacherPayload.mustChangePassword, true);

    const wrongRoleLogin = await login("student");
    assert.equal(wrongRoleLogin.status, 401);
    const invalidRoleLogin = await login("admin");
    assert.equal(invalidRoleLogin.status, 400);

    const unauthenticatedCreate = await fetch(`${base}/api/school/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "new-user", role: "teacher" }),
    });
    assert.equal(unauthenticatedCreate.status, 401);

    const teacherToken = jwt.sign(
      { role: "teacher" },
      TEST_SECRET,
      {
        algorithm: "HS256",
        subject: String(accountId),
        issuer: TOKEN_ISSUER,
        expiresIn: "5m",
      }
    );
    const forbiddenCreate = await fetch(`${base}/api/school/accounts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "new-user", role: "teacher" }),
    });
    assert.equal(forbiddenCreate.status, 403);

    const adminToken = jwt.sign(
      { role: "admin" },
      TEST_SECRET,
      {
        algorithm: "HS256",
        subject: "admin@example.test",
        issuer: TOKEN_ISSUER,
        expiresIn: "5m",
      }
    );
    const invalidRegistrationRole = await fetch(`${base}/api/school/accounts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "new-user", role: "admin" }),
    });
    assert.equal(invalidRegistrationRole.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    UserAccount.findOne = previousFindOne;
    bcrypt.compare = previousCompare;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("new school, lesson, eligibility, exam, and portal-data routes reject unauthenticated requests", async () => {
  const app = express();
  app.use("/api/school", schoolRoutes);
  app.use("/api/lessons", subjectLessonsRoutes);
  app.use("/api/eligibility", eligibilityRoutes);
  app.use("/api/exams", examsRoutes);
  app.use("/api/auth/portal", portalRoutes);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const paths = [
      "/api/school/classes",
      "/api/lessons",
      "/api/eligibility",
      "/api/exams",
      "/api/auth/portal/me",
    ];
    const responses = await Promise.all(paths.map((path) => fetch(`${base}${path}`)));
    assert.deepEqual(responses.map(({ status }) => status), [401, 401, 401, 401, 401]);
    const accountCreation = await fetch(`${base}/api/school/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "new-user", role: "student" }),
    });
    assert.equal(accountCreation.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("subject lesson submission finalizes complete rosters and edits without duplicates", async () => {
  const lessonId = new mongoose.Types.ObjectId("ddddddddddddddddddddddd1");
  const roster = [
    new mongoose.Types.ObjectId("eeeeeeeeeeeeeeeeeeeeeee1"),
    new mongoose.Types.ObjectId("eeeeeeeeeeeeeeeeeeeeeee2"),
  ];
  const lessonRecord = { _id: lessonId, status: "scheduled", rosterStudentIds: roster };
  const attendanceRecords = new Map();
  const lessonModel = {
    findById: () => ({
      session() { return this; },
      lean: async () => ({ ...lessonRecord }),
    }),
    updateOne: async (filter, update) => {
      if (lessonRecord.status !== filter.status) return { matchedCount: 0 };
      Object.assign(lessonRecord, update.$set);
      return { matchedCount: 1 };
    },
  };
  const attendanceModel = {
    bulkWrite: async (operations) => {
      for (const operation of operations) {
        const { filter, update } = operation.updateOne;
        attendanceRecords.set(`${filter.lessonId}:${filter.studentId}`, update.$set.status);
      }
    },
  };
  const startSession = async () => ({
    withTransaction: (callback) => callback(),
    endSession: async () => {},
  });
  const submissions = [
    { studentId: String(roster[0]), status: "present" },
    { studentId: String(roster[1]), status: "absent" },
  ];
  await submitLessonAttendance({
    lessonId: String(lessonId),
    statuses: submissions,
    actor: "teacher",
    lessonModel,
    attendanceModel,
    startSession,
  });
  assert.equal(lessonRecord.status, "finalized");
  assert.equal(attendanceRecords.size, 2);
  await submitLessonAttendance({
    lessonId: String(lessonId),
    statuses: [
      { studentId: String(roster[0]), status: "absent" },
      { studentId: String(roster[1]), status: "absent" },
    ],
    actor: "teacher",
    lessonModel,
    attendanceModel,
    startSession,
  });
  assert.equal(lessonRecord.status, "finalized");
  assert.equal(attendanceRecords.size, 2);
  assert.equal(attendanceRecords.get(`${lessonId}:${roster[0]}`), "absent");
  await assert.rejects(
    submitLessonAttendance({
      lessonId: String(lessonId),
      statuses: submissions.slice(0, 1),
      actor: "teacher",
      lessonModel,
      attendanceModel,
      startSession,
    }),
    { statusCode: 422 }
  );
});
