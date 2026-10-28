const XLSX = require("xlsx");
const SUNDAY_SCHOOL_CLASSES = require("../config/sundaySchoolClasses");

const MAX_ROWS_PER_SHEET = 5000;
const MAX_TOTAL_ROWS = 10000;
const HEADER_SCAN_ROWS = 25;
const MAX_DETAIL_ROWS = 5000;

const HEADER_ALIASES = Object.freeze({
  studentNumber: ["ተ.ቁ", "ተ•ቁ", "student number", "serial number", "number", "no"],
  studentName: ["የተማሪ ስም", "የተማሪ ስም እና የክርስትና ስም", "student name", "name"],
  christianName: ["ክርስትና ስም", "christian name"],
  gender: ["ጾታ", "ፃታ", "ፆታ", "gender", "sex"],
  age: ["እድሜ", "ዕድሜ", "age"],
  schoolGrade: ["የት/ደ", "የት/ደረጃ", "ት/ት", "school grade", "grade"],
  district: ["ወረዳ", "district"],
  houseNumber: ["የቤት ቁጥር", "house number"],
  guardianName: ["የወላጅ/አሳዳጊ ስም", "የወላጅ ስም", "parent name", "guardian name"],
  guardianPhone: [
    "የወላጅ/አሳዳጊ ስልክ",
    "የወላጅ ስልክ",
    "parent phone",
    "guardian phone",
  ],
  studentPhone: ["ስልክ", "ተቀያሪ ስልክ", "phone", "contact"],
  telegramPhone: ["telegram phone", "የቴሌግራም ስልክ ቁጥር"],
});

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([field, aliases]) => [
    field,
    new Set(aliases.map(normalizeHeader)),
  ])
);

function getCellText(cell) {
  if (cell === undefined || cell === null) {
    return "";
  }

  if (typeof cell !== "object") {
    return String(cell).normalize("NFC").trim();
  }

  if (cell.v === undefined || cell.v === null) {
    return "";
  }

  const formatted =
    typeof cell.w === "string" ? cell.w : XLSX.utils.format_cell(cell);
  return String(formatted ?? "").normalize("NFC").trim();
}

function mapHeaders(row) {
  const columns = {};

  row.forEach((value, index) => {
    const normalized = normalizeHeader(value);
    if (!normalized) {
      return;
    }

    for (const [field, aliases] of Object.entries(NORMALIZED_ALIASES)) {
      if (aliases.has(normalized) && columns[field] === undefined) {
        columns[field] = index;
      }
    }
  });

  return columns;
}

function findHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const columns = mapHeaders(rows[index] || []);
    if (columns.studentNumber !== undefined && columns.studentName !== undefined) {
      return { rowIndex: index, columns };
    }
  }

  return null;
}

function readRow(cells, columns, worksheet, worksheetRow) {
  const value = (field) =>
    columns[field] === undefined
      ? ""
      : getCellText(
          worksheet[
            XLSX.utils.encode_cell({
              r: worksheetRow - 1,
              c: columns[field],
            })
          ]
        );

  const row = {
    studentNumber: value("studentNumber"),
    studentName: value("studentName"),
    christianName: value("christianName"),
    gender: value("gender"),
    age: value("age"),
    schoolGrade: value("schoolGrade"),
    district: value("district"),
    houseNumber: value("houseNumber"),
    guardianName: value("guardianName"),
    guardianPhone: value("guardianPhone"),
    studentPhone: value("studentPhone"),
    telegramPhone: value("telegramPhone"),
  };

  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
  row.sourceData = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = worksheet[
      XLSX.utils.encode_cell({ r: worksheetRow - 1, c: column })
    ];
    const cellValue = getCellText(cell);
    if (!cellValue) {
      continue;
    }

    const headerCell =
      worksheet[
        XLSX.utils.encode_cell({
          r: worksheetRow - 2,
          c: column,
        })
      ];
    row.sourceData.push({
      column: column + 1,
      header: getCellText(headerCell),
      value: cellValue,
    });
  }

  return row;
}

