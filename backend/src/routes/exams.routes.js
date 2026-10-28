const express = require("express");
const Exam = require("../models/Exam");
const ExamMark = require("../models/ExamMark");
const Student = require("../models/Student");
const Subject = require("../models/Subject");
const AcademicTerm = require("../models/AcademicTerm");
const {
  authenticateAccount,
  authorizeAccountRoles,
  requireChangedPassword,
} = require("../middleware/authenticateAccount");
const { parseCanonicalDate } = require("../services/academicCalendar");
const { getEligibility } = require("../services/eligibility");
const { hasTeacherAccess, isObjectId } = require("../services/subjectAccess");
const { requireUniqueIndex } = require("../services/subjectLessons");

const router = express.Router();

function clientError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

router.get(
  "/",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      if (!isObjectId(req.query.classId) || !isObjectId(req.query.subjectId)) {
        throw clientError("Valid classId and subjectId are required.");
      }
      if (!hasTeacherAccess(req.account, req.query.classId, req.query.subjectId)) {
        throw clientError("You are not assigned to this class and subject.", 403);
      }
      const academicYear = Number(req.query.academicYear);
      if (!Number.isInteger(academicYear) || academicYear < 1000 || academicYear > 9999) {
        throw clientError("academicYear is invalid.");
      }
      const exams = await Exam.find({
        classId: req.query.classId,
        subjectId: req.query.subjectId,
        academicYear,
      })
        .sort({ examDate: -1 })
        .lean();
      return res.json({ status: "ok", exams });
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
      const { classId, subjectId, examDate, name } = req.body || {};
      if (!isObjectId(classId) || !isObjectId(subjectId)) {
        throw clientError("Valid classId and subjectId are required.");
      }
      if (!hasTeacherAccess(req.account, classId, subjectId)) {
        throw clientError("You are not assigned to this class and subject.", 403);
      }
      if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
        throw clientError("A valid exam name is required.");
      }
      const dateParts = parseCanonicalDate(examDate, "examDate");
      if (
        Number(req.body.academicYear) !== dateParts.academicYear ||
        Number(req.body.academicMonth) !== dateParts.academicMonth
      ) {
        throw clientError("Exam academic period must match its Ethiopian-calendar date.");
      }
      const subject = await Subject.findOne({ _id: subjectId, classId, active: true }).lean();
      if (!subject) throw clientError("Subject does not belong to the selected class.", 422);
      await requireUniqueIndex(
        Exam,
        "unique_exam_name_per_subject_year",
        { classId: 1, subjectId: 1, academicYear: 1, nameKey: 1 }
      );
      const maxMarks = Number(req.body.maxMarks);
      if (!Number.isFinite(maxMarks) || maxMarks <= 0 || maxMarks > 10000) {
        throw clientError("maxMarks must be greater than zero and no more than 10000.");
      }
      let termId = null;
      if (req.body.termId) {
        if (!isObjectId(req.body.termId)) throw clientError("termId is invalid.");
        const term = await AcademicTerm.findOne({
          _id: req.body.termId,
          academicYear: dateParts.academicYear,
          startDate: { $lte: examDate },
          endDate: { $gte: examDate },
        }).lean();
        if (!term) throw clientError("The selected term does not include the exam date.", 422);
        termId = term._id;
      }
      const exam = await Exam.create({
        classId,
        classNumber: subject.classNumber,
        subjectId,
        name: name.trim(),
        nameKey: name.trim().normalize("NFC").toLocaleLowerCase(),
        examDate,
        academicYear: dateParts.academicYear,
        academicMonth: dateParts.academicMonth,
        termId,
        maxMarks,
        createdBy: req.account.username,
      });
      return res.status(201).json({ status: "ok", exam });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          status: "error",
          message: "An exam with that name already exists for this subject and year.",
        });
      }
      return next(error);
    }
  }
);

