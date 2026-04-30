// src/api/client.ts
const RAW_API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "https://stellar-api.getdig.ai";

const API_BASE_URL = RAW_API_BASE.endsWith("/v1")
  ? RAW_API_BASE
  : `${RAW_API_BASE}/v1`;

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
