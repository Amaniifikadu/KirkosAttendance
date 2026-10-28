const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;

function parsePositiveInteger(value, fallback, parameterName) {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    const error = new Error(`${parameterName} must be a positive whole number.`);
    error.statusCode = 400;
    throw error;
  }

  return Number(value);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseStudentListQuery(query) {
  const page = parsePositiveInteger(query.page, 1, "page");
  const pageSize = parsePositiveInteger(
    query.pageSize,
    DEFAULT_PAGE_SIZE,
    "pageSize"
  );
  if (!Number.isSafeInteger((page - 1) * pageSize)) {
    const error = new Error("page is too large.");
    error.statusCode = 400;
    throw error;
  }

  if (pageSize > MAX_PAGE_SIZE) {
    const error = new Error(`pageSize cannot exceed ${MAX_PAGE_SIZE}.`);
    error.statusCode = 400;
    throw error;
  }

  let classNumber;
  if (query.classNumber !== undefined) {
    classNumber = parsePositiveInteger(query.classNumber, undefined, "classNumber");
    if (classNumber > 999) {
      const error = new Error("classNumber must be between 1 and 999.");
      error.statusCode = 400;
      throw error;
    }
  }

  if (query.search !== undefined && typeof query.search !== "string") {
    const error = new Error("search must be a string.");
    error.statusCode = 400;
    throw error;
  }
  const search = (query.search || "").trim();
  if (search.length > MAX_SEARCH_LENGTH) {
    const error = new Error(
      `search cannot exceed ${MAX_SEARCH_LENGTH} characters.`
    );
    error.statusCode = 400;
    throw error;
  }

  return { page, pageSize, classNumber, search };
}

async function listStudents(query, studentModel) {
  const { page, pageSize, classNumber, search } =
    parseStudentListQuery(query);
  const filter = {};

  if (classNumber !== undefined) {
    filter.classNumber = classNumber;
  }
  if (search) {
    const searchPattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { studentName: searchPattern },
      { christianName: searchPattern },
      { originalSerialNumber: searchPattern },
    ];
  }

  const [total, students] = await Promise.all([
    studentModel.countDocuments(filter),
    studentModel.aggregate([
      { $match: filter },
      ...numericStudentSortStages(),
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      {
        $project: {
          _id: 0,
          classNumber: 1,
          originalSerialNumber: 1,
          studentName: 1,
          christianName: 1,
        },
      },
    ]),
  ]);

  return {
    students,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

function numericStudentSortStages({ includeClassNumber = true } = {}) {
  return [
    {
      $addFields: {
        _serialText: {
          $convert: {
            input: "$originalSerialNumber",
            to: "string",
            onError: "",
            onNull: "",
          },
        },
      },
    },
    {
      $addFields: {
        _serialIsNonNumeric: {
          $cond: [
            { $regexMatch: { input: "$_serialText", regex: "^[0-9]+$" } },
            0,
            1,
          ],
        },
        _serialNumericDigits: {
          $cond: [
            { $regexMatch: { input: "$_serialText", regex: "^[0-9]+$" } },
            {
              $let: {
                vars: {
                  match: {
                    $regexFind: {
                      input: "$_serialText",
                      regex: "([1-9][0-9]*|0)$",
                    },
                  },
                },
                in: { $ifNull: ["$$match.match", ""] },
              },
            },
            "",
          ],
        },
      },
    },
    {
      $addFields: {
        _serialNumericLength: { $strLenCP: "$_serialNumericDigits" },
      },
    },
    {
      $sort: {
        ...(includeClassNumber ? { classNumber: 1 } : {}),
        _serialIsNonNumeric: 1,
        _serialNumericLength: 1,
        _serialNumericDigits: 1,
        originalSerialNumber: 1,
        studentName: 1,
      },
    },
  ];
}

module.exports = {
  listStudents,
  numericStudentSortStages,
  parseStudentListQuery,
};
