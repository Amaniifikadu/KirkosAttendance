const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Attendance = require("../src/models/Attendance");
const AttendanceSession = require("../src/models/AttendanceSession");
const attendanceRoutes = require("../src/routes/attendance.routes");
const { createAttendanceRouter } = require("../src/routes/attendance.routes");
const errorHandler = require("../src/middleware/errorHandler");
const {
  buildCompletedSessionFilter,
  createAttendanceService,
  normalizeStatusUpdates,
  parseAttendanceSelection,
} = require("../src/services/attendance");
const { TOKEN_ISSUER } = require("../src/middleware/authenticateAdmin");

const SECRET = "attendance-tests-secret-with-at-least-32-characters";
const attendanceDate = "2026-10-24";
const students = [
  {
    _id: new mongoose.Types.ObjectId("000000000000000000000001"),
    classNumber: 1,
    originalSerialNumber: "1",
    studentName: "Student One",
  },
  {
    _id: new mongoose.Types.ObjectId("000000000000000000000002"),
    classNumber: 1,
    originalSerialNumber: "2",
    studentName: "Student Two",
  },
  {
    _id: new mongoose.Types.ObjectId("000000000000000000000003"),
    classNumber: 1,
    originalSerialNumber: "10",
    studentName: "Student Ten",
  },
];

function query(value) {
  return {
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => value,
  };
}

function createFakeAttendanceService() {
  const sessions = new Map();
  const records = new Map();
  const key = (classNumber, date) => `${classNumber}:${date}`;
  const recordKey = (studentId, date) => `${studentId}:${date}`;

  const classModel = {
    findOne: () => query({ classNumber: 1 }),
  };
  const studentModel = {
    find: (filter) =>
      query(students.filter((student) => student.classNumber === filter.classNumber)),
    aggregate: async (pipeline) => {
      const match = pipeline[0].$match;
      const roster = students.filter((student) => {
        if (match.classNumber !== undefined) {
          return student.classNumber === match.classNumber;
        }
        return match._id.$in.some(
          (id) => String(id) === String(student._id)
        );
      });
      return roster.sort(
        (left, right) =>
          Number(left.originalSerialNumber) -
          Number(right.originalSerialNumber)
      );
    },
  };
  const sessionModel = {
    findOne: (filter) => query(sessions.get(key(filter.classNumber, filter.attendanceDate)) || null),
    updateOne: async (filter, update, options = {}) => {
      const sessionKey = key(filter.classNumber, filter.attendanceDate);
      let current = sessions.get(sessionKey);
      if (!current && options.upsert) {
        current = {
          ...update.$setOnInsert,
          rosterStudentIds: [],
          completedAt: null,
          completedBy: null,
        };
        sessions.set(sessionKey, current);
      }
      if (!current || (filter.status && current.status !== filter.status)) {
        return { matchedCount: 0 };
      }
      if (update.$set) Object.assign(current, update.$set);
      return { matchedCount: 1 };
    },
  };
  const attendanceModel = {
    find: (filter) =>
      query(
        [...records.values()].filter(
          (record) =>
            record.classNumber === filter.classNumber &&
            record.attendanceDate === filter.attendanceDate
        )
      ),
    bulkWrite: async (operations) => {
      for (const operation of operations) {
        if (operation.updateOne) {
          const { filter, update, upsert } = operation.updateOne;
          const recordId = recordKey(
            String(filter.studentId),
            filter.attendanceDate
          );
          const current = records.get(recordId);
          if (current) {
            Object.assign(current, update.$set);
          } else if (upsert) {
            records.set(recordId, {
              ...update.$setOnInsert,
              ...update.$set,
            });
          }
        } else if (operation.deleteOne) {
          const { filter } = operation.deleteOne;
          records.delete(
            recordKey(String(filter.studentId), filter.attendanceDate)
          );
        }
      }
      return { acknowledged: true };
    },
  };
  const startSession = async () => ({
    withTransaction: async (callback) => callback({}),
    endSession: async () => {},
  });

  return {
    service: createAttendanceService({
      attendanceModel,
      sessionModel,
      classModel,
      studentModel,
      startSession,
    }),
    sessions,
    records,
  };
}

function statuses(overrides = {}) {
  return students.map((student) => ({
    studentId: String(student._id),
    status: overrides[String(student._id)] || "not_recorded",
  }));
}

