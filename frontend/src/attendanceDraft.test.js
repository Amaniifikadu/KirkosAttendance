import assert from "node:assert/strict";
import test from "node:test";
import { attendanceUpdates } from "./attendanceDraft.js";

const students = [{ studentId: "a" }, { studentId: "b" }, { studentId: "c" }];

test("draft saves send only changed student statuses", () => {
  assert.deepEqual(
    attendanceUpdates(
      students,
      { a: "present", b: "absent", c: "not_recorded" },
      { a: "not_recorded", b: "absent", c: "not_recorded" }
    ),
    [{ studentId: "a", status: "present" }]
  );
});

test("session completion still submits each enrolled student's status", () => {
  assert.deepEqual(
    attendanceUpdates(
      students,
      { a: "present", b: "absent", c: "permission" },
      { a: "present", b: "absent", c: "not_recorded" },
      true
    ),
    [
      { studentId: "a", status: "present" },
      { studentId: "b", status: "absent" },
      { studentId: "c", status: "permission" },
    ]
  );
});
