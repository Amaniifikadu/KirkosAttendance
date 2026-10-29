const express = require("express");
const cors = require("cors");
const healthRoutes = require("./routes/health.routes");
const adminAuthRoutes = require("./routes/adminAuth.routes");
const studentRoutes = require("./routes/student.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const portalRoutes = require("./routes/portal.routes");
const schoolRoutes = require("./routes/school.routes");
const subjectLessonsRoutes = require("./routes/subjectLessons.routes");
const eligibilityRoutes = require("./routes/eligibility.routes");
const examsRoutes = require("./routes/exams.routes");
const parentMeetingsRoutes = require("./routes/parentMeetings.routes");
const errorHandler = require("./middleware/errorHandler");
const notFound = require("./middleware/notFound");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use("/api/health", healthRoutes);
app.use("/api/auth/admin", adminAuthRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/auth/portal", portalRoutes);
app.use("/api/school", schoolRoutes);
app.use("/api/lessons", subjectLessonsRoutes);
app.use("/api/eligibility", eligibilityRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/parent-meetings", parentMeetingsRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
