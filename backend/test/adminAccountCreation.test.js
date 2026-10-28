const assert = require("node:assert/strict");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Admin = require("../src/models/Admin");
const adminAuthRoutes = require("../src/routes/adminAuth.routes");
const errorHandler = require("../src/middleware/errorHandler");
const { TOKEN_ISSUER } = require("../src/middleware/authenticateAdmin");

const TEST_SECRET = "admin-account-creation-test-secret-at-least-32-bytes";
const firstAdmin = {
  _id: new mongoose.Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
  email: "existing-admin@example.test",
  passwordHash: "unchanged-existing-password-hash",
  role: "admin",
  bootstrapKey: "initial-admin",
  createdAt: new Date("2020-01-01T00:00:00.000Z"),
  updatedAt: new Date("2020-01-02T00:00:00.000Z"),
};
const firstAdminPassword = "First-admin-original-password";

async function withRoute(run) {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindOne = Admin.findOne;
  const originalCreate = Admin.create;
  const accounts = [structuredClone(firstAdmin)];
  accounts[0].passwordHash = await bcrypt.hash(firstAdminPassword, 12);
  const creationAttempts = [];
  process.env.JWT_SECRET = TEST_SECRET;

  Admin.findOne = (filter) => {
    const found = accounts.find(
        (account) =>
          account.email === filter.email &&
          account.role === filter.role &&
          (filter._id === undefined ||
            (filter._id.$ne
              ? String(account._id) !== String(filter._id.$ne)
              : String(account._id) === String(filter._id)))
      );
    return {
      select() {
        return this;
      },
      lean: async () => (found ? { _id: found._id } : null),
      then(resolve, reject) {
        return Promise.resolve(found).then(resolve, reject);
      },
    };
  };
  Admin.create = async (data) => {
    creationAttempts.push(data);
    if (accounts.some(({ email }) => email === data.email)) {
      throw Object.assign(new Error("duplicate email"), { code: 11000 });
    }
    if (accounts.some(({ bootstrapKey }) => bootstrapKey === data.bootstrapKey)) {
      throw Object.assign(new Error("duplicate bootstrap key"), { code: 11000 });
    }
    const account = {
      ...data,
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    accounts.push(account);
    return account;
  };

  const app = express();
  app.use(express.json());
  app.use("/api/auth/admin", adminAuthRoutes);
  app.use(errorHandler);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth/admin`;
  const tokenFor = (email, role = "admin") =>
    jwt.sign(
      { role },
      TEST_SECRET,
      {
        algorithm: "HS256",
        subject: email,
        issuer: TOKEN_ISSUER,
        expiresIn: "5m",
      }
    );

  try {
    await run({ baseUrl, accounts, creationAttempts, tokenFor });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Admin.findOne = originalFindOne;
    Admin.create = originalCreate;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
}

async function createAccount(baseUrl, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/accounts`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("admin account creation rejects missing and invalid authentication", async () => {
  await withRoute(async ({ baseUrl, tokenFor }) => {
    const noToken = await createAccount(baseUrl, "", {
      email: "second@example.test",
      password: "A-long-password-123",
    });
    assert.equal(noToken.response.status, 401);

    const invalidToken = await createAccount(baseUrl, "invalid.jwt.token", {
      email: "second@example.test",
      password: "A-long-password-123",
    });
    assert.equal(invalidToken.response.status, 401);

    const nonAdmin = await createAccount(
      baseUrl,
      tokenFor("teacher@example.test", "teacher"),
      { email: "second@example.test", password: "A-long-password-123" }
    );
    assert.equal(nonAdmin.response.status, 403);
  });
});

test("admin account creation requires exactly email and password", async () => {
  await withRoute(async ({ baseUrl, tokenFor, creationAttempts }) => {
    const token = tokenFor(firstAdmin.email);
    const invalidBodies = [
      {},
      { email: "second@example.test" },
      { password: "A-long-password-123" },
      { email: "second@example.test", password: "A-long-password-123", role: "admin" },
      { email: "second@example.test", password: "A-long-password-123", adminId: "other" },
    ];
    for (const body of invalidBodies) {
      const { response } = await createAccount(baseUrl, token, body);
      assert.equal(response.status, 400);
    }
    assert.equal(creationAttempts.length, 0);
  });
});

test("admin account creation validates normalized email and password limits", async () => {
  await withRoute(async ({ baseUrl, tokenFor, creationAttempts }) => {
    const token = tokenFor(firstAdmin.email);
    const invalidBodies = [
      { email: "", password: "A-long-password-123" },
      { email: "not-an-email", password: "A-long-password-123" },
      { email: `${"a".repeat(245)}@example.test`, password: "A-long-password-123" },
      { email: "second@example.test", password: "short" },
      { email: "second@example.test", password: "é".repeat(37) },
    ];
    for (const body of invalidBodies) {
      const { response } = await createAccount(baseUrl, token, body);
      assert.equal(response.status, 400);
    }
    assert.equal(creationAttempts.length, 0);
  });
});

test("existing admin identity must still resolve before account creation", async () => {
  await withRoute(async ({ baseUrl, tokenFor, accounts, creationAttempts }) => {
    const originalFindOne = Admin.findOne;
    const original = structuredClone(accounts[0]);
    Admin.findOne = () => ({
      select() {
        return this;
      },
      lean: async () => null,
    });
    try {
      const { response, payload } = await createAccount(
        baseUrl,
        tokenFor(firstAdmin.email),
        { email: "second@example.test", password: "A-long-password-123" }
      );
      assert.equal(response.status, 404);
      assert.equal(
        payload.message,
        "The authenticated administrator account was not found."
      );
      assert.equal(creationAttempts.length, 0);
      assert.deepEqual(accounts, [original]);
    } finally {
      Admin.findOne = originalFindOne;
    }
  });
});

test("successful creation stores an independent bcrypt credential and bootstrap key", async () => {
  await withRoute(async ({ baseUrl, tokenFor, accounts, creationAttempts }) => {
    const original = structuredClone(accounts[0]);
    const plaintextPassword = "Second-admin-strong-password-2026";
    const { response, payload } = await createAccount(
      baseUrl,
      tokenFor(firstAdmin.email),
      { email: "  Second.Admin@Example.Test ", password: plaintextPassword }
    );

    assert.equal(response.status, 201);
    assert.deepEqual(payload, {
      status: "ok",
      account: { email: "second.admin@example.test", role: "admin" },
      message: "Administrator account created.",
    });
    assert.equal(Object.hasOwn(payload.account, "passwordHash"), false);
    assert.equal(Object.hasOwn(payload.account, "bootstrapKey"), false);
    assert.equal(accounts.length, 2);
    assert.deepEqual(accounts[0], original);

    const created = accounts[1];
    assert.equal(created.email, "second.admin@example.test");
    assert.equal(created.role, "admin");
    assert.notEqual(created.passwordHash, plaintextPassword);
    assert.equal(await bcrypt.compare(plaintextPassword, created.passwordHash), true);
    assert.equal(creationAttempts[0].passwordHash, created.passwordHash);
    assert.match(created.bootstrapKey, /^[a-f0-9]{64}$/);
    assert.notEqual(created.bootstrapKey, firstAdmin.bootstrapKey);
    assert.notEqual(created.passwordHash, firstAdmin.passwordHash);
    assert.equal(created.createdAt instanceof Date, true);
    assert.equal(created.updatedAt instanceof Date, true);
    assert.equal(JSON.stringify(payload).includes(plaintextPassword), false);
    assert.equal(JSON.stringify(payload).includes(created.passwordHash), false);
    assert.equal(JSON.stringify(payload).includes(created.bootstrapKey), false);
  });
});

test("duplicate email returns a safe 409 and preserves the existing admin", async () => {
  await withRoute(async ({ baseUrl, tokenFor, accounts, creationAttempts }) => {
    const original = structuredClone(accounts[0]);
    const { response, payload } = await createAccount(
      baseUrl,
      tokenFor(firstAdmin.email),
      { email: firstAdmin.email, password: "Second-admin-strong-password" }
    );
    assert.equal(response.status, 409);
    assert.equal(
      payload.message,
      "An administrator with that email already exists."
    );
    assert.deepEqual(accounts, [original]);
    assert.equal(creationAttempts.length, 0);
    assert.equal(JSON.stringify(payload).includes(firstAdmin.passwordHash), false);
    assert.equal(JSON.stringify(payload).includes(firstAdmin.bootstrapKey), false);
  });
});

test("duplicate-key errors including bootstrap-key collisions return safe 409 responses", async () => {
  await withRoute(async ({ baseUrl, tokenFor, accounts }) => {
    const original = structuredClone(accounts[0]);
    const originalCreate = Admin.create;
    const errors = [
      new Error("email index details"),
      new Error("bootstrap index details"),
    ];
    errors[0].code = 11000;
    errors[1].code = 11000;
    let call = 0;
    Admin.create = async () => {
      throw errors[call++];
    };

    try {
      for (let index = 0; index < errors.length; index += 1) {
        const { response, payload } = await createAccount(
          baseUrl,
          tokenFor(firstAdmin.email),
          {
            email: `new-${index}@example.test`,
            password: "Second-admin-strong-password",
          }
        );
        assert.equal(response.status, 409);
        assert.equal(payload.message.includes("already exists or"), true);
        assert.equal(JSON.stringify(payload).includes("index details"), false);
        assert.equal(JSON.stringify(payload).includes(firstAdmin.passwordHash), false);
        assert.equal(JSON.stringify(payload).includes(firstAdmin.bootstrapKey), false);
      }
      assert.deepEqual(accounts, [original]);
    } finally {
      Admin.create = originalCreate;
    }
  });
});

test("both admin accounts can log in independently with their own credentials", async () => {
  await withRoute(async ({ baseUrl, tokenFor, accounts }) => {
    const secondPassword = "Second-admin-strong-password-2026";
    const creation = await createAccount(
      baseUrl,
      tokenFor(firstAdmin.email),
      { email: "second@example.test", password: secondPassword }
    );
    assert.equal(creation.response.status, 201);

    const originalFindOne = Admin.findOne;
    Admin.findOne = (filter) => {
      const found = accounts.find(
        ({ email, role }) => email === filter.email && role === filter.role
      ) || null;
      return {
        select() {
          return this;
        },
        lean: async () => found,
        then(resolve, reject) {
          return Promise.resolve(found).then(resolve, reject);
        },
      };
    };
    try {
      const login = async (email, password) => {
        const response = await fetch(`${baseUrl}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        return { response, payload: await response.json() };
      };

      const secondLogin = await login("SECOND@example.test", secondPassword);
      assert.equal(secondLogin.response.status, 200);
      const secondClaims = jwt.verify(secondLogin.payload.token, TEST_SECRET, {
        algorithms: ["HS256"],
        issuer: TOKEN_ISSUER,
      });
      assert.equal(secondClaims.role, "admin");
      assert.equal(secondClaims.sub, "second@example.test");

      const firstLogin = await login(firstAdmin.email, firstAdminPassword);
      assert.equal(firstLogin.response.status, 200);
      const firstClaims = jwt.verify(firstLogin.payload.token, TEST_SECRET, {
        algorithms: ["HS256"],
        issuer: TOKEN_ISSUER,
      });
      assert.equal(firstClaims.role, "admin");
      assert.equal(firstClaims.sub, firstAdmin.email);
    } finally {
      Admin.findOne = originalFindOne;
    }
  });
});
