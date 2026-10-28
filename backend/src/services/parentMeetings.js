const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const ParentMeeting = require("../models/ParentMeeting");
const ParentMeetingAttendance = require("../models/ParentMeetingAttendance");
const Student = require("../models/Student");
const Class = require("../models/Class");
const { parseCanonicalDate, normalizeAcademicPeriod } = require("./academicCalendar");
const { numericStudentSortStages } = require("./studentList");
const SUNDAY_SCHOOL_CLASSES = require("../config/sundaySchoolClasses");

const STATUSES = new Set(["present", "absent", "permission", "not_recorded"]);
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

function requestError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

function publicMeeting(meeting) {
  const { operationLock, ...result } = meeting;
  return result;
}

function parseAcademicMonth(value) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 13) {
    throw requestError("academicMonth must be between 1 and 13.");
  }
  return month;
}

function validateMeetingDate(meetingDate, academicYear, academicMonth) {
  const dateParts = parseCanonicalDate(meetingDate, "meetingDate");
  if (dateParts.date.getUTCDay() !== 0) {
    throw requestError("Parent meetings can only be scheduled on Sundays.");
  }
  const year = normalizeAcademicPeriod(academicYear);
  const month = parseAcademicMonth(academicMonth);
  if (year !== dateParts.academicYear || month !== dateParts.academicMonth) {
    throw requestError(
      "academicYear and academicMonth must match the Ethiopian meeting date."
    );
  }
  return { academicYear: year, academicMonth: month };
}

function parseMeetingId(value) {
  if (typeof value !== "string" || !mongoose.isValidObjectId(value)) {
    throw requestError("meetingId is invalid.");
  }
  return new mongoose.Types.ObjectId(value);
}

function normalizeStatuses(statuses) {
  if (!Array.isArray(statuses) || statuses.length > 5000) {
    throw requestError("statuses must contain no more than 5000 entries.");
  }
  const seen = new Set();
  return statuses.map((entry) => {
    if (
      !entry ||
      typeof entry.studentId !== "string" ||
      !mongoose.isValidObjectId(entry.studentId)
    ) {
      throw requestError("Each attendance entry requires a valid studentId.");
    }
    const studentId = entry.studentId.toLowerCase();
    if (seen.has(studentId)) {
      throw requestError("A student may appear only once in statuses.");
    }
    seen.add(studentId);
    if (!STATUSES.has(entry.status)) {
      throw requestError(
        "Each parent attendance status must be present, absent, permission, or not_recorded."
      );
    }
    for (const [field, maxLength] of [
      ["guardianName", 200],
      ["notes", 1000],
    ]) {
      if (
        entry[field] !== undefined &&
        (typeof entry[field] !== "string" || entry[field].length > maxLength)
      ) {
        throw requestError(`${field} must be a string of at most ${maxLength} characters.`);
      }
    }
    const normalized = {
      studentId,
      status: entry.status,
    };
    for (const field of ["guardianName", "notes"]) {
      if (entry[field] !== undefined) normalized[field] = entry[field].trim();
    }
    return normalized;
  });
}

