// ediciones.ts — vista de Ediciones: cerrar/abrir el ciclo de recepción (ADMIN/WEBMASTER).

import { api, clearSession, getUser, getIdToken } from './api';

interface Edicion {
  numero: string;
  estado: string;
  fecha_apertura: string;
  fecha_cierre: string;
}

const user = getUser();
const esAdmin = user?.rol === 'ADMINISTRADOR' || user?.rol === 'WEBMASTER';

let ediciones: Edicion[] = [];
let actual = '';

function renderNav() {
  const navUser = document.getElementById('nav-user');
  if (!navUser || !user) return;
  const esGestor = user.rol === 'ADMINISTRADOR' || user.rol === 'WEBMASTER' || user.rol === 'SUPERVISOR';
  navUser.hidden = false;
  document.getElementById('nav-user-name')!.textContent = user.nombre || user.email;
  document.getElementById('nav-user-role')!.textContent = user.rol;
  (document.getElementById('nav-users') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-config') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-analytics') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-descargas') as HTMLElement).hidden = !esGestor;
  document.getElementById('nav-logout')?.addEventListener('click', () => { clearSession(); window.location.replace('/'); });
}

function showAlert(message: string, error = false) {
  const el = document.getElementById('ediciones-alert')!;
  el.hidden = false;
  el.className = `status-card${error ? ' error' : ''}`;
  el.textContent = message;
}

function hideAlert() {
  document.getElementById('ediciones-alert')!.hidden = true;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function fmtFecha(key: string): string {
  if (!key) return '—';
  const p = key.split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderLista() {
  const lista = document.getElementById('ediciones-list')!;
  if (ediciones.length === 0) {
    lista.innerHTML = '<div class="board-empty">Todavía no hay ediciones registradas.</div>';
    return;
  }

  const items = [...ediciones].reverse().map((e) => {
    const abierta = e.estado === 'abierta';
    return `
    <div class="edicion-card${abierta ? ' edicion-abierta' : ''}">
      <div>
        <span class="edicion-numero">Edición ${esc(e.numero)}</span>
        <span class="badge ${abierta ? 'badge-orange' : 'badge-grey'} edicion-estado">${abierta ? 'Abierta' : 'Cerrada'}</span>
        <div class="edicion-datos">
          Apertura: ${fmtFecha(e.fecha_apertura)}
          ${e.fecha_cierre ? ' · Cierre: ' + fmtFecha(e.fecha_cierre) : ''}
        </div>
      </div>
      <div class="edicion-acciones">
        ${abierta ? `<button type="button" class="btn-enviar" data-accion="cerrar" data-numero="${esc(e.numero)}">Cerrar edición</button>` : ''}
      </div>
    </div>`;
  }).join('');

  const ultima = ediciones[ediciones.length - 1];
  const ultimaCerrada = ultima && ultima.estado === 'cerrada' && !!ultima.fecha_cierre;
  const botonAbrir = `
    <div class="edicion-card">
      <div>
        <span class="edicion-numero">Abrir nueva edición</span>
        <div class="edicion-datos">Requisito: la edición actual debe estar cerrada y debe ser al menos el día siguiente calendario a su fecha de cierre.</div>
      </div>
      <div class="edicion-acciones">
        <button type="button" class="btn-enviar" data-accion="abrir" ${ultimaCerrada && !actual ? '' : 'disabled title="La edición actual aún no está cerrada (o el día de cierre es hoy)."'}>Abrir edición</button>
      </div>
    </div>`;

  lista.innerHTML = botonAbrir + items;

  lista.querySelectorAll('[data-accion="cerrar"]').forEach((btn) => {
    btn.addEventListener('click', () => cerrar((btn as HTMLElement).dataset.numero || ''));
  });
  lista.querySelectorAll('[data-accion="abrir"]').forEach((btn) => {
    btn.addEventListener('click', () => abrir());
  });
}

async function cargar() {
  hideAlert();
  const data = await api('panel/ediciones/list');
  if (data.status !== 'ok') { showAlert(data.message || 'No se pudo cargar.', true); return; }
  ediciones = data.ediciones || [];
  actual = data.actual || '';
  renderLista();
}

async function cerrar(numero: string) {
  if (!confirm(`¿Cerrar la recepción de la edición ${numero}? Se registrará la fecha de cierre de hoy.`)) return;
  const data = await api('panel/ediciones/cerrar', { numero });
  if (data.status === 'ok') { showAlert(data.message || 'Edición cerrada.'); await cargar(); }
  else showAlert(data.message || 'No se pudo cerrar.', true);
}

async function abrir() {
  const data = await api('panel/ediciones/abrir');
  if (data.status === 'ok') { showAlert(data.message || 'Edición abierta.'); await cargar(); }
  else showAlert(data.message || 'No se pudo abrir.', true);
}

function init() {
  if (!user || !getIdToken() || !esAdmin) { window.location.replace('/tablero/'); return; }
  renderNav();
  document.getElementById('ediciones-refrescar')?.addEventListener('click', cargar);
  cargar();
}

init();