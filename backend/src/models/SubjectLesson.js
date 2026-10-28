const mongoose = require("mongoose");

const subjectLessonSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    classNumber: { type: Number, required: true, min: 1, max: 999 },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    lessonDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    academicYear: { type: Number, required: true, min: 1000, max: 9999 },
    academicMonth: { type: Number, required: true, min: 1, max: 13 },
    termId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicTerm",
      default: null,
    },
    status: {
      type: String,
      enum: ["scheduled", "finalized", "cancelled"],
      default: "scheduled",
      required: true,
    },
    rosterStudentIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Student",
      required: true,
    },
    createdBy: { type: String, required: true, maxlength: 254 },
    finalizedBy: { type: String, default: null, maxlength: 254 },
    finalizedAt: { type: Date, default: null },
    cancelledBy: { type: String, default: null, maxlength: 254 },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true, autoCreate: false, autoIndex: false }
);

subjectLessonSchema.index(
  { classId: 1, subjectId: 1, lessonDate: 1 },
  { unique: true, name: "unique_subject_lesson_date" }
);
subjectLessonSchema.index(
  { classId: 1, subjectId: 1, academicYear: 1, academicMonth: 1, status: 1 },
  { name: "subject_lessons_by_period" }
);

module.exports = mongoose.model("SubjectLesson", subjectLessonSchema);
