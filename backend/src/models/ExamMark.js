const mongoose = require("mongoose");

const examMarkSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    marks: { type: Number, required: true, min: 0 },
    recordedBy: { type: String, required: true, maxlength: 254 },
  },
  { timestamps: true, autoCreate: false, autoIndex: false }
);

examMarkSchema.index(
  { examId: 1, studentId: 1 },
  { unique: true, name: "unique_student_mark_per_exam" }
);

module.exports = mongoose.model("ExamMark", examMarkSchema);
