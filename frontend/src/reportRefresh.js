const DEFAULT_INTERVAL_MS = 30_000;

export function reportRefreshInterval(value = import.meta.env?.VITE_REPORT_REFRESH_INTERVAL_MS) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval <= 0) return DEFAULT_INTERVAL_MS;
  return Math.min(300_000, Math.max(15_000, interval));
}

export function scheduleReportRefresh(callback, {
  intervalMs = reportRefreshInterval(),
  documentRef = globalThis.document,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
} = {}) {
  let active = true;
  let running = false;
  const tick = async () => {
    if (!active || running || documentRef?.hidden) return;
    running = true;
    try {
      await callback();
    } finally {
      running = false;
    }
  };
  const onVisibilityChange = () => {
    if (!documentRef?.hidden) void tick();
  };
  const timer = setIntervalFn(tick, intervalMs);
  documentRef?.addEventListener?.("visibilitychange", onVisibilityChange);
  return () => {
    active = false;
    clearIntervalFn(timer);
    documentRef?.removeEventListener?.("visibilitychange", onVisibilityChange);
  };
}
