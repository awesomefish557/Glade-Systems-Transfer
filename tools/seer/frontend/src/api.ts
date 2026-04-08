const base = () =>
  (import.meta.env.VITE_SEER_API_BASE ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const b = base();
  return b ? `${b}${p}` : p;
}

export function apiHeaders(json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const t = import.meta.env.VITE_API_BEARER_TOKEN;
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const err =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : res.statusText || `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data as T;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const jsonHeader = !(init?.body instanceof FormData);
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: "same-origin",
    headers: { ...apiHeaders(jsonHeader), ...init?.headers }
  });
  return parseJson<T>(res);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
