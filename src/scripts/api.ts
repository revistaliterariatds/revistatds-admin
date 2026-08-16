// api.ts — helpers compartidos de sesión y llamadas a PanelTDS.

export const APPS_SCRIPT_URL = import.meta.env.PUBLIC_APPS_SCRIPT_URL;

let expiryTimer: number | undefined;

export interface Usuario {
  email: string;
  rol: string;
  nombre: string;
}

export function getIdToken(): string | null {
  return sessionStorage.getItem('tds_idToken');
}

function tokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

function redirectToLogin() {
  clearSession();
  if (window.location.pathname !== '/') window.location.replace('/');
}

function scheduleExpiry(token: string | null) {
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  if (!token) return;
  const exp = tokenExp(token);
  if (!exp) return;
  const delay = exp * 1000 - Date.now();
  expiryTimer = window.setTimeout(redirectToLogin, Math.max(0, delay));
}

export function getUser(): Usuario | null {
  const raw = sessionStorage.getItem('tds_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Usuario;
  } catch {
    return null;
  }
}

export function setSession(idToken: string, user: Usuario) {
  sessionStorage.setItem('tds_idToken', idToken);
  sessionStorage.setItem('tds_user', JSON.stringify(user));
  scheduleExpiry(idToken);
}

export function clearSession() {
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  sessionStorage.removeItem('tds_idToken');
  sessionStorage.removeItem('tds_user');
}

// Deshabilita un botón y muestra "Guardando…" mientras corre una acción,
// y restaura su texto original al terminar (o al fallar).
export function btnCargando(btn: HTMLElement | null, on: boolean, texto = 'Guardando…') {
  if (!(btn instanceof HTMLButtonElement)) return;
  if (on) {
    btn.dataset.textoOriginal = btn.textContent || '';
    btn.disabled = true;
    btn.textContent = texto;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.textoOriginal || '';
  }
}

// Llamada a la API: el idToken de sesión va en el body (evita preflight CORS).
export async function api(action: string, body: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, ...body, idToken: getIdToken() ?? undefined }),
  });
  const json = await res.json();
  if (res.status === 401 || res.status === 403 || json.code === 'AuthError') {
    redirectToLogin();
  }
  return json;
}

scheduleExpiry(getIdToken());
