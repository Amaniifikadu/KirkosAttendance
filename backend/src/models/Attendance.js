const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    classNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    attendanceDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    status: {
      type: String,
      required: true,
      enum: ["present", "absent", "permission"],
    },
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
  }
);

attendanceSchema.index(
  { studentId: 1, attendanceDate: 1 },
  { unique: true, name: "unique_student_attendance_per_date" }
);
attendanceSchema.index({ classNumber: 1, attendanceDate: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
