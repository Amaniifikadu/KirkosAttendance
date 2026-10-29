const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const { authenticateAdmin } = require("../middleware/authenticateAdmin");
const {
  ADMIN_TOKEN_TTL_SECONDS,
  getJwtSecret,
  TOKEN_ISSUER,
} = require("../middleware/authenticateAdmin");

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/login", async (req, res, next) => {
  try {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (
      !EMAIL_PATTERN.test(email) ||
      email.length > 254 ||
      !password ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        status: "error",
        message: "A valid email and password are required.",
      });
    }

    const admin = await Admin.findOne({
      email: email.toLowerCase(),
      role: "admin",
    }).select("+passwordHash");
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      return res.status(401).json({
        status: "error",
        message: "Invalid administrator credentials.",
      });
    }

    const token = jwt.sign(
      { role: "admin" },
      getJwtSecret(),
      {
        algorithm: "HS256",
        subject: admin.email,
        issuer: TOKEN_ISSUER,
        expiresIn: ADMIN_TOKEN_TTL_SECONDS,
      }
    );

    return res.json({
      status: "ok",
      token,
      tokenType: "Bearer",
      expiresInSeconds: ADMIN_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts", authenticateAdmin, async (req, res, next) => {
  try {
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(body, "email") ||
      !Object.prototype.hasOwnProperty.call(body, "password") ||
      typeof body.email !== "string" ||
      typeof body.password !== "string"
    ) {
      return res.status(400).json({
        status: "error",
        message: "Provide only an email and password.",
      });
    }

    const email = body.email.trim().toLowerCase();
    const password = body.password;
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({
        status: "error",
        message: "A valid email address of at most 254 characters is required.",
      });
    }
    if (
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 12 characters and no more than 72 UTF-8 bytes.",
      });
    }

    const creator = await Admin.findOne({
      email: req.admin.email,
      role: "admin",
    })
      .select("_id")
      .lean();
    if (!creator) {
      return res.status(404).json({
        status: "error",
        message: "The authenticated administrator account was not found.",
      });
    }

    const existingAccount = await Admin.findOne({ email, role: "admin" })
      .select("_id")
      .lean();
    if (existingAccount) {
      return res.status(409).json({
        status: "error",
        message: "An administrator with that email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const account = await Admin.create({
      email,
      passwordHash,
      role: "admin",
      bootstrapKey: crypto.randomBytes(32).toString("hex"),
    });

    return res.status(201).json({
      status: "ok",
      account: {
        email: account.email,
        role: account.role,
      },
      message: "Administrator account created.",
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        status: "error",
        message: "An administrator with that email already exists or the account could not be created.",
      });
    }
    return next(error);
  }
});

router.patch("/email", authenticateAdmin, async (req, res, next) => {
  try {
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(body, "email") ||
      typeof body.email !== "string"
    ) {
      return res.status(400).json({
        status: "error",
        message: "Provide only a valid email field.",
      });
    }

    const email = body.email.trim().toLowerCase();
    if (
      !email ||
      email.length > 254 ||
      !EMAIL_PATTERN.test(email)
    ) {
      return res.status(400).json({
        status: "error",
        message: "A valid email address of at most 254 characters is required.",
      });
    }

    const admin = await Admin.findOne({
      email: req.admin.email,
      role: "admin",
    })
      .select("_id email")
      .lean();
    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "The authenticated administrator account was not found.",
      });
    }

    if (admin.email.toLowerCase() === email) {
      return res.json({
        status: "ok",
        email: admin.email,
        changed: false,
        message: "That email address is already in use by this account.",
      });
    }

    const emailOwner = await Admin.findOne({
      email,
      role: "admin",
      _id: { $ne: admin._id },
    })
      .select("_id")
      .lean();
    if (emailOwner) {
      return res.status(409).json({
        status: "error",
        message: "That email address is already in use.",
      });
    }

    const result = await Admin.collection.updateOne(
      { _id: admin._id, email: admin.email, role: "admin" },
      { $set: { email } },
      { upsert: false }
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      return res.status(409).json({
        status: "error",
        message: "The administrator account changed concurrently. Please retry.",
      });
    }

    const token = jwt.sign(
      { role: "admin" },
      getJwtSecret(),
      {
        algorithm: "HS256",
        subject: email,
        issuer: TOKEN_ISSUER,
        expiresIn: ADMIN_TOKEN_TTL_SECONDS,
      }
    );

    return res.json({
      status: "ok",
      email,
      changed: true,
      token,
      tokenType: "Bearer",
      expiresInSeconds: ADMIN_TOKEN_TTL_SECONDS,
      message: "Administrator email updated.",
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        status: "error",
        message: "That email address is already in use.",
      });
    }
    return next(error);
  }
});

module.exports = router;
