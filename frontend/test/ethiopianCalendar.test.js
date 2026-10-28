import assert from "node:assert/strict";
import test from "node:test";
import {
  ethiopianToGregorian,
  gregorianToEthiopian,
} from "../src/ethiopianCalendar.js";

test("converts known Ethiopian New Year dates to canonical Gregorian dates", () => {
  assert.equal(
    ethiopianToGregorian({ year: 2016, month: 1, day: 1 }),
    "2023-09-12"
  );
  assert.equal(
    ethiopianToGregorian({ year: 2017, month: 1, day: 1 }),
    "2024-09-11"
  );
  assert.deepEqual(gregorianToEthiopian("2023-09-12"), {
    year: 2016,
    month: 1,
    day: 1,
  });
});

test("converts Pagume leap day correctly and rejects invalid Ethiopian dates", () => {
  assert.equal(
    ethiopianToGregorian({ year: 2015, month: 13, day: 6 }),
    "2023-09-11"
  );
  assert.deepEqual(gregorianToEthiopian("2023-09-11"), {
    year: 2015,
    month: 13,
    day: 6,
  });
  assert.throws(
    () => ethiopianToGregorian({ year: 2016, month: 13, day: 6 }),
    RangeError
  );
  assert.throws(
    () => ethiopianToGregorian({ year: 2016, month: 2, day: 31 }),
    RangeError
  );
});

test("Gregorian-to-Ethiopian conversion rejects non-canonical dates", () => {
  assert.throws(() => gregorianToEthiopian("2026-2-03"), RangeError);
  assert.throws(() => gregorianToEthiopian("2026-02-30"), RangeError);
});

test("round-trips Ethiopian new-year and Pagume month/year boundaries", () => {
  const dates = [
    [{ year: 2018, month: 13, day: 5 }, "2026-09-10"],
    [{ year: 2019, month: 1, day: 1 }, "2026-09-11"],
    [{ year: 2019, month: 13, day: 6 }, "2027-09-11"],
    [{ year: 2020, month: 1, day: 1 }, "2027-09-12"],
  ];

  for (const [ethiopianDate, gregorianDate] of dates) {
    assert.equal(ethiopianToGregorian(ethiopianDate), gregorianDate);
    assert.deepEqual(gregorianToEthiopian(gregorianDate), ethiopianDate);
  }
});

test("canonical meeting conversion is stable across time zones", () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of [
      "Pacific/Honolulu",
      "Africa/Addis_Ababa",
      "Asia/Tokyo",
    ]) {
      process.env.TZ = timezone;
      assert.equal(
        ethiopianToGregorian({ year: 2019, month: 2, day: 14 }),
        "2026-10-24"
      );
      assert.deepEqual(gregorianToEthiopian("2026-10-24"), {
        year: 2019,
        month: 2,
        day: 14,
      });
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
