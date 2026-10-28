const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const express = require("express");
const AcademicTerm = require("../models/AcademicTerm");
const Class = require("../models/Class");
const Student = require("../models/Student");
const Subject = require("../models/Subject");
const UserAccount = require("../models/UserAccount");
const {
  authenticateAccount,
  authorizeAccountRoles,
  requireChangedPassword,
} = require("../middleware/authenticateAccount");
const { normalizeAcademicPeriod, parseCanonicalDate } = require("../services/academicCalendar");
const { isObjectId } = require("../services/subjectAccess");
const { requireUniqueIndex } = require("../services/subjectLessons");
const { numericStudentSortStages } = require("../services/studentList");
const SUNDAY_SCHOOL_CLASSES = require("../config/sundaySchoolClasses");

const router = express.Router();
const BCRYPT_COST = 12;
const CLASS_NAME = /^[^\u0000-\u001f]{1,100}$/;
const SERIAL_NUMBER = /^[^\u0000-\u001f]{1,50}$/;

function clientError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

function handleDuplicate(error, res, message) {
  if (error?.code !== 11000) return false;
  res.status(409).json({ status: "error", message });
  return true;
}

function teacherClassFilter(account) {
  if (account.role === "admin") return {};
  const classIds = (account.assignments || []).map(({ classId }) => classId);
  return { _id: { $in: classIds } };
}

function validateTeacherAssignments(assignments) {
  if (!Array.isArray(assignments) || !assignments.length) {
    throw clientError("Teacher accounts require at least one class/subject assignment.");
  }
  for (const assignment of assignments) {
    if (
      !assignment ||
      typeof assignment !== "object" ||
      !isObjectId(assignment.classId) ||
      !Array.isArray(assignment.subjectIds) ||
      !assignment.subjectIds.length ||
      assignment.subjectIds.some((subjectId) => !isObjectId(subjectId))
    ) {
      throw clientError("Each teacher assignment requires a classId and subjectIds.");
    }
  }
  return assignments;
}

