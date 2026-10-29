const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001/api';
let accessToken = '';
let refreshRequest: Promise<boolean> | undefined;
let deviceId = localStorage.getItem('auralis-device');
if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem('auralis-device', deviceId); }
export const device = deviceId;
export function setAccessToken(token: string) { accessToken = token; }
export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init.headers },
  });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const renewed = await refresh();
    if (renewed) return api<T>(path, init, false);
  }
  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as { message?: string; error?: string | { message?: string } } | null;
    const message = error?.message ?? (typeof error?.error === 'string' ? error.error : error?.error?.message);
    throw new Error(message ?? `Сервер вернул ошибку ${response.status}`);
  }
  return data as T;
}
export function refresh(): Promise<boolean> {
  // Coalesce simultaneous 401s and React development remounts: a rotating refresh
  // token must be used only once by this tab at a time.
  if (refreshRequest) return refreshRequest;
  refreshRequest = (async () => {
    try {
      const result = await api<{ accessToken: string }>('/auth/refresh', { method: 'POST', body: JSON.stringify({ deviceId: device }) }, false);
      setAccessToken(result.accessToken);
      return true;
    } catch { setAccessToken(''); return false; }
    finally { refreshRequest = undefined; }
  })();
  return refreshRequest;
}
export function assetUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${base.replace(/\/api\/?$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

let verification: { token: string; promise: Promise<unknown> } | undefined;
export function verifyEmail(token: string) {
  if (verification?.token !== token) verification = { token, promise: api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }) };
  return verification.promise;
}
