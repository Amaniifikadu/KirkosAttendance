const express = require("express");
const multer = require("multer");
const crypto = require("node:crypto");
const Class = require("../models/Class");
const Student = require("../models/Student");
const ImportBatch = require("../models/ImportBatch");
const SUNDAY_SCHOOL_CLASSES = require("../config/sundaySchoolClasses");
const { authenticateAdmin } = require("../middleware/authenticateAdmin");
const { parseStudentWorkbook } = require("../services/studentWorkbookPreview");
const { listStudents } = require("../services/studentList");
const {
  deletePreview,
  getPreview,
  storePreview,
} = require("../services/studentImportPreviewStore");

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 },
});

const router = express.Router();

router.get("/", authenticateAdmin, async (req, res, next) => {
  try {
    const result = await listStudents(req.query, Student);
    return res.json({ status: "ok", ...result });
  } catch (error) {
    return next(error);
  }
});

async function ensureCollectionAndIndexes(model) {
  try {
    await model.createCollection();
  } catch (error) {
    if (error.code !== 48) {
      throw error;
    }
  }
  await model.createIndexes();
}

function studentIdentityKey(student) {
  return JSON.stringify([
    student.classNumber,
    String(student.originalSerialNumber).normalize("NFC"),
  ]);
}

async function insertNewStudents(records, session, studentModel = Student) {
  const requestedIdentities = new Set(records.map(studentIdentityKey));
  const classNumbers = [...new Set(records.map(({ classNumber }) => classNumber))];
  const existingStudents = await studentModel
    .find(
      { classNumber: { $in: classNumbers } },
      { classNumber: 1, originalSerialNumber: 1 }
    )
    .session(session)
    .lean();
  const matchingStudent = existingStudents.find((student) =>
    requestedIdentities.has(studentIdentityKey(student))
  );

  if (matchingStudent) {
    throw Object.assign(
      new Error(
        "A student with an eligible class and student number was added after preview. Upload the workbook again to create a fresh preview."
      ),
      { statusCode: 409, expose: true }
    );
  }

  return studentModel.insertMany(records, {
    session,
    ordered: true,
  });
}

