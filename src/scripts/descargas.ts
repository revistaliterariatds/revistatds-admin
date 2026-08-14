import { api, clearSession, getIdToken, getUser } from './api';

const user = getUser();
const esGestor = user?.rol === 'ADMINISTRADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';
type Fila = { archivo: string; total: number };
type Acciones = { leer: number; descargar: number };

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

function showAlert(message: string) {
  const el = document.getElementById('descargas-alert')!;
  el.hidden = false;
  el.textContent = message;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function render(rows: Fila[], acciones: Acciones, total: number) {
  document.getElementById('kpi-total-descargas')!.textContent = total.toLocaleString('es-AR');
  document.getElementById('kpi-leer')!.textContent = (acciones?.leer || 0).toLocaleString('es-AR');
  document.getElementById('kpi-descargar')!.textContent = (acciones?.descargar || 0).toLocaleString('es-AR');

  const body = document.getElementById('descargas-body')!;
  const empty = document.getElementById('descargas-empty')!;
  empty.hidden = rows.length > 0;
  body.innerHTML = rows.map((row) => `<tr>
    <td data-label="Edición">${esc(row.archivo)}</td>
    <td data-label="Total de clics">${row.total.toLocaleString('es-AR')}</td>
  </tr>`).join('');
}

async function load() {
  const selected = (document.getElementById('descargas-days') as HTMLSelectElement).value;
  const days: number | string = selected === 'all' ? 'all' : Number(selected);
  const data = await api('panel/descargas/list', { days });
  if (data.status !== 'ok') { showAlert(data.message || 'No se pudieron cargar las descargas.'); return; }
  render(data.porArchivo || [], data.acciones || {}, Number(data.total || 0));
}

function init() {
  if (!user || !getIdToken() || !esGestor) { window.location.replace('/tablero/'); return; }
  renderNav();
  document.getElementById('descargas-days')?.addEventListener('change', load);
  load();
}

init();
