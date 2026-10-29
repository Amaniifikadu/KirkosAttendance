import assert from "node:assert/strict";
import test from "node:test";
import {
  apiFetch,
  AUTH_EXPIRED_EVENT,
  readApiResponse,
} from "./apiClient.js";

test("API requests skip browser caching and include the existing bearer token", async () => {
  const originalFetch = globalThis.fetch;
  let received;
  globalThis.fetch = async (_url, options) => {
    received = options;
    return { status: 200, ok: true, json: async () => ({ status: "ok" }) };
  };
  try {
    const response = await apiFetch("/api/example", { token: "session-token" });
    assert.equal(response.status, 200);
    assert.equal(received.cache, "no-store");
    assert.equal(received.headers.Authorization, "Bearer session-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API 401 responses notify the app to clear the active session", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let eventType;
  globalThis.window = {
    dispatchEvent(event) {
      eventType = event.type;
    },
  };
  globalThis.fetch = async () => ({
    status: 401,
    ok: false,
    json: async () => ({ message: "Expired." }),
  });
  try {
    await apiFetch("/api/protected", { token: "expired-token" });
    assert.equal(eventType, AUTH_EXPIRED_EVENT);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("timed-out requests return a useful retry message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
  try {
    await assert.rejects(
      apiFetch("/api/slow", { timeoutMs: 5 }),
      /server took too long to respond/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network failures return a connection-specific message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    await assert.rejects(
      apiFetch("/api/unreachable"),
      /could not reach the server/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API errors retain their HTTP status for caller handling", async () => {
  await assert.rejects(
    readApiResponse({
      ok: false,
      status: 503,
      json: async () => ({ message: "Service unavailable." }),
    }),
    (error) => error.status === 503 && /unavailable/.test(error.message)
  );
});
