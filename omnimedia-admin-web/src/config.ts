const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const rawClientAppUrl = import.meta.env.VITE_CLIENT_APP_URL?.trim();

export const API_BASE_URL = (rawApiBaseUrl || "http://127.0.0.1:8000").replace(/\/+$/, "");
export const CLIENT_APP_URL = (rawClientAppUrl || "http://127.0.0.1:5173").replace(
  /\/+$/,
  "",
);
