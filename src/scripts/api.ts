// api.ts — helpers compartidos de sesión y llamadas a PanelTDS.

export const APPS_SCRIPT_URL = import.meta.env.PUBLIC_APPS_SCRIPT_URL;

export interface Usuario {
  email: string;
  rol: string;
  nombre: string;
}

export function getIdToken(): string | null {
  return sessionStorage.getItem('tds_idToken');
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
}

export function clearSession() {
  sessionStorage.removeItem('tds_idToken');
  sessionStorage.removeItem('tds_user');
}

// Llamada a la API: el idToken de sesión va en el body (evita preflight CORS).
export async function api(action: string, body: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, ...body, idToken: getIdToken() ?? undefined }),
  });
  return res.json();
}