function createAdminToken() {
  return jwt.sign(
    { role: "admin" },
    SECRET,
    {
      algorithm: "HS256",
      subject: "admin@example.test",
      issuer: TOKEN_ISSUER,
      expiresIn: "5m",
    }
  );
}

test("validates canonical Gregorian dates, class numbers, and duplicate status entries", () => {
  assert.deepEqual(parseAttendanceSelection("1", attendanceDate), {
    classNumber: 1,
    attendanceDate,
  });
  assert.throws(
    () => parseAttendanceSelection("13", attendanceDate),
    { statusCode: 400 }
  );
  assert.throws(
    () => parseAttendanceSelection("1", "2026-02-30"),
    { statusCode: 400 }
  );
  assert.throws(
    () =>
      normalizeStatusUpdates([
        { studentId: String(students[0]._id), status: "present" },
        { studentId: String(students[0]._id), status: "absent" },
      ]),
    { statusCode: 400 }
  );
  assert.deepEqual(
    normalizeStatusUpdates([
      { studentId: String(students[0]._id), status: "permission" },
    ]),
    [{ studentId: String(students[0]._id), status: "permission" }]
  );
});

test("attendance endpoints require administrator authentication", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  const app = express();
  app.use("/api/attendance", attendanceRoutes);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/attendance/session`;
    const readResponse = await fetch(
      `${baseUrl}?classNumber=1&attendanceDate=${attendanceDate}`
    );
    const draftResponse = await fetch(`${baseUrl}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const completeResponse = await fetch(`${baseUrl}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.deepEqual(
      [readResponse.status, draftResponse.status, completeResponse.status],
      [401, 401, 401]
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("attendance writes fail closed when required unique indexes are missing", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  let writeCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/attendance",
    createAttendanceRouter({
      attendanceService: {
        saveDraft: async () => {
          writeCalls += 1;
        },
      },
      attendanceModel: { collection: { indexes: async () => [] } },
      sessionModel: { collection: { indexes: async () => [] } },
    })
  );
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/attendance/session/draft`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${createAdminToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );
    assert.equal(response.status, 503);
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("write endpoints map duplicate-key races to a safe conflict response", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  const attendanceService = {
    saveDraft: async () => {
      throw Object.assign(new Error("duplicate key detail"), { code: 11000 });
    },
  };
  const uniqueIndexModel = (name, key) => ({
    collection: {
      indexes: async () => [{ name, key, unique: true }],
    },
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/attendance",
    createAttendanceRouter({
      attendanceService,
      attendanceModel: uniqueIndexModel(
        "unique_student_attendance_per_date",
        { studentId: 1, attendanceDate: 1 }
      ),
      sessionModel: uniqueIndexModel(
        "unique_attendance_session_per_class_date",
        { classNumber: 1, attendanceDate: 1 }
      ),
    })
  );
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/attendance/session/draft`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${createAdminToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.match(payload.message, /changed concurrently/i);
    assert.doesNotMatch(JSON.stringify(payload), /duplicate key detail/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("draft save supports partial statuses and reloading does not duplicate records", async () => {
  const { service, records, sessions } = createFakeAttendanceService();
  const firstStudent = String(students[0]._id);
  const secondStudent = String(students[1]._id);

  await service.saveDraft({
    classNumber: 1,
    attendanceDate,
    statuses: [{ studentId: firstStudent, status: "present" }],
  });
  let loaded = await service.getSession({
    classNumber: "1",
    attendanceDate,
  });
  assert.equal(loaded.session.status, "draft");
  assert.deepEqual(
    loaded.students.map(({ status }) => status),
    ["present", "not_recorded", "not_recorded"]
  );

  await service.saveDraft({
    classNumber: 1,
    attendanceDate,
    statuses: [
      { studentId: firstStudent, status: "absent" },
      { studentId: secondStudent, status: "present" },
    ],
  });
  loaded = await service.getSession({
    classNumber: "1",
    attendanceDate,
  });
  assert.equal(sessions.size, 1);
  assert.equal(records.size, 2);
  assert.deepEqual(
    loaded.students.map(({ status }) => status),
    ["absent", "present", "not_recorded"]
  );
});

test("rejects completion while any enrolled student is not recorded", async () => {
  const { service, sessions, records } = createFakeAttendanceService();
  await assert.rejects(
    service.completeSession(
      {
        classNumber: 1,
        attendanceDate,
        statuses: [
          { studentId: String(students[0]._id), status: "present" },
          { studentId: String(students[1]._id), status: "absent" },
        ],
      },
      "admin@example.test"
    ),
    { statusCode: 422 }
  );
  assert.equal(sessions.size, 0);
  assert.equal(records.size, 0);
});

test("does not count arbitrary weekdays as scheduled attendance sessions", async () => {
  const { service, sessions, records } = createFakeAttendanceService();
  await assert.rejects(
    service.completeSession(
      {
        classNumber: 1,
        attendanceDate: "2026-10-23",
        statuses: statuses({
          [String(students[0]._id)]: "present",
          [String(students[1]._id)]: "absent",
          [String(students[2]._id)]: "present",
        }),
      },
      "admin@example.test"
    ),
    { statusCode: 400 }
  );
  assert.equal(sessions.size, 0);
  assert.equal(records.size, 0);
});

test("completes only fully recorded sessions and snapshots the completion roster", async () => {
  const { service, sessions, records } = createFakeAttendanceService();
  const result = await service.completeSession(
    {
      classNumber: 1,
      attendanceDate,
      statuses: statuses({
        [String(students[0]._id)]: "present",
        [String(students[1]._id)]: "absent",
        [String(students[2]._id)]: "permission",
      }),
    },
    "admin@example.test"
  );
  const savedSession = sessions.get(`1:${attendanceDate}`);
  assert.equal(result.session.status, "complete");
  assert.equal(records.size, 3);
  assert.equal(
    records.get(`${String(students[2]._id)}:${attendanceDate}`).status,
    "permission"
  );
  assert.deepEqual(
    savedSession.rosterStudentIds.map(String),
    students.map(({ _id }) => String(_id))
  );
  assert.equal(savedSession.completedBy, "admin@example.test");
});

test("rejects students outside the selected class and permits completed-session corrections only", async () => {
  const { service, records } = createFakeAttendanceService();
  const outsider = new mongoose.Types.ObjectId(
    "000000000000000000000004"
  );
  await assert.rejects(
    service.saveDraft({
      classNumber: 1,
      attendanceDate,
      statuses: [{ studentId: String(outsider), status: "present" }],
    }),
    { statusCode: 422 }
  );

  await service.completeSession(
    {
      classNumber: 1,
      attendanceDate,
      statuses: statuses({
        [String(students[0]._id)]: "present",
        [String(students[1]._id)]: "absent",
        [String(students[2]._id)]: "present",
      }),
    },
    "admin@example.test"
  );
  students[0].classNumber = 2;
  await service.saveDraft({
    classNumber: 1,
    attendanceDate,
    statuses: [{ studentId: String(students[0]._id), status: "absent" }],
  });
  const loaded = await service.getSession({
    classNumber: "1",
    attendanceDate,
  });
  assert.equal(loaded.session.status, "complete");
  assert.equal(loaded.students[0].classNumber, 1);
  assert.equal(loaded.students[0].status, "absent");
  assert.equal(records.size, 3);
  students[0].classNumber = 1;
  await assert.rejects(
    service.saveDraft({
      classNumber: 1,
      attendanceDate,
      statuses: [{ studentId: String(students[0]._id), status: "not_recorded" }],
    }),
    { statusCode: 409 }
  );
});

test("unique indexes protect student/date records and class/date sessions", () => {
  assert.deepEqual(Attendance.schema.path("status").enumValues, [
    "present",
    "absent",
    "permission",
  ]);
  assert.ok(
    Attendance.schema.indexes().some(
      ([fields, options]) =>
        fields.studentId === 1 &&
        fields.attendanceDate === 1 &&
        options.unique === true
    )
  );
  assert.ok(
    AttendanceSession.schema.indexes().some(
      ([fields, options]) =>
        fields.classNumber === 1 &&
        fields.attendanceDate === 1 &&
        options.unique === true
    )
  );
});

test("future denominators include only completed sessions containing the roster snapshot", () => {
  assert.deepEqual(
    buildCompletedSessionFilter(String(students[0]._id)),
    {
      status: "complete",
      rosterStudentIds: students[0]._id,
    }
  );
});
