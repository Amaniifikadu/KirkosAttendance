const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const UserAccount = require("../models/UserAccount");
const { getJwtSecret, TOKEN_ISSUER } = require("./authenticateAdmin");

async function authenticateAccount(req, res, next) {
  const authorization = req.get("authorization") || "";
  const parts = authorization.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return res.status(401).json({
      status: "error",
      message: "A valid portal bearer token is required.",
    });
  }

  try {
    const payload = jwt.verify(parts[1], getJwtSecret(), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
    });
    if (payload.role === "admin" && typeof payload.sub === "string") {
      req.account = {
        role: "admin",
        username: payload.sub,
        assignments: [],
        mustChangePassword: false,
      };
      return next();
    }
    if (
      !["teacher", "student"].includes(payload.role) ||
      typeof payload.sub !== "string" ||
      !mongoose.isValidObjectId(payload.sub)
    ) {
      return res.status(401).json({
        status: "error",
        message: "The portal token is invalid or expired.",
      });
    }

    const account = await UserAccount.findOne({
      _id: payload.sub,
      role: payload.role,
      active: true,
    })
      .select("username role studentId assignments mustChangePassword")
      .lean();
    if (!account) {
      return res.status(401).json({
        status: "error",
        message: "The portal account is unavailable.",
      });
    }
    req.account = account;
    return next();
  } catch (error) {
    if (error.statusCode === 503) return next(error);
    return res.status(401).json({
      status: "error",
      message: "The portal token is invalid or expired.",
    });
  }
}

function authorizeAccountRoles(...roles) {
  return (req, res, next) => {
    if (!req.account || !roles.includes(req.account.role)) {
      return res.status(403).json({
        status: "error",
        message: "This account is not authorized for the requested operation.",
      });
    }
    return next();
  };
}

function requireChangedPassword(req, res, next) {
  if (req.account?.mustChangePassword && req.path !== "/password") {
    return res.status(403).json({
      status: "error",
      message: "Change the temporary password before using the portal.",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  }
  return next();
}

module.exports = {
  authenticateAccount,
  authorizeAccountRoles,
  requireChangedPassword,
};