router.get(
  "/:examId/marks",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      if (!isObjectId(req.params.examId)) throw clientError("examId is invalid.");
      const exam = await Exam.findById(req.params.examId).lean();
      if (!exam) throw clientError("Exam was not found.", 404);
      if (!hasTeacherAccess(req.account, exam.classId, exam.subjectId)) {
        throw clientError("You are not assigned to this class and subject.", 403);
      }
      const marks = await ExamMark.find({ examId: exam._id })
        .select("studentId marks")
        .lean();
      const studentIds = marks.map(({ studentId }) => studentId);
      const students = await Student.find({ _id: { $in: studentIds } })
        .select("_id classNumber originalSerialNumber studentName christianName")
        .lean();
      const studentById = new Map(students.map((student) => [String(student._id), student]));
      return res.json({
        status: "ok",
        exam: { id: String(exam._id), name: exam.name, maxMarks: exam.maxMarks },
        marks: marks.map(({ studentId, marks: score }) => {
          const student = studentById.get(String(studentId));
          return student
            ? {
                studentId: String(studentId),
                studentNumber: student.originalSerialNumber,
                fullName: [student.studentName, student.christianName].filter(Boolean).join(" "),
                marks: score,
              }
            : null;
        }).filter(Boolean),
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  "/:examId/marks",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      if (!isObjectId(req.params.examId)) throw clientError("examId is invalid.");
      const exam = await Exam.findById(req.params.examId).lean();
      if (!exam) throw clientError("Exam was not found.", 404);
      if (!hasTeacherAccess(req.account, exam.classId, exam.subjectId)) {
        throw clientError("You are not assigned to this class and subject.", 403);
      }
      const submitted = req.body?.marks;
      if (!Array.isArray(submitted) || submitted.length < 1 || submitted.length > 5000) {
        throw clientError("marks must be a non-empty array of at most 5000 entries.");
      }
      const seen = new Set();
      for (const entry of submitted) {
        if (!isObjectId(entry?.studentId) || seen.has(entry.studentId.toLowerCase())) {
          throw clientError("Each mark requires a unique valid studentId.");
        }
        seen.add(entry.studentId.toLowerCase());
        if (!Number.isFinite(entry.marks) || entry.marks < 0 || entry.marks > exam.maxMarks) {
          throw clientError("Each mark must be between zero and maxMarks.");
        }
      }
      const students = await Student.find({
        _id: { $in: submitted.map(({ studentId }) => studentId) },
        classId: exam.classId,
      })
        .select("_id")
        .lean();
      if (students.length !== submitted.length) {
        throw clientError("All marked students must belong to the exam class.", 422);
      }

      const eligibility = await getEligibility({
        classId: String(exam.classId),
        subjectId: String(exam.subjectId),
        academicYear: exam.academicYear,
        ...(exam.termId
          ? { termId: String(exam.termId) }
          : { academicMonth: exam.academicMonth }),
      });
      const eligibleIds = new Set(eligibility.groups.eligible.map(({ studentId }) => studentId));
      const blocked = submitted.some(({ studentId }) => !eligibleIds.has(studentId.toLowerCase()));
      if (blocked) {
        throw clientError("Marks can be recorded only for eligible students with complete attendance data.", 422);
      }

      await requireUniqueIndex(
        ExamMark,
        "unique_student_mark_per_exam",
        { examId: 1, studentId: 1 }
      );
      const session = await ExamMark.startSession();
      try {
        await session.withTransaction(() =>
          ExamMark.bulkWrite(
            submitted.map(({ studentId, marks }) => ({
              updateOne: {
                filter: { examId: exam._id, studentId },
                update: {
                  $set: { marks, recordedBy: req.account.username },
                  $setOnInsert: { examId: exam._id, studentId },
                },
                upsert: true,
              },
            })),
            { session, ordered: true }
          )
        );
      } finally {
        await session.endSession();
      }
      return res.json({
        status: "ok",
        savedCount: submitted.length,
        message: "Eligible student marks saved.",
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          status: "error",
          message: "Marks changed concurrently. Reload and try again.",
        });
      }
      return next(error);
    }
  }
);

module.exports = router;
