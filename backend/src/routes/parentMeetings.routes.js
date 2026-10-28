const express = require("express");
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");
const ParentMeeting = require("../models/ParentMeeting");
const ParentMeetingAttendance = require("../models/ParentMeetingAttendance");
const Student = require("../models/Student");
const Class = require("../models/Class");
const {
  authenticateAccount,
  authorizeAccountRoles,
  requireChangedPassword,
} = require("../middleware/authenticateAccount");
const { authenticateAdmin } = require("../middleware/authenticateAdmin");
const { createParentMeetingService } = require("../services/parentMeetings");
const SUNDAY_SCHOOL_CLASSES = require("../config/sundaySchoolClasses");

const ETHIOPIAN_MONTHS = [
  "መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት",
  "መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ",
];
const ethiopianDateFormatter = new Intl.DateTimeFormat(
  "en-u-ca-ethiopic-nu-latn",
  { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }
);
const ETHIOPIAN_MONTHS_LATIN = [
  "Meskerem", "Tikimt", "Hidar", "Tahsas", "Tir", "Yekatit", "Megabit",
  "Miyazya", "Ginbot", "Sene", "Hamle", "Nehase", "Pagume",
];

function formatEthiopianDate(gregorianDate) {
  const date = new Date(`${gregorianDate}T00:00:00.000Z`);
  const parts = Object.fromEntries(
    ethiopianDateFormatter
      .formatToParts(date)
      .filter(({ type }) => ["year", "month", "day"].includes(type))
      .map(({ type, value }) => [type, Number(value)])
  );
  return `${parts.day} ${ETHIOPIAN_MONTHS[parts.month - 1]} ${parts.year} ዓ.ም.`;
}

function formatEthiopianDateLatin(gregorianDate) {
  const date = new Date(`${gregorianDate}T00:00:00.000Z`);
  const parts = Object.fromEntries(
    ethiopianDateFormatter
      .formatToParts(date)
      .filter(({ type }) => ["year", "month", "day"].includes(type))
      .map(({ type, value }) => [type, Number(value)])
  );
  return `${parts.day} ${ETHIOPIAN_MONTHS_LATIN[parts.month - 1]} ${parts.year} E.C.`;
}

const INDEXES = [
  {
    model: ParentMeeting,
    name: "unique_parent_meeting_date",
    key: { meetingDate: 1 },
  },
  {
    model: ParentMeetingAttendance,
    name: "unique_parent_meeting_student",
    key: { meetingId: 1, studentId: 1 },
  },
];

