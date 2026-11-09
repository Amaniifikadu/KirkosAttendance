const assert = require("node:assert/strict");
const test = require("node:test");
const XLSX = require("xlsx");
const SUNDAY_SCHOOL_CLASSES = require("../src/config/sundaySchoolClasses");
const Student = require("../src/models/Student");
const { parseStudentWorkbook } = require("../src/services/studentWorkbookPreview");
const { insertNewStudents } = require("../src/routes/student.routes");

function createWorkbook(
  classOneRows,
  reservedRows,
  classRows = {},
  normalizeClassSheetNames = false,
  reservedSheetName = "Reserved",
  omittedClassNumbers = []
) {
  const workbook = XLSX.utils.book_new();

  for (const { classNumber, sheetName } of SUNDAY_SCHOOL_CLASSES) {
    if (omittedClassNumbers.includes(classNumber)) {
      continue;
    }
    const rows =
      sheetName === SUNDAY_SCHOOL_CLASSES[0].sheetName
        ? [["Student Number", "Student Name"], ...classOneRows]
        : [
            ["Student Number", "Student Name"],
            ...(classRows[sheetName] || []),
          ];
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      normalizeClassSheetNames
        ? ` ${sheetName.normalize("NFD")} `
        : sheetName
    );
  }

  if (reservedRows) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(reservedRows),
      reservedSheetName
    );
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function createKnownClasses() {
  return SUNDAY_SCHOOL_CLASSES.map(({ classNumber, sheetName }) => ({
    _id: `class-${classNumber}`,
    classNumber,
    sheetName,
  }));
}

function createFakeStudentModel(students) {
  let insertCalls = 0;
  return {
    find(filter) {
      const classNumbers = new Set(filter.classNumber.$in);
      return {
        session() {
          return this;
        },
        async lean() {
          return students.filter((student) =>
            classNumbers.has(student.classNumber)
          );
        },
      };
    },
    async insertMany(records, options) {
      insertCalls += 1;
      assert.equal(options.ordered, true);
      students.push(...records.map((record) => ({ ...record })));
      return records;
    },
    get insertCalls() {
      return insertCalls;
    },
  };
}

test("classifies rows and caches only unique, valid, new identities", () => {
  const existingStudentsByClass = new Map([
    [SUNDAY_SCHOOL_CLASSES[0].sheetName, new Set(["1"])],
  ]);
  const parsed = parseStudentWorkbook(
    createWorkbook([
      ["1", "Existing student"],
      ["2", "New student"],
      ["3", "Duplicate one"],
      ["3", "Duplicate two"],
      ["4", ""],
      ["5", "Valid duplicate"],
      ["5", ""],
    ]),
    createKnownClasses(),
    existingStudentsByClass
  );

  assert.deepEqual(parsed.preview.summary, {
    sheetCount: 14,
    classRecordsFound: 14,
    classRecordsMissing: 0,
    totalRows: 7,
    validRows: 1,
    newRows: 1,
    existingRows: 1,
    duplicateRows: 3,
    invalidRows: 2,
    duplicateIdentifiers: 3,
  });
  assert.deepEqual(
    parsed.importRecords.map(({ classNumber, originalSerialNumber }) => ({
      classNumber,
      originalSerialNumber,
    })),
    [{ classNumber: 1, originalSerialNumber: "2" }]
  );
  assert.equal(parsed.preview.existingRows[0].originalSerialNumber, "1");
  assert.equal(parsed.preview.newRows[0].className, "ቂርቆስ (ቅድመ መደበኛ 1)");
  assert.deepEqual(
    parsed.preview.newRows.map(
      ({ classNumber, originalSerialNumber }) => ({
        classNumber,
        originalSerialNumber,
      })
    ),
    [{ classNumber: 1, originalSerialNumber: "2" }]
  );
  assert.deepEqual(
    parsed.preview.duplicateRows.map(({ originalSerialNumber }) => originalSerialNumber),
    ["3", "3", "5"]
  );
});

test("imports a legacy 12-class workbook without requiring the new class sheets", () => {
  const parsed = parseStudentWorkbook(
    createWorkbook(
      [["1", "Legacy class student"]],
      undefined,
      {},
      false,
      "Reserved",
      [13, 14]
    ),
    createKnownClasses(),
    new Map()
  );

  assert.equal(parsed.preview.summary.sheetCount, 12);
  assert.equal(parsed.preview.summary.totalRows, 1);
  assert.equal(parsed.preview.summary.classRecordsFound, 12);
  assert.equal(parsed.preview.classes.length, 12);
  assert.deepEqual(
    parsed.importRecords.map(({ classNumber, originalSerialNumber }) => [
      classNumber,
      originalSerialNumber,
    ]),
    [[1, "1"]]
  );
});

test("rejects a workbook containing only one of the new class worksheets", () => {
  assert.throws(
    () =>
      parseStudentWorkbook(
        createWorkbook([], undefined, {}, false, "Reserved", [14]),
        createKnownClasses(),
        new Map()
      ),
    (error) =>
      error.statusCode === 422 &&
      error.details.missingSheets.includes(SUNDAY_SCHOOL_CLASSES[13].sheetName)
  );
});

