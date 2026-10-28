const mongoose = require("mongoose");
const AcademicTerm = require("../models/AcademicTerm");
const Class = require("../models/Class");
const Subject = require("../models/Subject");
const SubjectAttendance = require("../models/SubjectAttendance");
const SubjectLesson = require("../models/SubjectLesson");
const Student = require("../models/Student");
const { normalizeAcademicPeriod } = require("./academicCalendar");
const { numericStudentSortStages } = require("./studentList");
const SUNDAY_SCHOOL_CLASSES = require("../config/sundaySchoolClasses");

function classifyAttendance({ attended, total }) {
  if (!total) return { status: "not_enough_data", percentage: null };
  const percentage = (attended / total) * 100;
  return {
    status: percentage > 50 ? "eligible" : "not_eligible",
    percentage: Number(percentage.toFixed(2)),
  };
}

function evaluateStudentEligibility({
  student,
  finalizedLessons,
  incompleteLessons,
  recordByLessonStudent,
}) {
  const studentId = String(student._id);
  const studentFinalized = finalizedLessons.filter((lesson) =>
    lesson.rosterStudentIds.some((id) => String(id) === studentId)
  );
  const studentIncomplete = incompleteLessons.filter((lesson) =>
    lesson.rosterStudentIds.some((id) => String(id) === studentId)
  );
  const validFinalized = studentFinalized.filter((lesson) =>
    recordByLessonStudent.has(`${lesson._id}:${student._id}`)
  );
  const corruptFinalized = studentFinalized.length - validFinalized.length;
  const attended = validFinalized.reduce(
    (count, lesson) =>
      count +
      (recordByLessonStudent.get(`${lesson._id}:${student._id}`) === "present"
        ? 1
        : 0),
    0
  );
  const totals = {
    attendedSessions: attended,
    totalFinalizedSessions: validFinalized.length,
    incompleteSessions: studentIncomplete.length + corruptFinalized,
  };
  const classification =
    totals.incompleteSessions > 0
      ? { status: "attendance_incomplete", percentage: null }
      : classifyAttendance({
          attended,
          total: validFinalized.length,
        });
  return {
    studentId,
    studentNumber: student.originalSerialNumber,
    fullName: [student.studentName, student.christianName]
      .filter(Boolean)
      .join(" "),
    classNumber: student.classNumber,
    className: SUNDAY_SCHOOL_CLASSES.getDisplayName(student.classNumber),
    ...totals,
    attendancePercentage: classification.percentage,
    eligibility: classification.status,
  };
}

function historicalRosterIds(lessons) {
  return [
    ...new Map(
      lessons
        .filter(({ status }) => status === "scheduled" || status === "finalized")
        .flatMap(({ rosterStudentIds }) =>
          rosterStudentIds.map((id) => [String(id), id])
        )
    ).values(),
  ];
}

async function resolveLessonFilter({
  academicYear: yearValue,
  academicMonth: monthValue,
  termId,
}) {
  const academicYear = normalizeAcademicPeriod(yearValue);
  const filter = { academicYear };
  if (termId !== undefined && termId !== "") {
    if (!mongoose.isValidObjectId(termId)) {
      throw Object.assign(new Error("termId is invalid."), {
        statusCode: 400,
        expose: true,
      });
    }
    const term = await AcademicTerm.findOne({
      _id: termId,
      academicYear,
    }).lean();
    if (!term) {
      throw Object.assign(new Error("The selected academic term was not found."), {
        statusCode: 404,
        expose: true,
      });
    }
    filter.lessonDate = { $gte: term.startDate, $lte: term.endDate };
    return { academicYear, filter, periodLabel: term.name };
  }
  if (monthValue !== undefined && monthValue !== "") {
    const academicMonth = Number(monthValue);
    if (!Number.isInteger(academicMonth) || academicMonth < 1 || academicMonth > 13) {
      throw Object.assign(new Error("academicMonth must be from 1 to 13."), {
        statusCode: 400,
        expose: true,
      });
    }
    filter.academicMonth = academicMonth;
    return { academicYear, filter, periodLabel: `month-${academicMonth}` };
  }
  return { academicYear, filter, periodLabel: "academic-year" };
}

