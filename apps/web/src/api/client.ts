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

/**
 * Error carrying the HTTP status so callers can react to specific codes
 * (e.g. 429 from the edge rate limiter → backoff + honest "retrying" copy,
 * Lot R R3c). message stays what it always was — existing catch sites keep
 * working unchanged.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
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
    throw new ApiError(
      text || `API request failed: ${response.status}`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}
