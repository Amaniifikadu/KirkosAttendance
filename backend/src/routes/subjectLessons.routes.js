const express = require("express");
const AcademicTerm = require("../models/AcademicTerm");
const Class = require("../models/Class");
const Student = require("../models/Student");
const Subject = require("../models/Subject");
const SubjectAttendance = require("../models/SubjectAttendance");
const SubjectLesson = require("../models/SubjectLesson");
const {
  authenticateAccount,
  authorizeAccountRoles,
  requireChangedPassword,
} = require("../middleware/authenticateAccount");
const { parseCanonicalDate } = require("../services/academicCalendar");
const { hasTeacherAccess, isObjectId } = require("../services/subjectAccess");
const {
  requireUniqueIndex,
  submitLessonAttendance,
  validateLessonPeriod,
} = require("../services/subjectLessons");

const router = express.Router();

function clientError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

async function requireLessonAccess(account, lesson) {
  if (!hasTeacherAccess(account, lesson.classId, lesson.subjectId)) {
    throw clientError("You are not assigned to this class and subject.", 403);
  }
}

function readFilter(query) {
  const { classId, subjectId } = query;
  if (!isObjectId(classId) || !isObjectId(subjectId)) {
    throw clientError("Valid classId and subjectId are required.");
  }
  const academicYear = Number(query.academicYear);
  if (!Number.isInteger(academicYear) || academicYear < 1000 || academicYear > 9999) {
    throw clientError("academicYear must be a valid Ethiopian year.");
  }
  const filter = { classId, subjectId, academicYear };
  if (query.academicMonth !== undefined) {
    const month = Number(query.academicMonth);
    if (!Number.isInteger(month) || month < 1 || month > 13) {
      throw clientError("academicMonth must be from 1 to 13.");
    }
    filter.academicMonth = month;
  }
  return filter;
}

router.get(
  "/",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      const filter = readFilter(req.query);
      if (!hasTeacherAccess(req.account, filter.classId, filter.subjectId)) {
        throw clientError("You are not assigned to this class and subject.", 403);
      }
      const lessons = await SubjectLesson.find(filter)
        .sort({ lessonDate: -1 })
        .select("_id classNumber subjectId lessonDate academicYear academicMonth termId status rosterStudentIds finalizedAt")
        .lean();
      return res.json({
        status: "ok",
        lessons: lessons.map(({ rosterStudentIds, ...lesson }) => ({
          ...lesson,
          rosterCount: rosterStudentIds.length,
        })),
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      const { classId, subjectId, lessonDate } = req.body || {};
      if (!isObjectId(classId) || !isObjectId(subjectId)) {
        throw clientError("Valid classId and subjectId are required.");
      }
      const dateParts = validateLessonPeriod(
        lessonDate,
        req.body.academicYear,
        req.body.academicMonth
      );
      if (!hasTeacherAccess(req.account, classId, subjectId)) {
        throw clientError("You are not assigned to this class and subject.", 403);
      }
      const [classRecord, subject, students] = await Promise.all([
        Class.findById(classId).lean(),
        Subject.findOne({ _id: subjectId, classId, active: true }).lean(),
        Student.find({ classId }, { _id: 1 }).lean(),
      ]);
      if (!classRecord || !subject) {
        throw clientError("The selected subject does not belong to a configured class.", 422);
      }
      if (!students.length) {
        throw clientError("A lesson cannot be scheduled for an empty class.", 422);
      }
      let termId = null;
      if (req.body.termId) {
        if (!isObjectId(req.body.termId)) throw clientError("termId is invalid.");
        const term = await AcademicTerm.findOne({
          _id: req.body.termId,
          academicYear: dateParts.academicYear,
          startDate: { $lte: lessonDate },
          endDate: { $gte: lessonDate },
        }).lean();
        if (!term) throw clientError("The selected term does not include this lesson date.", 422);
        termId = term._id;
      }
      await requireUniqueIndex(
        SubjectLesson,
        "unique_subject_lesson_date",
        { classId: 1, subjectId: 1, lessonDate: 1 }
      );
      const lesson = await SubjectLesson.create({
        classId: classRecord._id,
        classNumber: classRecord.classNumber,
        subjectId: subject._id,
        lessonDate,
        academicYear: dateParts.academicYear,
        academicMonth: dateParts.academicMonth,
        termId,
        status: "scheduled",
        rosterStudentIds: students.map(({ _id }) => _id),
        createdBy: req.account.username,
      });
      return res.status(201).json({
        status: "ok",
        lesson: {
          id: String(lesson._id),
          classNumber: lesson.classNumber,
          subjectId: String(lesson.subjectId),
          lessonDate: lesson.lessonDate,
          academicYear: lesson.academicYear,
          academicMonth: lesson.academicMonth,
          status: lesson.status,
          rosterCount: lesson.rosterStudentIds.length,
        },
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          status: "error",
          message: "A lesson already exists for this class, subject, and date.",
        });
      }
      return next(error);
    }
  }
);

