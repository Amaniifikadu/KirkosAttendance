const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Admin = require("../src/models/Admin");
const adminAuthRoutes = require("../src/routes/adminAuth.routes");
const errorHandler = require("../src/middleware/errorHandler");
const { TOKEN_ISSUER } = require("../src/middleware/authenticateAdmin");

const TEST_SECRET = "admin-email-change-test-secret-at-least-32-bytes";
const currentAdmin = {
  _id: new mongoose.Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
  email: "current@example.test",
  passwordHash: "must-not-be-returned",
  bootstrapKey: "must-not-be-returned",
  role: "admin",
  createdAt: new Date("2020-01-01T00:00:00.000Z"),
  updatedAt: new Date("2020-01-02T00:00:00.000Z"),
};

async function withRoute({ findAdmin, updateEmail }, run) {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindOne = Admin.findOne;
  const originalUpdateOne = Admin.collection.updateOne;
  process.env.JWT_SECRET = TEST_SECRET;
  Admin.findOne = findAdmin || ((filter) => ({
    select() {
      return this;
    },
    lean: async () =>
      filter.email === currentAdmin.email ? { ...currentAdmin } : null,
  }));
  Admin.collection.updateOne =
    updateEmail || (async () => ({ matchedCount: 1, modifiedCount: 1 }));

  const app = express();
  app.use(express.json());
  app.use("/api/auth/admin", adminAuthRoutes);
  app.use(errorHandler);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth/admin/email`;
  const token = jwt.sign(
    { role: "admin" },
    TEST_SECRET,
    {
      algorithm: "HS256",
      subject: currentAdmin.email,
      issuer: TOKEN_ISSUER,
      expiresIn: "5m",
    }
  );

  try {
    await run({ baseUrl, token });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Admin.findOne = originalFindOne;
    Admin.collection.updateOne = originalUpdateOne;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
}

async function patchEmail(baseUrl, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(baseUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("email change requires an authenticated administrator", async () => {
  await withRoute({}, async ({ baseUrl }) => {
    const { response, payload } = await patchEmail(baseUrl, "", {
      email: "new@example.test",
    });
    assert.equal(response.status, 401);
    assert.equal(payload.status, "error");
  });
});

test("a validly signed non-admin token is forbidden from changing email", async () => {
  await withRoute({}, async ({ baseUrl }) => {
    const nonAdminToken = jwt.sign(
      { role: "teacher" },
      TEST_SECRET,
      {
        algorithm: "HS256",
        subject: String(currentAdmin._id),
        issuer: TOKEN_ISSUER,
        expiresIn: "5m",
      }
    );
    const { response, payload } = await patchEmail(baseUrl, nonAdminToken, {
      email: "new@example.test",
    });
    assert.equal(response.status, 403);
    assert.equal(payload.message, "Administrator access is required.");
  });
});

test("authenticated admin whose email no longer exists receives a safe 404", async () => {
  let updateCalls = 0;
  await withRoute(
    {
      findAdmin: (filter) => ({
        select() {
          return this;
        },
        lean: async () => {
          assert.deepEqual(filter, {
            email: currentAdmin.email,
            role: "admin",
          });
          return null;
        },
      }),
      updateEmail: async () => {
        updateCalls += 1;
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
    async ({ baseUrl, token }) => {
      const { response, payload } = await patchEmail(baseUrl, token, {
        email: "new@example.test",
      });
      assert.equal(response.status, 404);
      assert.equal(
        payload.message,
        "The authenticated administrator account was not found."
      );
      assert.equal(updateCalls, 0);
      assert.equal(JSON.stringify(payload).includes(currentAdmin.passwordHash), false);
      assert.equal(JSON.stringify(payload).includes(currentAdmin.bootstrapKey), false);
    }
  );
});

test("administrator can update only their authenticated account email", async () => {
  let lookupFilter;
  let updateArguments;
  let createCalls = 0;
  const originalCreate = Admin.create;
  Admin.create = async () => {
    createCalls += 1;
    throw new Error("Email change must not create administrators.");
  };

  try {
    await withRoute(
      {
        findAdmin: (filter) => {
          if (filter.email !== currentAdmin.email) {
            return {
              select() {
                return this;
              },
              lean: async () => null,
            };
          }
          lookupFilter = filter;
          return {
            select(selection) {
              assert.equal(selection, "_id email");
              return this;
            },
            lean: async () => ({ ...currentAdmin }),
          };
        },
        updateEmail: async (...args) => {
          updateArguments = args;
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
      async ({ baseUrl, token }) => {
        const { response, payload } = await patchEmail(baseUrl, token, {
          email: "  New.Address@Example.Test  ",
        });
        assert.equal(response.status, 200);
        assert.equal(payload.email, "new.address@example.test");
        assert.equal(payload.changed, true);
        assert.equal(payload.tokenType, "Bearer");
        assert.equal(payload.expiresInSeconds, 1800);
        assert.equal(Object.hasOwn(payload, "passwordHash"), false);
        assert.equal(Object.hasOwn(payload, "bootstrapKey"), false);
        assert.deepEqual(lookupFilter, {
          email: currentAdmin.email,
          role: "admin",
        });
        assert.deepEqual(updateArguments, [
          {
            _id: currentAdmin._id,
            email: currentAdmin.email,
            role: "admin",
          },
          { $set: { email: "new.address@example.test" } },
          { upsert: false },
        ]);
        assert.equal(createCalls, 0);

        const updatedToken = jwt.verify(payload.token, TEST_SECRET, {
          algorithms: ["HS256"],
          issuer: TOKEN_ISSUER,
        });
        assert.equal(updatedToken.role, "admin");
        assert.equal(updatedToken.sub, "new.address@example.test");
      }
    );
  } finally {
    Admin.create = originalCreate;
  }
});

test("email change rejects missing, empty, malformed, long, and extra fields", async () => {
  let updateCalls = 0;
  await withRoute(
    {
      updateEmail: async () => {
        updateCalls += 1;
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
    async ({ baseUrl, token }) => {
      const invalidBodies = [
        {},
        { email: "" },
        { email: "   " },
        { email: "not-an-email" },
        { email: `${"a".repeat(245)}@example.test` },
        { email: "new@example.test", adminId: "another-account" },
        [],
      ];
      for (const body of invalidBodies) {
        const { response } = await patchEmail(baseUrl, token, body);
        assert.equal(response.status, 400, JSON.stringify(body));
      }
      assert.equal(updateCalls, 0);
    }
  );
});

test("request-body identity fields cannot select or update another administrator", async () => {
  let lookupCalls = 0;
  let updateCalls = 0;
  await withRoute(
    {
      findAdmin: () => {
        lookupCalls += 1;
        return {
          select() {
            return this;
          },
          lean: async () => ({ ...currentAdmin }),
        };
      },
      updateEmail: async () => {
        updateCalls += 1;
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
    async ({ baseUrl, token }) => {
      const { response, payload } = await patchEmail(baseUrl, token, {
        email: "new@example.test",
        adminId: "bbbbbbbbbbbbbbbbbbbbbbbb",
        targetEmail: "other@example.test",
        role: "admin",
      });
      assert.equal(response.status, 400);
      assert.equal(lookupCalls, 0);
      assert.equal(updateCalls, 0);
      assert.equal(JSON.stringify(payload).includes(currentAdmin.passwordHash), false);
      assert.equal(JSON.stringify(payload).includes(currentAdmin.bootstrapKey), false);
    }
  );
});

test("same normalized email is a no-op and does not issue a replacement token", async () => {
  let updateCalls = 0;
  await withRoute(
    {
      updateEmail: async () => {
        updateCalls += 1;
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
    async ({ baseUrl, token }) => {
      const { response, payload } = await patchEmail(baseUrl, token, {
        email: " CURRENT@example.test ",
      });
      assert.equal(response.status, 200);
      assert.equal(payload.changed, false);
      assert.equal(payload.email, currentAdmin.email);
      assert.equal(Object.hasOwn(payload, "token"), false);
      assert.equal(updateCalls, 0);
    }
  );
});

test("email already owned by another administrator returns 409 without updating", async () => {
  let updateCalls = 0;
  const existingOtherAdmin = {
    _id: new mongoose.Types.ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb"),
  };
  await withRoute(
    {
      findAdmin: (filter) => ({
        select() {
          return this;
        },
        lean: async () =>
          filter.email === currentAdmin.email
            ? { ...currentAdmin }
            : existingOtherAdmin,
      }),
      updateEmail: async () => {
        updateCalls += 1;
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
    async ({ baseUrl, token }) => {
      const { response, payload } = await patchEmail(baseUrl, token, {
        email: "other@example.test",
      });
      assert.equal(response.status, 409);
      assert.equal(payload.message, "That email address is already in use.");
      assert.equal(updateCalls, 0);
    }
  );
});

test("duplicate-key race returns a safe 409 without leaking database details", async () => {
  await withRoute(
    {
      updateEmail: async () => {
        throw Object.assign(new Error("duplicate details"), { code: 11000 });
      },
    },
    async ({ baseUrl, token }) => {
      const { response, payload } = await patchEmail(baseUrl, token, {
        email: "already-used@example.test",
      });
      assert.equal(response.status, 409);
      assert.equal(payload.message, "That email address is already in use.");
      assert.equal(JSON.stringify(payload).includes("duplicate details"), false);
      assert.equal(JSON.stringify(payload).includes(currentAdmin.passwordHash), false);
      assert.equal(JSON.stringify(payload).includes(currentAdmin.bootstrapKey), false);
      assert.equal(Object.hasOwn(payload, "passwordHash"), false);
      assert.equal(Object.hasOwn(payload, "bootstrapKey"), false);
    }
  );
});

test("email update that no longer matches the authenticated record returns conflict", async () => {
  await withRoute(
    {
      updateEmail: async () => ({ matchedCount: 0, modifiedCount: 0 }),
    },
    async ({ baseUrl, token }) => {
      const { response, payload } = await patchEmail(baseUrl, token, {
        email: "new@example.test",
      });
      assert.equal(response.status, 409);
      assert.equal(payload.status, "error");
      assert.equal(JSON.stringify(payload).includes(currentAdmin.passwordHash), false);
      assert.equal(JSON.stringify(payload).includes(currentAdmin.bootstrapKey), false);
      assert.equal(JSON.stringify(payload).includes("database"), false);
    }
  );
});
