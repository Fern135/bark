import axios from "axios";

// In the browser, requests go same-origin through the gateway (/api -> Django).
// During server-side rendering, requests go straight to Django on the internal Docker network.
const baseURL =
  typeof window === "undefined"
    ? (process.env.INTERNAL_API_URL ?? "http://server:8000/api")
    : "/api";

export const api = axios.create({
  baseURL,
  timeout: 10_000,
  withCredentials: true,
  // Matches Django's default CSRF cookie/header names.
  xsrfCookieName: "csrftoken",
  xsrfHeaderName: "X-CSRFToken",
  headers: { Accept: "application/json" },
});

let csrf: Promise<unknown> | undefined;
api.interceptors.request.use(async (config) => {
  if (typeof document !== "undefined" && !["get", "head", "options"].includes(config.method ?? "get")) {
    if (!document.cookie.split(";").some((cookie) => cookie.trim().startsWith("csrftoken="))) {
      csrf ??= api.get("/auth/csrf/").finally(() => { csrf = undefined; });
      await csrf;
    }
  }
  return config;
});
api.interceptors.response.use((response) => response, (error) => {
  if (typeof window !== "undefined" && error.response?.status === 401 && error.config?.url?.startsWith("/canvas/")) {
    window.dispatchEvent(new Event("bark:session-expired"));
  }
  return Promise.reject(error);
});