router.post(
  "/import/preview",
  authenticateAdmin,
  upload.single("workbook"),
  async (req, res, next) => {
    try {
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          status: "error",
          message: "Upload one .xlsx file using the workbook form field.",
        });
      }

      const hasXlsxExtension = /\.xlsx$/i.test(file.originalname);
      const hasZipSignature =
        file.buffer.length >= 4 &&
        file.buffer[0] === 0x50 &&
        file.buffer[1] === 0x4b &&
        [0x03, 0x05, 0x07].includes(file.buffer[2]) &&
        [0x04, 0x06, 0x08].includes(file.buffer[3]);

      if (
        !hasXlsxExtension ||
        !XLSX_MIME_TYPES.has(file.mimetype) ||
        !hasZipSignature
      ) {
        return res.status(415).json({
          status: "error",
          message: "The uploaded file must be a valid .xlsx workbook.",
        });
      }

      const classRecords = await Class.find(
        { sheetName: { $in: SUNDAY_SCHOOL_CLASSES.map(({ sheetName }) => sheetName) } },
        { _id: 1, classNumber: 1, sheetName: 1 }
      ).lean();
      const studentRecords = await Student.find(
        {
          classNumber: {
            $in: SUNDAY_SCHOOL_CLASSES.map(({ classNumber }) => classNumber),
          },
        },
        { classNumber: 1, originalSerialNumber: 1 }
      ).lean();
      const sheetNameByClassNumber = new Map(
        SUNDAY_SCHOOL_CLASSES.map(({ classNumber, sheetName }) => [
          classNumber,
          sheetName,
        ])
      );
      const existingStudentsByClass = new Map();

      for (const student of studentRecords) {
        const sheetName = sheetNameByClassNumber.get(student.classNumber);
        if (!sheetName) {
          continue;
        }
        if (!existingStudentsByClass.has(sheetName)) {
          existingStudentsByClass.set(sheetName, new Set());
        }
        existingStudentsByClass
          .get(sheetName)
          .add(String(student.originalSerialNumber).normalize("NFC"));
      }

      const fileHash = crypto
        .createHash("sha256")
        .update(file.buffer)
        .digest("hex");
      const alreadyImported = await ImportBatch.findOne({ fileHash })
        .select({ _id: 1 })
        .lean();
      const parsed = parseStudentWorkbook(
        file.buffer,
        classRecords,
        existingStudentsByClass
      );
      const cached = storePreview({
        fileHash,
        importRecords: parsed.importRecords,
        response: parsed.preview,
      });

      return res.json({
        ...parsed.preview,
        alreadyImported: Boolean(alreadyImported),
        previewId: cached.previewId,
        expiresAt: cached.expiresAt,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/import/confirm",
  authenticateAdmin,
  express.json(),
  async (req, res, next) => {
    const { previewId, confirmation } = req.body || {};

    if (confirmation !== "IMPORT") {
      return res.status(400).json({
        status: "error",
        message: 'Explicit confirmation is required. Send confirmation: "IMPORT".',
      });
    }

    if (typeof previewId !== "string" || previewId.length > 100) {
      return res.status(400).json({
        status: "error",
        message: "A valid previewId is required.",
      });
    }

    const cachedPreview = getPreview(previewId);
    if (!cachedPreview) {
      return res.status(410).json({
        status: "error",
        message: "Preview expired or is unavailable. Upload the workbook again.",
      });
    }

    if (cachedPreview.importRecords.length === 0) {
      return res.status(422).json({
        status: "error",
        message: "No valid student rows are available to import.",
      });
    }

    let session;
    let insertedCount = 0;
    const skippedCount =
      cachedPreview.response.summary.totalRows -
      cachedPreview.importRecords.length;

    try {
      const alreadyImported = await ImportBatch.findOne({
        fileHash: cachedPreview.fileHash,
      })
        .select({ _id: 1 })
        .lean();

      if (alreadyImported) {
        return res.status(409).json({
          status: "error",
          message: "This exact workbook has already been imported.",
        });
      }

      await ensureCollectionAndIndexes(Class);
      await ensureCollectionAndIndexes(Student);
      await ensureCollectionAndIndexes(ImportBatch);

      session = await Class.startSession();
      await session.withTransaction(async () => {
        await Class.bulkWrite(
          SUNDAY_SCHOOL_CLASSES.map(({ classNumber, sheetName }) => ({
            updateOne: {
              filter: { classNumber },
              update: {
                $setOnInsert: {
                  classNumber,
                  name: SUNDAY_SCHOOL_CLASSES.getDisplayName(
                    classNumber,
                    sheetName
                  ),
                  sheetName,
                },
              },
              upsert: true,
            },
          })),
          { session, ordered: true }
        );

        const classes = await Class.find({
          sheetName: {
            $in: SUNDAY_SCHOOL_CLASSES.map(({ sheetName }) => sheetName),
          },
        })
          .session(session)
          .lean();
        const classByNumber = new Map(
          classes.map((item) => [item.classNumber, item])
        );

        for (const configuredClass of SUNDAY_SCHOOL_CLASSES) {
          const classRecord = classByNumber.get(configuredClass.classNumber);
          if (
            !classRecord ||
            classRecord.sheetName !== configuredClass.sheetName
          ) {
            throw Object.assign(
              new Error("Class records changed since the workbook preview."),
              { statusCode: 409, expose: true }
            );
          }
        }

        const documents = cachedPreview.importRecords.map((record) => ({
          ...record,
          classId: classByNumber.get(record.classNumber)._id,
        }));
        await insertNewStudents(documents, session);
        await ImportBatch.create(
          [
            {
              fileHash: cachedPreview.fileHash,
              insertedCount: documents.length,
              skippedCount,
              importedBy: req.admin.email,
            },
          ],
          { session }
        );
        insertedCount = documents.length;
      });

      deletePreview(previewId);
      return res.json({
        status: "ok",
        insertedCount,
        skippedCount,
        existingCount: cachedPreview.response.summary.existingRows,
        duplicateCount: cachedPreview.response.summary.duplicateRows,
        invalidCount: cachedPreview.response.summary.invalidRows,
        failedCount: 0,
        message: "Workbook import completed.",
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          status: "error",
          message:
            "Import stopped because the workbook or a class-local student number already exists. No student records were imported.",
          insertedCount: 0,
          skippedCount: 0,
          failedCount: cachedPreview.importRecords.length,
        });
      }

      if (error?.statusCode === 409 && error.expose) {
        return res.status(409).json({
          status: "error",
          message: error.message,
          insertedCount: 0,
          skippedCount: 0,
          failedCount: cachedPreview.importRecords.length,
        });
      }

      return next(error);
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }
);

module.exports = router;
module.exports.insertNewStudents = insertNewStudents;
