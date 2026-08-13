// Login con Google Identity Services (popup) + perfil de Google.
// Fase 1: de-risking de autenticación — muestra "hola <email> <nombre>".
// El rol viene de `panel/auth/whoami` (backend GAS), se cablea en Fase 1 avanzada.

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdTokenPayload {
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  sub?: string;
  exp?: number;
}

const CLIENT_ID = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID;
const APPS_SCRIPT_URL = import.meta.env.PUBLIC_APPS_SCRIPT_URL;

function decodeIdToken(token: string): GoogleIdTokenPayload | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    return JSON.parse(json) as GoogleIdTokenPayload;
  } catch {
    return null;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

function setStatus(kind: 'ok' | 'error', html: string) {
  const card = document.getElementById('status-card');
  if (!card) return;
  card.hidden = false;
  card.classList.toggle('error', kind === 'error');
  card.innerHTML = html;
}

function showIdentity(payload: GoogleIdTokenPayload, idToken: string) {
  const email = payload.email ?? 'email desconocido';
  const name = payload.name ?? '';

  const navUser = document.getElementById('nav-user');
  const navName = document.getElementById('nav-user-name');
  const navRole = document.getElementById('nav-user-role');
  if (navUser && navName) {
    navUser.hidden = false;
    navName.textContent = name || email;
  }
  if (navRole) navRole.textContent = 'sesión iniciada';

  document.getElementById('login-button')?.setAttribute('hidden', '');

  setStatus(
    'ok',
    `<p class="email">Hola ${name ? `<strong>${name}</strong> · ` : ''}${email}</p>
     <span class="role">pendiente rol (whoami)</span>`,
  );

  // TODO (Fase 1): llamar a `panel/auth/whoami` con Authorization: Bearer <idToken>
  // y mostrar el rol devuelto (ADMINISTRADOR/SUPERVISOR/EDITOR) o un 403.
  console.debug('[login] ID token recibido; APPS_SCRIPT_URL =', APPS_SCRIPT_URL || '(no configurado)');
}

async function handleCredential(response: GoogleCredentialResponse) {
  const payload = decodeIdToken(response.credential);
  if (!payload) {
    setStatus('error', '<p class="email">No se pudo leer el ID token.</p>');
    return;
  }
  if (!payload.email_verified) {
    setStatus('error', '<p class="email">El email no está verificado.</p>');
    return;
  }
  if (!payload.email?.toLowerCase().endsWith('@gmail.com')) {
    setStatus('error', '<p class="email">Solo se permiten cuentas @gmail.com.</p>');
    return;
  }
  showIdentity(payload, response.credential);
}

async function initLogin() {
  if (!CLIENT_ID) {
    setStatus(
      'error',
      '<p class="email">Falta <code>PUBLIC_GOOGLE_CLIENT_ID</code> (ver <code>.env.example</code>).</p>',
    );
    return;
  }

  try {
    await loadScript('https://accounts.google.com/gsi/client');
  } catch {
    setStatus('error', '<p class="email">No se pudo cargar Google Identity Services.</p>');
    return;
  }

  const google = (window as unknown as { google?: { accounts: { id: {
    initialize: (cfg: unknown) => void;
    prompt: () => void;
  } } } }).google;

  if (!google?.accounts?.id) {
    setStatus('error', '<p class="email">Google Identity Services no disponible.</p>');
    return;
  }

  google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: handleCredential,
    ux_mode: 'popup',
  });

  const btn = document.getElementById('login-button');
  btn?.addEventListener('click', () => google.accounts.id.prompt());
}

initLogin();
