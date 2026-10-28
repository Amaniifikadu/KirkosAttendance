require("dotenv").config();

const app = require("./app");
const connectToDatabase = require("./config/database");

const port = Number(process.env.PORT || 5000);

async function startServer() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a whole number between 1 and 65535.");
  }

  await connectToDatabase();

  const server = app.listen(port, () => {
    console.log(`Sunday School Attendance API listening on port ${port}.`);
  });

  server.on("error", (error) => {
    console.error("HTTP server failed to start:", error);
    process.exitCode = 1;
  });
}

startServer().catch((error) => {
  console.error("Failed to start the API:", error.message);
  process.exitCode = 1;
});
