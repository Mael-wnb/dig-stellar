// src/api/client.ts

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/v1'

export function getApiBaseUrl(): string {
  return API_BASE_URL
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `API request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}