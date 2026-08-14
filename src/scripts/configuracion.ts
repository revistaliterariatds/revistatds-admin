import { api, clearSession, getIdToken, getUser } from './api';

const user = getUser();
const esGestor = user?.rol === 'ADMINISTRADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';

function renderNav() {
  const nav = document.getElementById('nav-user');
  if (!nav || !user) return;
  nav.hidden = false;
  document.getElementById('nav-user-name')!.textContent = user.nombre || user.email;
  document.getElementById('nav-user-role')!.textContent = user.rol;
  (document.getElementById('nav-users') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-config') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-analytics') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-descargas') as HTMLElement).hidden = !esGestor;
  document.getElementById('nav-logout')?.addEventListener('click', () => { clearSession(); window.location.replace('/'); });
}

function showAlert(message: string, error = false) {
  const el = document.getElementById('config-alert')!;
  el.hidden = false;
  el.className = `status-card${error ? ' error' : ''}`;
  el.textContent = message;
}

const CONFIG_CACHE_KEY = 'tds-config-cache-v1';

function fillForm(config: Record<string, string>) {
  (document.getElementById('config-expira') as HTMLInputElement).value = config.expira_token_dias || '30';
  (document.getElementById('config-site') as HTMLInputElement).value = config.site_base_url || '';
  const subjects = ['confirmation', 'correcciones', 'revision', 'consulta', 'version', 'devolucion'];
  subjects.forEach((key) => {
    (document.getElementById(`mail-subject-${key}`) as HTMLInputElement).value = config[`mail_subject_${key}`] || '';
  });
  (document.getElementById('config-form') as HTMLFormElement).hidden = false;
}

function readCachedConfig(): Record<string, string> | null {
  try { return JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) || 'null'); } catch { return null; }
}

async function load() {
  const cached = readCachedConfig();
  if (cached) fillForm(cached);
  const data = await api('panel/config/list');
  if (data.status !== 'ok') {
    if (!cached) showAlert(data.message || 'No se pudo cargar la configuración.', true);
    return;
  }
  const config = data.config || {};
  try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config)); } catch { /* sin caché local */ }
  fillForm(config);
}

async function save(key: string, value: string) {
  const data = await api('panel/config/save', { key, value });
  if (data.status !== 'ok') throw new Error(data.message || 'No se pudo guardar.');
}

async function submit(event: SubmitEvent) {
  event.preventDefault();
  try {
    await save('expira_token_dias', (document.getElementById('config-expira') as HTMLInputElement).value);
    await save('site_base_url', (document.getElementById('config-site') as HTMLInputElement).value);
    const subjects = ['confirmation', 'correcciones', 'revision', 'consulta', 'version', 'devolucion'];
    for (const key of subjects) {
      await save(`mail_subject_${key}`, (document.getElementById(`mail-subject-${key}`) as HTMLInputElement).value);
    }
    try { localStorage.removeItem(CONFIG_CACHE_KEY); } catch { /* sin caché local */ }
    showAlert('Configuración guardada.');
  } catch (error) { showAlert(error instanceof Error ? error.message : 'No se pudo guardar.', true); }
}

function init() {
  if (!user || !getIdToken() || !esGestor) { window.location.replace('/tablero/'); return; }
  renderNav();
  document.getElementById('config-form')?.addEventListener('submit', submit);
  load();
}

init();
