const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 60_000;
export const AUTH_EXPIRED_EVENT = "kirkos:auth-expired";

function configuredTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const API_REQUEST_TIMEOUT_MS = configuredTimeout(
  import.meta.env?.VITE_API_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS
);
export const API_LOGIN_TIMEOUT_MS = configuredTimeout(
  import.meta.env?.VITE_LOGIN_TIMEOUT_MS,
  DEFAULT_LOGIN_TIMEOUT_MS
);

export async function apiFetch(path, options = {}) {
  const {
    token,
    timeoutMs = API_REQUEST_TIMEOUT_MS,
    signal,
    headers,
    ...requestOptions
  } = options;
  const isAbsoluteUrl = /^https?:\/\//i.test(path);
  const url = isAbsoluteUrl ? path : `${API_BASE_URL}${path}`;
  const hasBearerToken = Boolean(
    token || headers?.Authorization || headers?.authorization
  );
  const controller = new AbortController();
  let timedOut = false;
  const relayAbort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", relayAbort, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...requestOptions,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
    if (response.status === 401 && hasBearerToken && typeof window !== "undefined") {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return response;
  } catch (error) {
    if (timedOut) {
      throw new Error("The server took too long to respond. Check your connection and try again.");
    }
    if (error instanceof TypeError) {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}

export async function readApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.message || `Request failed (${response.status}).`
    );
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

export async function apiRequest(path, token, options = {}) {
  const response = await apiFetch(path, { ...options, token });
  return readApiResponse(response);
}
