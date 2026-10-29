const TOKEN_KEY = "munshi.token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Server tak nahi pahunch paaye. Internet check karein.", 0);
  }
  if (!res.ok) {
    let detail = res.statusText;
    let retry: number | undefined;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: any) => d.msg).join(", ") : detail;
      retry = j.retry_after;
    } catch { /* non-JSON error body */ }
    if (res.status === 401 && token && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(detail, res.status, retry);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("json") ? res.json() : res.blob()) as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: body === undefined ? undefined : json(body) }),
  put: <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: json(body) }),
  del: <T>(p: string) => request<T>(p, { method: "DELETE" }),
  form: <T>(p: string, form: FormData) => request<T>(p, { method: "POST", body: form }),
  blob: (p: string, body: unknown) => request<Blob>(p, { method: "POST", body: json(body) }),
};
