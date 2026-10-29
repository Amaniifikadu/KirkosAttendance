const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const {
  ADMIN_TOKEN_TTL_SECONDS,
  getJwtSecret,
  TOKEN_ISSUER,
} = require("../src/middleware/authenticateAdmin");
const adminAuthRoutes = require("../src/routes/adminAuth.routes");

test("admin login token remains valid beyond the former 15-minute expiry", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";

  try {
    const loginRoute = adminAuthRoutes.stack.find(
      (layer) => layer.route?.path === "/login"
    );
    const loginHandler = loginRoute.route.stack[0].handle;
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };
    let nextError;
    const request = {
      body: {
        email: "admin@example.test",
        password: "test-password",
      },
    };
    const admin = {
      email: "admin@example.test",
      passwordHash:
        "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
    };
    const Admin = require("../src/models/Admin");
    const originalFindOne = Admin.findOne;
    Admin.findOne = () => ({
      select: async () => admin,
    });
    const bcrypt = require("bcryptjs");
    const originalCompare = bcrypt.compare;
    bcrypt.compare = async () => true;

    try {
      await loginHandler(request, response, (error) => {
        nextError = error;
      });
    } finally {
      Admin.findOne = originalFindOne;
      bcrypt.compare = originalCompare;
    }

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(ADMIN_TOKEN_TTL_SECONDS, 30 * 60);
    assert.equal(response.payload.expiresInSeconds, ADMIN_TOKEN_TTL_SECONDS);
    const payload = jwt.verify(response.payload.token, getJwtSecret(), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      clockTimestamp: Math.floor(Date.now() / 1000) + 16 * 60,
    });
    assert.equal(payload.role, "admin");
    assert.equal(payload.sub, admin.email);
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});
