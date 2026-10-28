const formatter = new Intl.DateTimeFormat("en-u-ca-ethiopic-nu-latn", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

export const ETHIOPIAN_MONTHS = [
  "መስከረም",
  "ጥቅምት",
  "ኅዳር",
  "ታኅሣሥ",
  "ጥር",
  "የካቲት",
  "መጋቢት",
  "ሚያዝያ",
  "ግንቦት",
  "ሰኔ",
  "ሐምሌ",
  "ነሐሴ",
  "ጳጉሜ",
];

function getEthiopianParts(date) {
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(({ type }) => ["year", "month", "day"].includes(type))
      .map(({ type, value }) => [type, Number(value)])
  );
  return values;
}

function formatGregorianDate(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function findEthiopianNewYear(year) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError("Ethiopian year must be between 1000 and 9999.");
  }
  const estimatedStart = Date.UTC(year + 7, 8, 11);
  for (let offset = -3; offset <= 3; offset += 1) {
    const candidate = new Date(estimatedStart + offset * 86400000);
    const parts = getEthiopianParts(candidate);
    if (parts.year === year && parts.month === 1 && parts.day === 1) {
      return candidate;
    }
  }
  throw new RangeError("Could not resolve the Ethiopian new year.");
}

export function ethiopianToGregorian({ year, month, day }) {
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 13 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > (month === 13 ? (year % 4 === 3 ? 6 : 5) : 30)
  ) {
    throw new RangeError("The selected Ethiopian calendar date is invalid.");
  }
  const firstDay = findEthiopianNewYear(year);
  const offset = (month - 1) * 30 + day - 1;
  const gregorianDate = new Date(firstDay.getTime() + offset * 86400000);
  const actualParts = getEthiopianParts(gregorianDate);
  if (
    actualParts.year !== year ||
    actualParts.month !== month ||
    actualParts.day !== day
  ) {
    throw new RangeError("The selected Ethiopian calendar date is invalid.");
  }
  return formatGregorianDate(gregorianDate);
}

export function gregorianToEthiopian(isoDate) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new RangeError("Gregorian date must use YYYY-MM-DD format.");
  }
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    formatGregorianDate(date) !== isoDate
  ) {
    throw new RangeError("Gregorian date is invalid.");
  }
  return getEthiopianParts(date);
}

export function localTodayAsGregorian() {
  const today = new Date();
  return [
    String(today.getFullYear()).padStart(4, "0"),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

export function isEthiopianSunday(value) {
  try {
    const gregorianDate = ethiopianToGregorian(value);
    return new Date(`${gregorianDate}T00:00:00.000Z`).getUTCDay() === 0;
  } catch {
    return false;
  }
}

export function getEthiopianSundays({ year, month }) {
  if (
    !Number.isInteger(year) ||
    year < 1000 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 13
  ) {
    return [];
  }
  const daysInMonth = month === 13 ? (year % 4 === 3 ? 6 : 5) : 30;
  return Array.from({ length: daysInMonth }, (_, index) => index + 1).filter(
    (day) => isEthiopianSunday({ year, month, day })
  );
}

export function nextSundayAsEthiopian(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new RangeError("Gregorian date is invalid.");
  }
  const offset = (7 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + offset);
  return gregorianToEthiopian(date.toISOString().slice(0, 10));
}