function buildAnnualReport({
  academicYear,
  classNumber,
  meetings,
  populationByClass,
  attendanceGroups,
  classNumbers,
}) {
  const selectedNumbers = classNumber === undefined
    ? classNumbers
    : classNumbers.filter((number) => number === classNumber);
  const allowedNumbers = new Set(selectedNumbers);
  const populations = new Map(
    populationByClass.map(({ classNumber: number, totalStudents }) => [
      Number(number),
      totalStudents,
    ])
  );
  const totalStudents = selectedNumbers.reduce(
    (total, number) => total + (populations.get(number) || 0),
    0
  );
  const monthByMeeting = new Map(
    meetings.map((meeting) => [String(meeting._id), meeting.academicMonth])
  );
  const monthly = Array.from({ length: 13 }, (_, index) => ({
    academicMonth: index + 1,
    meetingCount: 0,
    totalStudents: 0,
    totalStudentMeetings: 0,
    present: 0,
    absent: 0,
    permission: 0,
    notRecorded: 0,
    attendancePercentage: 0,
  }));
  const classes = selectedNumbers.map((number) => ({
    classNumber: number,
    name: SUNDAY_SCHOOL_CLASSES.getDisplayName(number),
    totalStudents: populations.get(number) || 0,
    totalStudentMeetings: 0,
    present: 0,
    absent: 0,
    permission: 0,
    notRecorded: 0,
    attendancePercentage: 0,
  }));
  const classByNumber = new Map(classes.map((item) => [item.classNumber, item]));

  for (const meeting of meetings) {
    if (meeting.academicMonth < 1 || meeting.academicMonth > 13) continue;
    const month = monthly[meeting.academicMonth - 1];
    month.meetingCount += 1;
    month.totalStudents = totalStudents;
  }
  for (const month of monthly) {
    month.totalStudentMeetings = month.meetingCount * totalStudents;
  }

  for (const group of attendanceGroups) {
    const meetingMonth = monthByMeeting.get(String(group.meetingId));
    const number = Number(group.classNumber);
    if (
      meetingMonth === undefined ||
      !allowedNumbers.has(number) ||
      !["present", "absent", "permission"].includes(group.status)
    ) {
      continue;
    }
    monthly[meetingMonth - 1][group.status] += group.count;
    const classSummary = classByNumber.get(number);
    if (classSummary) {
      classSummary[group.status] += group.count;
    }
  }

  for (const month of monthly) {
    month.notRecorded = Math.max(
      0,
      month.totalStudentMeetings -
        month.present -
        month.absent -
        month.permission
    );
    month.attendancePercentage = month.totalStudentMeetings
      ? Number(((month.present / month.totalStudentMeetings) * 100).toFixed(1))
      : 0;
  }
  for (const item of classes) {
    item.totalStudentMeetings = item.totalStudents * meetings.length;
    item.notRecorded = Math.max(
      0,
      item.totalStudentMeetings -
        item.present -
        item.absent -
        item.permission
    );
    item.attendancePercentage = item.totalStudentMeetings
      ? Number(((item.present / item.totalStudentMeetings) * 100).toFixed(1))
      : 0;
  }

  const summary = monthly.reduce(
    (total, month) => ({
      meetingCount: total.meetingCount + month.meetingCount,
      totalStudentMeetings:
        total.totalStudentMeetings + month.totalStudentMeetings,
      present: total.present + month.present,
      absent: total.absent + month.absent,
      permission: total.permission + month.permission,
      notRecorded: total.notRecorded + month.notRecorded,
    }),
    {
      meetingCount: 0,
      totalStudentMeetings: 0,
      present: 0,
      absent: 0,
      permission: 0,
      notRecorded: 0,
    }
  );
  summary.totalStudents = totalStudents;
  summary.attendancePercentage = summary.totalStudentMeetings
    ? Number(
        ((summary.present / summary.totalStudentMeetings) * 100).toFixed(1)
      )
    : 0;

  return {
    academicYear,
    classNumber: classNumber ?? null,
    selectedClassName:
      classNumber === undefined
        ? "All Classes"
        : SUNDAY_SCHOOL_CLASSES.getDisplayName(classNumber),
    classes,
    monthly,
    summary,
  };
}

function parsePositiveInteger(value, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  ) {
    throw requestError(`${name} must be a positive whole number no greater than ${maximum}.`);
  }
  return Number(value);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMeetingQuery(query) {
  let classNumber;
  if (query.classNumber !== undefined && query.classNumber !== "") {
    classNumber = parsePositiveInteger(query.classNumber, "classNumber", undefined, 999);
  }
  return {
    academicYear: normalizeAcademicPeriod(query.academicYear),
    academicMonth: parseAcademicMonth(query.academicMonth),
    classNumber,
  };
}

function emptyMeetingCounts() {
  return { present: 0, absent: 0, permission: 0 };
}

function buildMeetingSummary(totalStudents, counts) {
  const normalized = { ...emptyMeetingCounts(), ...counts };
  const present = normalized.present || 0;
  const absent = normalized.absent || 0;
  const permission = normalized.permission || 0;
  const notRecorded = Math.max(0, totalStudents - present - absent - permission);
  return {
    totalStudents,
    present,
    absent,
    permission,
    notRecorded,
  };
}