function uniqueSheetName(candidate, existingNames) {
  const base = (candidate || "Class")
    .replace(/[\\/*?:[\]]/g, " ")
    .trim()
    .slice(0, 31) || "Class";
  let name = base;
  let suffix = 2;
  while (existingNames.has(name.toLowerCase())) {
    const tail = ` (${suffix})`;
    name = `${base.slice(0, 31 - tail.length)}${tail}`;
    suffix += 1;
  }
  existingNames.add(name.toLowerCase());
  return name;
}

function buildParentMeetingWorkbook(report, students, attendance, classes, classNumber) {
  const exportClasses = (classNumber === undefined
    ? report.classes.filter(({ classNumber: number }) =>
        SUNDAY_SCHOOL_CLASSES.some((item) => item.classNumber === number)
      )
    : report.classes.filter((item) => item.classNumber === Number(classNumber))
  ).map((item) => ({
    ...item,
    name: SUNDAY_SCHOOL_CLASSES.getDisplayName(item.classNumber, item.name),
  }));
  const attendanceByStudent = new Map(
    attendance.map((item) => [String(item.studentId), item])
  );
  const classNameById = new Map(classes.map((item) => [
    String(item._id),
    SUNDAY_SCHOOL_CLASSES.getDisplayName(item.classNumber, item.name),
  ]));
  const workbook = XLSX.utils.book_new();
  const summaryRows = exportClasses.map((item) => ({
    Class: item.name,
    "Total Students": item.totalStudents,
    Present: item.present,
    Absent: item.absent,
    Permission: item.permission,
    "Not Recorded": item.notRecorded,
    "Attendance %": item.attendancePercentage,
  }));
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["Meeting title", "Parents' Meeting Attendance"],
    ["Meeting date (Ethiopian)", formatEthiopianDate(report.meeting.meetingDate)],
    ["Ethiopian year", report.meeting.academicYear, "Ethiopian month", ETHIOPIAN_MONTHS[report.meeting.academicMonth - 1]],
    ["Meeting date range", formatEthiopianDate(report.meeting.meetingDate)],
    [],
    ["Class", "Total Students", "Present", "Absent", "Permission", "Not Recorded", "Attendance %"],
  ]);
  if (summaryRows.length) {
    XLSX.utils.sheet_add_json(summarySheet, summaryRows, {
      origin: "A7",
      skipHeader: true,
    });
  }
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  const sheetNames = new Set(["summary"]);
  for (const classSummary of exportClasses) {
    const rows = students
      .filter(({ classId }) => String(classId) === classSummary.classId)
      .map((student) => {
        const record = attendanceByStudent.get(String(student._id));
        return {
          Class: classSummary.name || classNameById.get(String(student.classId)),
          "Student Number": student.originalSerialNumber,
          "Student Name": student.studentName,
          "Christian Name": student.christianName || "",
          "Parent Status": record?.status || "not_recorded",
          "Guardian Name": record?.guardianName || "",
          Notes: record?.notes || "",
          "Last Updated": record?.updatedAt
            ? formatEthiopianDate(new Date(record.updatedAt).toISOString().slice(0, 10))
            : "",
        };
      });
    const classSheet = XLSX.utils.aoa_to_sheet([
      [classSummary.name || `Class ${classSummary.classNumber}`],
      ["Meeting date (Ethiopian)", formatEthiopianDate(report.meeting.meetingDate)],
      ["Academic year", report.meeting.academicYear],
      [],
      [
        "Class",
        "Student Number",
        "Student Name",
        "Christian Name",
        "Parent Status",
        "Guardian Name",
        "Notes",
        "Last Updated",
      ],
    ]);
    if (rows.length) {
      XLSX.utils.sheet_add_json(classSheet, rows, {
        origin: "A6",
        header: [
          "Class",
          "Student Number",
          "Student Name",
          "Christian Name",
          "Parent Status",
          "Guardian Name",
          "Notes",
          "Last Updated",
        ],
        skipHeader: true,
      });
    }
    classSheet["!cols"] = [
      { wch: 16 },
      { wch: 42 },
      { wch: 30 },
      { wch: 24 },
      { wch: 18 },
      { wch: 28 },
      { wch: 40 },
      { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(
      workbook,
      classSheet,
      uniqueSheetName(classSummary.name || `Class ${classSummary.classNumber}`, sheetNames)
    );
  }
  return workbook;
}

function createParentMeetingPdf(report, classNumber) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
    });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    const pageWidth = document.page.width;
    const left = 36;
    const tableWidth = pageWidth - left * 2;
    const columns = [
      { title: "Class", width: 180 },
      { title: "Total", width: 80 },
      { title: "Present", width: 80 },
      { title: "Absent", width: 80 },
      { title: "Permission", width: 90 },
      { title: "Not recorded", width: 110 },
      { title: "Attendance %", width: tableWidth - 620 },
    ];
    const classSummaries = classNumber === undefined
      ? report.classes.filter(({ classNumber: number }) =>
          SUNDAY_SCHOOL_CLASSES.some((item) => item.classNumber === number)
        )
      : report.classes.filter((item) => item.classNumber === Number(classNumber));

    document.rect(left, 34, 76, 56).stroke();
    document.font("Helvetica").fontSize(9).text("Church Logo", left + 9, 56, {
      width: 58,
      align: "center",
    });
    document.fontSize(19).fillColor("#0A1172")
      .text("Kirkos Sunday School", 130, 38, { width: pageWidth - 170 });
    document.fontSize(14).fillColor("#222")
      .text("Parents' Meeting Attendance Report", 130, 62);
    document.fontSize(11).fillColor("#222")
      .text(`Meeting date: ${formatEthiopianDateLatin(report.meeting.meetingDate)}`, left, 108);
    document.text(
      `Academic year ${report.meeting.academicYear} E.C. · Month ${ETHIOPIAN_MONTHS_LATIN[report.meeting.academicMonth - 1]}`,
      left,
      126
    );

    let y = 164;
    const drawTableHeader = () => {
      document.rect(left, y, tableWidth, 24).fill("#0A1172");
      document.fillColor("#FFFFFF").fontSize(9);
      let x = left + 6;
      for (const column of columns) {
        document.text(column.title, x, y + 7, {
          width: column.width - 8,
          lineBreak: false,
        });
        x += column.width;
      }
      y += 24;
    };
    drawTableHeader();
    document.fillColor("#222").fontSize(9);
    for (const item of classSummaries) {
      if (y > document.page.height - 90) {
        document.addPage();
        y = 42;
        drawTableHeader();
        document.fillColor("#222").fontSize(9);
      }
      document.rect(left, y, tableWidth, 22).strokeColor("#CBD2DD").stroke();
      const values = [
        item.name,
        item.totalStudents,
        item.present,
        item.absent,
        item.permission,
        item.notRecorded,
        `${Number(item.attendancePercentage || 0).toFixed(1)}%`,
      ];
      let x = left + 6;
      values.forEach((value, index) => {
        document.text(String(value), x, y + 6, {
          width: columns[index].width - 8,
          lineBreak: false,
        });
        x += columns[index].width;
      });
      y += 22;
    }

    if (y > document.page.height - 68) {
      document.addPage();
      y = 46;
    } else {
      y += 28;
    }
    document.fontSize(11).fillColor("#222")
      .text("Director Signature: __________________________________________", left, y, {
        width: tableWidth,
        align: "right",
      });
    document.end();
  });
}

function createParentMeetingAllClassesPdf(report, students, attendance) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
      bufferPages: true,
    });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    const pageWidth = document.page.width;
    const left = 36;
    const widths = [66, 160, 120, 130, 78, pageWidth - 2 * left - 554];
    const columns = [
      "Student No.",
      "Student Name",
      "Christian Name",
      "Guardian Name",
      "Status",
      "Notes",
    ];
    const attendanceByStudent = new Map(
      attendance.map((item) => [String(item.studentId), item])
    );
    let isFirstPage = true;

    const drawClassHeader = (item, continued = false) => {
      document.font("Helvetica").fillColor("#0A1172").fontSize(18)
        .text(`Class ${item.classNumber} - ${item.name}${continued ? " (continued)" : ""}`, left, 36);
      document.fillColor("#222").fontSize(10)
        .text(`Meeting: ${formatEthiopianDateLatin(report.meeting.meetingDate)}`, left, 62);
      document.text(
        `Ethiopian year ${report.meeting.academicYear} · Month ${ETHIOPIAN_MONTHS_LATIN[report.meeting.academicMonth - 1]}`,
        left,
        77
      );
      document.text(
        `Students ${item.totalStudents} · Present ${item.present} · Absent ${item.absent} · Permission ${item.permission} · Not recorded ${item.notRecorded} · Attendance ${Number(item.attendancePercentage || 0).toFixed(1)}%`,
        left,
        94,
        { width: pageWidth - left * 2 }
      );
      let x = left;
      const headerY = 119;
      document.rect(left, headerY, widths.reduce((sum, width) => sum + width, 0), 23)
        .fill("#0A1172");
      document.fillColor("#fff").fontSize(8);
      columns.forEach((column, index) => {
        document.text(column, x + 4, headerY + 7, {
          width: widths[index] - 8,
          lineBreak: false,
        });
        x += widths[index];
      });
      document.fillColor("#222").fontSize(8);
      return headerY + 23;
    };

    const configuredClasses = report.classes.filter(({ classNumber }) =>
      SUNDAY_SCHOOL_CLASSES.some((item) => item.classNumber === classNumber)
    );
    for (const classSummary of configuredClasses) {
      if (!isFirstPage) document.addPage();
      isFirstPage = false;
      let y = drawClassHeader(classSummary);
      const classStudents = students
        .filter(({ classNumber }) => classNumber === classSummary.classNumber)
        .sort((leftStudent, rightStudent) =>
          String(leftStudent.originalSerialNumber).localeCompare(
            String(rightStudent.originalSerialNumber),
            undefined,
            { numeric: true }
          )
        );
      if (!classStudents.length) {
        document.fontSize(10).fillColor("#475569")
          .text("No students are enrolled in this class.", left, y + 8);
        continue;
      }

      for (const student of classStudents) {
        const record = attendanceByStudent.get(String(student._id));
        const values = [
          student.originalSerialNumber || "",
          student.studentName || "",
          student.christianName || "",
          record?.guardianName || "",
          record?.status || "not_recorded",
          record?.notes || "",
        ];
        const heights = values.map((value, index) =>
          document.heightOfString(String(value), {
            width: widths[index] - 8,
            font: "Helvetica",
            fontSize: 8,
          })
        );
        const rowHeight = Math.max(22, ...heights.map((height) => height + 8));
        if (y + rowHeight > document.page.height - 42) {
          document.addPage();
          y = drawClassHeader(classSummary, true);
        }
        let x = left;
        values.forEach((value, index) => {
          document.rect(x, y, widths[index], rowHeight)
            .strokeColor("#CBD2DD")
            .stroke();
          document.text(String(value), x + 4, y + 4, {
            width: widths[index] - 8,
            height: rowHeight - 8,
            fontSize: 8,
          });
          x += widths[index];
        });
        y += rowHeight;
      }
    }

    const pageRange = document.bufferedPageRange();
    for (let index = pageRange.start; index < pageRange.start + pageRange.count; index += 1) {
      document.switchToPage(index);
      document.font("Helvetica").fontSize(8).fillColor("#64748B")
        .text(
          `Page ${index - pageRange.start + 1} of ${pageRange.count}`,
          left,
          document.page.height - 28,
          { width: pageWidth - left * 2, align: "center" }
        );
    }
    document.end();
  });
}

function buildAnnualReportWorkbook(report) {
  const workbook = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([
    ["Parents' Meeting Annual Report"],
    ["Ethiopian academic year", report.academicYear],
    ["Class scope", report.selectedClassName],
    ["Unique students in scope", report.summary.totalStudents],
    ["Meetings", report.summary.meetingCount],
    ["Student-meeting opportunities", report.summary.totalStudentMeetings],
    ["Present", report.summary.present],
    ["Absent", report.summary.absent],
    ["Permission", report.summary.permission],
    ["Not recorded", report.summary.notRecorded],
    ["Attendance percentage", `${report.summary.attendancePercentage}%`],
  ]);
  XLSX.utils.book_append_sheet(workbook, summary, "Annual Summary");

  const monthlyRows = report.monthly.map((item) => ({
    Month: ETHIOPIAN_MONTHS[item.academicMonth - 1],
    "Meeting Count": item.meetingCount,
    "Unique Students": item.totalStudents,
    "Student-Meeting Opportunities": item.totalStudentMeetings,
    Present: item.present,
    Absent: item.absent,
    Permission: item.permission,
    "Not Recorded": item.notRecorded,
    "Attendance %": item.attendancePercentage,
  }));
  const monthlySheet = XLSX.utils.json_to_sheet(monthlyRows);
  monthlySheet["!cols"] = [
    { wch: 20 }, { wch: 15 }, { wch: 17 }, { wch: 28 }, { wch: 12 },
    { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(workbook, monthlySheet, "Monthly Breakdown");

  const classRows = report.classes.map((item) => ({
    Class: item.name,
    "Unique Students": item.totalStudents,
    "Student-Meeting Opportunities": item.totalStudentMeetings,
    Present: item.present,
    Absent: item.absent,
    Permission: item.permission,
    "Not Recorded": item.notRecorded,
    "Attendance %": item.attendancePercentage,
  }));
  const classSheet = XLSX.utils.json_to_sheet(classRows);
  classSheet["!cols"] = [
    { wch: 42 }, { wch: 17 }, { wch: 28 }, { wch: 12 },
    { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(workbook, classSheet, "Class Breakdown");
  return workbook;
}

function createAnnualReportPdf(report) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40,
      bufferPages: true,
    });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    const left = 40;
    const width = document.page.width - left * 2;
    document.font("Helvetica").fontSize(19).fillColor("#0A1172")
      .text("Kirkos Sunday School", left, 38);
    document.fontSize(14).fillColor("#222")
      .text("Parents' Meeting Annual Report", left, 64);
    document.fontSize(11)
      .text(`Ethiopian academic year ${report.academicYear} · ${report.selectedClassName}`, left, 88);
    document.fontSize(9).fillColor("#222")
      .text(
        `Meetings ${report.summary.meetingCount} · Unique students ${report.summary.totalStudents} · Student-meeting opportunities ${report.summary.totalStudentMeetings} · Present ${report.summary.present} · Absent ${report.summary.absent} · Permission ${report.summary.permission} · Not recorded ${report.summary.notRecorded} · Attendance ${report.summary.attendancePercentage}%`,
        left,
        110,
        { width }
      );

    const columns = [
      ["Month", 115],
      ["Meetings", 52],
      ["Unique students", 70],
      ["Student-meeting opportunities", 125],
      ["Present", 50],
      ["Absent", 50],
      ["Permission", 60],
      ["Not recorded", 70],
      ["Attendance %", width - 592],
    ];
    let y = 154;
    const drawHeader = (titles) => {
      let x = left;
      document.rect(left, y, width, 25).fill("#0A1172");
      document.fontSize(8).fillColor("#fff");
      titles.forEach(([title, columnWidth]) => {
        document.text(title, x + 3, y + 7, { width: columnWidth - 6, lineBreak: false });
        x += columnWidth;
      });
      y += 25;
      document.fillColor("#222").fontSize(8);
    };
    drawHeader(columns);
    for (const item of report.monthly) {
      if (y > document.page.height - 55) {
        document.addPage();
        y = 42;
        drawHeader(columns);
      }
      const values = [
        ETHIOPIAN_MONTHS_LATIN[item.academicMonth - 1],
        item.meetingCount,
        item.totalStudents,
        item.totalStudentMeetings,
        item.present,
        item.absent,
        item.permission,
        item.notRecorded,
        `${item.attendancePercentage}%`,
      ];
      let x = left;
      values.forEach((value, index) => {
        const cellWidth = columns[index][1];
        document.rect(x, y, cellWidth, 22).strokeColor("#CBD2DD").stroke();
        document.text(String(value), x + 3, y + 6, {
          width: cellWidth - 6,
          lineBreak: false,
        });
        x += cellWidth;
      });
      y += 22;
    }

    const pageRange = document.bufferedPageRange();
    for (let index = pageRange.start; index < pageRange.start + pageRange.count; index += 1) {
      document.switchToPage(index);
      document.fontSize(8).fillColor("#64748B")
        .text(
          `Page ${index - pageRange.start + 1} of ${pageRange.count}`,
          left,
          document.page.height - 28,
          { width, align: "center" }
        );
    }
    document.end();
  });
}

async function ensureUniqueIndexes(indexes = INDEXES) {
  for (const { model, name, key } of indexes) {
    let existing = [];
    try {
      existing = await model.collection.indexes();
    } catch (error) {
      if (error.codeName !== "NamespaceNotFound" && error.code !== 26) throw error;
    }
    const found = existing.find(({ name: indexName }) => indexName === name);
    if (!found) {
      await model.collection.createIndex(key, { unique: true, name });
      continue;
    }
    if (
      found.unique !== true ||
      Object.keys(found.key).length !== Object.keys(key).length ||
      Object.entries(key).some(([field, direction]) => found.key[field] !== direction)
    ) {
      throw Object.assign(
        new Error(`Required unique index "${name}" is missing or invalid.`),
        { statusCode: 503, expose: true }
      );
    }
  }
}

function createParentMeetingsRouter({
  service,
  ensureIndexes = ensureUniqueIndexes,
} = {}) {
  const parentMeetingsRouter = express.Router();
  let resolvedService = service;
  async function getService() {
    if (!resolvedService) {
      resolvedService = await createParentMeetingService();
    }
    return resolvedService;
  }

  function assignedClassIds(req) {
    if (req.account?.role === "admin") return undefined;
    return (req.account?.assignments || []).map(({ classId }) => String(classId));
  }

  async function requireAssignedClass(req, classNumber) {
    if (req.account?.role !== "teacher" || classNumber === undefined) return;
    const assignedIds = assignedClassIds(req);
    const classRecord = await Class.findOne({
      _id: { $in: assignedIds },
      classNumber: Number(classNumber),
    }).select("_id").lean();
    if (!classRecord) {
      throw Object.assign(new Error("You are not assigned to this class."), {
        statusCode: 403,
        expose: true,
      });
    }
  }

  const reportAccess = [
    authenticateAccount,
    authorizeAccountRoles("admin", "teacher"),
    requireChangedPassword,
  ];

  parentMeetingsRouter.get(
    "/annual-report",
    ...reportAccess,
    async (req, res, next) => {
      try {
        await requireAssignedClass(req, req.query.classNumber);
        const report = await (await getService()).getAnnualReport(
          req.query.academicYear,
          {
            ...req.query,
            allowedClassIds: assignedClassIds(req),
          }
        );
        return res.json({ status: "ok", ...report });
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.get(
    "/annual-report/export.xlsx",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        const report = await (await getService()).getAnnualReport(
          req.query.academicYear,
          req.query
        );
        const buffer = XLSX.write(buildAnnualReportWorkbook(report), {
          bookType: "xlsx",
          type: "buffer",
        });
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="parent-meeting-annual-${report.academicYear}.xlsx"`
        );
        return res.send(buffer);
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.get(
    "/annual-report/export.pdf",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        const report = await (await getService()).getAnnualReport(
          req.query.academicYear,
          req.query
        );
        const pdf = await createAnnualReportPdf(report);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="parent-meeting-annual-${report.academicYear}.pdf"`
        );
        return res.send(pdf);
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.get("/", ...reportAccess, async (req, res, next) => {
    try {
      return res.json({
        status: "ok",
        ...(await (await getService()).listMeetings({
          ...req.query,
          allowedClassIds: assignedClassIds(req),
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  parentMeetingsRouter.get(
    "/:meetingId/report",
    ...reportAccess,
    async (req, res, next) => {
      try {
        await requireAssignedClass(req, req.query.classNumber);
        const report = await (await getService()).getClassReport(
          req.params.meetingId,
          {
            ...req.query,
            allowedClassIds: assignedClassIds(req),
          }
        );
        return res.json({ status: "ok", ...report });
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.get(
    "/:meetingId/follow-ups",
    ...reportAccess,
    async (req, res, next) => {
      try {
        await requireAssignedClass(req, req.query.classNumber);
        const result = await (await getService()).getFollowUps(
          req.params.meetingId,
          { ...req.query, allowedClassIds: assignedClassIds(req) }
        );
        return res.json({ status: "ok", ...result });
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.get(
    "/:meetingId/export.xlsx",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        const service = await getService();
        const report = await service.getClassReport(
          req.params.meetingId,
          req.query.classNumber === undefined
            ? {}
            : { classNumber: req.query.classNumber }
        );
        const students = await Student.find({})
          .select("_id classId classNumber originalSerialNumber studentName christianName")
          .sort({ classNumber: 1, originalSerialNumber: 1 })
          .lean();
        const [attendance, classes] = await Promise.all([
          ParentMeetingAttendance.find({ meetingId: report.meeting._id }).lean(),
          Class.find({}).select("_id name classNumber").lean(),
        ]);
        const workbook = buildParentMeetingWorkbook(
          report,
          students,
          attendance,
          classes,
          req.query.classNumber
        );
        const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
        const filename = `parent-meeting-${report.meeting.academicYear}-${report.meeting.academicMonth}.xlsx`;
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(buffer);
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.get(
    "/:meetingId/export.pdf",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        const report = await (await getService()).getClassReport(
          req.params.meetingId,
          req.query.classNumber === undefined
            ? {}
            : { classNumber: req.query.classNumber }
        );
        let pdf;
        if (req.query.classNumber === undefined) {
          const [students, attendance] = await Promise.all([
            Student.find({})
              .select("_id classId classNumber originalSerialNumber studentName christianName")
              .sort({ classNumber: 1, originalSerialNumber: 1 })
              .lean(),
            ParentMeetingAttendance.find({ meetingId: report.meeting._id }).lean(),
          ]);
          pdf = await createParentMeetingAllClassesPdf(
            report,
            students,
            attendance
          );
        } else {
          pdf = await createParentMeetingPdf(report, req.query.classNumber);
        }
        const filename = `parent-meeting-${report.meeting.academicYear}-${report.meeting.academicMonth}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(pdf);
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.post("/", authenticateAdmin, async (req, res, next) => {
    try {
      await ensureIndexes();
      const meeting = await (await getService()).createMeeting(
        req.body || {},
        req.admin.email
      );
      return res.status(201).json({ status: "ok", meeting });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          status: "error",
          message: "A parent meeting already exists for this date.",
        });
      }
      return next(error);
    }
  });

  parentMeetingsRouter.put(
    "/:meetingId",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        await ensureIndexes();
        const meeting = await (await getService()).updateMeeting(
          req.params.meetingId,
          req.body || {}
        );
        return res.json({ status: "ok", meeting });
      } catch (error) {
        if (error?.code === 11000) {
          return res.status(409).json({
            status: "error",
            message: "A parent meeting already exists for this date.",
          });
        }
        return next(error);
      }
    }
  );

  parentMeetingsRouter.get(
    "/:meetingId/attendance",
    ...reportAccess,
    async (req, res, next) => {
      try {
        await requireAssignedClass(req, req.query.classNumber);
        const result = await (await getService()).getAttendance(
          req.params.meetingId,
          { ...req.query, allowedClassIds: assignedClassIds(req) }
        );
        return res.json({ status: "ok", ...result });
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.put(
    "/:meetingId/attendance",
    ...reportAccess,
    async (req, res, next) => {
      try {
        await ensureIndexes();
        const result = await (await getService()).saveAttendance(
          req.params.meetingId,
          req.body || {},
          assignedClassIds(req)
        );
        return res.json({ status: "ok", ...result, message: "Meeting attendance saved." });
      } catch (error) {
        if (error?.code === 11000) {
          return res.status(409).json({
            status: "error",
            message: "Attendance changed concurrently. Reload the meeting and retry.",
          });
        }
        return next(error);
      }
    }
  );

  parentMeetingsRouter.delete(
    "/:meetingId/attendance/:studentId",
    ...reportAccess,
    async (req, res, next) => {
      try {
        const result = await (await getService()).deleteStudentAttendance(
          req.params.meetingId,
          req.params.studentId,
          assignedClassIds(req)
        );
        return res.json({ status: "ok", ...result });
      } catch (error) {
        return next(error);
      }
    }
  );

  parentMeetingsRouter.delete(
    "/:meetingId",
    authenticateAdmin,
    async (req, res, next) => {
      try {
        const result = await (await getService()).deleteMeeting(
          req.params.meetingId
        );
        return res.json({
          status: "ok",
          ...result,
          message: "Parent meeting and its attendance records were deleted.",
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  return parentMeetingsRouter;
}

module.exports = createParentMeetingsRouter();
module.exports.createParentMeetingsRouter = createParentMeetingsRouter;
module.exports.ensureUniqueIndexes = ensureUniqueIndexes;
module.exports.buildParentMeetingWorkbook = buildParentMeetingWorkbook;
module.exports.buildAnnualReportWorkbook = buildAnnualReportWorkbook;
module.exports.createParentMeetingAllClassesPdf =
  createParentMeetingAllClassesPdf;
module.exports.createAnnualReportPdf = createAnnualReportPdf;
module.exports.createParentMeetingPdf = createParentMeetingPdf;