async function getEligibility({
  classId,
  subjectId,
  academicYear: yearValue,
  academicMonth,
  termId,
}) {
  if (!mongoose.isValidObjectId(classId) || !mongoose.isValidObjectId(subjectId)) {
    throw Object.assign(new Error("A valid classId and subjectId are required."), {
      statusCode: 400,
      expose: true,
    });
  }
  const classRecord = await Class.findById(classId).lean();
  if (!classRecord) {
    throw Object.assign(new Error("The selected class was not found."), {
      statusCode: 404,
      expose: true,
    });
  }
  const subject = await Subject.findOne({ _id: subjectId, classId }).lean();
  if (!subject) {
    throw Object.assign(new Error("The selected subject does not belong to this class."), {
      statusCode: 422,
      expose: true,
    });
  }
  const { academicYear, filter, periodLabel } = await resolveLessonFilter({
    academicYear: yearValue,
    academicMonth,
    termId,
  });
  const lessons = await SubjectLesson.find({
    classId,
    subjectId,
    ...filter,
  }).lean();
  const finalizedLessons = lessons.filter(({ status }) => status === "finalized");
  const incompleteLessons = lessons.filter(({ status }) => status === "scheduled");
  const lessonIds = finalizedLessons.map(({ _id }) => _id);
  const records = lessonIds.length
    ? await SubjectAttendance.find({
        lessonId: { $in: lessonIds },
      })
        .select("lessonId studentId status")
        .lean()
    : [];
  const recordByLessonStudent = new Map(
    records.map((record) => [
      `${record.lessonId}:${record.studentId}`,
      record.status,
    ])
  );
  const rosterIds = historicalRosterIds(lessons);
  const students = await Student.aggregate([
    {
      $match: {
        $or: [
          { classId: new mongoose.Types.ObjectId(classId) },
          { _id: { $in: rosterIds } },
        ],
      },
    },
    ...numericStudentSortStages(),
    {
      $project: {
        _id: 1,
        classNumber: 1,
        originalSerialNumber: 1,
        studentName: 1,
        christianName: 1,
      },
    },
  ]);

  const groups = {
    eligible: [],
    notEligible: [],
    attendanceIncomplete: [],
    notEnoughData: [],
  };
  for (const student of students) {
    const item = evaluateStudentEligibility({
      student: { ...student, classNumber: classRecord.classNumber },
      finalizedLessons,
      incompleteLessons,
      recordByLessonStudent,
    });
    if (item.eligibility === "eligible") groups.eligible.push(item);
    else if (item.eligibility === "not_eligible") groups.notEligible.push(item);
    else if (item.eligibility === "attendance_incomplete") {
      groups.attendanceIncomplete.push(item);
    } else groups.notEnoughData.push(item);
  }

  return {
    classId: String(classId),
    classNumber: classRecord.classNumber,
    subject: { id: String(subject._id), name: subject.name },
    academicYear,
    academicMonth: academicMonth ? Number(academicMonth) : null,
    termId: termId || null,
    period: periodLabel,
    sessionCounts: {
      finalized: finalizedLessons.length,
      incomplete: incompleteLessons.length,
      cancelled: lessons.filter(({ status }) => status === "cancelled").length,
    },
    groups,
    summary: {
      eligible: groups.eligible.length,
      notEligible: groups.notEligible.length,
      attendanceIncomplete: groups.attendanceIncomplete.length,
      notEnoughData: groups.notEnoughData.length,
    },
  };
}

module.exports = {
  classifyAttendance,
  evaluateStudentEligibility,
  getEligibility,
  historicalRosterIds,
  resolveLessonFilter,
};
