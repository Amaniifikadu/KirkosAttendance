const mongoose = require("mongoose");

const parentMeetingAttendanceSchema = new mongoose.Schema(
  {
    meetingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ParentMeeting",
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["present", "absent", "permission", "not_recorded"],
      default: "not_recorded",
    },
    guardianName: { type: String, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
  }
);

parentMeetingAttendanceSchema.index(
  { meetingId: 1, studentId: 1 },
  { unique: true, name: "unique_parent_meeting_student" }
);

module.exports = mongoose.model(
  "ParentMeetingAttendance",
  parentMeetingAttendanceSchema
);
