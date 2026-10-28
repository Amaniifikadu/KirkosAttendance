const mongoose = require("mongoose");

const parentMeetingSchema = new mongoose.Schema(
  {
    meetingDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    academicYear: { type: Number, required: true, min: 1000, max: 9999 },
    academicMonth: { type: Number, required: true, min: 1, max: 13 },
    createdBy: { type: String, required: true, trim: true, maxlength: 320 },
    deletionState: {
      type: String,
      enum: ["active", "deleting"],
      default: "active",
    },
    operationLock: { type: String, maxlength: 36 },
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
  }
);

parentMeetingSchema.index(
  { meetingDate: 1 },
  { unique: true, name: "unique_parent_meeting_date" }
);

module.exports = mongoose.model("ParentMeeting", parentMeetingSchema);