router.get(
  "/:lessonId",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      if (!isObjectId(req.params.lessonId)) throw clientError("lessonId is invalid.");
      const lesson = await SubjectLesson.findById(req.params.lessonId).lean();
      if (!lesson) throw clientError("Lesson was not found.", 404);
      await requireLessonAccess(req.account, lesson);
      const [students, records] = await Promise.all([
        Student.find({ _id: { $in: lesson.rosterStudentIds } })
          .select("_id classNumber originalSerialNumber studentName christianName")
          .lean(),
        SubjectAttendance.find({ lessonId: lesson._id })
          .select("studentId status")
          .lean(),
      ]);
      const statusByStudent = new Map(
        records.map((record) => [String(record.studentId), record.status])
      );
      return res.json({
        status: "ok",
        lesson: {
          id: String(lesson._id),
          classNumber: lesson.classNumber,
          subjectId: String(lesson.subjectId),
          lessonDate: lesson.lessonDate,
          academicYear: lesson.academicYear,
          academicMonth: lesson.academicMonth,
          termId: lesson.termId ? String(lesson.termId) : null,
          status: lesson.status,
          students: students.map((student) => ({
            studentId: String(student._id),
            classNumber: student.classNumber,
            originalSerialNumber: student.originalSerialNumber,
            studentName: student.studentName,
            christianName: student.christianName || "",
            status: statusByStudent.get(String(student._id)) || "not_recorded",
          })),
        },
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  "/:lessonId/attendance",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      if (!isObjectId(req.params.lessonId)) throw clientError("lessonId is invalid.");
      const lesson = await SubjectLesson.findById(req.params.lessonId).lean();
      if (!lesson) throw clientError("Lesson was not found.", 404);
      await requireLessonAccess(req.account, lesson);
      await requireUniqueIndex(
        SubjectAttendance,
        "unique_student_attendance_per_subject_lesson",
        { lessonId: 1, studentId: 1 }
      );
      await submitLessonAttendance({
        lessonId: req.params.lessonId,
        statuses: req.body?.statuses,
        actor: req.account.username,
      });
      return res.json({
        status: "ok",
        lessonStatus: "finalized",
        message: "Lesson attendance submitted. Corrections preserve finalized status.",
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          status: "error",
          message: "Attendance changed concurrently. Reload this lesson before submitting.",
        });
      }
      return next(error);
    }
  }
);

router.post(
  "/:lessonId/cancel",
  authenticateAccount,
  authorizeAccountRoles("admin"),
  async (req, res, next) => {
    try {
      if (!isObjectId(req.params.lessonId)) throw clientError("lessonId is invalid.");
      const cancelled = await SubjectLesson.updateOne(
        { _id: req.params.lessonId, status: "scheduled" },
        {
          $set: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledBy: req.account.username,
          },
        }
      );
      if (!cancelled.matchedCount) {
        throw clientError("Only a scheduled, unfinalized lesson can be cancelled.", 409);
      }
      return res.json({ status: "ok", lessonStatus: "cancelled" });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
