const mongoose = require("mongoose");

function hasTeacherAccess(account, classId, subjectId) {
  if (account?.role === "admin") return true;
  if (account?.role !== "teacher") return false;
  return (account.assignments || []).some((assignment) => {
    if (String(assignment.classId) !== String(classId)) return false;
    return (assignment.subjectIds || []).some(
      (assignedSubjectId) => String(assignedSubjectId) === String(subjectId)
    );
  });
}

function isObjectId(value) {
  return (
    typeof value === "string" &&
    /^[a-f\d]{24}$/i.test(value) &&
    mongoose.isValidObjectId(value)
  );
}

module.exports = { hasTeacherAccess, isObjectId };
