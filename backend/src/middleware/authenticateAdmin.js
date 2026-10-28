const jwt = require("jsonwebtoken");

const TOKEN_ISSUER = "kirkos-attendance";
const ADMIN_TOKEN_TTL_SECONDS = 30 * 60;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    const error = new Error(
      "Admin authentication is not configured. Set JWT_SECRET to at least 32 characters."
    );
    error.statusCode = 503;
    error.expose = true;
    throw error;
  }

  return secret;
}

function authenticateAdmin(req, res, next) {
  const authorization = req.get("authorization") || "";
  const parts = authorization.split(" ");
  const [scheme, token] = parts;

  if (scheme !== "Bearer" || !token || parts.length !== 2) {
    return res.status(401).json({
      status: "error",
      message: "A valid administrator bearer token is required.",
    });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
    });

    if (payload.role !== "admin" || typeof payload.sub !== "string") {
      return res.status(403).json({
        status: "error",
        message: "Administrator access is required.",
      });
    }

    req.admin = { email: payload.sub };
    return next();
  } catch (error) {
    if (error.statusCode === 503) {
      return next(error);
    }

    return res.status(401).json({
      status: "error",
      message: "The administrator token is invalid or expired.",
    });
  }
}

module.exports = {
  ADMIN_TOKEN_TTL_SECONDS,
  authenticateAdmin,
  getJwtSecret,
  TOKEN_ISSUER,
};
