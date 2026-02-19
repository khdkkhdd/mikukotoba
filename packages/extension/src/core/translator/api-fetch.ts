// Replaceable fetch implementation.
// Background (default): globalThis.fetch
// Content script: bgFetch via chrome.runtime.sendMessage proxy
let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);

export function setApiFetchImpl(fn: typeof fetch): void {
  fetchImpl = fn;
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetchImpl(input, init);
}