test("ignores an optional reserved worksheet and never imports its students", () => {
  const parsed = parseStudentWorkbook(
    createWorkbook([], [
      ["Student Number", "Student Name"],
      ["reserved-1", "Reserved student"],
    ], {
      [SUNDAY_SCHOOL_CLASSES[12].sheetName]: [
        ["13-1", "Class Thirteen Student"],
      ],
      [SUNDAY_SCHOOL_CLASSES[13].sheetName]: [
        ["14-1", "Class Fourteen Student"],
      ],
    }),
    createKnownClasses(),
    new Map()
  );

  assert.equal(parsed.preview.summary.sheetCount, 15);
  assert.equal(parsed.preview.summary.totalRows, 2);
  assert.equal(parsed.preview.classes.length, 14);
  assert.deepEqual(
    parsed.importRecords.map(({ classNumber, originalSerialNumber }) => [
      classNumber,
      originalSerialNumber,
    ]),
    [
      [13, "13-1"],
      [14, "14-1"],
    ]
  );
  assert.deepEqual(
    parsed.preview.newRows.map(({ className }) => className),
    ["11ኛ ክፍል", "12ኛ ክፍል"]
  );
  assert.equal(
    parsed.preview.newRows.some(
      ({ studentName }) => studentName === "Reserved student"
    ),
    false
  );
});

test("matches class worksheet names after trimming whitespace and NFC normalization", () => {
  const parsed = parseStudentWorkbook(
    createWorkbook([], undefined, {}, true),
    createKnownClasses(),
    new Map()
  );

  assert.equal(parsed.preview.summary.classRecordsFound, 14);
  assert.equal(parsed.preview.summary.classRecordsMissing, 0);
});

test("prefers an exact class worksheet over an extra normalized-name collision", () => {
  const classThirteenSheet = SUNDAY_SCHOOL_CLASSES[12].sheetName;
  const parsed = parseStudentWorkbook(
    createWorkbook(
      [],
      [
        ["Student Number", "Student Name"],
        ["reserved-13", "Reserved worksheet student"],
      ],
      {
        [classThirteenSheet]: [["13-1", "Class 13 student"]],
      },
      false,
      ` ${classThirteenSheet} `
    ),
    createKnownClasses(),
    new Map()
  );

  assert.deepEqual(
    parsed.importRecords.map(({ classNumber, originalSerialNumber }) => [
      classNumber,
      originalSerialNumber,
    ]),
    [[13, "13-1"]]
  );
  assert.equal(parsed.preview.newRows[0].className, "11ኛ ክፍል");
});

test("rejects ambiguous normalized class worksheet names without importing either", () => {
  const classThirteenSheet = SUNDAY_SCHOOL_CLASSES[12].sheetName;
  assert.throws(
    () =>
      parseStudentWorkbook(
        createWorkbook(
          [],
          [
            ["Student Number", "Student Name"],
            ["reserved-13", "Reserved worksheet student"],
          ],
          {},
          true,
          `  ${classThirteenSheet.normalize("NFD")}  `
        ),
        createKnownClasses(),
        new Map()
      ),
    (error) =>
      error.statusCode === 422 &&
      error.details.ambiguousSheets.includes(classThirteenSheet)
  );
});

test("inserts eligible records once without changing existing or attendance data", async () => {
  const originalStudent = {
    _id: "existing-student",
    classNumber: 1,
    originalSerialNumber: "1",
    studentName: "Unchanged existing student",
  };
  const students = [{ ...originalStudent }];
  const attendance = [
    { studentId: originalStudent._id, date: "2025-01-05", status: "present" },
  ];
  const originalAttendance = structuredClone(attendance);
  const fakeStudentModel = createFakeStudentModel(students);
  const newRecords = [
    { classNumber: 1, originalSerialNumber: "2", studentName: "New student" },
  ];

  await insertNewStudents(newRecords, {}, fakeStudentModel);

  assert.equal(fakeStudentModel.insertCalls, 1);
  assert.deepEqual(students[0], originalStudent);
  assert.deepEqual(students.slice(1), newRecords);
  assert.deepEqual(attendance, originalAttendance);
});

test("stops without inserting if an eligible identity appeared after preview", async () => {
  const fakeStudentModel = createFakeStudentModel([
    { classNumber: 1, originalSerialNumber: "2", studentName: "Added meanwhile" },
  ]);

  await assert.rejects(
    insertNewStudents(
      [{ classNumber: 1, originalSerialNumber: "2", studentName: "Preview row" }],
      {},
      fakeStudentModel
    ),
    (error) => error.statusCode === 409 && error.expose === true
  );
  assert.equal(fakeStudentModel.insertCalls, 0);
});

test("uses the existing Student model as the production insertion default", () => {
  assert.equal(typeof Student.insertMany, "function");
});
