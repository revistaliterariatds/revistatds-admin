// ediciones.ts — vista de Ediciones: cerrar/abrir el ciclo de recepción (COORDINADOR/WEBMASTER).
// Las fechas de apertura y cierre se eligen siempre; el backend valida que no se superpongan.

import { api, getUser, getIdToken } from './api';
import { esc, esAdmin, renderNav } from './ui';

interface Edicion {
  numero: string;
  estado: string;
  fecha_apertura: string;
  fecha_cierre: string;
}

const user = getUser();

let ediciones: Edicion[] = [];

// ── caché local (stale-while-revalidate) ──
const EDICIONES_CACHE_KEY = 'tds-ediciones-cache-v1';

function readCachedEdiciones(): Edicion[] | null {
  try { return JSON.parse(localStorage.getItem(EDICIONES_CACHE_KEY) || 'null'); } catch { return null; }
}

function saveCachedEdiciones(list: Edicion[]) {
  try { localStorage.setItem(EDICIONES_CACHE_KEY, JSON.stringify(list)); } catch { /* sin caché local */ }
}

function clearCachedEdiciones() {
  try { localStorage.removeItem(EDICIONES_CACHE_KEY); } catch { /* sin caché local */ }
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
        ${!abierta ? `<button type="button" class="btn-enviar" data-accion="editar-cierre" data-numero="${esc(e.numero)}">Modificar cierre / reabrir</button>` : ''}
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
  lista.querySelectorAll('[data-accion="editar-cierre"]').forEach((btn) => {
    btn.addEventListener('click', () => abrirDialogoEditarCierre((btn as HTMLElement).dataset.numero || ''));
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
    modal.close();
    const r = await mutarEdicion('panel/ediciones/cerrar', { numero, fecha_cierre: fecha }, () => {
      const e = ediciones.find((x) => x.numero === numero);
      if (e) { e.fecha_cierre = fecha; e.estado = 'cerrada'; }
      renderLista();
    });
    if (r.status === 'ok') showAlert(r.message || 'Edición cerrada.');
    else showAlert(r.message || 'No se pudo cerrar.', true);
  });
}

function abrirDialogoEditarCierre(numero: string) {
  const modal = document.getElementById('edicionModal') as HTMLDialogElement;
  const content = document.getElementById('edicionModalContent')!;
  const ed = ediciones.find((e) => e.numero === numero);
  content.innerHTML = `
    <h2 class="detail-titulo">Editar edición ${esc(numero)}</h2>
    <p class="config-intro">Modificá la fecha de cierre o dejá la edición abierta de nuevo. No puede superponerse con la fecha de apertura de la edición siguiente.</p>
    <form id="edicion-form" class="cita-form">
      <div class="form-group">
        <label for="edicion-fecha">Fecha de cierre</label>
        <input id="edicion-fecha" type="date" value="${esc(ed?.fecha_cierre || '')}" ${ed?.fecha_apertura ? `min="${esc(ed.fecha_apertura)}"` : ''} />
      </div>
      <div class="detail-acciones">
        <button type="submit" class="btn-enviar">Guardar fecha de cierre</button>
        <button type="button" class="btn-ghost" id="edicion-reabrir">Reabrir (dejar abierta)</button>
        <button type="button" class="btn-ghost" id="edicion-cancelar">Cancelar</button>
      </div>
    </form>`;
  modal.showModal();

  content.querySelector('#edicion-cancelar')?.addEventListener('click', () => modal.close());
  content.querySelector('#edicion-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fecha = (document.getElementById('edicion-fecha') as HTMLInputElement).value;
    if (!fecha) { showAlert('Elegí una fecha de cierre.', true); return; }
    modal.close();
    const r = await mutarEdicion('panel/ediciones/editar-cierre', { numero, fecha_cierre: fecha }, () => {
      const x = ediciones.find((y) => y.numero === numero);
      if (x) { x.fecha_cierre = fecha; x.estado = 'cerrada'; }
      renderLista();
    });
    if (r.status === 'ok') showAlert(r.message || 'Cierre actualizado.');
    else showAlert(r.message || 'No se pudo actualizar.', true);
  });
  content.querySelector('#edicion-reabrir')?.addEventListener('click', async () => {
    if (!confirm('¿Reabrir la edición ' + numero + '? Quedará abierta, sin fecha de cierre.')) return;
    modal.close();
    const r = await mutarEdicion('panel/ediciones/editar-cierre', { numero, fecha_cierre: '' }, () => {
      const x = ediciones.find((y) => y.numero === numero);
      if (x) { x.fecha_cierre = ''; x.estado = 'abierta'; }
      renderLista();
    });
    if (r.status === 'ok') showAlert(r.message || 'Edición reabierta.');
    else showAlert(r.message || 'No se pudo reabrir.', true);
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
    modal.close();
    const r = await mutarEdicion('panel/ediciones/abrir', { fecha_apertura: fecha }, () => { /* el número lo asigna el backend */ });
    if (r.status === 'ok') showAlert(r.message || 'Edición abierta.');
    else showAlert(r.message || 'No se pudo abrir.', true);
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

// Mutación con feedback optimista: invalida la caché, aplica el cambio local
// al instante y re-sincroniza con el servidor (revierte si falla).
async function mutarEdicion(accion: string, body: Record<string, unknown>, aplicar: () => void) {
  clearCachedEdiciones();
  aplicar();
  const r = await api(accion, body);
  await cargar();
  return r;
}

async function cargar() {
  hideAlert();
  const cached = readCachedEdiciones();
  if (cached) { ediciones = cached; renderLista(); }
  const data = await api('panel/ediciones/list');
  if (data.status !== 'ok') { if (!cached) showAlert(data.message || 'No se pudo cargar.', true); return; }
  ediciones = data.ediciones || [];
  renderLista();
  saveCachedEdiciones(ediciones);
}

function init() {
  if (!user || !getIdToken() || !esAdmin) { window.location.replace('/tablero/'); return; }
  renderNav(user);
  document.getElementById('btn-cerrar-edicion-modal')?.addEventListener('click', () => {
    (document.getElementById('edicionModal') as HTMLDialogElement).close();
  });
  document.getElementById('ediciones-refrescar')?.addEventListener('click', cargar);
  cargar();
}

init();