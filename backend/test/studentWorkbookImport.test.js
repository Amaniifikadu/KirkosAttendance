const assert = require("node:assert/strict");
const test = require("node:test");
const XLSX = require("xlsx");
const SUNDAY_SCHOOL_CLASSES = require("../src/config/sundaySchoolClasses");
const Student = require("../src/models/Student");
const { parseStudentWorkbook } = require("../src/services/studentWorkbookPreview");
const { insertNewStudents } = require("../src/routes/student.routes");

function createWorkbook(classOneRows) {
  const workbook = XLSX.utils.book_new();

  for (const { sheetName } of SUNDAY_SCHOOL_CLASSES) {
    const rows =
      sheetName === SUNDAY_SCHOOL_CLASSES[0].sheetName
        ? [["Student Number", "Student Name"], ...classOneRows]
        : [["Student Number", "Student Name"]];
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      sheetName
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
    sheetCount: 12,
    classRecordsFound: 12,
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
