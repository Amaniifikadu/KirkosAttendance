const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const Class = require("../models/Class");
const Exam = require("../models/Exam");
const ExamMark = require("../models/ExamMark");
const Student = require("../models/Student");
const Subject = require("../models/Subject");
const SubjectAttendance = require("../models/SubjectAttendance");
const SubjectLesson = require("../models/SubjectLesson");
const UserAccount = require("../models/UserAccount");
const {
  authenticateAccount,
  authorizeAccountRoles,
  requireChangedPassword,
} = require("../middleware/authenticateAccount");
const { getJwtSecret, TOKEN_ISSUER } = require("../middleware/authenticateAdmin");
const { parseCanonicalDate } = require("../services/academicCalendar");
const { isObjectId } = require("../services/subjectAccess");
const SUNDAY_SCHOOL_CLASSES = require("../config/sundaySchoolClasses");

const router = express.Router();
const BCRYPT_COST = 12;

function clientError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

router.post("/login", async (req, res, next) => {
  try {
    const username = typeof req.body?.username === "string"
      ? req.body.username.trim().toLowerCase()
      : "";
    const password = typeof req.body?.password === "string"
      ? req.body.password
      : "";
    const expectedRole = req.body?.expectedRole;
    if (
      expectedRole !== undefined &&
      !["teacher", "student"].includes(expectedRole)
    ) {
      throw clientError("expectedRole must be teacher or student.");
    }
    if (!username || username.length > 120 || !password || Buffer.byteLength(password, "utf8") > 72) {
      throw clientError("A valid username and password are required.");
    }

    const account = await UserAccount.findOne({ username, active: true })
      .select("+passwordHash")
      .lean();
    let passwordMatches = false;
    if (account) {
      passwordMatches = await bcrypt.compare(password, account.passwordHash);
    } else {
      await bcrypt.hash(password, BCRYPT_COST);
    }
    if (!account || !passwordMatches || (expectedRole && account.role !== expectedRole)) {
      return res.status(401).json({
        status: "error",
        message: "Invalid portal credentials.",
      });
    }

    const token = jwt.sign(
      { role: account.role },
      getJwtSecret(),
      {
        algorithm: "HS256",
        subject: String(account._id),
        issuer: TOKEN_ISSUER,
        expiresIn: 30 * 60,
      }
    );
    res.set("Cache-Control", "no-store");
    return res.json({
      status: "ok",
      token,
      tokenType: "Bearer",
      role: account.role,
      mustChangePassword: account.mustChangePassword,
      expiresInSeconds: 1800,
    });
  } catch (error) {
    return next(error);
  }
});

