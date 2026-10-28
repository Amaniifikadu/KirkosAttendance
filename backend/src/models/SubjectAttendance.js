const mongoose = require("mongoose");

const subjectAttendanceSchema = new mongoose.Schema(
  {
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubjectLesson",
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
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
    status: {
      type: String,
      enum: ["present", "absent", "permission"],
      required: true,
    },
    recordedBy: { type: String, required: true, maxlength: 254 },
  },
  { timestamps: true, autoCreate: false, autoIndex: false }
);

subjectAttendanceSchema.index(
  { lessonId: 1, studentId: 1 },
  { unique: true, name: "unique_student_attendance_per_subject_lesson" }
);
subjectAttendanceSchema.index(
  { studentId: 1, subjectId: 1, lessonDate: 1 },
  { name: "student_subject_attendance_history" }
);

module.exports = mongoose.model("SubjectAttendance", subjectAttendanceSchema);
