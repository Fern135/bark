import axios from "axios";
import { api } from "./api";

export type User = { user_id: string; username: string; email: string };
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    const message = typeof data?.error === "string" ? data.error : error.response?.status === 413
      ? "This world is too large to save (10 MB maximum). Export JSON to keep a copy."
      : error.response?.status === 429 ? "Too many requests. Please wait before trying again."
      : error.response?.status === 403 ? "Your request could not be verified. Refresh your session and try again."
      : "Could not reach Bark. Check your connection and try again.";
    return [message, ...(Array.isArray(data?.details) ? data.details.filter((x: unknown) => typeof x === "string") : [])].join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
export function returnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/my-games";
  const parsed = new URL(value, "https://bark.invalid");
  return parsed.origin === "https://bark.invalid" && !["/login", "/signup"].includes(parsed.pathname) ? parsed.pathname + parsed.search : "/my-games";
}
export const accounts = {
  me: async () => (await api.get<{ user: User }>("/auth/me/")).data.user,
  login: async (email: string, password: string) => (await api.post<{ user: User }>("/auth/login/", { username: email, password })).data.user,
  register: async (username: string, email: string, password: string) => { await api.post("/auth/register/", { username, email, password }); },
  logout: async () => { await api.post("/auth/logout/"); },
};
