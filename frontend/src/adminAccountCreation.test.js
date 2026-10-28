import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdminAccount,
  validateAdminAccountForm,
} from "./adminAccountCreation.js";

const validForm = {
  email: "  SECOND.ADMIN@Example.Test ",
  password: "A-strong-password-2026",
  confirmPassword: "A-strong-password-2026",
};

test("validates and normalizes an Admin email", () => {
  assert.deepEqual(validateAdminAccountForm(validForm), {
    email: "second.admin@example.test",
  });
});

test("rejects missing and malformed email values", () => {
  assert.equal(validateAdminAccountForm({ ...validForm, email: " " }).error, "Email is required.");
  assert.match(
    validateAdminAccountForm({ ...validForm, email: "not-an-email" }).error,
    /valid email/
  );
  assert.match(
    validateAdminAccountForm({ ...validForm, email: `${"a".repeat(245)}@example.test` }).error,
    /254 characters/
  );
});

test("requires a password of at least 12 characters and at most 72 UTF-8 bytes", () => {
  assert.match(
    validateAdminAccountForm({ ...validForm, password: "short", confirmPassword: "short" }).error,
    /12 characters/
  );
  assert.match(
    validateAdminAccountForm({
      ...validForm,
      password: "é".repeat(37),
      confirmPassword: "é".repeat(37),
    }).error,
    /72 UTF-8 bytes/
  );
  assert.match(
    validateAdminAccountForm({ ...validForm, password: "", confirmPassword: "" }).error,
    /Password is required/
  );
});

test("requires a matching confirmation", () => {
  assert.equal(
    validateAdminAccountForm({ ...validForm, confirmPassword: "" }).error,
    "Confirm the password."
  );
  assert.equal(
    validateAdminAccountForm({ ...validForm, confirmPassword: "a different password" }).error,
    "Passwords do not match."
  );
});

test("sends only normalized email and password through the authenticated API helper", async () => {
  const mockedResponse = {
    status: "ok",
    account: { email: "second.admin@example.test", role: "admin" },
  };
  let capturedRequest;
  const mockedApiRequest = async (...args) => {
    capturedRequest = args;
    return mockedResponse;
  };

  const result = await createAdminAccount(
    mockedApiRequest,
    "existing-admin-session-token",
    "second.admin@example.test",
    validForm.password
  );

  assert.equal(result, mockedResponse);
  assert.deepEqual(capturedRequest, [
    "/api/auth/admin/accounts",
    "existing-admin-session-token",
    {
      method: "POST",
      body: JSON.stringify({
        email: "second.admin@example.test",
        password: validForm.password,
      }),
    },
  ]);
});
