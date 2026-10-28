const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    classNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 999,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    sheetName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
  }
);

classSchema.index({ classNumber: 1 }, { unique: true });
classSchema.index({ name: 1 }, { unique: true });
classSchema.index({ sheetName: 1 }, { unique: true });

module.exports = mongoose.model("Class", classSchema);