router.get(
  "/classes",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      const classes = await Class.find(teacherClassFilter(req.account))
        .sort({ classNumber: 1 })
        .select("_id classNumber name sheetName")
        .lean();
      return res.json({
        status: "ok",
        classes: classes.map((item) => ({
          ...item,
          name: SUNDAY_SCHOOL_CLASSES.getDisplayName(item.classNumber, item.name),
        })),
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/classes",
  authenticateAccount,
  authorizeAccountRoles("admin"),
  async (req, res, next) => {
    try {
      const classNumber = Number(req.body?.classNumber);
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 999) {
        throw clientError("classNumber must be a whole number from 1 to 999.");
      }
      if (!CLASS_NAME.test(name)) throw clientError("A valid class name is required.");
      await requireUniqueIndex(Class, "classNumber_1", { classNumber: 1 });
      await requireUniqueIndex(Class, "name_1", { name: 1 });
      await requireUniqueIndex(Class, "sheetName_1", { sheetName: 1 });
      const record = await Class.create({
        classNumber,
        name,
        sheetName: name,
      });
      return res.status(201).json({
        status: "ok",
        class: {
          id: String(record._id),
          classNumber: record.classNumber,
          name: record.name,
        },
      });
    } catch (error) {
      if (handleDuplicate(error, res, "Class number or name already exists.")) return;
      return next(error);
    }
  }
);

router.post(
  "/classes/:classId/students",
  authenticateAccount,
  authorizeAccountRoles("admin"),
  async (req, res, next) => {
    try {
      if (!isObjectId(req.params.classId)) throw clientError("classId is invalid.");
      const classRecord = await Class.findById(req.params.classId).lean();
      if (!classRecord) throw clientError("Class was not found.", 404);
      const serial = typeof req.body?.originalSerialNumber === "string"
        ? req.body.originalSerialNumber.trim()
        : "";
      const studentName = typeof req.body?.studentName === "string"
        ? req.body.studentName.trim()
        : "";
      const christianName = typeof req.body?.christianName === "string"
        ? req.body.christianName.trim()
        : "";
      if (!SERIAL_NUMBER.test(serial)) {
        throw clientError("A valid original student number is required.");
      }
      if (!studentName || studentName.length > 200 || christianName.length > 200) {
        throw clientError("Valid student name fields are required.");
      }
      await requireUniqueIndex(
        Student,
        "unique_student_serial_per_class",
        { classNumber: 1, originalSerialNumber: 1 }
      );
      const student = await Student.create({
        classId: classRecord._id,
        classNumber: classRecord.classNumber,
        originalSerialNumber: serial,
        studentName,
        ...(christianName ? { christianName } : {}),
      });
      return res.status(201).json({
        status: "ok",
        student: {
          id: String(student._id),
          classNumber: student.classNumber,
          originalSerialNumber: student.originalSerialNumber,
          studentName: student.studentName,
          christianName: student.christianName || "",
        },
      });
    } catch (error) {
      if (handleDuplicate(error, res, "That student number already exists in this class.")) return;
      return next(error);
    }
  }
);

router.get(
  "/classes/:classId/students",
  authenticateAccount,
  authorizeAccountRoles("admin"),
  async (req, res, next) => {
    try {
      if (!isObjectId(req.params.classId)) throw clientError("classId is invalid.");
      const classRecord = await Class.findById(req.params.classId).select("_id").lean();
      if (!classRecord) throw clientError("Class was not found.", 404);
      const students = await Student.aggregate([
        { $match: { classId: classRecord._id } },
        ...numericStudentSortStages({ includeClassNumber: false }),
        {
          $project: {
            _id: 1,
            originalSerialNumber: 1,
            studentName: 1,
            christianName: 1,
          },
        },
      ]);
      return res.json({ status: "ok", students });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/subjects",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.classId !== undefined) {
        if (!isObjectId(req.query.classId)) throw clientError("classId is invalid.");
        filter.classId = req.query.classId;
      }
      if (req.account.role === "teacher") {
        const assignments = req.account.assignments || [];
        const scoped = assignments.flatMap((assignment) =>
          (assignment.subjectIds || []).map((subjectId) => String(subjectId))
        );
        filter._id = { $in: scoped };
        if (filter.classId && !assignments.some(
          ({ classId }) => String(classId) === String(filter.classId)
        )) {
          return res.json({ status: "ok", subjects: [] });
        }
      }
      const subjects = await Subject.find(filter)
        .sort({ classNumber: 1, name: 1 })
        .select("_id classId classNumber name active")
        .lean();
      return res.json({ status: "ok", subjects });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/subjects",
  authenticateAccount,
  authorizeAccountRoles("admin"),
  async (req, res, next) => {
    try {
      if (!isObjectId(req.body?.classId)) throw clientError("classId is invalid.");
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name || name.length > 120) throw clientError("A valid subject name is required.");
      const classRecord = await Class.findById(req.body.classId).lean();
      if (!classRecord) throw clientError("Class was not found.", 404);
      await requireUniqueIndex(
        Subject,
        "unique_subject_name_per_class",
        { classId: 1, nameKey: 1 }
      );
      const subject = await Subject.create({
        classId: classRecord._id,
        classNumber: classRecord.classNumber,
        name,
        nameKey: name.normalize("NFC").toLocaleLowerCase(),
      });
      return res.status(201).json({
        status: "ok",
        subject: {
          id: String(subject._id),
          classId: String(subject.classId),
          classNumber: subject.classNumber,
          name: subject.name,
        },
      });
    } catch (error) {
      if (handleDuplicate(error, res, "That subject already exists in this class.")) return;
      return next(error);
    }
  }
);

router.get(
  "/terms",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.academicYear !== undefined) {
        filter.academicYear = normalizeAcademicPeriod(req.query.academicYear);
      }
      const terms = await AcademicTerm.find(filter)
        .sort({ academicYear: -1, startDate: 1 })
        .lean();
      return res.json({ status: "ok", terms });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/terms",
  authenticateAccount,
  authorizeAccountRoles("admin"),
  async (req, res, next) => {
    try {
      const academicYear = normalizeAcademicPeriod(req.body?.academicYear);
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name || name.length > 80) throw clientError("A valid term name is required.");
      const start = parseCanonicalDate(req.body?.startDate, "startDate");
      const end = parseCanonicalDate(req.body?.endDate, "endDate");
      if (
        req.body.startDate > req.body.endDate ||
        start.academicYear !== academicYear ||
        end.academicYear !== academicYear
      ) {
        throw clientError("Term dates must be ordered and within the selected Ethiopian academic year.");
      }
      const overlap = await AcademicTerm.exists({
        academicYear,
        startDate: { $lte: req.body.endDate },
        endDate: { $gte: req.body.startDate },
      });
      if (overlap) throw clientError("Academic term dates cannot overlap.", 409);
      await requireUniqueIndex(
        AcademicTerm,
        "unique_term_per_academic_year",
        { academicYear: 1, nameKey: 1 }
      );
      const term = await AcademicTerm.create({
        academicYear,
        name,
        nameKey: name.toLocaleLowerCase(),
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        createdBy: req.account.username,
      });
      return res.status(201).json({ status: "ok", term });
    } catch (error) {
      if (handleDuplicate(error, res, "That term name already exists for this year.")) return;
      return next(error);
    }
  }
);

