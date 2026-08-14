// ediciones.ts — vista de Ediciones: cerrar/abrir el ciclo de recepción (ADMIN/WEBMASTER).
// Las fechas de apertura y cierre se eligen siempre; el backend valida que no se superpongan.

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

function hoyInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  const botonAbrir = `
    <div class="edicion-card">
      <div>
        <span class="edicion-numero">Abrir nueva edición</span>
        <div class="edicion-datos">Elegís la fecha de apertura. La nueva edición queda sin fecha de cierre, que se define al cerrarla.</div>
      </div>
      <div class="edicion-acciones">
        <button type="button" class="btn-enviar" data-accion="abrir">Abrir edición</button>
      </div>
    </div>`;

  lista.innerHTML = botonAbrir + items;

  lista.querySelectorAll('[data-accion="cerrar"]').forEach((btn) => {
    btn.addEventListener('click', () => abrirDialogoCerrar((btn as HTMLElement).dataset.numero || ''));
  });
  lista.querySelectorAll('[data-accion="abrir"]').forEach((btn) => {
    btn.addEventListener('click', () => abrirDialogoAbrir());
  });
}

// ── diálogo: elegir fecha y confirmar ──
function abrirDialogoCerrar(numero: string) {
  const modal = document.getElementById('edicionModal') as HTMLDialogElement;
  const content = document.getElementById('edicionModalContent')!;
  const ed = ediciones.find((e) => e.numero === numero);
  content.innerHTML = `
    <h2 class="detail-titulo">Cerrar edición ${esc(numero)}</h2>
    <p class="config-intro">Elegí la fecha de cierre de la recepción.</p>
    <form id="edicion-form" class="cita-form">
      <div class="form-group">
        <label for="edicion-fecha">Fecha de cierre</label>
        <input id="edicion-fecha" type="date" required value="${hoyInput()}" ${ed?.fecha_apertura ? `min="${esc(ed.fecha_apertura)}"` : ''} />
      </div>
      <div class="detail-acciones">
        <button type="submit" class="btn-enviar">Cerrar edición</button>
        <button type="button" class="btn-ghost" id="edicion-cancelar">Cancelar</button>
      </div>
    </form>`;
  modal.showModal();
  bindFormulario(modal, async (fecha) => {
    const data = await api('panel/ediciones/cerrar', { numero, fecha_cierre: fecha });
    if (data.status === 'ok') { modal.close(); showAlert(data.message || 'Edición cerrada.'); await cargar(); }
    else showAlert(data.message || 'No se pudo cerrar.', true);
  });
}

function abrirDialogoAbrir() {
  const modal = document.getElementById('edicionModal') as HTMLDialogElement;
  const content = document.getElementById('edicionModalContent')!;
  content.innerHTML = `
    <h2 class="detail-titulo">Abrir nueva edición</h2>
    <p class="config-intro">Elegí la fecha de apertura. La edición queda sin fecha de cierre (la definís al cerrarla).</p>
    <form id="edicion-form" class="cita-form">
      <div class="form-group">
        <label for="edicion-fecha">Fecha de apertura</label>
        <input id="edicion-fecha" type="date" required value="${hoyInput()}" />
      </div>
      <div class="detail-acciones">
        <button type="submit" class="btn-enviar">Abrir edición</button>
        <button type="button" class="btn-ghost" id="edicion-cancelar">Cancelar</button>
      </div>
    </form>`;
  modal.showModal();
  bindFormulario(modal, async (fecha) => {
    const data = await api('panel/ediciones/abrir', { fecha_apertura: fecha });
    if (data.status === 'ok') { modal.close(); showAlert(data.message || 'Edición abierta.'); await cargar(); }
    else showAlert(data.message || 'No se pudo abrir.', true);
  });
}

function bindFormulario(modal: HTMLDialogElement, onConfirm: (fecha: string) => Promise<void>) {
  const content = document.getElementById('edicionModalContent')!;
  content.querySelector('#edicion-cancelar')?.addEventListener('click', () => modal.close());
  content.querySelector('#edicion-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fecha = (document.getElementById('edicion-fecha') as HTMLInputElement).value;
    if (!fecha) { showAlert('Elegí una fecha.', true); return; }
    await onConfirm(fecha);
  });
}

async function cargar() {
  hideAlert();
  const data = await api('panel/ediciones/list');
  if (data.status !== 'ok') { showAlert(data.message || 'No se pudo cargar.', true); return; }
  ediciones = data.ediciones || [];
  renderLista();
}

function init() {
  if (!user || !getIdToken() || !esAdmin) { window.location.replace('/tablero/'); return; }
  renderNav();
  document.getElementById('btn-cerrar-edicion-modal')?.addEventListener('click', () => {
    (document.getElementById('edicionModal') as HTMLDialogElement).close();
  });
  document.getElementById('ediciones-refrescar')?.addEventListener('click', cargar);
  cargar();
}

init();