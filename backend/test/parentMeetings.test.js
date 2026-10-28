const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const UserAccount = require("../src/models/UserAccount");
const Class = require("../src/models/Class");
const ParentMeeting = require("../src/models/ParentMeeting");
const ParentMeetingAttendance = require("../src/models/ParentMeetingAttendance");
const errorHandler = require("../src/middleware/errorHandler");
const { TOKEN_ISSUER } = require("../src/middleware/authenticateAdmin");
const SUNDAY_SCHOOL_CLASSES = require("../src/config/sundaySchoolClasses");
const {
  buildAnnualReportWorkbook,
  createAnnualReportPdf,
  createParentMeetingAllClassesPdf,
  buildParentMeetingWorkbook,
  createParentMeetingsRouter,
  createParentMeetingPdf,
} = require("../src/routes/parentMeetings.routes");
const XLSX = require("xlsx");
const {
  buildAnnualReport,
  createParentMeetingService,
  normalizeStatuses,
  validateMeetingDate,
} = require("../src/services/parentMeetings");

const SECRET = "parent-meetings-tests-secret-with-at-least-32-characters";
const meetingId = new mongoose.Types.ObjectId("000000000000000000000010");
const students = [
  {
    _id: new mongoose.Types.ObjectId("000000000000000000000001"),
    classNumber: 1,
    originalSerialNumber: "10",
    studentName: "Student Ten",
  },
  {
    _id: new mongoose.Types.ObjectId("000000000000000000000002"),
    classNumber: 1,
    originalSerialNumber: "2",
    studentName: "Student Two",
  },
];

