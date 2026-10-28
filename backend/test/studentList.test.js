const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const Student = require("../src/models/Student");
const studentRoutes = require("../src/routes/student.routes");
const { TOKEN_ISSUER } = require("../src/middleware/authenticateAdmin");
const errorHandler = require("../src/middleware/errorHandler");

const TEST_SECRET = "student-list-test-secret-that-is-at-least-32-chars";
const records = [
  {
    classNumber: 1,
    originalSerialNumber: "1",
    studentName: "Student One",
    christianName: "One",
  },
  {
    classNumber: 1,
    originalSerialNumber: "2",
    studentName: "Student Two",
    christianName: "Two",
  },
  {
    classNumber: 1,
    originalSerialNumber: "3",
    studentName: "Student Three",
    christianName: "Three",
  },
  {
    classNumber: 1,
    originalSerialNumber: "10",
    studentName: "Student Ten",
    christianName: "Ten",
  },
  {
    classNumber: 1,
    originalSerialNumber: "11",
    studentName: "Student Eleven",
    christianName: "Eleven",
  },
  {
    classNumber: 1,
    originalSerialNumber: "20",
    studentName: "Student Twenty",
    christianName: "Twenty",
  },
  {
    classNumber: 2,
    originalSerialNumber: "001",
    studentName: "Gamma Student",
    christianName: "C",
  },
];

function matchesFilter(record, filter) {
  if (
    filter.classNumber !== undefined &&
    record.classNumber !== filter.classNumber
  ) {
    return false;
  }

  if (filter.$or) {
    return filter.$or.some((condition) =>
      Object.entries(condition).some(([field, pattern]) =>
        pattern.test(record[field] || "")
      )
    );
  }

  return true;
}

