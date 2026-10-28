export async function persistInlineStatusChange({
  previousStatus,
  nextStatus,
  save,
  onStatusChange,
}) {
  if (previousStatus === nextStatus) return false;

  onStatusChange(nextStatus);
  try {
    await save(nextStatus);
    return true;
  } catch (error) {
    onStatusChange(previousStatus);
    throw error;
  }
}

export function moveStatusCount(summary, previousStatus, nextStatus) {
  if (!summary) return summary;
  const fieldFor = (status) =>
    status === "not_recorded" ? "notRecorded" : status;
  const previousField = fieldFor(previousStatus);
  const nextField = fieldFor(nextStatus);
  return {
    ...summary,
    [previousField]: Math.max(0, (summary[previousField] || 0) - 1),
    [nextField]: (summary[nextField] || 0) + 1,
  };
}
