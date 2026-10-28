const assert = require("node:assert/strict");
const test = require("node:test");
const SUNDAY_SCHOOL_CLASSES = require("../src/config/sundaySchoolClasses");

const expected = [
  ["ቂርቆስ (ቅድመ መደበኛ 1)", "ቂርቆስ"],
  ["ኢየሉጣ (ቅድመ መደበኛ)", "ኢየሉጣ"],
  ["ማቴዎስ (1ኛ ክፍል)", "ማቴዎስ"],
  ["ማርቆስ (2ኛ ክፍል)", "ማርቆስ"],
  ["ሉቃስ (3ኛ ክፍል)", "ሉቃስ"],
  ["ዮሐንስ (4ኛ ክፍል)", "ዮሀንስ"],
  ["ዳንኤል (5ኛ ክፍል)", "ዳንኤል"],
  ["ሕዝቅኤል (6ኛ ክፍል)", "ሕዝቅኤል"],
  ["ኤርምያስ (7ኛ ክፍል)", "ኤርምያስ"],
  ["ኢሳይያስ (8ኛ ክፍል)", "ኢሳይያስ"],
  ["ጴጥሮስ (9ኛ ክፍል)", "ጴጥሮስ"],
  ["ጳውሎስ (10ኛ ክፍል)", "ጳውሎስ"],
];

test("provides exact display labels in numeric class order", () => {
  assert.equal(SUNDAY_SCHOOL_CLASSES.length, 12);
  assert.deepEqual(
    SUNDAY_SCHOOL_CLASSES.map(({ classNumber, displayName }) => [
      classNumber,
      displayName,
    ]),
    expected.map(([displayName], index) => [index + 1, displayName])
  );
  assert.deepEqual(
    SUNDAY_SCHOOL_CLASSES.map(({ classNumber }) => classNumber),
    Array.from({ length: 12 }, (_, index) => index + 1)
  );
});

test("keeps all original workbook worksheet names and identity numbers", () => {
  assert.deepEqual(
    SUNDAY_SCHOOL_CLASSES.map(({ classNumber, sheetName }) => [
      classNumber,
      sheetName,
    ]),
    expected.map(([, sheetName], index) => [index + 1, sheetName])
  );
});
