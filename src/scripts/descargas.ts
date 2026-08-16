import { api, clearSession, getIdToken, getUser } from './api';

const user = getUser();
const esGestor = user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';
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

function render(rows: Fila[], acciones: Acciones, total: number, totalHistorico: number) {
  document.getElementById('kpi-total-descargas')!.textContent = total.toLocaleString('es-AR');
  document.getElementById('kpi-leer')!.textContent = (acciones?.leer || 0).toLocaleString('es-AR');
  document.getElementById('kpi-descargar')!.textContent = (acciones?.descargar || 0).toLocaleString('es-AR');
  document.getElementById('kpi-historico-descargas')!.textContent = totalHistorico.toLocaleString('es-AR');

  const body = document.getElementById('descargas-body')!;
  const empty = document.getElementById('descargas-empty')!;
  empty.hidden = rows.length > 0;
  body.innerHTML = rows.map((row) => `<tr>
    <td data-label="Edición">${esc(row.archivo)}</td>
    <td data-label="Total de clics">${row.total.toLocaleString('es-AR')}</td>
  </tr>`).join('');
}

// Caché local por rango de días (stale-while-revalidate): sin mutaciones,
// solo sirve para pintar al instante al volver a la pestaña.
function cacheKey(days: number | string): string {
  return 'tds-descargas-cache-' + days;
}

function readCached(days: number | string): { porArchivo: Fila[]; acciones: Acciones; total: number; totalHistorico: number } | null {
  try { return JSON.parse(localStorage.getItem(cacheKey(days)) || 'null'); } catch { return null; }
}

function saveCached(days: number | string, value: { porArchivo: Fila[]; acciones: Acciones; total: number; totalHistorico: number }) {
  try { localStorage.setItem(cacheKey(days), JSON.stringify(value)); } catch { /* sin caché local */ }
}

async function load() {
  const selected = (document.getElementById('descargas-days') as HTMLSelectElement).value;
  const days: number | string = selected === 'all' ? 'all' : Number(selected);
  const cached = readCached(days);
  if (cached) render(cached.porArchivo, cached.acciones, cached.total, cached.totalHistorico);
  const data = await api('panel/descargas/list', { days });
  if (data.status !== 'ok') { if (!cached) showAlert(data.message || 'No se pudieron cargar las descargas.'); return; }
  const resultado = {
    porArchivo: data.porArchivo || [],
    acciones: data.acciones || {},
    total: Number(data.total || 0),
    totalHistorico: Number(data.total_historico || 0),
  };
  render(resultado.porArchivo, resultado.acciones, resultado.total, resultado.totalHistorico);
  saveCached(days, resultado);
}

function init() {
  if (!user || !getIdToken() || !esGestor) { window.location.replace('/tablero/'); return; }
  renderNav();
  document.getElementById('descargas-days')?.addEventListener('change', load);
  load();
}

init();
