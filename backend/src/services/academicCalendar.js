const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ethiopianFormatter = new Intl.DateTimeFormat(
  "en-u-ca-ethiopic-nu-latn",
  {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }
);

function parseCanonicalDate(value, field = "date") {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw Object.assign(new Error(`${field} must use YYYY-MM-DD format.`), {
      statusCode: 400,
      expose: true,
    });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw Object.assign(new Error(`${field} must be a valid Gregorian date.`), {
      statusCode: 400,
      expose: true,
    });
  }
  const parts = Object.fromEntries(
    ethiopianFormatter
      .formatToParts(date)
      .filter(({ type }) => ["year", "month"].includes(type))
      .map(({ type, value: part }) => [type, Number(part)])
  );
  return {
    date,
    academicYear: parts.year,
    academicMonth: parts.month,
  };
}

function normalizeAcademicPeriod(value) {
  const period = Number(value);
  if (!Number.isInteger(period) || period < 1000 || period > 9999) {
    throw Object.assign(new Error("academicYear must be a valid Ethiopian year."), {
      statusCode: 400,
      expose: true,
    });
  }
  return period;
}

module.exports = { normalizeAcademicPeriod, parseCanonicalDate };