function validateRow(row) {
  const issues = [];

  if (!row.studentNumber) {
    issues.push({
      code: "missing_student_number",
      message: "Student number (ተ.ቁ) is required.",
    });
  } else if (row.studentNumber.length > 50) {
    issues.push({
      code: "student_number_too_long",
      message: "Student number must be 50 characters or fewer.",
    });
  }

  if (!row.studentName) {
    issues.push({
      code: "missing_student_name",
      message: "Student name is required.",
    });
  } else if (row.studentName.length > 200) {
    issues.push({
      code: "student_name_too_long",
      message: "Student name must be 200 characters or fewer.",
    });
  }

  for (const field of [
    "christianName",
    "gender",
    "schoolGrade",
    "district",
    "houseNumber",
    "guardianName",
    "guardianPhone",
    "studentPhone",
    "telegramPhone",
  ]) {
    const maximumLength = field.toLowerCase().includes("phone") ? 50 : 200;
    if (row[field].length > maximumLength) {
      issues.push({
        code: `${field}_too_long`,
        message: `${field} exceeds the allowed ${maximumLength} characters.`,
      });
    }
  }

  if (row.age) {
    const age = Number(row.age);
    if (!Number.isFinite(age) || age < 0 || age > 120) {
      issues.push({
        code: "invalid_age",
        message: "Age must be a number between 0 and 120.",
      });
    } else {
      row.age = age;
    }
  } else {
    row.age = undefined;
  }

  return issues;
}

function safePreviewRow(row) {
  const {
    guardianPhone,
    studentPhone,
    telegramPhone,
    sourceData,
    ...safeRow
  } = row;
  return safeRow;
}

