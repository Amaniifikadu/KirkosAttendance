const express = require("express");
const Attendance = require("../models/Attendance");
const AttendanceSession = require("../models/AttendanceSession");
const { authenticateAdmin } = require("../middleware/authenticateAdmin");
const { createAttendanceService } = require("../services/attendance");
const SUNDAY_SCHOOL_CLASSES = require("../config/sundaySchoolClasses");

async function requireUniqueIndex(model, name, key) {
  let indexes;
  try {
    indexes = await model.collection.indexes();
  } catch (error) {
    if (error.codeName !== "NamespaceNotFound" && error.code !== 26) {
      throw error;
    }
    indexes = [];
  }

  const index = indexes.find((entry) => entry.name === name);
  const matchesKey =
    index &&
    Object.entries(key).every(
      ([field, direction]) => index.key[field] === direction
    ) &&
    Object.keys(index.key).length === Object.keys(key).length;
  if (!index || !index.unique || !matchesKey) {
    const error = new Error(
      `Required unique index "${name}" is missing. Apply the documented attendance index setup before saving attendance.`
    );
    error.statusCode = 503;
    error.expose = true;
    throw error;
  }
}

async function requireAttendanceIndexes(attendanceModel, sessionModel) {
  await Promise.all([
    requireUniqueIndex(attendanceModel, "unique_student_attendance_per_date", {
      studentId: 1,
      attendanceDate: 1,
    }),
    requireUniqueIndex(
      sessionModel,
      "unique_attendance_session_per_class_date",
      { classNumber: 1, attendanceDate: 1 }
    ),
  ]);
}

function createAttendanceRouter({
  attendanceService = createAttendanceService(),
  attendanceModel = Attendance,
  sessionModel = AttendanceSession,
} = {}) {
  const attendanceRouter = express.Router();

  attendanceRouter.get("/classes", authenticateAdmin, (req, res) =>
    res.json({
      status: "ok",
      classes: SUNDAY_SCHOOL_CLASSES.map(({ classNumber, displayName }) => ({
        classNumber,
        name: displayName,
      })),
    })
  );

  attendanceRouter.get(
    "/session",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        return res.json({
          status: "ok",
          ...(await attendanceService.getSession(req.query)),
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  attendanceRouter.put(
    "/session/draft",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        await requireAttendanceIndexes(attendanceModel, sessionModel);
        const result = await attendanceService.saveDraft(req.body || {});
        return res.json({
          status: "ok",
          ...result,
          message:
            result.session?.status === "complete"
              ? "Attendance corrections saved. The session remains complete."
              : "Attendance draft saved.",
        });
      } catch (error) {
        if (error?.code === 11000) {
          return res.status(409).json({
            status: "error",
            message:
              "Attendance changed concurrently. Reload the session before saving again.",
          });
        }
        return next(error);
      }
    }
  );

  attendanceRouter.post(
    "/session/complete",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        await requireAttendanceIndexes(attendanceModel, sessionModel);
        const result = await attendanceService.completeSession(
          req.body || {},
          req.admin.email
        );
        return res.json({
          status: "ok",
          ...result,
          message: "Attendance session completed.",
        });
      } catch (error) {
        if (error?.code === 11000) {
          return res.status(409).json({
            status: "error",
            message:
              "Attendance changed concurrently. Reload the session before completing it.",
          });
        }
        return next(error);
      }
    }
  );

  return attendanceRouter;
}

module.exports = createAttendanceRouter();
module.exports.createAttendanceRouter = createAttendanceRouter;
