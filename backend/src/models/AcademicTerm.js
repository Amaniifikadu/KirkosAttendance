const mongoose = require("mongoose");

const academicTermSchema = new mongoose.Schema(
  {
    academicYear: { type: Number, required: true, min: 1000, max: 9999 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true, lowercase: true, trim: true },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    createdBy: { type: String, required: true, maxlength: 254 },
  },
  { timestamps: true, autoCreate: false, autoIndex: false }
);

academicTermSchema.index(
  { academicYear: 1, nameKey: 1 },
  { unique: true, name: "unique_term_per_academic_year" }
);
academicTermSchema.index(
  { academicYear: 1, startDate: 1, endDate: 1 },
  { name: "academic_term_date_range" }
);

module.exports = mongoose.model("AcademicTerm", academicTermSchema);