function parseStudentWorkbook(buffer, knownClasses, existingStudentsByClass) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: false,
      dense: false,
    });
  } catch {
    const error = new Error("The uploaded workbook could not be read.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedSheets = workbook.SheetNames.map((name) =>
    name.trim().normalize("NFC")
  );
  const expected = new Set(
    SUNDAY_SCHOOL_CLASSES.map(({ sheetName }) => sheetName)
  );
  const unexpectedSheets = normalizedSheets.filter((name) => !expected.has(name));
  const missingSheets = SUNDAY_SCHOOL_CLASSES.map(
    ({ sheetName }) => sheetName
  ).filter((name) => !normalizedSheets.includes(name));

  if (unexpectedSheets.length || missingSheets.length) {
    const error = new Error(
      "Workbook must contain exactly the 12 configured Sunday School class sheets."
    );
    error.statusCode = 422;
    error.details = { missingSheets, unexpectedSheets };
    throw error;
  }

  const classBySheet = new Map(
    knownClasses.map((classRecord) => [
      String(classRecord.sheetName).trim().normalize("NFC"),
      classRecord,
    ])
  );
  const classRows = new Map();
  const newRows = [];
  const existingRows = [];
  const duplicateRows = [];
  const invalidRows = [];
  const candidates = [];
  const importRecords = [];
  let totalRows = 0;

  for (const { classNumber, sheetName } of SUNDAY_SCHOOL_CLASSES) {
    const actualSheetName = workbook.SheetNames.find(
      (name) => name.trim().normalize("NFC") === sheetName
    );
    const worksheet = workbook.Sheets[actualSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    const header = findHeader(rows);

    if (!header) {
      const error = new Error(
        `A header row with student number and student name columns was not found in sheet "${sheetName}".`
      );
      error.statusCode = 422;
      throw error;
    }

    const dataRows = rows.slice(header.rowIndex + 1);
    if (dataRows.length > MAX_ROWS_PER_SHEET) {
      const error = new Error(
        `Sheet "${sheetName}" exceeds the ${MAX_ROWS_PER_SHEET}-row limit.`
      );
      error.statusCode = 422;
      throw error;
    }

    const classRecord = classBySheet.get(sheetName);
    const rowsForClass = {
      classNumber,
      displayName: SUNDAY_SCHOOL_CLASSES.getDisplayName(classNumber),
      sheetName,
      classId: classRecord?._id || null,
      classRecordFound: Boolean(classRecord),
      totalRows: 0,
      newRows: 0,
      existingRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      validRows: 0,
      duplicateIdentifiers: 0,
    };
    classRows.set(sheetName, rowsForClass);

    for (let offset = 0; offset < dataRows.length; offset += 1) {
      const cells = dataRows[offset] || [];
      if (!cells.some((cell) => getCellText(cell))) {
        continue;
      }

      totalRows += 1;
      if (totalRows > MAX_TOTAL_ROWS) {
        const error = new Error(
          `Workbook exceeds the ${MAX_TOTAL_ROWS}-row limit.`
        );
        error.statusCode = 422;
        throw error;
      }

      rowsForClass.totalRows += 1;
      const worksheetRow = header.rowIndex + offset + 2;
      const row = readRow(cells, header.columns, worksheet, worksheetRow);
      const issues = validateRow(row);
      const identifier = row.studentNumber
        ? row.studentNumber.normalize("NFC")
        : null;
      const detail = {
        classNumber,
        className: SUNDAY_SCHOOL_CLASSES.getDisplayName(classNumber),
        sheetName,
        worksheetRow,
        originalSerialNumber: row.studentNumber,
        ...safePreviewRow(row),
        issues,
      };
      candidates.push({
        classNumber,
        sheetName,
        identifier,
        row,
        detail,
        rowsForClass,
        worksheetRow,
      });
    }
  }

  const workbookIdentityRows = new Map();
  for (const candidate of candidates) {
    if (!candidate.identifier) {
      continue;
    }
    const identity = JSON.stringify([
      candidate.classNumber,
      candidate.identifier,
    ]);
    workbookIdentityRows.set(
      identity,
      (workbookIdentityRows.get(identity) || 0) + 1
    );
  }

  for (const candidate of candidates) {
    const {
      classNumber,
      sheetName,
      identifier,
      row,
      detail,
      rowsForClass,
      worksheetRow,
    } = candidate;
    if (detail.issues.length) {
      rowsForClass.invalidRows += 1;
      invalidRows.push(detail);
      continue;
    }

    const identity = JSON.stringify([classNumber, identifier]);
    if ((workbookIdentityRows.get(identity) || 0) > 1) {
      detail.issues.push({
        code: "duplicate_student_number_in_workbook",
        message: "Student number occurs more than once in this class sheet.",
      });
      rowsForClass.duplicateRows += 1;
      rowsForClass.duplicateIdentifiers += 1;
      duplicateRows.push(detail);
      continue;
    }

    const knownNumbers = existingStudentsByClass.get(sheetName);
    if (knownNumbers?.has(identifier)) {
      rowsForClass.existingRows += 1;
      existingRows.push(detail);
      continue;
    }

    rowsForClass.newRows += 1;
    rowsForClass.validRows += 1;
    newRows.push(detail);
    importRecords.push({
      classNumber,
      originalSerialNumber: row.studentNumber,
      studentName: row.studentName,
      christianName: row.christianName || undefined,
      gender: row.gender || undefined,
      age: row.age,
      schoolGrade: row.schoolGrade || undefined,
      district: row.district || undefined,
      houseNumber: row.houseNumber || undefined,
      guardianName: row.guardianName || undefined,
      guardianPhone: row.guardianPhone || undefined,
      studentPhone: row.studentPhone || undefined,
      telegramPhone: row.telegramPhone || undefined,
      source: { sheetName, worksheetRow },
      sourceData: row.sourceData,
    });
  }

  const foundClassCount = [...classRows.values()].filter(
    (item) => item.classRecordFound
  ).length;

  const preview = {
    status: "ok",
    mode: "preview",
    writtenToDatabase: false,
    summary: {
      sheetCount: workbook.SheetNames.length,
      classRecordsFound: foundClassCount,
      classRecordsMissing: SUNDAY_SCHOOL_CLASSES.length - foundClassCount,
      totalRows,
      validRows: newRows.length,
      newRows: newRows.length,
      existingRows: existingRows.length,
      duplicateRows: duplicateRows.length,
      invalidRows: invalidRows.length,
      duplicateIdentifiers: duplicateRows.length,
    },
    classes: [...classRows.values()],
    newRows: newRows.slice(0, MAX_DETAIL_ROWS),
    existingRows: existingRows.slice(0, MAX_DETAIL_ROWS),
    duplicateRows: duplicateRows.slice(0, MAX_DETAIL_ROWS),
    invalidRows: invalidRows.slice(0, MAX_DETAIL_ROWS),
    detailsTruncated:
      newRows.length > MAX_DETAIL_ROWS ||
      existingRows.length > MAX_DETAIL_ROWS ||
      duplicateRows.length > MAX_DETAIL_ROWS ||
      invalidRows.length > MAX_DETAIL_ROWS,
  };

  return { preview, importRecords };
}

module.exports = { parseStudentWorkbook };