async function withMockStudentModel(run) {
  const originalCountDocuments = Student.countDocuments;
  const originalAggregate = Student.aggregate;

  Student.countDocuments = async (filter) =>
    records.filter((record) => matchesFilter(record, filter)).length;
  Student.aggregate = async (pipeline) => {
    const matchIndex = pipeline.findIndex((stage) => stage.$match);
    const sortIndex = pipeline.findIndex((stage) => stage.$sort);
    const skipIndex = pipeline.findIndex((stage) => stage.$skip !== undefined);
    const limitIndex = pipeline.findIndex((stage) => stage.$limit !== undefined);
    const projectIndex = pipeline.findIndex((stage) => stage.$project);
    assert.ok(matchIndex < sortIndex);
    assert.ok(sortIndex < skipIndex);
    assert.ok(skipIndex < limitIndex);
    assert.ok(limitIndex < projectIndex);
    assert.deepEqual(pipeline[sortIndex].$sort, {
      classNumber: 1,
      _serialIsNonNumeric: 1,
      _serialNumericLength: 1,
      _serialNumericDigits: 1,
      originalSerialNumber: 1,
      studentName: 1,
    });
    assert.deepEqual(pipeline[projectIndex].$project, {
      _id: 0,
      classNumber: 1,
      originalSerialNumber: 1,
      studentName: 1,
      christianName: 1,
    });

    const filter = pipeline[matchIndex].$match;
    const results = records
      .filter((record) => matchesFilter(record, filter))
      .sort((left, right) => {
        if (left.classNumber !== right.classNumber) {
          return left.classNumber - right.classNumber;
        }
        const leftSerial = left.originalSerialNumber;
        const rightSerial = right.originalSerialNumber;
        const leftNumeric = /^[0-9]+$/.test(leftSerial);
        const rightNumeric = /^[0-9]+$/.test(rightSerial);
        if (leftNumeric !== rightNumeric) {
          return leftNumeric ? -1 : 1;
        }
        if (leftNumeric) {
          const leftDigits = leftSerial.replace(/^0+(?=\d)/, "");
          const rightDigits = rightSerial.replace(/^0+(?=\d)/, "");
          if (leftDigits.length !== rightDigits.length) {
            return leftDigits.length - rightDigits.length;
          }
          if (leftDigits !== rightDigits) {
            return leftDigits < rightDigits ? -1 : 1;
          }
        }
        if (leftSerial !== rightSerial) {
          return leftSerial < rightSerial ? -1 : 1;
        }
        return left.studentName.localeCompare(right.studentName);
      });
    const skip = pipeline[skipIndex].$skip;
    const limit = pipeline[limitIndex].$limit;
    return results.slice(skip, skip + limit).map(
      ({ classNumber, originalSerialNumber, studentName, christianName }) => ({
        classNumber,
        originalSerialNumber,
        studentName,
        christianName,
      })
    );
  };

  const app = express();
  app.use("/api/students", studentRoutes);
  app.use(errorHandler);
  const server = app.listen(0);
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}/api/students`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    Student.countDocuments = originalCountDocuments;
    Student.aggregate = originalAggregate;
  }
}

function createAdminToken() {
  return jwt.sign(
    { role: "admin" },
    TEST_SECRET,
    {
      algorithm: "HS256",
      subject: "admin@example.test",
      issuer: TOKEN_ISSUER,
      expiresIn: "5m",
    }
  );
}

test("student list endpoint rejects requests without admin authentication", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_SECRET;
  try {
    await withMockStudentModel(async (url) => {
      const response = await fetch(url);
      assert.equal(response.status, 401);
    });
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});

test("student numbers sort numerically before pagination without changing displayed values", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_SECRET;
  try {
    await withMockStudentModel(async (baseUrl) => {
      const headers = { Authorization: `Bearer ${createAdminToken()}` };
      const firstPage = await fetch(
        `${baseUrl}?classNumber=1&page=1&pageSize=3`,
        { headers }
      );
      const firstPayload = await firstPage.json();
      const secondPage = await fetch(
        `${baseUrl}?classNumber=1&page=2&pageSize=3`,
        { headers }
      );
      const secondPayload = await secondPage.json();

      assert.deepEqual(
        firstPayload.students.map(({ originalSerialNumber }) => originalSerialNumber),
        ["1", "2", "3"]
      );
      assert.deepEqual(
        secondPayload.students.map(({ originalSerialNumber }) => originalSerialNumber),
        ["10", "11", "20"]
      );
    });
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});

test("student list filters by class and searches name or student number", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_SECRET;
  try {
    await withMockStudentModel(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}?classNumber=1&search=3&page=1&pageSize=10`,
        { headers: { Authorization: `Bearer ${createAdminToken()}` } }
      );
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.pagination.total, 1);
      assert.equal(payload.students[0].originalSerialNumber, "3");

      const nameResponse = await fetch(
        `${baseUrl}?classNumber=2&search=gamma`,
        { headers: { Authorization: `Bearer ${createAdminToken()}` } }
      );
      const namePayload = await nameResponse.json();
      assert.equal(namePayload.pagination.total, 1);
      assert.equal(namePayload.students[0].classNumber, 2);
    });
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});

test("student list paginates results and rejects invalid query parameters", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_SECRET;
  try {
    await withMockStudentModel(async (baseUrl) => {
      const headers = { Authorization: `Bearer ${createAdminToken()}` };
      const pageResponse = await fetch(
        `${baseUrl}?classNumber=1&page=2&pageSize=2`,
        { headers }
      );
      const pagePayload = await pageResponse.json();
      assert.equal(pagePayload.pagination.total, 6);
      assert.equal(pagePayload.pagination.totalPages, 3);
      assert.deepEqual(
        pagePayload.students.map(({ originalSerialNumber }) => originalSerialNumber),
        ["3", "10"]
      );

      const invalidResponse = await fetch(`${baseUrl}?classNumber=1000`, {
        headers,
      });
      assert.equal(invalidResponse.status, 400);
    });
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});
