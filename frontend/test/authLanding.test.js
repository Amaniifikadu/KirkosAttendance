import assert from "node:assert/strict";
import test from "node:test";
import {
  getLoginRequest,
  getRegistrationGuidance,
} from "../src/authLanding.js";

test("login selection routes administrator, teacher, and student to the right flow", () => {
  assert.deepEqual(getLoginRequest("admin", "admin@example.test", "pass"), {
    path: "/api/auth/admin/login",
    body: { email: "admin@example.test", password: "pass" },
  });
  assert.deepEqual(getLoginRequest("teacher", "teacher1", "pass"), {
    path: "/api/auth/portal/login",
    body: { username: "teacher1", password: "pass", expectedRole: "teacher" },
  });
  assert.deepEqual(getLoginRequest("student", "student1", "pass"), {
    path: "/api/auth/portal/login",
    body: { username: "student1", password: "pass", expectedRole: "student" },
  });
  assert.throws(() => getLoginRequest("admin,student", "x", "x"), /valid account type/);
});

test("registration guidance never presents public administrator signup", () => {
  const admin = getRegistrationGuidance("admin");
  const teacher = getRegistrationGuidance("teacher");
  const student = getRegistrationGuidance("student");
  assert.match(admin.message, /no public administrator sign-up/i);
  assert.match(teacher.message, /assign the classes and subjects/i);
  assert.match(student.message, /student number/i);
  assert.match(student.message, /change it at first sign-in/i);
  assert.throws(() => getRegistrationGuidance("unknown"), /valid account type/);
});