router.put(
  "/password",
  authenticateAccount,
  authorizeAccountRoles("teacher", "student"),
  async (req, res, next) => {
    try {
      const currentPassword = req.body?.currentPassword;
      const newPassword = req.body?.newPassword;
      if (
        typeof currentPassword !== "string" ||
        typeof newPassword !== "string" ||
        Buffer.byteLength(newPassword, "utf8") < 12 ||
        Buffer.byteLength(newPassword, "utf8") > 72
      ) {
        throw clientError("Current password and a new 12–72 byte password are required.");
      }
      const account = await UserAccount.findById(req.account._id)
        .select("+passwordHash");
      if (!account || !(await bcrypt.compare(currentPassword, account.passwordHash))) {
        return res.status(401).json({
          status: "error",
          message: "Current password is incorrect.",
        });
      }
      account.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
      account.mustChangePassword = false;
      await account.save();
      return res.json({ status: "ok", message: "Password updated." });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/me",
  authenticateAccount,
  authorizeAccountRoles("student"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      const academicYear = req.query.academicYear === undefined
        ? parseCanonicalDate(new Date().toISOString().slice(0, 10)).academicYear
        : Number(req.query.academicYear);
      const academicMonth = req.query.academicMonth === undefined
        ? undefined
        : Number(req.query.academicMonth);
      if (!Number.isInteger(academicYear) || academicYear < 1000 || academicYear > 9999) {
        throw clientError("academicYear is invalid.");
      }
      if (academicMonth !== undefined && (!Number.isInteger(academicMonth) || academicMonth < 1 || academicMonth > 13)) {
        throw clientError("academicMonth must be from 1 to 13.");
      }
      const student = await Student.findById(req.account.studentId)
        .select("_id classId classNumber originalSerialNumber studentName christianName")
        .lean();
      if (!student) throw clientError("The student account has no active student profile.", 404);
      const [classRecord, subjects] = await Promise.all([
        Class.findById(student.classId).select("classNumber name").lean(),
        Subject.find({ classId: student.classId, active: true })
          .select("_id name")
          .sort({ name: 1 })
          .lean(),
      ]);
      const subjectAttendance = [];
      for (const subject of subjects) {
        const lessonFilter = {
          classId: student.classId,
          subjectId: subject._id,
          academicYear,
          status: "finalized",
          rosterStudentIds: student._id,
        };
        if (academicMonth !== undefined) lessonFilter.academicMonth = academicMonth;
        const lessons = await SubjectLesson.find(lessonFilter)
          .select("_id lessonDate")
          .sort({ lessonDate: 1 })
          .lean();
        const records = lessons.length
          ? await SubjectAttendance.find({
              lessonId: { $in: lessons.map(({ _id }) => _id) },
              studentId: student._id,
            })
              .select("lessonId status")
              .lean()
          : [];
        const statusByLesson = new Map(
          records.map((record) => [String(record.lessonId), record.status])
        );
        const attended = records.filter(({ status }) => status === "present").length;
        const relevantPending = await SubjectLesson.countDocuments({
          classId: student.classId,
          subjectId: subject._id,
          academicYear,
          status: "scheduled",
          rosterStudentIds: student._id,
          ...(academicMonth !== undefined ? { academicMonth } : {}),
        });
        const incompleteSessions = relevantPending + lessons.length - records.length;
        subjectAttendance.push({
          subjectId: String(subject._id),
          subjectName: subject.name,
          attendedSessions: attended,
          totalFinalizedSessions: records.length,
          incompleteSessions,
          attendancePercentage: records.length
            ? Number(((attended / records.length) * 100).toFixed(2))
            : null,
          eligibility:
            incompleteSessions > 0
              ? "attendance_incomplete"
              : !records.length
                ? "not_enough_data"
                : attended / records.length > 0.5
                  ? "eligible"
                  : "not_eligible",
          history: lessons.map((lesson) => ({
            lessonDate: lesson.lessonDate,
            status: statusByLesson.get(String(lesson._id)) || "incomplete",
          })),
        });
      }
      const examFilter = {
        classId: student.classId,
        academicYear,
      };
      if (academicMonth !== undefined) examFilter.academicMonth = academicMonth;
      const exams = await Exam.find(examFilter)
        .select("_id subjectId name examDate maxMarks")
        .lean();
      const marks = exams.length
        ? await ExamMark.find({
            examId: { $in: exams.map(({ _id }) => _id) },
            studentId: student._id,
          })
            .select("examId marks")
            .lean()
        : [];
      const markByExam = new Map(marks.map(({ examId, marks: score }) => [String(examId), score]));
      return res.json({
        status: "ok",
        student: {
          studentNumber: student.originalSerialNumber,
          fullName: [student.studentName, student.christianName].filter(Boolean).join(" "),
          classNumber: classRecord?.classNumber ?? student.classNumber,
          className: classRecord
            ? SUNDAY_SCHOOL_CLASSES.getDisplayName(
                classRecord.classNumber,
                classRecord.name
              )
            : "",
        },
        period: { academicYear, academicMonth: academicMonth ?? null },
        subjects: subjectAttendance,
        results: exams
          .filter(({ _id }) => markByExam.has(String(_id)))
          .map((exam) => ({
            subjectName: subjects.find(({ _id }) => String(_id) === String(exam.subjectId))?.name || "",
            examName: exam.name,
            examDate: exam.examDate,
            marks: markByExam.get(String(exam._id)),
            maxMarks: exam.maxMarks,
          })),
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
