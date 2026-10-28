const express = require("express");
const {
  authenticateAccount,
  authorizeAccountRoles,
  requireChangedPassword,
} = require("../middleware/authenticateAccount");
const { getEligibility } = require("../services/eligibility");
const { hasTeacherAccess, isObjectId } = require("../services/subjectAccess");

const router = express.Router();

router.get(
  "/",
  authenticateAccount,
  authorizeAccountRoles("admin", "teacher"),
  requireChangedPassword,
  async (req, res, next) => {
    try {
      const { classId, subjectId, academicYear, academicMonth, termId } = req.query;
      if (!isObjectId(classId) || !isObjectId(subjectId)) {
        return res.status(400).json({
          status: "error",
          message: "Valid classId and subjectId are required.",
        });
      }
      if (!hasTeacherAccess(req.account, classId, subjectId)) {
        return res.status(403).json({
          status: "error",
          message: "You are not assigned to this class and subject.",
        });
      }
      const result = await getEligibility({
        classId,
        subjectId,
        academicYear,
        academicMonth,
        termId,
      });
      return res.json({ status: "ok", ...result });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
