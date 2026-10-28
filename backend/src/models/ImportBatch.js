const mongoose = require("mongoose");

const importBatchSchema = new mongoose.Schema(
  {
    fileHash: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
    },
    insertedCount: { type: Number, required: true, min: 0 },
    skippedCount: { type: Number, required: true, min: 0 },
    importedBy: { type: String, required: true, maxlength: 254 },
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
  }
);

importBatchSchema.index(
  { fileHash: 1 },
  { unique: true, name: "unique_imported_workbook" }
);

module.exports = mongoose.model("ImportBatch", importBatchSchema);
