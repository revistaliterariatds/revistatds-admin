// tablero.ts — vista del tablero editorial (Fase 3).

import { api, getUser, getIdToken } from './api';
import { esc, esGestor, esAdmin, renderNav, confirmar } from './ui';
import { abrirDetalle } from './tablero-detalle';

export interface Produccion {
  id: string;
  titulo: string;
  autor: string;
  email_autor: string;
  edad: string;
  categoria: string;
  estado: string;
  editor_asignado: string;
  url_carpeta_drive: string;
  url_doc_correccion: string;
  version_actual: string;
  convocatoria: string;
  edicion: string;
  url_publicable: string;
  fecha_recibido: string;
  enviado_autor: boolean;
  titular: string;
  accion_autor: string;
  accion_autor_fecha: string;
  accion_autor_detalle: string;
}

export const ESTADOS: Record<string, { label: string; color: string }> = {
  'RECIBIDO': { label: 'Recibido', color: 'grey' },
  'PRESELECCIONADO': { label: 'Preseleccionado', color: 'blue' },
  'EN_REVISIÓN': { label: 'En revisión', color: 'orange' },
  'CORRECCIONES_SOLICITADAS': { label: 'Correcciones', color: 'orange' },
  'ESPERANDO_APROBACIÓN': { label: 'En aprobación', color: 'orange' },
  'CONSULTA_AUTOR': { label: 'Consulta autor', color: 'orange' },
  'APROBADO': { label: 'Aprobado', color: 'green' },
  'PUBLICADO': { label: 'Publicable', color: 'green' },
  'RECHAZADO_POR_AUTOR': { label: 'Rechazado', color: 'red' },
  'DESCARTADO': { label: 'Descartado', color: 'grey' },
};

let producciones: Produccion[] = [];
let estadoActivo = 'TODOS';
let convocatoriaActiva = 'TODAS';
let edicionActiva = 'TODAS';
let termino = '';
let editores: { email: string; nombre: string }[] = [];
let ediciones: { numero: string; estado: string }[] = [];

// ── caché local (stale-while-revalidate) ──
// Guarda la última respuesta del tablero para pintar al instante al entrar
// y refrescar en segundo plano; se invalida en cada mutación.
const BOARD_CACHE_KEY = 'tds-board-cache-v1';

function readCachedBoard(): { producciones: Produccion[]; editores: { email: string; nombre: string }[]; ediciones: { numero: string; estado: string }[] } | null {
  try { return JSON.parse(localStorage.getItem(BOARD_CACHE_KEY) || 'null'); } catch { return null; }
}

function saveCachedBoard(cache: { producciones: Produccion[]; editores: { email: string; nombre: string }[]; ediciones: { numero: string; estado: string }[] }) {
  try { localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify(cache)); } catch { /* sin caché local */ }
}

function clearCachedBoard() {
  try { localStorage.removeItem(BOARD_CACHE_KEY); } catch { /* sin caché local */ }
}

// ── sesión ──
const user = getUser();

// Accesos para tablero-detalle.ts (los bindings importados son de solo lectura).
export function getEdiciones(): { numero: string; estado: string }[] { return ediciones; }
export function buscarProduccion(id: string): Produccion | undefined {
  return producciones.find((p) => p.id === id);
}
export function quitarProduccion(id: string) {
  producciones = producciones.filter((p) => p.id !== id);
}

// ── utilidades ──
export function badge(estado: string): string {
  const info = ESTADOS[estado] || { label: estado, color: 'grey' };
  // El estado puede venir de la hoja (editable a mano): se escapa siempre.
  return `<span class="badge badge-${esc(info.color)}">${esc(info.label)}</span>`;
}

