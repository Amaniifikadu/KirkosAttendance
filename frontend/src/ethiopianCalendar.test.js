import assert from "node:assert/strict";
import test from "node:test";
import {
  ethiopianToGregorian,
  getEthiopianSundays,
  gregorianToEthiopian,
  isEthiopianSunday,
  nextSundayAsEthiopian,
} from "./ethiopianCalendar.js";

test("Sunday selection follows canonical Gregorian weekdays across Ethiopian dates", () => {
  const sunday = gregorianToEthiopian("2026-10-25");
  const saturday = gregorianToEthiopian("2026-10-24");
  assert.equal(ethiopianToGregorian(sunday), "2026-10-25");
  assert.equal(isEthiopianSunday(sunday), true);
  assert.equal(isEthiopianSunday(saturday), false);
  assert.ok(getEthiopianSundays(sunday).includes(sunday.day));
  assert.equal(ethiopianToGregorian(nextSundayAsEthiopian("2026-10-24")), "2026-10-25");
});
