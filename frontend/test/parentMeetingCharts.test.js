import assert from "node:assert/strict";
import test from "node:test";
import {
  attendancePercentage,
  buildAttendanceSlices,
  buildClassBars,
  buildMonthlyTrendPoints,
} from "../src/parentMeetingCharts.js";

test("class attendance percentages and bars use present divided by total students", () => {
  assert.equal(attendancePercentage(100, 120), 83.3);
  assert.equal(attendancePercentage(0, 0), 0);

  const bars = buildClassBars(
    [
      { classId: "class-1", classNumber: 1, present: 100, totalStudents: 120 },
      { classId: "class-2", classNumber: 2, present: 95, totalStudents: 118 },
    ],
    480
  );
  assert.deepEqual(bars.map(({ percentage }) => percentage), [83.3, 80.5]);
  assert.ok(bars[0].height > bars[1].height);
});

test("pie chart keeps Present, Absent, Permission, and Not recorded distinct", () => {
  const slices = buildAttendanceSlices({
    present: 100,
    absent: 12,
    permission: 3,
    notRecorded: 5,
  });
  assert.deepEqual(slices.map(({ key }) => key), [
    "present",
    "absent",
    "permission",
    "notRecorded",
  ]);
  assert.equal(slices.at(-1).end, 100);
  assert.equal(slices.find(({ key }) => key === "permission").percentage, 2.5);
});

test("monthly trend chart keeps Ethiopian month positions and zero-data values", () => {
  const points = buildMonthlyTrendPoints([
    { academicMonth: 1, present: 8, totalStudents: 10 },
    { academicMonth: 2, present: 0, totalStudents: 0 },
  ]);
  assert.deepEqual(points.map(({ month, percentage }) => [month, percentage]), [
    [1, 80],
    [2, 0],
  ]);
  assert.ok(points[1].x > points[0].x);
});
