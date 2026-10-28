const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    classNumber: { type: Number, required: true, min: 1, max: 999 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameKey: { type: String, required: true, lowercase: true, trim: true },
    active: { type: Boolean, default: true, required: true },
  },
  { timestamps: true, autoCreate: false, autoIndex: false }
);

subjectSchema.index(
  { classId: 1, nameKey: 1 },
  { unique: true, name: "unique_subject_name_per_class" }
);

module.exports = mongoose.model("Subject", subjectSchema);
