import assert from "node:assert/strict";
import test from "node:test";
import {
  reportRefreshInterval,
  scheduleReportRefresh,
} from "./reportRefresh.js";

test("report refresh interval has a safe configurable range", () => {
  assert.equal(reportRefreshInterval("45000"), 45_000);
  assert.equal(reportRefreshInterval("1000"), 15_000);
  assert.equal(reportRefreshInterval("900000"), 300_000);
  assert.equal(reportRefreshInterval("invalid"), 30_000);
});

test("report refresh skips hidden pages, overlapping calls, and cleans up", async () => {
  let tick;
  let cleared = false;
  let calls = 0;
  let release;
  let visibilityHandler;
  let listenerRemoved = false;
  const documentRef = {
    hidden: true,
    addEventListener(_type, callback) {
      visibilityHandler = callback;
    },
    removeEventListener(_type, callback) {
      listenerRemoved = callback === visibilityHandler;
    },
  };
  const stop = scheduleReportRefresh(
    () => {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    },
    {
      intervalMs: 30_000,
      documentRef,
      setIntervalFn(callback, interval) {
        assert.equal(interval, 30_000);
        tick = callback;
        return "timer";
      },
      clearIntervalFn(timer) {
        assert.equal(timer, "timer");
        cleared = true;
      },
    }
  );

  await tick();
  assert.equal(calls, 0);
  documentRef.hidden = false;
  const first = visibilityHandler();
  await visibilityHandler();
  assert.equal(calls, 1);
  release();
  await first;
  stop();
  assert.equal(cleared, true);
  assert.equal(listenerRemoved, true);
  await visibilityHandler();
  assert.equal(calls, 1);
});
