'use client'

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 6000,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal || controller.signal,
    })
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function fetchJsonWithTimeout<T = any>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 6000,
): Promise<T | null> {
  const res = await fetchWithTimeout(input, init, timeoutMs)
  if (!res.ok) return null
  return await res.json().catch(() => null)
}
