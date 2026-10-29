export function attendanceUpdates(students, statuses, savedStatuses, complete = false) {
  return students
    .filter(({ studentId }) =>
      complete || statuses[studentId] !== savedStatuses[studentId]
    )
    .map(({ studentId }) => ({
      studentId,
      status: statuses[studentId] || "not_recorded",
    }));
}
