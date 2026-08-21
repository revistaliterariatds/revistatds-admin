// Login con Google Identity Services (popup) + perfil de Google.
// Al autenticar, guarda la sesión y redirige al tablero.

import { setSession, decodeJwtPayload } from './api';
import { esc } from './ui';
import { saveCachedBoard } from './tablero-cache';

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

async function showIdentity(payload: GoogleIdTokenPayload, idToken: string) {
  const email = payload.email ?? 'email desconocido';
  const name = payload.name ?? '';
  const safeEmail = esc(email);

  const navUser = document.getElementById('nav-user');
  const navName = document.getElementById('nav-user-name');
  const navRole = document.getElementById('nav-user-role');
  if (navUser && navName) {
    navUser.hidden = false;
    navName.textContent = name || email;
  }
  if (navRole) navRole.textContent = 'sesión iniciada';

  document.getElementById('login-button')?.setAttribute('hidden', '');

  const who = await fetchWhoami(idToken);
  const rol = who.ok ? (who.rol ?? null) : null;
  if (rol && navRole) navRole.textContent = rol;
  if (!rol && navRole) navRole.textContent = 'sin acceso';

  // Prefiere alias/nombre real de whoami; si coincide con el email, usa el
  // nombre del perfil de Google; si tampoco hay, no duplica el email.
  const whoName = who.ok ? (who.nombre || '') : '';
  const displayName = (whoName && whoName !== email) ? whoName : name;
  const safeDisplayName = esc(displayName);
  const safeRole = rol ? esc(rol) : '';
  const safeMessage = esc(who.message || 'desconocido');
  const roleHtml = rol
    ? `<span class="role">${safeRole}</span>`
    : `<span class="role">error: ${safeMessage}</span>`;

  const greet = displayName && displayName !== email
    ? `Hola <strong>${safeDisplayName}</strong> · ${safeEmail}`
    : `Hola ${safeEmail}`;

  if (rol) {
    setSession(idToken, { email, rol, nombre: displayName || name || email });
    setStatus('ok', `<p class="email">${greet}</p> <span class="role">${safeRole}</span> <p class="email">Cargando tu tablero…</p>`);
    // Precarga en paralelo con la redirección: si llega a tiempo (backend
    // tibio), el tablero pinta al instante; si no, corta por LIMITE_MS y el
    // tablero carga con su estado "Cargando producciones…" como fallback.
    await Promise.race([
      precargarTablero(idToken, rol).catch(() => {}),
      new Promise((r) => setTimeout(r, PRECARGA_LIMITE_MS)),
    ]);
    window.location.href = '/tablero/';
    return;
  }

  setStatus(
    'error',
    `<p class="email">${greet}</p>
     ${roleHtml}`,
  );
}

interface WhoamiResult {
  ok: boolean;
  rol?: string;
  nombre?: string;
  message?: string;
}

// ── precarga del tablero desde la pantalla de login ──
// Dispara las mismas llamadas que hará /tablero/ y escribe su caché local:
// al llegar, los datos ya están pintados y solo queda revalidar. Si el
// backend está frío y tarda más de LIMITE_MS, se redirige igual (el tablero
// muestra su estado de carga y trae los datos como siempre).
const PRECARGA_LIMITE_MS = 800;

async function llamarPanel(action: string, idToken: string): Promise<Record<string, any>> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, idToken }),
  });
  return res.json();
}

async function precargarTablero(idToken: string, rol: string): Promise<void> {
  const gestor = ['COORDINADOR', 'WEBMASTER', 'SUPERVISOR'].includes(rol);
  const [board, eds, ediciones] = await Promise.all([
    llamarPanel('panel/board/list', idToken),
    gestor ? llamarPanel('panel/board/editors', idToken) : Promise.resolve({ status: 'ok', editores: [] }),
    gestor ? llamarPanel('panel/ediciones/list', idToken) : Promise.resolve({ status: 'ok', ediciones: [] }),
  ]);
  if (!board || board.status !== 'ok') return; // sin caché → el tablero carga normal
  saveCachedBoard({
    producciones: board.producciones || [],
    editores: eds.editores || [],
    ediciones: ediciones.ediciones || [],
  });
}

// POST a panel/auth/whoami. El `action` va en el body (no en el path):
// agregar path a la URL de GAS rompe CORS (ver Code.gs).
async function fetchWhoami(idToken: string): Promise<WhoamiResult> {  if (!APPS_SCRIPT_URL) return { ok: false, message: 'falta PUBLIC_APPS_SCRIPT_URL' };
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'panel/auth/whoami', idToken }),
    });
    const json = await res.json();
    if (json.status === 'ok') return { ok: true, rol: json.rol, nombre: json.nombre };
    return { ok: false, message: json.message || `error ${res.status}` };
  } catch {
    return { ok: false, message: 'no se pudo contactar el backend (red/CORS)' };
  }
}

async function handleCredential(response: GoogleCredentialResponse) {
  const payload = decodeJwtPayload(response.credential) as GoogleIdTokenPayload | null;
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
  await showIdentity(payload, response.credential);
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
    use_fedcm_for_prompt: false, // evita el flujo FedCM que Chrome puede bloquear
  });

  const btn = document.getElementById('login-button');
  btn?.addEventListener('click', () => google.accounts.id.prompt());
}

initLogin();
