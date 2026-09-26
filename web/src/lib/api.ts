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