router.post(
  "/accounts",
  authenticateAccount,
  authorizeAccountRoles("admin"),
  async (req, res, next) => {
    try {
      const { role } = req.body || {};
      const username = typeof req.body?.username === "string"
        ? req.body.username.trim().toLowerCase()
        : "";
      if (!["teacher", "student"].includes(role)) {
        throw clientError("role must be teacher or student.");
      }
      if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(username)) {
        throw clientError("username must be 3–120 letters, numbers, dots, underscores, or hyphens.");
      }
      await requireUniqueIndex(
        UserAccount,
        "unique_portal_username",
        { username: 1 }
      );
      if (role === "student") {
        await requireUniqueIndex(
          UserAccount,
          "unique_student_portal_account",
          { studentId: 1 }
        );
      }

      const temporaryPassword = crypto.randomBytes(18).toString("base64url");
      const accountData = {
        username,
        passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_COST),
        role,
        mustChangePassword: true,
      };
      if (role === "student") {
        if (!isObjectId(req.body.studentId)) throw clientError("A valid studentId is required.");
        if (!(await Student.exists({ _id: req.body.studentId }))) {
          throw clientError("Student was not found.", 404);
        }
        accountData.studentId = req.body.studentId;
      } else {
        const assignments = validateTeacherAssignments(req.body.assignments);
        for (const assignment of assignments) {
          if (!(await Class.exists({ _id: assignment.classId }))) {
            throw clientError("Teacher assignments must refer to an existing class.", 422);
          }
          const subjects = await Subject.find({
            _id: { $in: assignment.subjectIds },
            classId: assignment.classId,
            active: true,
          }).select("_id").lean();
          if (subjects.length !== new Set(assignment.subjectIds.map(String)).size) {
            throw clientError("Teacher subjects must belong to the assigned class.", 422);
          }
        }
        accountData.assignments = assignments;
      }

      const account = await UserAccount.create(accountData);
      res.set("Cache-Control", "no-store");
      return res.status(201).json({
        status: "ok",
        account: {
          id: String(account._id),
          username: account.username,
          role: account.role,
          mustChangePassword: true,
        },
        temporaryPassword,
        warning: "Copy this temporary password now; it is not shown again.",
      });
    } catch (error) {
      if (handleDuplicate(error, res, "That username or student account already exists.")) return;
      return next(error);
    }
  }
);

module.exports = router;
module.exports.validateTeacherAssignments = validateTeacherAssignments;
