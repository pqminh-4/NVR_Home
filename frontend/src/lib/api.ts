/** Fetch wrapper: token tự gắn, lỗi 401 tự đăng xuất. */

const TOKEN_KEY = "nvr_token";

export const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = auth.getToken();
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(`/api${path}`, { ...opts, headers });

  if (resp.status === 401) {
    auth.clear();
    window.location.href = "/login";
    throw new ApiError(401, "Phiên đăng nhập hết hạn");
  }
  if (!resp.ok) {
    let detail = `Lỗi ${resp.status}`;
    try {
      const body = await resp.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* ignore */
    }
    throw new ApiError(resp.status, detail);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** URL go2rtc để lấy stream live — đi qua proxy /go2rtc của backend
 * (cùng origin với app nên không bị CORS; dev dùng proxy của Vite). */
export function go2rtcBase(_systemGo2rtcUrl?: string): string {
  const envUrl = import.meta.env.VITE_GO2RTC_URL as string | undefined;
  if (envUrl) return envUrl;
  return "/go2rtc";
}
