import assert from "node:assert/strict";
import test from "node:test";
import {
  moveStatusCount,
  persistInlineStatusChange,
} from "../src/parentMeetingAttendance.js";

test("inline status changes save the selected status without replacing other fields", async () => {
  const displayedStatuses = [];
  let savedStatus;
  const saved = await persistInlineStatusChange({
    previousStatus: "not_recorded",
    nextStatus: "permission",
    onStatusChange: (status) => displayedStatuses.push(status),
    save: async (status) => {
      savedStatus = status;
    },
  });

  assert.equal(saved, true);
  assert.deepEqual(displayedStatuses, ["permission"]);
  assert.equal(savedStatus, "permission");
});

test("failed inline status saves restore the previous displayed status for retry", async () => {
  const displayedStatuses = [];
  await assert.rejects(
    persistInlineStatusChange({
      previousStatus: "absent",
      nextStatus: "present",
      onStatusChange: (status) => displayedStatuses.push(status),
      save: async () => {
        throw new Error("Network unavailable.");
      },
    }),
    { message: "Network unavailable." }
  );
  assert.deepEqual(displayedStatuses, ["present", "absent"]);
});

test("inline status changes refresh distinct meeting summary counts", () => {
  const summary = {
    totalStudents: 5,
    present: 2,
    absent: 1,
    permission: 1,
    notRecorded: 1,
  };
  const updated = moveStatusCount(summary, "not_recorded", "present");
  assert.deepEqual(updated, {
    totalStudents: 5,
    present: 3,
    absent: 1,
    permission: 1,
    notRecorded: 0,
  });
  assert.equal(
    updated.present + updated.absent + updated.permission + updated.notRecorded,
    updated.totalStudents
  );
});