export function fmtRelativa(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const dias = Math.floor(diff / 86400000);
  if (dias <= 0 && now.toDateString() === d.toDateString()) {
    return 'hoy ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  if (dias === 1) return 'ayer';
  if (dias < 7) return 'hace ' + dias + ' días';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export function convocatoriaLabel(c: string): string {
  return c === 'docentes' ? 'Docentes' : 'General';
}

// Última decisión del autor registrada en el tablero (accion_autor).
export function accionAutorInfo(c: Produccion): { label: string; color: string } | null {
  const map: Record<string, { label: string; color: string }> = {
    'APROBADO': { label: 'Autor aprobó', color: 'green' },
    'NO_APROBADO': { label: 'Autor no aprobó', color: 'red' },
    'NUEVA_VERSION': { label: 'Autor subió versión', color: 'blue' },
  };
  const info = c.accion_autor ? map[c.accion_autor] : null;
  return info || null;
}

export function accionAutorBadge(c: Produccion): string {
  const info = accionAutorInfo(c);
  if (!info) return '';
  const fecha = c.accion_autor_fecha ? ' · ' + fmtRelativa(c.accion_autor_fecha) : '';
  const detalle = c.accion_autor_detalle ? ' · ' + esc(c.accion_autor_detalle) : '';
  return `<span class="badge badge-${info.color}" title="${esc('Última decisión del autor')}">${info.label}${fecha}${detalle}</span>`;
}

// ── filtros ──
function renderEstadoSelect() {
  const cont: Record<string, number> = {};
  producciones.forEach((c) => { cont[c.estado] = (cont[c.estado] || 0) + 1; });

  const el = document.getElementById('filtro-estado') as HTMLSelectElement;
  const options = [`<option value="TODOS">Todos los estados (${producciones.length})</option>`];
  Object.keys(ESTADOS).forEach((k) => {
    if (!esGestor && k === 'RECIBIDO') return; // RECIBIDO solo lo ve admin/supervisor
    const n = cont[k] || 0;
    options.push(`<option value="${k}">${esc(ESTADOS[k].label)} (${n})</option>`);
  });
  el.innerHTML = options.join('');
  el.value = estadoActivo;
}

function renderConvocatoriaSelect() {
  const cont: Record<string, number> = {};
  producciones.forEach((c) => { cont[c.convocatoria] = (cont[c.convocatoria] || 0) + 1; });

  const el = document.getElementById('filtro-convocatoria') as HTMLSelectElement;
  const options = [`<option value="TODAS">Todas (${producciones.length})</option>`];
  ['general', 'docentes'].forEach((k) => {
    const n = cont[k] || 0;
    options.push(`<option value="${k}">${esc(convocatoriaLabel(k))} (${n})</option>`);
  });
  el.innerHTML = options.join('');
  el.value = convocatoriaActiva;
}

function renderEdicionSelect() {
  const cont: Record<string, number> = {};
  producciones.forEach((c) => {
    const key = c.edicion ? String(c.edicion) : 'sin-edicion';
    cont[key] = (cont[key] || 0) + 1;
  });

  const el = document.getElementById('filtro-edicion') as HTMLSelectElement;
  const options = [`<option value="TODAS">Todas (${producciones.length})</option>`];
  Object.keys(cont).sort().forEach((k) => {
    const label = k === 'sin-edicion' ? 'Sin edición' : 'Edición ' + k;
    options.push(`<option value="${k}">${esc(label)} (${cont[k]})</option>`);
  });
  el.innerHTML = options.join('');
  el.value = edicionActiva;
}

function visibles(): Produccion[] {
  return producciones.filter((c) => {
    if (estadoActivo !== 'TODOS' && c.estado !== estadoActivo) return false;
    if (convocatoriaActiva !== 'TODAS' && c.convocatoria !== convocatoriaActiva) return false;
    if (edicionActiva !== 'TODAS') {
      const key = c.edicion ? String(c.edicion) : 'sin-edicion';
      if (key !== edicionActiva) return false;
    }
    if (termino) {
      const t = termino.toLowerCase();
      const hay = (c.titulo + ' ' + c.autor).toLowerCase().includes(t);
      if (!hay) return false;
    }
    return true;
  });
}

// ── tabla ──
function renderTable() {
  const body = document.getElementById('boardBody')!;
  const lista = visibles();
  const empty = document.getElementById('emptyState')!;

  if (lista.length === 0) {
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  body.innerHTML = lista.map((c) => {
    const libre = !c.editor_asignado;
    const puedoAsignarme = user?.rol === 'EDITOR' && libre && c.estado === 'PRESELECCIONADO';

    const acciones: string[] = [];
    if (puedoAsignarme) {
      acciones.push(`<button type="button" class="btn-mini" data-accion="asignarme" data-id="${esc(c.id)}">Asignarme</button>`);
    }
    if (esGestor && libre && c.estado === 'PRESELECCIONADO') {
      acciones.push(editorSelect('asignar', c.id));
    }
    if (esGestor && !libre) {
      acciones.push(editorSelect('reasignar', c.id));
      acciones.push(`<button type="button" class="btn-mini" data-accion="desasignar" data-id="${esc(c.id)}">Desasignar</button>`);
    }
    // Acceso al Doc para todo usuario logueado, desde el primer momento:
    // apunta al doc de corrección si existe, si no a la carpeta del original.
    const docHref = c.url_doc_correccion || c.url_carpeta_drive;
    if (docHref) {
      acciones.push(`<a class="btn-mini" href="${esc(docHref)}" target="_blank" rel="noopener noreferrer">Doc</a>`);
    }

    return `<tr class="board-row" data-id="${esc(c.id)}">
      <td data-label="Estado">${badge(c.estado)}</td>
      <td data-label="Producción" class="td-titulo">
        <strong>${esc(c.titulo)}</strong>
        <span class="td-cat">${esc(c.categoria || 'Sin clasificar')}${c.edad ? ' · ' + esc(c.edad) : ''}</span>
        ${accionAutorBadge(c)}
      </td>
      <td data-label="Autor">${esc(c.autor)}</td>
      <td data-label="Convocatoria">${convocatoriaLabel(c.convocatoria)}</td>
      <td data-label="Edición">${c.edicion ? 'Ed. ' + esc(String(c.edicion)) : '<span class="td-libre">—</span>'}</td>
      <td data-label="Titular">${c.titular ? esc(c.titular) : '<span class="td-libre">libre</span>'}</td>
      <td data-label="Recibido">${fmtRelativa(c.fecha_recibido)}</td>
      <td data-label="Acciones" class="col-acciones">${acciones.join(' ')}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.board-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, a')) return;
      abrirDetalle((row as HTMLElement).dataset.id || '');
    });
  });

  body.querySelectorAll('[data-accion="asignarme"]').forEach((btn) => {
    btn.addEventListener('click', () => asignarme((btn as HTMLElement).dataset.id || ''));
  });

  body.querySelectorAll('[data-asignar]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = (sel as HTMLSelectElement).value;
      if (v) asignar((sel as HTMLElement).dataset.asignar || '', v);
    });
  });

  body.querySelectorAll('[data-reasignar]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = (sel as HTMLSelectElement).value;
      if (v) reasignar((sel as HTMLElement).dataset.reasignar || '', v);
    });
  });

  body.querySelectorAll('[data-accion="desasignar"]').forEach((btn) => {
    btn.addEventListener('click', () => desasignar((btn as HTMLElement).dataset.id || ''));
  });
}

function editorSelect(tipo: 'asignar' | 'reasignar', id: string): string {
  const opts = editores.map((e) => `<option value="${esc(e.email)}">${esc(e.nombre)}</option>`).join('');
  const label = tipo === 'asignar' ? 'Asignar a…' : 'Reasignar a…';
  return `<select class="editor-select" data-${tipo}="${esc(id)}" aria-label="${label}"><option value="">${label}</option>${opts}</select>`;
}

// ── acciones ──
async function cargar() {
  const cached = readCachedBoard();
  if (cached) {
    producciones = cached.producciones;
    if (esGestor) { editores = cached.editores || []; ediciones = cached.ediciones || []; }
    renderEstadoSelect();
    renderConvocatoriaSelect();
    renderEdicionSelect();
    renderTable();
  }
  const edPromise = esGestor ? api('panel/board/editors') : Promise.resolve({ status: 'ok', editores: [] });
  const edicionesPromise = esGestor ? api('panel/ediciones/list') : Promise.resolve({ status: 'ok', ediciones: [] });
  const [data, ed, edicionesData] = await Promise.all([api('panel/board/list'), edPromise, edicionesPromise]);
  if (data.status !== 'ok') {
    if (!cached) alert(data.message || 'No se pudo cargar el tablero.');
    return;
  }
  producciones = data.producciones;
  if (esGestor && ed.status === 'ok') editores = ed.editores || [];
  if (esGestor && edicionesData.status === 'ok') ediciones = edicionesData.ediciones || [];
  renderEstadoSelect();
  renderConvocatoriaSelect();
  renderEdicionSelect();
  renderTable();
  saveCachedBoard({ producciones, editores, ediciones });
}

// Aplica una mutación con feedback optimista: invalida la caché local,
// aplica el cambio visual al instante y re-sincroniza con el servidor
// (si falla, la recarga revierte el optimismo).
export async function mutar(id: string, action: string, body: Record<string, unknown> = {}, patch?: Partial<Produccion> | ((c: Produccion) => void)) {
  clearCachedBoard();
  const c = producciones.find((p) => p.id === id);
  if (patch) {
    if (typeof patch === 'function') { if (c) patch(c); }
    else if (c) Object.assign(c, patch);
    renderTable();
  }
  const r = await api(action, { id, ...body });
  await cargar();
  return r;
}

async function asignarme(id: string) {
  const r = await mutar(id, 'panel/board/asignarme', {}, { estado: 'EN_REVISIÓN', editor_asignado: user?.email || '' });
  if (r.status !== 'ok') alert(r.message || 'No se pudo asignar.');
}

async function asignar(id: string, editorEmail: string) {
  const r = await mutar(id, 'panel/board/asignar', { editorEmail }, { estado: 'EN_REVISIÓN', editor_asignado: editorEmail });
  if (r.status !== 'ok') alert(r.message || 'No se pudo asignar.');
}

async function reasignar(id: string, editorEmail: string) {
  const r = await mutar(id, 'panel/board/reasignar', { editorEmail }, { editor_asignado: editorEmail });
  if (r.status !== 'ok') alert(r.message || 'No se pudo reasignar.');
}

async function desasignar(id: string) {
  if (!(await confirmar('¿Desasignar esta producción?'))) return;
  const c = producciones.find((p) => p.id === id);
  const estado = c && (c.estado === 'CONSULTA_AUTOR' || c.estado === 'RECHAZADO_POR_AUTOR') ? undefined : 'PRESELECCIONADO';
  const r = await mutar(id, 'panel/board/desasignar', {}, { editor_asignado: '', ...(estado ? { estado } : {}) });
  if (r.status !== 'ok') alert(r.message || 'No se pudo desasignar.');
}

// ── init ──
function init() {
  if (!user || !getIdToken()) {
    window.location.href = '/';
    return;
  }

  document.getElementById('btn-cerrar-detalle')?.addEventListener('click', () => {
    (document.getElementById('detailModal') as HTMLDialogElement).close();
  });

  const buscador = document.getElementById('buscador') as HTMLInputElement;
  buscador?.addEventListener('input', () => {
    termino = buscador.value.trim();
    renderTable();
  });

  const filtroEstado = document.getElementById('filtro-estado') as HTMLSelectElement;
  filtroEstado?.addEventListener('change', () => {
    estadoActivo = filtroEstado.value || 'TODOS';
    renderTable();
  });

  const filtroConvocatoria = document.getElementById('filtro-convocatoria') as HTMLSelectElement;
  filtroConvocatoria?.addEventListener('change', () => {
    convocatoriaActiva = filtroConvocatoria.value || 'TODAS';
    renderTable();
  });

  const filtroEdicion = document.getElementById('filtro-edicion') as HTMLSelectElement;
  filtroEdicion?.addEventListener('change', () => {
    edicionActiva = filtroEdicion.value || 'TODAS';
    renderTable();
  });

  document.getElementById('btn-refrescar')?.addEventListener('click', cargar);

  document.getElementById('btn-limpiar-filtros')?.addEventListener('click', () => {
    estadoActivo = 'TODOS';
    convocatoriaActiva = 'TODAS';
    edicionActiva = 'TODAS';
    termino = '';
    if (buscador) buscador.value = '';
    renderEstadoSelect();
    renderConvocatoriaSelect();
    renderEdicionSelect();
    renderTable();
  });

  renderNav(user);
  cargar();
}

init();
