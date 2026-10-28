const mongoose = require("mongoose");

const attendanceSessionSchema = new mongoose.Schema(
  {
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
      enum: ["draft", "complete"],
      default: "draft",
    },
    rosterStudentIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Student",
      default: [],
    },
    completedAt: { type: Date, default: null },
    completedBy: { type: String, maxlength: 254, default: null },
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
  }
);

attendanceSessionSchema.index(
  { classNumber: 1, attendanceDate: 1 },
  { unique: true, name: "unique_attendance_session_per_class_date" }
);
attendanceSessionSchema.index({ status: 1, attendanceDate: 1 });

module.exports = mongoose.model(
  "AttendanceSession",
  attendanceSessionSchema
);
