const mongoose = require("mongoose");

const studentSourceSchema = new mongoose.Schema(
  {
    sheetName: { type: String, maxlength: 100 },
    worksheetRow: { type: Number, min: 1 },
  },
  { _id: false }
);

const studentSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
      index: false,
    },
    classNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 999,
    },
    originalSerialNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    studentName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    christianName: { type: String, trim: true, maxlength: 200 },
    gender: { type: String, trim: true, maxlength: 50 },
    age: { type: Number, min: 0, max: 120 },
    schoolGrade: { type: String, trim: true, maxlength: 100 },
    district: { type: String, trim: true, maxlength: 200 },
    houseNumber: { type: String, trim: true, maxlength: 100 },
    guardianName: { type: String, trim: true, maxlength: 200 },
    guardianPhone: { type: String, trim: true, maxlength: 50 },
    studentPhone: { type: String, trim: true, maxlength: 50 },
    telegramPhone: { type: String, trim: true, maxlength: 50 },
    source: { type: studentSourceSchema, default: undefined },
    sourceData: [
      {
        column: { type: Number, required: true, min: 1 },
        header: { type: String, maxlength: 200 },
        value: { type: String, maxlength: 1000 },
      },
    ],
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
  }
);

studentSchema.index(
  { classNumber: 1, originalSerialNumber: 1 },
  { unique: true, name: "unique_student_serial_per_class" }
);

module.exports = mongoose.model("Student", studentSchema);
