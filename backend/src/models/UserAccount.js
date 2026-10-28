const mongoose = require("mongoose");

const teacherAssignmentSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    subjectIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
    }],
  },
  { _id: false }
);

const userAccountSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 120,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["teacher", "student"], required: true },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
    },
    assignments: { type: [teacherAssignmentSchema], default: [] },
    mustChangePassword: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, autoCreate: false, autoIndex: false }
);

userAccountSchema.index(
  { username: 1 },
  { unique: true, name: "unique_portal_username" }
);
userAccountSchema.index(
  { studentId: 1 },
  {
    unique: true,
    name: "unique_student_portal_account",
    partialFilterExpression: { role: "student", studentId: { $type: "objectId" } },
  }
);

module.exports = mongoose.model("UserAccount", userAccountSchema);
