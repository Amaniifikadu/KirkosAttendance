const mongoose = require("mongoose");

const examSchema = new mongoose.Schema(
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
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameKey: { type: String, required: true, lowercase: true, trim: true },
    examDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    academicYear: { type: Number, required: true, min: 1000, max: 9999 },
    academicMonth: { type: Number, required: true, min: 1, max: 13 },
    termId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicTerm",
      default: null,
    },
    maxMarks: { type: Number, required: true, min: 0.01, max: 10000 },
    createdBy: { type: String, required: true, maxlength: 254 },
  },
  { timestamps: true, autoCreate: false, autoIndex: false }
);

examSchema.index(
  { classId: 1, subjectId: 1, academicYear: 1, nameKey: 1 },
  { unique: true, name: "unique_exam_name_per_subject_year" }
);

module.exports = mongoose.model("Exam", examSchema);
