const SUNDAY_SCHOOL_CLASSES = [
  { classNumber: 1, displayName: "ቂርቆስ (ቅድመ መደበኛ 1)", sheetName: "ቂርቆስ" },
  { classNumber: 2, displayName: "ኢየሉጣ (ቅድመ መደበኛ)", sheetName: "ኢየሉጣ" },
  { classNumber: 3, displayName: "ማቴዎስ (1ኛ ክፍል)", sheetName: "ማቴዎስ" },
  { classNumber: 4, displayName: "ማርቆስ (2ኛ ክፍል)", sheetName: "ማርቆስ" },
  { classNumber: 5, displayName: "ሉቃስ (3ኛ ክፍል)", sheetName: "ሉቃስ" },
  { classNumber: 6, displayName: "ዮሐንስ (4ኛ ክፍል)", sheetName: "ዮሀንስ" },
  { classNumber: 7, displayName: "ዳንኤል (5ኛ ክፍል)", sheetName: "ዳንኤል" },
  { classNumber: 8, displayName: "ሕዝቅኤል (6ኛ ክፍል)", sheetName: "ሕዝቅኤል" },
  { classNumber: 9, displayName: "ኤርምያስ (7ኛ ክፍል)", sheetName: "ኤርምያስ" },
  { classNumber: 10, displayName: "ኢሳይያስ (8ኛ ክፍል)", sheetName: "ኢሳይያስ" },
  { classNumber: 11, displayName: "ጴጥሮስ (9ኛ ክፍል)", sheetName: "ጴጥሮስ" },
  { classNumber: 12, displayName: "ጳውሎስ (10ኛ ክፍል)", sheetName: "ጳውሎስ" },
].map((item) => Object.freeze(item));

function getDisplayName(classNumber, fallback = "") {
  return (
    SUNDAY_SCHOOL_CLASSES.find((item) => item.classNumber === Number(classNumber))
      ?.displayName || fallback || `Class ${classNumber}`
  );
}

Object.defineProperty(SUNDAY_SCHOOL_CLASSES, "getDisplayName", {
  value: getDisplayName,
});

module.exports = Object.freeze(SUNDAY_SCHOOL_CLASSES);
