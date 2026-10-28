const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const AttendanceSession = require("../models/AttendanceSession");
const Class = require("../models/Class");
const Student = require("../models/Student");
const { numericStudentSortStages } = require("./studentList");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const MAX_STATUS_UPDATES = 5000;

function createClientError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

function parseAttendanceSelection(classNumberValue, attendanceDateValue) {
  if (
    typeof classNumberValue !== "string" &&
    typeof classNumberValue !== "number"
  ) {
    throw createClientError("classNumber must be between 1 and 12.");
  }
  const classNumber = Number(classNumberValue);
  if (
    !Number.isInteger(classNumber) ||
    classNumber < 1 ||
    classNumber > 12 ||
    String(classNumber) !== String(classNumberValue)
  ) {
    throw createClientError("classNumber must be between 1 and 12.");
  }

  if (
    typeof attendanceDateValue !== "string" ||
    !DATE_PATTERN.test(attendanceDateValue)
  ) {
    throw createClientError("attendanceDate must use YYYY-MM-DD format.");
  }
  const date = new Date(`${attendanceDateValue}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== attendanceDateValue
  ) {
    throw createClientError("attendanceDate must be a valid Gregorian date.");
  }

  return { classNumber, attendanceDate: attendanceDateValue };
}

function normalizeStatusUpdates(statuses) {
  if (!Array.isArray(statuses) || statuses.length > MAX_STATUS_UPDATES) {
    throw createClientError(
      `statuses must be an array with no more than ${MAX_STATUS_UPDATES} entries.`
    );
  }

  const seenStudentIds = new Set();
  return statuses.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.studentId !== "string" ||
      !OBJECT_ID_PATTERN.test(entry.studentId) ||
      !mongoose.isValidObjectId(entry.studentId)
    ) {
      throw createClientError("Each status requires a valid studentId.");
    }
    const studentId = entry.studentId.toLowerCase();
    if (seenStudentIds.has(studentId)) {
      throw createClientError("A student may appear only once in statuses.");
    }
    seenStudentIds.add(studentId);

    if (!["present", "absent", "permission", "not_recorded"].includes(entry.status)) {
      throw createClientError(
        "Each status must be present, absent, permission, or not_recorded."
      );
    }
    return { studentId, status: entry.status };
  });
}

function buildCompletedSessionFilter(studentId) {
  return {
    status: "complete",
    rosterStudentIds: new mongoose.Types.ObjectId(studentId),
  };
}

function createAttendanceService({
  attendanceModel = Attendance,
  sessionModel = AttendanceSession,
  classModel = Class,
  studentModel = Student,
  startSession = () => mongoose.startSession(),
} = {}) {
  async function withTransaction(callback) {
    const session = await startSession();
    try {
      return await session.withTransaction(() => callback(session));
    } finally {
      await session.endSession();
    }
  }

  async function requireClass(classNumber, session) {
    const classQuery = classModel.findOne({ classNumber });
    const classRecord = session
      ? await classQuery.session(session).lean()
      : await classQuery.lean();
    if (!classRecord) {
      throw createClientError("The selected class is not configured.", 404);
    }
  }

  async function getStudents(classNumber, session, rosterStudentIds) {
    const match = rosterStudentIds
      ? { _id: { $in: rosterStudentIds } }
      : { classNumber };
    const pipeline = [
      { $match: match },
      ...numericStudentSortStages({ includeClassNumber: false }),
      {
        $project: {
          _id: 1,
          classNumber: 1,
          originalSerialNumber: 1,
          studentName: 1,
          christianName: 1,
        },
      },
    ];
    return studentModel.aggregate(pipeline, session ? { session } : {});
  }

  async function getSessionAndAttendance(
    classNumber,
    attendanceDate,
    session
  ) {
    let sessionQuery = sessionModel.findOne({ classNumber, attendanceDate });
    let attendanceQuery = attendanceModel.find({ classNumber, attendanceDate });
    if (session) {
      sessionQuery = sessionQuery.session(session);
      attendanceQuery = attendanceQuery.session(session);
    }
    const [attendanceSession, attendanceRecords] = await Promise.all([
      sessionQuery.lean(),
      attendanceQuery
        .select({ studentId: 1, status: 1, _id: 0 })
        .lean(),
    ]);
    return { attendanceSession, attendanceRecords };
  }

  async function getSession(query) {
    const { classNumber, attendanceDate } = parseAttendanceSelection(
      query.classNumber,
      query.attendanceDate
    );
    await requireClass(classNumber);
    const { attendanceSession, attendanceRecords } =
      await getSessionAndAttendance(classNumber, attendanceDate);
    const students = await getStudents(
      classNumber,
      null,
      attendanceSession?.status === "complete"
        ? attendanceSession.rosterStudentIds
        : null
    );
    const statusByStudentId = new Map(
      attendanceRecords.map(({ studentId, status }) => [
        String(studentId),
        status,
      ])
    );

    return {
      classNumber,
      attendanceDate,
      session: attendanceSession
        ? {
            status: attendanceSession.status,
            completedAt: attendanceSession.completedAt,
          }
        : null,
      students: students.map((student) => ({
        studentId: String(student._id),
        classNumber,
        originalSerialNumber: student.originalSerialNumber,
        studentName: student.studentName,
        christianName: student.christianName || "",
        status:
          statusByStudentId.get(String(student._id)) || "not_recorded",
      })),
    };
  }

  async function saveDraft(body) {
    const { classNumber, attendanceDate } = parseAttendanceSelection(
      body.classNumber,
      body.attendanceDate
    );
    const updates = normalizeStatusUpdates(body.statuses);

    await withTransaction(async (session) => {
      await requireClass(classNumber, session);
      const currentStudents = await studentModel
        .find({ classNumber }, { _id: 1 })
        .session(session)
        .lean();
      const { attendanceSession } = await getSessionAndAttendance(
        classNumber,
        attendanceDate,
        session
      );
      const allowedStudentIds = new Set(
        (
          attendanceSession?.status === "complete"
            ? attendanceSession.rosterStudentIds
            : currentStudents.map(({ _id }) => _id)
        ).map((id) => String(id).toLowerCase())
      );

      for (const update of updates) {
        if (!allowedStudentIds.has(update.studentId)) {
          throw createClientError(
            "A selected student does not belong to this class session.",
            422
          );
        }
        if (
          attendanceSession?.status === "complete" &&
          update.status === "not_recorded"
        ) {
          throw createClientError(
            "Completed attendance cannot be reopened by saving. Use present, absent, or permission corrections only.",
            409
          );
        }
      }

      await sessionModel.updateOne(
        { classNumber, attendanceDate },
        {
          $setOnInsert: {
            classNumber,
            attendanceDate,
            status: "draft",
          },
        },
        { upsert: true, session }
      );

      const operations = updates.map(({ studentId, status }) =>
        status === "not_recorded"
          ? {
              deleteOne: {
                filter: {
                  studentId: new mongoose.Types.ObjectId(studentId),
                  attendanceDate,
                },
              },
            }
          : {
              updateOne: {
                filter: {
                  studentId: new mongoose.Types.ObjectId(studentId),
                  attendanceDate,
                },
                update: {
                  $set: { classNumber, status },
                  $setOnInsert: {
                    studentId: new mongoose.Types.ObjectId(studentId),
                    attendanceDate,
                  },
                },
                upsert: true,
              },
            }
      );
      if (operations.length) {
        await attendanceModel.bulkWrite(operations, {
          session,
          ordered: true,
        });
      }
    });

    return getSession({ classNumber: String(classNumber), attendanceDate });
  }

  async function completeSession(body, adminEmail) {
    const { classNumber, attendanceDate } = parseAttendanceSelection(
      body.classNumber,
      body.attendanceDate
    );
    const updates = normalizeStatusUpdates(body.statuses);
    const weekday = new Date(
      `${attendanceDate}T00:00:00.000Z`
    ).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      throw createClientError(
        "Attendance sessions can be completed only for scheduled Saturday or Sunday dates."
      );
    }

    await withTransaction(async (session) => {
      await requireClass(classNumber, session);
      const currentStudents = await studentModel
        .find({ classNumber }, { _id: 1 })
        .session(session)
        .lean();
      if (!currentStudents.length) {
        throw createClientError(
          "A session cannot be completed because the selected class has no students.",
          422
        );
      }
      const { attendanceSession } = await getSessionAndAttendance(
        classNumber,
        attendanceDate,
        session
      );
      if (attendanceSession?.status === "complete") {
        throw createClientError(
          "This session is already complete. Save present/absent/permission corrections instead.",
          409
        );
      }

      const currentIds = new Set(
        currentStudents.map(({ _id }) => String(_id).toLowerCase())
      );
      const updateById = new Map(
        updates.map((update) => [update.studentId, update.status])
      );
      if (
        updates.some(
          ({ studentId, status }) =>
            !currentIds.has(studentId) || status === "not_recorded"
        ) ||
        updateById.size !== currentIds.size ||
        [...currentIds].some(
          (studentId) =>           !["present", "absent", "permission"].includes(updateById.get(studentId))
        )
      ) {
        throw createClientError(
          "Every currently enrolled student must have an explicit present, absent, or permission status before completion.",
          422
        );
      }

      await sessionModel.updateOne(
        { classNumber, attendanceDate },
        {
          $setOnInsert: {
            classNumber,
            attendanceDate,
            status: "draft",
          },
        },
        { upsert: true, session }
      );

      await attendanceModel.bulkWrite(
        updates.map(({ studentId, status }) => ({
          updateOne: {
            filter: {
              studentId: new mongoose.Types.ObjectId(studentId),
              attendanceDate,
            },
            update: {
              $set: { classNumber, status },
              $setOnInsert: {
                studentId: new mongoose.Types.ObjectId(studentId),
                attendanceDate,
              },
            },
            upsert: true,
          },
        })),
        { session, ordered: true }
      );

      const completed = await sessionModel.updateOne(
        { classNumber, attendanceDate, status: "draft" },
        {
          $set: {
            status: "complete",
            completedAt: new Date(),
            completedBy: adminEmail,
            rosterStudentIds: currentStudents.map(({ _id }) => _id),
          },
        },
        { session }
      );
      if (completed.matchedCount !== 1) {
        throw createClientError(
          "The session changed while it was being completed. Reload and try again.",
          409
        );
      }
    });

    return getSession({ classNumber: String(classNumber), attendanceDate });
  }

  return { completeSession, getSession, saveDraft };
}

module.exports = {
  buildCompletedSessionFilter,
  createAttendanceService,
  normalizeStatusUpdates,
  parseAttendanceSelection,
};