function createServiceModels() {
  let meeting = {
    _id: meetingId,
    meetingDate: "2026-10-24",
    academicYear: 2019,
    academicMonth: 2,
  };
  const records = new Map();
  return {
    records,
    meetingModel: {
      find: () => ({
        sort() {
          return this;
        },
        lean: async () => [meeting],
      }),
      findById: () => ({ lean: async () => meeting }),
      create: async (value) => ({ ...value, _id: meetingId }),
      updateOne: async (filter, update) => {
        if (
          !meeting ||
          String(meeting._id) !== String(filter._id) ||
          (filter.operationLock?.$exists === false &&
            meeting.operationLock !== undefined) ||
          (filter.operationLock &&
            typeof filter.operationLock === "string" &&
            meeting.operationLock !== filter.operationLock) ||
          (filter.deletionState?.$ne === "deleting" &&
            meeting.deletionState === "deleting")
        ) {
          return { matchedCount: 0 };
        }
        Object.assign(meeting, update.$set || {});
        if (update.$unset) {
          for (const field of Object.keys(update.$unset)) delete meeting[field];
        }
        return { matchedCount: 1 };
      },
      deleteOne: async (filter) => {
        if (
          !meeting ||
          String(meeting._id) !== String(filter._id) ||
          meeting.operationLock !== filter.operationLock ||
          meeting.deletionState !== filter.deletionState
        ) {
          return { deletedCount: 0 };
        }
        meeting = null;
        return { deletedCount: 1 };
      },
    },
    studentModel: {
      collection: { name: "students" },
      countDocuments: async (filter = {}) =>
        students.filter(
          (student) =>
            filter.classNumber === undefined ||
            student.classNumber === filter.classNumber
        ).length,
      aggregate: async (pipeline) => {
        const statusMatch = pipeline.find(
          (stage) => stage.$match?.status !== undefined
        )?.$match.status;
        if (pipeline.some((stage) => stage.$count)) {
          return [{ total: students.filter((student) => {
            const record = [...records.values()].find(
              (item) => String(item.studentId) === String(student._id)
            );
            return !statusMatch ||
              (statusMatch === "not_recorded" ? !record : record?.status === statusMatch);
          }).length }];
        }
        const skip = pipeline.find((stage) => stage.$skip)?.$skip || 0;
        const limit = pipeline.find((stage) => stage.$limit)?.$limit || students.length;
        return students.slice(skip, skip + limit).map((student) => {
          const record = [...records.values()].find(
            (item) => String(item.studentId) === String(student._id)
          );
          return {
            ...student,
            status: record?.status || "not_recorded",
            guardianName: record?.guardianName || "",
            notes: record?.notes || "",
            lastUpdated: record?.updatedAt || null,
          };
        }).filter((student) => !statusMatch || student.status === statusMatch);
      },
      find: (filter) => ({
        lean: async () => {
          const requested = new Set(filter._id.$in.map(String));
          return students
            .filter(({ _id }) => requested.has(String(_id)))
            .map(({ _id }) => ({ _id }));
        },
      }),
    },
    attendanceModel: {
      collection: { name: "parentmeetingattendances" },
      aggregate: async (pipeline) => {
        const matchingMeetingIds = new Set(
          pipeline[0].$match.meetingId.$in.map(String)
        );
        const classNumber = pipeline.find(
          (stage) => stage.$match?.["student.classNumber"] !== undefined
        )?.$match?.["student.classNumber"];
        const counts = new Map();
        for (const record of records.values()) {
          const student = students.find(
            ({ _id }) => String(_id) === String(record.studentId)
          );
          if (
            !matchingMeetingIds.has(String(record.meetingId)) ||
            !student ||
            (classNumber !== undefined && student.classNumber !== classNumber)
          ) {
            continue;
          }
          const key = `${record.meetingId}:${record.status}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return [...counts].map(([key, count]) => {
          const [id, status] = key.split(":");
          return { _id: { meetingId: id, status }, count };
        });
      },
      find: () => ({
        lean: async () => [...records.values()],
      }),
      bulkWrite: async (operations) => {
        for (const { updateOne } of operations) {
          const id = String(updateOne.filter.studentId);
          records.set(id, {
            meetingId: updateOne.filter.meetingId,
            studentId: updateOne.filter.studentId,
            ...records.get(id),
            ...updateOne.update.$set,
          });
        }
      },
    },
  };
}

function tokenFor(role = "admin") {
  return jwt.sign(
    { role },
    SECRET,
    {
      algorithm: "HS256",
      subject: "admin@example.test",
      issuer: TOKEN_ISSUER,
      expiresIn: "5m",
    }
  );
}

test("validates Sunday meeting dates and Ethiopian periods from canonical Gregorian dates", () => {
  assert.deepEqual(validateMeetingDate("2026-10-25", 2019, 2), {
    academicYear: 2019,
    academicMonth: 2,
  });
  assert.throws(
    () => validateMeetingDate("2026-10-24", 2019, 2),
    /Sundays/
  );
  assert.throws(
    () => validateMeetingDate("2026-10-25", 2019, 1),
    { statusCode: 400 }
  );
  assert.throws(
    () => validateMeetingDate("2026-02-30", 2018, 6),
    { statusCode: 400 }
  );
});

test("annual report uses all 13 Ethiopian months and weighted student-meeting totals", () => {
  const result = buildAnnualReport({
    academicYear: 2019,
    classNumber: undefined,
    meetings: [
      { _id: "jan-1", academicMonth: 1 },
      { _id: "jan-2", academicMonth: 1 },
      { _id: "mar-1", academicMonth: 3 },
    ],
    populationByClass: [
      { classNumber: 1, totalStudents: 2 },
      { classNumber: 2, totalStudents: 1 },
    ],
    attendanceGroups: [
      { meetingId: "jan-1", classNumber: 1, status: "present", count: 1 },
      { meetingId: "jan-1", classNumber: 2, status: "absent", count: 1 },
      { meetingId: "jan-2", classNumber: 1, status: "present", count: 1 },
      { meetingId: "jan-2", classNumber: 2, status: "permission", count: 1 },
      { meetingId: "mar-1", classNumber: 1, status: "absent", count: 1 },
      { meetingId: "mar-1", classNumber: 2, status: "absent", count: 1 },
    ],
    classNumbers: [1, 2, 3],
  });

  assert.equal(result.monthly.length, 13);
  assert.deepEqual(result.monthly[0], {
    academicMonth: 1,
    meetingCount: 2,
    totalStudents: 3,
    totalStudentMeetings: 6,
    present: 2,
    absent: 1,
    permission: 1,
    notRecorded: 2,
    attendancePercentage: 33.3,
  });
  assert.deepEqual(result.monthly[1], {
    academicMonth: 2,
    meetingCount: 0,
    totalStudents: 0,
    totalStudentMeetings: 0,
    present: 0,
    absent: 0,
    permission: 0,
    notRecorded: 0,
    attendancePercentage: 0,
  });
  assert.equal(result.summary.meetingCount, 3);
  assert.equal(result.summary.totalStudents, 3);
  assert.equal(result.summary.totalStudentMeetings, 9);
  assert.equal(result.summary.present, 2);
  assert.equal(result.summary.absent, 3);
  assert.equal(result.summary.permission, 1);
  assert.equal(result.summary.notRecorded, 3);
  assert.equal(result.summary.attendancePercentage, 22.2);
  assert.equal(result.classes[2].totalStudents, 0);
  assert.equal(result.classes[2].totalStudentMeetings, 0);
});

test("annual class filter recalculates attendance denominator for that class", () => {
  const report = buildAnnualReport({
    academicYear: 2019,
    classNumber: 1,
    meetings: [
      { _id: "first", academicMonth: 1 },
      { _id: "second", academicMonth: 4 },
    ],
    populationByClass: [
      { classNumber: 1, totalStudents: 2 },
      { classNumber: 2, totalStudents: 50 },
    ],
    attendanceGroups: [
      { meetingId: "first", classNumber: 1, status: "present", count: 1 },
      { meetingId: "second", classNumber: 1, status: "present", count: 1 },
      { meetingId: "first", classNumber: 2, status: "present", count: 50 },
    ],
    classNumbers: [1, 2],
  });
  assert.equal(report.selectedClassName, SUNDAY_SCHOOL_CLASSES.getDisplayName(1));
  assert.equal(report.summary.totalStudents, 2);
  assert.equal(report.summary.totalStudentMeetings, 4);
  assert.equal(report.summary.present, 2);
  assert.equal(report.summary.attendancePercentage, 50);
  assert.deepEqual(report.classes.map(({ classNumber }) => classNumber), [1]);
});

test("annual service aggregates all meetings and student populations without per-meeting requests", async () => {
  const meetings = [
    { _id: "month-1-a", academicMonth: 1, academicYear: 2019 },
    { _id: "month-1-b", academicMonth: 1, academicYear: 2019 },
    { _id: "month-3-a", academicMonth: 3, academicYear: 2019 },
  ];
  let populationAggregations = 0;
  let attendanceAggregations = 0;
  let attendancePipeline;
  const service = await createParentMeetingService({
    classModel: {
      find: () => ({
        sort() { return this; },
        select() { return this; },
        lean: async () => [],
      }),
    },
    meetingModel: {
      find: (filter) => ({
        sort() { return this; },
        lean: async () => {
          assert.deepEqual(filter, { academicYear: 2019 });
          return meetings;
        },
      }),
    },
    studentModel: {
      collection: { name: "students" },
      aggregate: async (pipeline) => {
        populationAggregations += 1;
        assert.deepEqual(pipeline[0].$match.classNumber, { $gte: 1, $lte: 12 });
        return [
          { _id: 1, totalStudents: 2 },
          { _id: 2, totalStudents: 1 },
        ];
      },
    },
    attendanceModel: {
      aggregate: async (pipeline) => {
        attendanceAggregations += 1;
        attendancePipeline = pipeline;
        return [
          { meetingId: "month-1-a", classNumber: 1, status: "present", count: 1 },
          { meetingId: "month-1-b", classNumber: 2, status: "absent", count: 1 },
          { meetingId: "month-3-a", classNumber: 1, status: "permission", count: 1 },
        ];
      },
    },
  });

  const report = await service.getAnnualReport("2019");
  assert.equal(populationAggregations, 1);
  assert.equal(attendanceAggregations, 1);
  assert.ok(attendancePipeline.some(
    (stage) => stage.$group?._id?.meetingId === "$meetingId" &&
      stage.$group?._id?.studentId === "$studentId"
  ));
  assert.equal(report.monthly[0].meetingCount, 2);
  assert.equal(report.monthly[2].meetingCount, 1);
  assert.equal(report.summary.totalStudentMeetings, 9);
  assert.equal(report.summary.present, 1);
  assert.equal(report.summary.absent, 1);
  assert.equal(report.summary.permission, 1);
  assert.equal(report.summary.notRecorded, 6);
});

test("rejects duplicate student entries and unknown parent attendance statuses", () => {
  const studentId = String(students[0]._id);
  assert.throws(
    () =>
      normalizeStatuses([
        { studentId, status: "present" },
        { studentId, status: "absent" },
      ]),
    { statusCode: 400 }
  );
  assert.throws(
    () => normalizeStatuses([{ studentId, status: "excused" }]),
    { statusCode: 400 }
  );
  for (const status of ["present", "absent", "permission", "not_recorded"]) {
    assert.equal(
      normalizeStatuses([{ studentId, status }])[0].status,
      status
    );
  }
});

test("meeting and attendance schemas declare unique meeting and student keys", () => {
  const meetingIndex = ParentMeeting.schema
    .indexes()
    .find(([, options]) => options.name === "unique_parent_meeting_date");
  const attendanceIndex = ParentMeetingAttendance.schema
    .indexes()
    .find(([, options]) => options.name === "unique_parent_meeting_student");

  assert.deepEqual(meetingIndex[0], { meetingDate: 1 });
  assert.equal(meetingIndex[1].unique, true);
  assert.deepEqual(attendanceIndex[0], { meetingId: 1, studentId: 1 });
  assert.equal(attendanceIndex[1].unique, true);
  assert.deepEqual(ParentMeetingAttendance.schema.path("status").enumValues, [
    "present",
    "absent",
    "permission",
    "not_recorded",
  ]);
});

test("updates the same meeting/student record and leaves other students not recorded", async () => {
  const models = createServiceModels();
  const service = await createParentMeetingService(models);
  const firstStudentId = String(students[0]._id);

  await service.saveAttendance(String(meetingId), {
    statuses: [
      {
        studentId: firstStudentId,
        status: "present",
        guardianName: "Parent One",
        notes: "Arrived on time",
      },
    ],
  });
  await service.saveAttendance(String(meetingId), {
    statuses: [{ studentId: firstStudentId, status: "permission" }],
  });

  const result = await service.getAttendance(String(meetingId));
  assert.equal(models.records.size, 1);
  assert.equal(
    result.students.find(({ studentId }) => studentId === firstStudentId).status,
    "permission"
  );
  assert.equal(
    models.records.get(firstStudentId).guardianName,
    "Parent One"
  );
  assert.equal(models.records.get(firstStudentId).notes, "Arrived on time");
  assert.equal(result.summary.present, 0);
  assert.equal(result.summary.absent, 0);
  assert.equal(result.summary.permission, 1);
  assert.equal(result.summary.notRecorded, 1);
  assert.equal(
    result.summary.present +
      result.summary.absent +
      result.summary.permission +
      result.summary.notRecorded,
    result.summary.totalStudents
  );
  const missing = await service.getAttendance(String(meetingId), {
    status: "not_recorded",
  });
  assert.equal(missing.pagination.total, 1);
  assert.equal(missing.students[0].studentId, String(students[1]._id));
  await assert.rejects(
    service.getAttendance(String(meetingId), { status: "excused" }),
    { statusCode: 400 }
  );
});

test("monthly report isolates meeting counts and keeps the Permission count separate from Present and Absent", async () => {
  const models = createServiceModels();
  models.records.set("absent", {
    meetingId,
    studentId: students[1]._id,
    status: "absent",
  });
  models.records.set("permission", {
    meetingId,
    studentId: students[0]._id,
    status: "permission",
  });
  models.records.set("unrelated-meeting", {
    meetingId: new mongoose.Types.ObjectId("000000000000000000000011"),
    studentId: students[0]._id,
    status: "permission",
  });
  const service = await createParentMeetingService(models);
  const result = await service.listMeetings({
    academicYear: "2019",
    academicMonth: "2",
  });
  assert.deepEqual(result.meetings[0].summary, {
    totalStudents: 2,
    present: 0,
    absent: 1,
    permission: 1,
    notRecorded: 0,
  });
  assert.equal(
    result.meetings[0].summary.present +
      result.meetings[0].summary.absent +
      result.meetings[0].summary.permission +
      result.meetings[0].summary.notRecorded,
    result.meetings[0].summary.totalStudents
  );
});

test("attendance roster pagination bounds response size for large populations", async () => {
  let requestedPipeline;
  const service = await createParentMeetingService({
    meetingModel: {
      findById: () => ({
        lean: async () => ({ _id: meetingId, deletionState: "active" }),
      }),
    },
    studentModel: {
      collection: { name: "students" },
      countDocuments: async () => 2500,
      aggregate: async (pipeline) => {
        requestedPipeline = pipeline;
        if (pipeline.some((stage) => stage.$count)) return [{ total: 2500 }];
        return students.slice(0, 100);
      },
    },
    attendanceModel: {
      collection: { name: "parentmeetingattendances" },
      find: () => ({ lean: async () => [] }),
      aggregate: async () => [],
    },
  });

  const result = await service.getAttendance(String(meetingId), {
    page: "3",
    pageSize: "100",
  });
  assert.ok(result.students.length <= 100);
  assert.equal(result.pagination.total, 2500);
  assert.ok(requestedPipeline.some((stage) => stage.$skip === 200));
  assert.ok(requestedPipeline.some((stage) => stage.$limit === 100));
  await assert.rejects(
    service.getAttendance(String(meetingId), { pageSize: "101" }),
    { statusCode: 400 }
  );
});

  test("class report returns numerically sorted, mutually exclusive class totals", async () => {
    const classRecords = [
      {
        _id: new mongoose.Types.ObjectId("000000000000000000000101"),
        classNumber: 1,
        name: "Class One",
      },
      {
        _id: new mongoose.Types.ObjectId("000000000000000000000102"),
        classNumber: 12,
        name: "Class Twelve",
      },
      {
        _id: new mongoose.Types.ObjectId("000000000000000000000103"),
        classNumber: 14,
        name: "Class Fourteen",
      },
    ];
    const roster = [
      { _id: students[0]._id, classId: classRecords[0]._id, classNumber: 1 },
      { _id: students[1]._id, classId: classRecords[0]._id, classNumber: 1 },
      {
        _id: new mongoose.Types.ObjectId("000000000000000000000003"),
        classId: classRecords[1]._id,
        classNumber: 12,
      },
    ];
    const records = [
      { meetingId, studentId: roster[0]._id, status: "present" },
      { meetingId, studentId: roster[1]._id, status: "permission" },
      { meetingId, studentId: roster[2]._id, status: "absent" },
    ];
    const service = await createParentMeetingService({
      meetingModel: {
        findById: () => ({ lean: async () => ({
          _id: meetingId,
          meetingDate: "2026-10-25",
          academicYear: 2019,
          academicMonth: 2,
        }) }),
        find: () => ({
          sort() { return this; },
          lean: async () => [{
            _id: meetingId,
            meetingDate: "2026-10-25",
            academicYear: 2019,
            academicMonth: 2,
          }],
        }),
      },
      studentModel: {
        collection: { name: "students" },
        aggregate: async (pipeline) => {
          if (pipeline.some((stage) => stage.$group?._id?.classId)) {
            return classRecords.map((record) => ({
              _id: { classId: record._id, classNumber: record.classNumber },
              totalStudents: roster.filter(
                (student) => String(student.classId) === String(record._id)
              ).length,
            }));
          }
          return [];
        },
      },
      classModel: {
        find: () => ({
          sort() { return this; },
          lean: async () => classRecords,
        }),
      },
      attendanceModel: {
        aggregate: async (pipeline) => {
          const groupStage = [...pipeline].reverse().find((stage) => stage.$group);
          if (groupStage?.$group?._id?.status === "$status" &&
              groupStage.$group?._id?.classNumber === "$student.classNumber") {
            const counts = new Map();
            for (const record of records) {
              const student = roster.find(
                (candidate) => String(candidate._id) === String(record.studentId)
              );
              const key = `${student.classId}:${student.classNumber}:${record.status}`;
              counts.set(key, (counts.get(key) || 0) + 1);
            }
            return [...counts].map(([key, count]) => {
              const [classId, classNumber, status] = key.split(":");
              return {
                _id: { classId, classNumber: Number(classNumber), status },
                count,
              };
            });

          }
          const counts = new Map();
          for (const record of records) {
            const key = `${record.meetingId}:${record.status}`;
            counts.set(key, (counts.get(key) || 0) + 1);
          }
          return [...counts].map(([key, count]) => {
            const [id, status] = key.split(":");
            return { _id: { meetingId: id, status }, count };
          });
        },
      },
    });

    const result = await service.getClassReport(String(meetingId));
    assert.deepEqual(
      result.classes.map((item) => item.classNumber),
      [...Array.from({ length: 12 }, (_, index) => index + 1), 14]
    );
    assert.deepEqual(
      result.classes.map((item) => item.name),
      [
        ...SUNDAY_SCHOOL_CLASSES.map(({ displayName }) => displayName),
        "Class Fourteen",
      ]
    );
    assert.deepEqual(
      result.classes.find((item) => item.classNumber === 1),
      {
        classId: String(classRecords[0]._id),
        classNumber: 1,
        name: SUNDAY_SCHOOL_CLASSES.getDisplayName(1),
        totalStudents: 2,
        present: 1,
        absent: 0,
        permission: 1,
        notRecorded: 0,
        attendancePercentage: 50,
      }
    );
    assert.deepEqual(
      result.classes.find((item) => item.classNumber === 12),
      {
        classId: String(classRecords[1]._id),
        classNumber: 12,
        name: SUNDAY_SCHOOL_CLASSES.getDisplayName(12),
        totalStudents: 1,
        present: 0,
        absent: 1,
        permission: 0,
        notRecorded: 0,
        attendancePercentage: 0,
      }
    );
    for (const item of result.classes) {
      assert.equal(
        item.present + item.absent + item.permission + item.notRecorded,
        item.totalStudents
      );
    }
    assert.equal(result.trend.length, 13);
    assert.equal(result.trend[1].attendancePercentage, 33.3);
  });

  test("Excel export includes a summary sheet and a separate class roster sheet", async () => {
    const classId = String(students[0]._id);
    const workbook = buildParentMeetingWorkbook(
      {
        meeting: {
          meetingDate: "2026-10-24",
          academicYear: 2019,
          academicMonth: 2,
        },
        classes: [{
          classId,
          classNumber: 1,
          name: "Class One",
          totalStudents: 1,
          present: 0,
          absent: 0,
          permission: 1,
          notRecorded: 0,
          attendancePercentage: 0,
        }],
      },
      [{
        _id: students[0]._id,
        classId: students[0]._id,
        originalSerialNumber: "1",
        studentName: "Student One",
      }],
      [{
        studentId: students[0]._id,
        status: "permission",
        guardianName: "Guardian",
        updatedAt: new Date("2026-10-24T00:00:00.000Z"),
      }],
      [{ _id: students[0]._id, name: "Class One" }]
    );
    const className = SUNDAY_SCHOOL_CLASSES.getDisplayName(1);
    assert.deepEqual(workbook.SheetNames, ["Summary", className]);
    const summary = XLSX.utils.sheet_to_json(workbook.Sheets.Summary, { range: 5 });
    const classRows = XLSX.utils.sheet_to_json(
      workbook.Sheets[className],
      { header: 1 }
    );
    assert.equal(workbook.Sheets.Summary.B2.v, "14 ጥቅምት 2019 ዓ.ም.");
    assert.equal(summary[0].Permission, 1);
    assert.equal(classRows[4][4], "Parent Status");
    assert.equal(classRows[5][4], "permission");
    assert.equal(classRows[5][7], "14 ጥቅምት 2019 ዓ.ም.");
    assert.equal(
      buildParentMeetingWorkbook(
        {
          meeting: {
            meetingDate: "2026-10-24",
            academicYear: 2019,
            academicMonth: 2,
          },
          classes: [{ classId, classNumber: 1, name: "Class One" }],
        },
        [],
        [],
        [],
        "1"
      ).SheetNames.length,
      2
    );
    const pdf = await createParentMeetingPdf(
      {
        meeting: {
          meetingDate: "2026-10-24",
          academicYear: 2019,
          academicMonth: 2,
        },
        classes: [{
          name: "Class One",
          classNumber: 1,
          totalStudents: 1,
          present: 0,
          absent: 0,
          permission: 1,
          notRecorded: 0,
          attendancePercentage: 0,
        }],
      }
    );
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 500);
  });

  test("all-class Excel and PDF exports include numeric class order and empty classes", async () => {
    const classSummaries = SUNDAY_SCHOOL_CLASSES.map(
      ({ classNumber, displayName }) => ({
        classId: `configured-class-${classNumber}`,
        classNumber,
        name: displayName,
        totalStudents: classNumber === 1 ? 1 : 0,
        present: classNumber === 1 ? 1 : 0,
        absent: 0,
        permission: 0,
        notRecorded: 0,
        attendancePercentage: classNumber === 1 ? 100 : 0,
      })
    );
    const report = {
      meeting: {
        meetingDate: "2026-10-25",
        academicYear: 2019,
        academicMonth: 2,
      },
      classes: [
        ...classSummaries,
        {
          classId: "unconfigured-class",
          classNumber: 14,
          name: "Class Fourteen",
          totalStudents: 1,
          present: 1,
          absent: 0,
          permission: 0,
          notRecorded: 0,
          attendancePercentage: 100,
        },
      ],
    };
    const workbook = buildParentMeetingWorkbook(report, [], [], []);
    assert.equal(workbook.SheetNames.length, 13);
    assert.deepEqual(workbook.SheetNames.slice(1), classSummaries.map(({ name }) => name));
    assert.equal(workbook.SheetNames.includes("Class Fourteen"), false);
    assert.equal(workbook.Sheets[classSummaries[0].name].A1.v, classSummaries[0].name);
    assert.equal(workbook.Sheets[classSummaries[11].name].A1.v, classSummaries[11].name);

    const pdf = await createParentMeetingAllClassesPdf(report, [], []);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 1000);
  });

  test("annual PDF and Excel exports contain all 13 months and year totals", async () => {
    const report = buildAnnualReport({
      academicYear: 2019,
      classNumber: undefined,
      meetings: [{ _id: "m1", academicMonth: 1 }],
      populationByClass: [{ classNumber: 1, totalStudents: 1 }],
      attendanceGroups: [
        { meetingId: "m1", classNumber: 1, status: "present", count: 1 },
      ],
      classNumbers: [1, 2],
    });
    const workbook = buildAnnualReportWorkbook(report);
    assert.deepEqual(workbook.SheetNames, [
      "Annual Summary",
      "Monthly Breakdown",
      "Class Breakdown",
    ]);
    assert.equal(workbook.Sheets["Annual Summary"].B2.v, 2019);
    assert.equal(
      XLSX.utils.sheet_to_json(workbook.Sheets["Monthly Breakdown"]).length,
      13
    );
    assert.equal(
      XLSX.utils.sheet_to_json(workbook.Sheets["Class Breakdown"]).length,
      2
    );
    const pdf = await createAnnualReportPdf(report);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 500);
  });

test("deleting an attendance row removes only its parent-meeting record in an assigned class", async () => {
  const classId = new mongoose.Types.ObjectId("000000000000000000000111");
  let deletedFilter;
  const service = await createParentMeetingService({
    meetingModel: {
      findById: () => ({ lean: async () => ({ _id: meetingId }) }),
    },
    studentModel: {
      findOne: (filter) => ({
        lean: async () => {
          assert.equal(String(filter._id), String(students[0]._id));
          assert.equal(String(filter.classId.$in[0]), String(classId));
          return { _id: students[0]._id };
        },
      }),
    },
    attendanceModel: {
      deleteOne: async (filter) => {
        deletedFilter = filter;
        return { deletedCount: 1 };
      },
    },
  });
  const result = await service.deleteStudentAttendance(
    String(meetingId),
    String(students[0]._id),
    [String(classId)]
  );
  assert.equal(result.deleted, true);
  assert.equal(String(deletedFilter.meetingId), String(meetingId));
  assert.equal(String(deletedFilter.studentId), String(students[0]._id));
});

test("meeting edits validate IDs and Ethiopian period metadata before updating", async () => {
  let updateCalls = 0;
  let meeting = { _id: meetingId, deletionState: "active" };
  const meetingModel = {
    findById: () => ({
      lean: async () => meeting,
    }),
    updateOne: async (filter, update) => {
      if (filter.operationLock?.$exists === false) {
        if (meeting.operationLock) return { matchedCount: 0 };
        Object.assign(meeting, update.$set);
      } else if (filter.operationLock) {
        if (meeting.operationLock !== filter.operationLock) {
          return { matchedCount: 0 };
        }
        if (update.$set?.meetingDate) {
          updateCalls += 1;
          Object.assign(meeting, update.$set);
        }
        if (update.$unset) delete meeting.operationLock;
      }
      return { matchedCount: 1 };
    },
  };
  const service = await createParentMeetingService({ meetingModel });
  await assert.rejects(
    service.updateMeeting("invalid", {}),
    { statusCode: 400 }
  );
  await assert.rejects(
    service.updateMeeting(String(meetingId), {
      meetingDate: "2026-10-24",
      academicYear: 2019,
      academicMonth: 1,
    }),
    { statusCode: 400 }
  );
  assert.equal(updateCalls, 0);
  await service.updateMeeting(String(meetingId), {
    meetingDate: "2026-10-25",
    academicYear: 2019,
    academicMonth: 2,
  });
  assert.equal(updateCalls, 1);
});

test("standalone-safe deletion removes only selected meeting attendance and supports retry", async () => {
  const otherMeetingId = new mongoose.Types.ObjectId(
    "000000000000000000000011"
  );
  const meeting = { _id: meetingId, deletionState: "active" };
  const attendanceRecords = new Map([
    ["selected", { meetingId, studentId: students[0]._id }],
    ["unrelated", { meetingId: otherMeetingId, studentId: students[1]._id }],
  ]);
  const lessonAttendanceRecords = new Map([
    ["lesson-record", { lessonId: meetingId, studentId: students[0]._id }],
  ]);
  const studentsRemain = [...students];
  let failFirstAttendanceDeletion = true;
  const meetingModel = {
    findById: () => ({
      session() {
        return this;
      },
      lean: async () => (meeting ? { ...meeting } : null),
    }),
    updateOne: async (filter, update) => {
      if (
        !meeting ||
        meeting._id.toString() !== filter._id.toString() ||
        (filter.operationLock?.$exists === false && meeting.operationLock)
      ) {
        return { matchedCount: 0 };
      }
      Object.assign(meeting, update.$set);
      if (update.$unset) {
        for (const field of Object.keys(update.$unset)) delete meeting[field];
      }
      return { matchedCount: 1 };
    },
    deleteOne: async (filter) => {
      if (
        !meeting ||
        meeting.deletionState !== filter.deletionState ||
        meeting.operationLock !== filter.operationLock
      ) {
        return { deletedCount: 0 };
      }
      meeting.deleted = true;
      return { deletedCount: 1 };
    },
  };
  const attendanceModel = {
    deleteMany: async (filter) => {
      assert.equal(filter.meetingId.toString(), String(meetingId));
      if (failFirstAttendanceDeletion) {
        failFirstAttendanceDeletion = false;
        throw new Error("temporary attendance-store failure");
      }
      for (const [key, record] of attendanceRecords) {
        if (String(record.meetingId) === String(filter.meetingId)) {
          attendanceRecords.delete(key);
        }
      }
      return { deletedCount: 1 };
    },
  };
  const service = await createParentMeetingService({
    meetingModel,
    attendanceModel,
    startSession: async () => ({
      withTransaction: async () => {
        throw Object.assign(
          new Error("Transaction numbers are only allowed on a replica set member or mongos"),
          { code: 20, codeName: "IllegalOperation" }
        );
      },
      endSession: async () => {},
    }),
  });

  await assert.rejects(
    service.deleteMeeting(String(meetingId)),
    /temporary attendance-store failure/
  );
  assert.equal(meeting.deletionState, "deleting");
  assert.equal(attendanceRecords.size, 2);

  const result = await service.deleteMeeting(String(meetingId));
  assert.equal(result.deleted, true);
  assert.equal(result.deletionMode, "retryable");
  assert.equal(attendanceRecords.size, 1);
  assert.equal(attendanceRecords.has("unrelated"), true);
  assert.equal(lessonAttendanceRecords.size, 1);
  assert.equal(studentsRemain.length, 2);
});

test("parent meeting endpoints reject unauthenticated and non-admin writes", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  let writeCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/parent-meetings",
    createParentMeetingsRouter({
      service: {
        createMeeting: async () => {
          writeCalls += 1;
        },
        saveAttendance: async () => {
          writeCalls += 1;
        },
        updateMeeting: async () => {
          writeCalls += 1;
        },
        deleteMeeting: async () => {
          writeCalls += 1;
        },
      },
      ensureIndexes: async () => {},
    })
  );
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/parent-meetings`;
    const unauthenticated = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    await (async () => {
      const previousSecret = process.env.JWT_SECRET;
      const originalUserFindOne = UserAccount.findOne;
      const originalClassFindOne = Class.findOne;
      process.env.JWT_SECRET = SECRET;
      const classId = new mongoose.Types.ObjectId("000000000000000000000201");
      const teacherId = new mongoose.Types.ObjectId("000000000000000000000202");
      let reportScope;
      let writeScope;
      let writePayload;
      UserAccount.findOne = () => ({
        select() { return this; },
        lean: async () => ({
          username: "teacher@example.test",
          role: "teacher",
          assignments: [{ classId, subjectIds: [] }],
          mustChangePassword: false,
        }),
      });
      Class.findOne = (filter) => ({
        select() { return this; },
        lean: async () => {
          assert.equal(String(filter._id.$in[0]), String(classId));
          return { _id: classId };
        },
      });
      const teacherToken = jwt.sign(
        { role: "teacher" },
        SECRET,
        {
          algorithm: "HS256",
          subject: String(teacherId),
          issuer: TOKEN_ISSUER,
          expiresIn: "5m",
        }
      );
      const app = express();
      app.use(express.json());
      app.use(
        "/api/parent-meetings",
        createParentMeetingsRouter({
          service: {
            getClassReport: async (_id, query) => {
              reportScope = query.allowedClassIds;
              return { classes: [] };
            },
            getAnnualReport: async (year, query) => {
              assert.equal(year, "2019");
              reportScope = query.allowedClassIds;
              return { academicYear: 2019, classes: [] };
            },
            saveAttendance: async (_id, body, allowedClassIds) => {
              writePayload = body;
              writeScope = allowedClassIds;
              return { updatedCount: 1 };
            },
            createMeeting: async () => {
              assert.fail("Teacher must not create meetings.");
            },
          },
          ensureIndexes: async () => {},
        })
      );
      app.use(errorHandler);
      const server = app.listen(0);
      try {
        const url = `http://127.0.0.1:${server.address().port}/api/parent-meetings`;
        const reportResponse = await fetch(`${url}/${meetingId}/report?classNumber=1`, {
          headers: { Authorization: `Bearer ${teacherToken}` },
        });
        assert.equal(reportResponse.status, 200);
        assert.deepEqual(reportScope, [String(classId)]);
        const annualResponse = await fetch(
          `${url}/annual-report?academicYear=2019&classNumber=1`,
          { headers: { Authorization: `Bearer ${teacherToken}` } }
        );
        assert.equal(annualResponse.status, 200);
        assert.deepEqual(reportScope, [String(classId)]);

        const updateResponse = await fetch(`${url}/${meetingId}/attendance`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${teacherToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            statuses: [{ studentId: String(students[0]._id), status: "present" }],
          }),
        });
        assert.equal(updateResponse.status, 200);
        assert.deepEqual(writeScope, [String(classId)]);
        assert.deepEqual(writePayload.statuses, [
          { studentId: String(students[0]._id), status: "present" },
        ]);

        const createResponse = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${teacherToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        const exportResponse = await fetch(`${url}/${meetingId}/export.xlsx`, {
          headers: { Authorization: `Bearer ${teacherToken}` },
        });
        const pdfExportResponse = await fetch(`${url}/${meetingId}/export.pdf`, {
          headers: { Authorization: `Bearer ${teacherToken}` },
        });
        const annualExcelResponse = await fetch(
          `${url}/annual-report/export.xlsx?academicYear=2019`,
          { headers: { Authorization: `Bearer ${teacherToken}` } }
        );
        const annualPdfResponse = await fetch(
          `${url}/annual-report/export.pdf?academicYear=2019`,
          { headers: { Authorization: `Bearer ${teacherToken}` } }
        );
        assert.equal(createResponse.status, 403);
        assert.equal(exportResponse.status, 403);
        assert.equal(pdfExportResponse.status, 403);
        assert.equal(annualExcelResponse.status, 403);
        assert.equal(annualPdfResponse.status, 403);
      } finally {
        await new Promise((resolve) => server.close(resolve));
        UserAccount.findOne = originalUserFindOne;
        Class.findOne = originalClassFindOne;
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
      }
    })();
    const unauthorizedRole = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenFor("teacher")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const unauthorizedEdit = await fetch(`${url}/${meetingId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokenFor("teacher")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const unauthorizedDelete = await fetch(`${url}/${meetingId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenFor("teacher")}` },
    });
    assert.deepEqual(
      [
        unauthenticated.status,
        unauthorizedRole.status,
        unauthorizedEdit.status,
        unauthorizedDelete.status,
      ],
      [401, 403, 403, 403]
    );
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
