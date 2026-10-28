function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      status: "error",
      message: "The uploaded workbook exceeds the 10 MB size limit.",
    });
  }

  if (error?.name === "MulterError") {
    return res.status(400).json({
      status: "error",
      message: "The workbook upload request is invalid.",
    });
  }

  if (
    (error?.statusCode && error.statusCode < 500) ||
    error?.expose === true
  ) {
    return res.status(error.statusCode).json({
      status: "error",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  console.error("Request failed:", {
    name: error.name || "Error",
    code: error.code || "UNKNOWN",
  });

  const statusCode = error.statusCode || error.status || 500;
  const message =
    statusCode >= 500 ? "Internal server error." : error.message;

  return res.status(statusCode).json({
    status: "error",
    message,
  });
}

module.exports = errorHandler;