function parseAttendanceQuery(query = {}) {
  const page = parsePositiveInteger(query.page, "page", 1);
  const pageSize = parsePositiveInteger(query.pageSize, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (!Number.isSafeInteger((page - 1) * pageSize)) {
    throw requestError("page is too large.");
  }
  if (query.search !== undefined && typeof query.search !== "string") {
    throw requestError("search must be a string.");
  }
  const search = (query.search || "").trim();
  if (search.length > 100) throw requestError("search cannot exceed 100 characters.");
  const status = query.status || "";
  if (
    status &&
    !["present", "absent", "permission", "not_recorded"].includes(status)
  ) {
    throw requestError("status is not a valid parent attendance status.");
  }
  return {
    page,
    pageSize,
    search,
    status,
    classNumber:
      query.classNumber === undefined || query.classNumber === ""
        ? undefined
        : parsePositiveInteger(query.classNumber, "classNumber", undefined, 999),
  };
}

function classIdScopeFilter(allowedClassIds) {
  if (!Array.isArray(allowedClassIds)) return {};
  return {
    classId: {
      $in: allowedClassIds
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    },
  };
}

async function summarizeMeetingAttendance(
  attendanceModel,
  studentModel,
  meetingIds,
  classNumber,
  allowedClassIds
) {
  if (!meetingIds.length) return new Map();
  const pipeline = [
    { $match: { meetingId: { $in: meetingIds } } },
    { $sort: { updatedAt: -1 } },
    {
      $group: {
        _id: { meetingId: "$meetingId", studentId: "$studentId" },
        status: { $first: "$status" },
      },
    },
    {
      $lookup: {
        from: studentModel.collection.name,
        localField: "_id.studentId",
        foreignField: "_id",
        as: "student",
      },
    },
    { $unwind: "$student" },
  ];
  if (classNumber !== undefined) {
    pipeline.push({ $match: { "student.classNumber": classNumber } });
  }
  if (Array.isArray(allowedClassIds)) {
    pipeline.push({
      $match: {
        "student.classId": {
          $in: allowedClassIds
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
      },
    });
  }
  pipeline.push({
    $group: {
      _id: { meetingId: "$_id.meetingId", status: "$status" },
      count: { $sum: 1 },
    },
  });
  const groups = await attendanceModel.aggregate(pipeline);
  const counts = new Map();
  for (const { _id, count } of groups) {
    const meetingKey = String(_id.meetingId);
    const current = counts.get(meetingKey) || emptyMeetingCounts();
    if (["present", "absent", "permission"].includes(_id.status)) {
      current[_id.status] = count;
    }
    counts.set(meetingKey, current);
  }
  for (const meetingId of meetingIds) {
    const meetingKey = String(meetingId);
    if (!counts.has(meetingKey)) {
      counts.set(meetingKey, emptyMeetingCounts());
    }
  }
  return counts;
}

async function createParentMeetingService({
  meetingModel = ParentMeeting,
  attendanceModel = ParentMeetingAttendance,
  studentModel = Student,
  classModel = Class,
  startSession = () => mongoose.startSession(),
} = {}) {
  async function acquireMeetingLock(meetingId, { allowDeleting = false, session } = {}) {
    const lock = randomUUID();
    const filter = {
      _id: meetingId,
      operationLock: { $exists: false },
      ...(allowDeleting
        ? {
            $or: [
              { deletionState: { $exists: false } },
              { deletionState: { $in: ["active", "deleting"] } },
            ],
          }
        : {
            deletionState: { $ne: "deleting" },
            $or: [
              { deletionState: { $exists: false } },
              { deletionState: "active" },
            ],
          }),
    };
    const update = {
      $set: {
        operationLock: lock,
        ...(allowDeleting ? { deletionState: "deleting" } : {}),
      },
    };
    const result = session
      ? await meetingModel.updateOne(filter, update, { session })
      : await meetingModel.updateOne(filter, update);
    if (result.matchedCount !== 1) {
      const meeting = await meetingModel.findById(meetingId).lean();
      if (!meeting) throw requestError("Parent meeting was not found.", 404);
      if (meeting.deletionState === "deleting" && !allowDeleting) {
        throw requestError(
          "This meeting is being deleted. Retry its deletion before editing attendance.",
          409
        );
      }
      throw requestError("This meeting is being changed. Retry shortly.", 409);
    }
    return lock;
  }

  async function releaseMeetingLock(meetingId, lock, session) {
    const options = session ? { session } : undefined;
    await meetingModel.updateOne(
      { _id: meetingId, operationLock: lock },
      { $unset: { operationLock: "" } },
      options
    );
  }

  return {
    async listMeetings(query) {
      const { academicYear, academicMonth, classNumber } = parseMeetingQuery(query);
      const studentFilter = {
        ...classIdScopeFilter(query.allowedClassIds),
        ...(classNumber === undefined ? {} : { classNumber }),
      };
      const [meetings, totalStudents] = await Promise.all([
        meetingModel
          .find({ academicYear, academicMonth })
          .sort({ meetingDate: 1 })
          .lean(),
        studentModel.countDocuments(studentFilter),
      ]);
      const meetingIds = meetings.map(({ _id }) => _id);
      const countsByMeeting = await summarizeMeetingAttendance(
        attendanceModel,
        studentModel,
        meetingIds,
        classNumber,
        query.allowedClassIds
      );
      return {
        meetings: meetings.map((meeting) => {
          const counts = countsByMeeting.get(String(meeting._id)) || emptyMeetingCounts();
          return {
            ...publicMeeting(meeting),
            summary: buildMeetingSummary(totalStudents, counts),
          };
        }),
      };
    },

    async getClassReport(meetingIdValue, query = {}) {
      const meetingId = parseMeetingId(meetingIdValue);
      const meeting = await meetingModel.findById(meetingId).lean();
      if (!meeting) throw requestError("Parent meeting was not found.", 404);
      if (meeting.deletionState === "deleting") {
        throw requestError("This parent meeting is being deleted.", 409);
      }

      const scopeFilter = classIdScopeFilter(query.allowedClassIds);
      const classNumber = query.classNumber === undefined
        ? undefined
        : parsePositiveInteger(query.classNumber, "classNumber", undefined, 999);
      const classGroups = await studentModel.aggregate([
        { $match: scopeFilter },
        {
          $group: {
            _id: { classId: "$classId", classNumber: "$classNumber" },
            totalStudents: { $sum: 1 },
          },
        },
        { $sort: { "_id.classNumber": 1 } },
      ]);
      const classRecords = await classModel
        .find(
          Array.isArray(query.allowedClassIds)
            ? {
                _id: {
                  $in: query.allowedClassIds
                    .filter((id) => mongoose.isValidObjectId(id))
                    .map((id) => new mongoose.Types.ObjectId(id)),
                },
              }
            : {}
        )
        .sort({ classNumber: 1 })
        .lean();
      const classNameById = new Map(
        classRecords.map((record) => [
          String(record._id),
          SUNDAY_SCHOOL_CLASSES.getDisplayName(record.classNumber, record.name),
        ])
      );
      const classGroupById = new Map(
        classGroups.map(({ _id, totalStudents }) => [
          String(_id.classId),
          { classNumber: _id.classNumber, totalStudents },
        ])
      );
      const countGroups = await attendanceModel.aggregate([
        { $match: { meetingId } },
        { $sort: { updatedAt: -1 } },
        {
          $group: {
            _id: "$studentId",
            status: { $first: "$status" },
          },
        },
        {
          $lookup: {
            from: studentModel.collection.name,
            localField: "_id",
            foreignField: "_id",
            as: "student",
          },
        },
        { $unwind: "$student" },
        ...(Array.isArray(query.allowedClassIds)
          ? [{ $match: { "student.classId": scopeFilter.classId } }]
          : []),
        {
          $group: {
            _id: {
              classId: "$student.classId",
              classNumber: "$student.classNumber",
              status: "$status",
            },
            count: { $sum: 1 },
          },
        },
      ]);
      const countByClass = new Map();
      for (const { _id, count } of countGroups) {
        const key = String(_id.classId);
        const counts = countByClass.get(key) || emptyMeetingCounts();
        if (["present", "absent", "permission"].includes(_id.status)) {
          counts[_id.status] += count;
        }
        countByClass.set(key, counts);
      }
      const reportClassRecords = [...classRecords];
      if (!Array.isArray(query.allowedClassIds)) {
        for (const configuredClass of SUNDAY_SCHOOL_CLASSES) {
          if (!reportClassRecords.some(
            (record) => record.classNumber === configuredClass.classNumber
          )) {
            reportClassRecords.push({
              _id: `configured-class-${configuredClass.classNumber}`,
              classNumber: configuredClass.classNumber,
              name: configuredClass.displayName,
            });
          }
        }
      }
      reportClassRecords.sort((left, right) => left.classNumber - right.classNumber);
      const classes = reportClassRecords.map((classRecord) => {
        const group = classGroupById.get(String(classRecord._id)) || {
          classNumber: classRecord.classNumber,
          totalStudents: 0,
        };
        const totalStudents = group.totalStudents;
        const counts = countByClass.get(String(classRecord._id)) || emptyMeetingCounts();
        const summary = buildMeetingSummary(totalStudents, counts);
        return {
          classId: String(classRecord._id),
          classNumber: group.classNumber ?? classRecord.classNumber,
          name:
            classNameById.get(String(classRecord._id)) ||
            SUNDAY_SCHOOL_CLASSES.getDisplayName(
              group.classNumber,
              `Class ${group.classNumber}`
            ),
          ...summary,
          attendancePercentage: totalStudents
            ? Number(((summary.present / totalStudents) * 100).toFixed(1))
            : 0,
        };
      });
      const summary = classes.reduce(
        (total, item) => ({
          totalStudents: total.totalStudents + item.totalStudents,
          present: total.present + item.present,
          absent: total.absent + item.absent,
          permission: total.permission + item.permission,
          notRecorded: total.notRecorded + item.notRecorded,
        }),
        { totalStudents: 0, present: 0, absent: 0, permission: 0, notRecorded: 0 }
      );

      const academicYearMeetings = await meetingModel
        .find({ academicYear: meeting.academicYear })
        .sort({ meetingDate: 1 })
        .lean();
      const historyMeetingIds = academicYearMeetings.map(({ _id }) => _id);
      const historyCounts = historyMeetingIds.length
        ? await summarizeMeetingAttendance(
            attendanceModel,
            studentModel,
            historyMeetingIds,
            classNumber,
            query.allowedClassIds
          )
        : new Map();
      const currentClass = classNumber;
      const completionCounts = currentClass === undefined
        ? historyCounts
        : await summarizeMeetingAttendance(
            attendanceModel,
            studentModel,
            historyMeetingIds,
            undefined,
            query.allowedClassIds
          );
      const completionPopulation = summary.totalStudents;
      const meetingsByMonth = new Map();
      const trend = Array.from({ length: 13 }, (_, index) => ({
        academicMonth: index + 1,
        present: 0,
        totalStudents: 0,
        attendancePercentage: 0,
      }));
      const totalForTrend = currentClass === undefined
        ? summary.totalStudents
        : classes.find(({ classNumber }) => classNumber === currentClass)?.totalStudents || 0;
      for (const historicalMeeting of academicYearMeetings) {
        const counts = historyCounts.get(String(historicalMeeting._id)) || emptyMeetingCounts();
        const monthSummary = buildMeetingSummary(totalForTrend, counts);
        const trendItem = trend[historicalMeeting.academicMonth - 1];
        trendItem.present += counts.present;
        trendItem.totalStudents += totalForTrend;
        trendItem.attendancePercentage = trendItem.totalStudents
          ? Number(((trendItem.present / trendItem.totalStudents) * 100).toFixed(1))
          : 0;
        const monthMeetings = meetingsByMonth.get(historicalMeeting.academicMonth) || [];
        monthMeetings.push({
          _id: String(historicalMeeting._id),
          meetingDate: historicalMeeting.meetingDate,
          academicYear: historicalMeeting.academicYear,
          academicMonth: historicalMeeting.academicMonth,
          summary: monthSummary,
        });
        meetingsByMonth.set(historicalMeeting.academicMonth, monthMeetings);
      }
      const completedMeetingCount = academicYearMeetings.filter((item) => {
        const counts = completionCounts.get(String(item._id)) || emptyMeetingCounts();
        return completionPopulation > 0 &&
          counts.present + counts.absent + counts.permission >= completionPopulation;
      }).length;

      return {
        meeting: publicMeeting(meeting),
        summary,
        classes,
        trend,
        completedMeetingCount,
        currentEthiopianMonth: meeting.academicMonth,
        meetingHistory: Object.fromEntries(meetingsByMonth),
      };
    },

    async getAnnualReport(yearValue, query = {}) {
      const academicYear = normalizeAcademicPeriod(yearValue);
      const classNumber = query.classNumber === undefined || query.classNumber === ""
        ? undefined
        : parsePositiveInteger(query.classNumber, "classNumber", undefined, 12);
      const allowedClassIds = Array.isArray(query.allowedClassIds)
        ? query.allowedClassIds
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id))
        : undefined;
      const classRecords = await classModel
        .find(allowedClassIds ? { _id: { $in: allowedClassIds } } : {})
        .sort({ classNumber: 1 })
        .select("_id classNumber")
        .lean();
      const availableClassNumbers = Array.isArray(query.allowedClassIds)
        ? classRecords
            .map(({ classNumber: number }) => number)
            .filter((number) => number >= 1 && number <= 12)
            .sort((left, right) => left - right)
        : SUNDAY_SCHOOL_CLASSES.map(({ classNumber: number }) => number);
      if (classNumber !== undefined && !availableClassNumbers.includes(classNumber)) {
        throw requestError("You are not assigned to this class.", 403);
      }

      const studentFilter = {
        ...classIdScopeFilter(query.allowedClassIds),
        classNumber: classNumber ?? { $gte: 1, $lte: 12 },
      };
      const [populationGroups, meetings] = await Promise.all([
        studentModel.aggregate([
          { $match: studentFilter },
          {
            $group: {
              _id: "$classNumber",
              totalStudents: { $sum: 1 },
            },
          },
        ]),
        meetingModel
          .find({ academicYear })
          .sort({ meetingDate: 1 })
          .lean(),
      ]);
      const attendanceGroups = meetings.length
        ? await attendanceModel.aggregate([
            { $match: { meetingId: { $in: meetings.map(({ _id }) => _id) } } },
            { $sort: { updatedAt: -1 } },
            {
              $group: {
                _id: { meetingId: "$meetingId", studentId: "$studentId" },
                status: { $first: "$status" },
              },
            },
            {
              $lookup: {
                from: studentModel.collection.name,
                localField: "_id.studentId",
                foreignField: "_id",
                as: "student",
              },
            },
            { $unwind: "$student" },
            {
              $match: {
                "student.classNumber": { $in: availableClassNumbers },
                ...(classNumber === undefined
                  ? {}
                  : { "student.classNumber": classNumber }),
                ...(allowedClassIds
                  ? { "student.classId": { $in: allowedClassIds } }
                  : {}),
              },
            },
            {
              $group: {
                _id: {
                  meetingId: "$_id.meetingId",
                  classNumber: "$student.classNumber",
                  status: "$status",
                },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                meetingId: "$_id.meetingId",
                classNumber: "$_id.classNumber",
                status: "$_id.status",
                count: 1,
              },
            },
          ])
        : [];
      return buildAnnualReport({
        academicYear,
        classNumber,
        meetings,
        populationByClass: populationGroups.map(({ _id, totalStudents }) => ({
          classNumber: _id,
          totalStudents,
        })),
        attendanceGroups,
        classNumbers: availableClassNumbers,
      });
    },

    async getFollowUps(meetingIdValue, query = {}) {
      const meetingId = parseMeetingId(meetingIdValue);
      const meeting = await meetingModel.findById(meetingId).lean();
      if (!meeting) throw requestError("Parent meeting was not found.", 404);
      const { page, pageSize, classNumber } = parseAttendanceQuery(query);
      const history = await meetingModel
        .find({
          meetingDate: { $lte: meeting.meetingDate },
        })
        .sort({ meetingDate: -1 })
        .limit(3)
        .lean();
      history.reverse();
      const historyIds = history.map(({ _id }) => _id);
      const pipeline = [
        { $match: { meetingId: { $in: historyIds } } },
        {
          $lookup: {
            from: studentModel.collection.name,
            localField: "studentId",
            foreignField: "_id",
            as: "student",
          },
        },
        { $unwind: "$student" },
        ...(Array.isArray(query.allowedClassIds)
          ? [{ $match: { "student.classId": classIdScopeFilter(query.allowedClassIds).classId } }]
          : []),
        ...(classNumber === undefined
          ? []
          : [{ $match: { "student.classNumber": classNumber } }]),
        { $sort: { meetingId: 1 } },
        {
          $group: {
            _id: "$studentId",
            student: { $last: "$student" },
            records: {
              $push: {
                meetingId: "$meetingId",
                status: "$status",
              },
            },
          },
        },
        {
          $project: {
            student: 1,
            records: 1,
          },
        },
      ];
      const rows = await attendanceModel.aggregate(pipeline);
      const followUps = rows.flatMap(({ student, records }) => {
        const currentRecord = records.find(
          (record) => String(record.meetingId) === String(meetingId)
        );
        if (!currentRecord || !["absent", "permission"].includes(currentRecord.status)) {
          return [];
        }
        let consecutiveAbsences = 0;
        for (let index = history.length - 1; index >= 0; index -= 1) {
          const record = records.find(
            (entry) => String(entry.meetingId) === String(history[index]._id)
          );
          if (record?.status !== "absent") break;
          consecutiveAbsences += 1;
        }
        const warning = consecutiveAbsences >= 3
          ? "red"
          : consecutiveAbsences >= 2
            ? "yellow"
            : "";
        return [{
          studentId: String(student._id),
          classNumber: student.classNumber,
          originalSerialNumber: student.originalSerialNumber,
          studentName: student.studentName,
          status: currentRecord.status,
          consecutiveAbsences,
          warning,
        }];
      }).sort((left, right) =>
        left.classNumber - right.classNumber ||
        String(left.originalSerialNumber).localeCompare(String(right.originalSerialNumber), undefined, { numeric: true })
      );
      const start = (page - 1) * pageSize;
      return {
        followUps: followUps.slice(start, start + pageSize),
        pagination: {
          page,
          pageSize,
          total: followUps.length,
          totalPages: Math.ceil(followUps.length / pageSize),
        },
      };
    },

    async createMeeting(payload, createdBy) {
      const { academicYear, academicMonth } = validateMeetingDate(
        payload.meetingDate,
        payload.academicYear,
        payload.academicMonth
      );
      try {
        const meeting = await meetingModel.create({
          meetingDate: payload.meetingDate,
          academicYear,
          academicMonth,
          createdBy,
        });
        return publicMeeting(meeting.toObject ? meeting.toObject() : meeting);
      } catch (error) {
        if (error?.code === 11000) {
          throw requestError("A parent meeting already exists for this date.", 409);
        }
        throw error;
      }
    },

    async updateMeeting(meetingIdValue, payload) {
      const meetingId = parseMeetingId(meetingIdValue);
      const { academicYear, academicMonth } = validateMeetingDate(
        payload.meetingDate,
        payload.academicYear,
        payload.academicMonth
      );
      const lock = await acquireMeetingLock(meetingId);
      try {
        const result = await meetingModel.updateOne(
          { _id: meetingId, operationLock: lock },
          { $set: { meetingDate: payload.meetingDate, academicYear, academicMonth } }
        );
        if (result.matchedCount !== 1) {
          throw requestError("Parent meeting changed; reload and try again.", 409);
        }
        return publicMeeting(await meetingModel.findById(meetingId).lean());
      } catch (error) {
        if (error?.code === 11000) {
          throw requestError("A parent meeting already exists for this date.", 409);
        }
        throw error;
      } finally {
        await releaseMeetingLock(meetingId, lock);
      }
    },

    async getAttendance(meetingIdValue, query = {}) {
      const meetingId = parseMeetingId(meetingIdValue);
      const meeting = await meetingModel.findById(meetingId).lean();
      if (!meeting) throw requestError("Parent meeting was not found.", 404);
      if (meeting.deletionState === "deleting") {
        throw requestError("This parent meeting is being deleted.", 409);
      }

      const { page, pageSize, search, classNumber, status } =
        parseAttendanceQuery(query);
      const filter = {
        ...classIdScopeFilter(query.allowedClassIds),
        ...(classNumber === undefined ? {} : { classNumber }),
      };
      if (search) {
        const pattern = new RegExp(escapeRegex(search), "i");
        filter.$or = [
          { studentName: pattern },
          { christianName: pattern },
          { originalSerialNumber: pattern },
        ];
      }
      const totalStudents = await studentModel.countDocuments({
        ...classIdScopeFilter(query.allowedClassIds),
        ...(classNumber === undefined ? {} : { classNumber }),
      });
      const rosterStages = [
        { $match: filter },
        ...numericStudentSortStages(),
        {
          $lookup: {
            from: attendanceModel.collection.name,
            let: { studentId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$meetingId", meetingId] },
                      { $eq: ["$studentId", "$$studentId"] },
                    ],
                  },
                },
              },
              { $sort: { updatedAt: -1 } },
              { $limit: 1 },
            ],
            as: "meetingAttendance",
          },
        },
        {
          $addFields: {
            status: {
              $ifNull: [
                { $arrayElemAt: ["$meetingAttendance.status", 0] },
                "not_recorded",
              ],
            },
            guardianName: {
              $ifNull: [
                { $arrayElemAt: ["$meetingAttendance.guardianName", 0] },
                "",
              ],
            },
            notes: {
              $ifNull: [
                { $arrayElemAt: ["$meetingAttendance.notes", 0] },
                "",
              ],
            },
            lastUpdated: {
              $arrayElemAt: ["$meetingAttendance.updatedAt", 0],
            },
          },
        },
        ...(status ? [{ $match: { status } }] : []),
      ];
      const countResult = await studentModel.aggregate([
        ...rosterStages,
        { $count: "total" },
      ]);
      const totalMatching = countResult[0]?.total || 0;
      const students = await studentModel.aggregate([
        ...rosterStages,
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
        {
          $project: {
            _id: 1,
            classNumber: 1,
            originalSerialNumber: 1,
            studentName: 1,
            christianName: 1,
            status: 1,
            guardianName: 1,
            notes: 1,
            lastUpdated: 1,
          },
        },
      ]);
      const roster = students.map((student) => {
        return {
          studentId: String(student._id),
          classNumber: student.classNumber,
          originalSerialNumber: student.originalSerialNumber,
          studentName: student.studentName,
          christianName: student.christianName || "",
          status: student.status,
          guardianName: student.guardianName,
          notes: student.notes,
          lastUpdated: student.lastUpdated || null,
        };
      });
      const summaryMap = await summarizeMeetingAttendance(
        attendanceModel,
        studentModel,
        [meetingId],
        classNumber,
        query.allowedClassIds
      );
      const counts = summaryMap.get(String(meetingId)) || emptyMeetingCounts();
      return {
        meeting: publicMeeting(meeting),
        students: roster,
        summary: buildMeetingSummary(totalStudents, counts),
        pagination: {
          page,
          pageSize,
          total: totalMatching,
          totalPages: Math.ceil(totalMatching / pageSize),
        },
      };
    },

    async saveAttendance(meetingIdValue, payload, allowedClassIds) {
      const meetingId = parseMeetingId(meetingIdValue);
      const updates = normalizeStatuses(payload.statuses);
      const lock = await acquireMeetingLock(meetingId);
      try {
        if (updates.length === 0) return { updatedCount: 0 };
        const studentIds = updates.map(({ studentId }) => studentId);
        const studentFilter = {
          _id: { $in: studentIds },
          ...classIdScopeFilter(allowedClassIds),
        };
        const existingStudents = await studentModel
          .find(studentFilter, { _id: 1 })
          .lean();
        if (existingStudents.length !== updates.length) {
          throw requestError("An attendance entry references an unknown student.", 422);
        }
        await attendanceModel.bulkWrite(
          updates.map(({ studentId, status, guardianName, notes }) => {
            const fieldsToSet = { status };
            if (guardianName !== undefined) fieldsToSet.guardianName = guardianName;
            if (notes !== undefined) fieldsToSet.notes = notes;
            return {
              updateOne: {
                filter: { meetingId, studentId },
                update: {
                  $set: fieldsToSet,
                  $setOnInsert: { meetingId, studentId },
                },
                upsert: true,
              },
            };
          }),
          { ordered: true }
        );
        return { updatedCount: updates.length };
      } finally {
        await releaseMeetingLock(meetingId, lock);
      }
    },

    async deleteStudentAttendance(meetingIdValue, studentIdValue, allowedClassIds) {
      const meetingId = parseMeetingId(meetingIdValue);
      if (!mongoose.isValidObjectId(studentIdValue)) {
        throw requestError("studentId is invalid.");
      }
      const meeting = await meetingModel.findById(meetingId).lean();
      if (!meeting) throw requestError("Parent meeting was not found.", 404);
      const studentFilter = {
        _id: new mongoose.Types.ObjectId(studentIdValue),
        ...classIdScopeFilter(allowedClassIds),
      };
      const student = await studentModel.findOne(studentFilter).lean();
      if (!student) throw requestError("Student was not found in an assigned class.", 404);
      const result = await attendanceModel.deleteOne({
        meetingId,
        studentId: student._id,
      });
      return { deleted: result.deletedCount > 0 };
    },

    async deleteMeeting(meetingIdValue) {
      const meetingId = parseMeetingId(meetingIdValue);
      const session = await startSession();
      try {
        try {
          await session.withTransaction(async () => {
            const lock = await acquireMeetingLock(meetingId, { session });
            await attendanceModel.deleteMany({ meetingId }, { session });
            const result = await meetingModel.deleteOne(
              { _id: meetingId, operationLock: lock },
              { session }
            );
            if (result.deletedCount !== 1) {
              throw requestError("Parent meeting changed; retry deletion.", 409);
            }
          });
          return { deleted: true, deletionMode: "transaction" };
        } catch (error) {
          if (!isUnsupportedTransactionError(error)) throw error;
        }
      } finally {
        await session.endSession();
      }

      const lock = await acquireMeetingLock(meetingId, { allowDeleting: true });
      try {
        await attendanceModel.deleteMany({ meetingId });
        const result = await meetingModel.deleteOne({
          _id: meetingId,
          deletionState: "deleting",
          operationLock: lock,
        });
        if (result.deletedCount !== 1) {
          throw requestError(
            "Meeting deletion is incomplete. Retry deletion to finish safely.",
            409
          );
        }
      } finally {
        await releaseMeetingLock(meetingId, lock);
      }
      return { deleted: true, deletionMode: "retryable" };
    },
  };
}

function isUnsupportedTransactionError(error) {
  const message = String(error?.message || "");
  return (
    error?.code === 20 ||
    error?.codeName === "IllegalOperation" ||
    /transaction numbers are only allowed|transactions are not supported|does not support transactions/i.test(
      message
    )
  );
}

module.exports = {
  buildAnnualReport,
  createParentMeetingService,
  isUnsupportedTransactionError,
  normalizeStatuses,
  parseMeetingQuery,
  publicMeeting,
  validateMeetingDate,
};
