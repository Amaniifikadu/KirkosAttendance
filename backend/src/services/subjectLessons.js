const mongoose = require("mongoose");
const SubjectAttendance = require("../models/SubjectAttendance");
const SubjectLesson = require("../models/SubjectLesson");
const { parseCanonicalDate } = require("./academicCalendar");

function parseRosterStatuses(statuses, rosterStudentIds) {
  if (!Array.isArray(statuses) || statuses.length > 5000) {
    throw Object.assign(new Error("statuses must contain no more than 5000 entries."), {
      statusCode: 400,
      expose: true,
    });
  }
  const roster = new Set(rosterStudentIds.map((id) => String(id).toLowerCase()));
  const statusByStudent = new Map();
  for (const entry of statuses) {
    if (
      !entry ||
      typeof entry.studentId !== "string" ||
      !/^[a-f\d]{24}$/i.test(entry.studentId) ||
      !mongoose.isValidObjectId(entry.studentId)
    ) {
      throw Object.assign(new Error("Each status requires a valid studentId."), {
        statusCode: 400,
        expose: true,
      });
    }
    const studentId = entry.studentId.toLowerCase();
    if (!roster.has(studentId)) {
      throw Object.assign(new Error("A selected student is outside this lesson roster."), {
        statusCode: 422,
        expose: true,
      });
    }
    if (statusByStudent.has(studentId)) {
      throw Object.assign(new Error("A student may appear only once in statuses."), {
        statusCode: 400,
        expose: true,
      });
    }
    if (!["present", "absent", "permission"].includes(entry.status)) {
      throw Object.assign(
        new Error("Each lesson status must be present, absent, or permission."),
        {
        statusCode: 400,
        expose: true,
        }
      );
    }
    statusByStudent.set(studentId, entry.status);
  }
  if (statusByStudent.size !== roster.size) {
    throw Object.assign(new Error("Every student in the lesson roster needs an explicit status."), {
      statusCode: 422,
      expose: true,
    });
  }
  return statusByStudent;
}

function validateLessonPeriod(lessonDate, academicYear, academicMonth) {
  const dateParts = parseCanonicalDate(lessonDate, "lessonDate");
  if (
    Number(academicYear) !== dateParts.academicYear ||
    Number(academicMonth) !== dateParts.academicMonth
  ) {
    throw Object.assign(
      new Error("academicYear and academicMonth must match the Ethiopian lesson date."),
      { statusCode: 400, expose: true }
    );
  }
  return dateParts;
}

async function requireUniqueIndex(model, indexName, key) {
  let indexes;
  try {
    indexes = await model.collection.indexes();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) indexes = [];
    else throw error;
  }
  const index = indexes.find(({ name }) => name === indexName);
  if (
    !index ||
    index.unique !== true ||
    Object.keys(index.key).length !== Object.keys(key).length ||
    Object.entries(key).some(([field, direction]) => index.key[field] !== direction)
  ) {
    throw Object.assign(
      new Error(`Required unique index "${indexName}" is missing.`),
      { statusCode: 503, expose: true }
    );
  }
}

async function submitLessonAttendance({
  lessonId,
  statuses,
  actor,
  lessonModel = SubjectLesson,
  attendanceModel = SubjectAttendance,
  startSession = () => mongoose.startSession(),
}) {
  if (!mongoose.isValidObjectId(lessonId)) {
    throw Object.assign(new Error("lessonId is invalid."), {
      statusCode: 400,
      expose: true,
    });
  }
  const session = await startSession();
  try {
    await session.withTransaction(async () => {
      const lesson = await lessonModel.findById(lessonId).session(session).lean();
      if (!lesson || lesson.status === "cancelled") {
        throw Object.assign(new Error("An active lesson was not found."), {
          statusCode: 404,
          expose: true,
        });
      }
      const statusByStudent = parseRosterStatuses(statuses, lesson.rosterStudentIds);
      const operations = [...statusByStudent].map(([studentId, status]) => ({
        updateOne: {
          filter: { lessonId: lesson._id, studentId },
          update: {
            $set: { status, recordedBy: actor },
            $setOnInsert: {
              lessonId: lesson._id,
              studentId,
              classId: lesson.classId,
              classNumber: lesson.classNumber,
              subjectId: lesson.subjectId,
              lessonDate: lesson.lessonDate,
              academicYear: lesson.academicYear,
              academicMonth: lesson.academicMonth,
            },
          },
          upsert: true,
        },
      }));
      await attendanceModel.bulkWrite(operations, { session, ordered: true });
      if (lesson.status === "scheduled") {
        const result = await lessonModel.updateOne(
          { _id: lesson._id, status: "scheduled" },
          {
            $set: {
              status: "finalized",
              finalizedAt: new Date(),
              finalizedBy: actor,
            },
          },
          { session }
        );
        if (result.matchedCount !== 1) {
          throw Object.assign(new Error("Lesson changed during submission; reload and retry."), {
            statusCode: 409,
            expose: true,
          });
        }
      }
    });
  } finally {
    await session.endSession();
  }
  return lessonModel.findById(lessonId).lean();
}

module.exports = {
  parseRosterStatuses,
  requireUniqueIndex,
  submitLessonAttendance,
  validateLessonPeriod,
};
