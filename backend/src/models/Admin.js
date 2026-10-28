const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      required: true,
      enum: ["admin"],
      default: "admin",
    },
    bootstrapKey: {
      type: String,
      required: true,
      default: "initial-admin",
      select: false,
    },
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
    strict: "throw",
  }
);

adminSchema.index({ email: 1 }, { unique: true, name: "unique_admin_email" });
adminSchema.index(
  { bootstrapKey: 1 },
  { unique: true, name: "one_initial_admin_only" }
);

module.exports = mongoose.model("Admin", adminSchema);
