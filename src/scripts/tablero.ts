// tablero.ts — vista del tablero editorial (Fase 3).

import { api, btnCargando, getUser, clearSession, getIdToken } from './api';

interface Produccion {
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
}

const ESTADOS: Record<string, { label: string; color: string }> = {
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
const esGestor = user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';
const esAdmin = user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER';

function renderNav() {
  const navUser = document.getElementById('nav-user');
  const navName = document.getElementById('nav-user-name');
  const navRole = document.getElementById('nav-user-role');
  const navLogout = document.getElementById('nav-logout');
  const navUsers = document.getElementById('nav-users');
  const navConfig = document.getElementById('nav-config');
  const navAnalytics = document.getElementById('nav-analytics');
  const navDescargas = document.getElementById('nav-descargas');
  if (!navUser || !user) return;
  navUser.hidden = false;
  navName.textContent = user.nombre || user.email;
  navRole.textContent = user.rol;
  if (navUsers) navUsers.hidden = !esGestor;
  if (navConfig) navConfig.hidden = !esGestor;
  if (navAnalytics) navAnalytics.hidden = !esGestor;
  if (navDescargas) navDescargas.hidden = !esGestor;
  navLogout?.addEventListener('click', () => {
    clearSession();
    window.location.href = '/';
  });
}

// ── utilidades ──
function badge(estado: string): string {
  const info = ESTADOS[estado] || { label: estado, color: 'grey' };
  return `<span class="badge badge-${info.color}">${info.label}</span>`;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function fmtRelativa(iso: string): string {
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

function convocatoriaLabel(c: string): string {
  return c === 'docentes' ? 'Docentes' : 'General';
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
async function mutar(id: string, action: string, body: Record<string, unknown> = {}, patch?: Partial<Produccion> | ((c: Produccion) => void)) {
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
  if (!confirm('¿Desasignar esta producción?')) return;
  const c = producciones.find((p) => p.id === id);
  const estado = c && (c.estado === 'CONSULTA_AUTOR' || c.estado === 'RECHAZADO_POR_AUTOR') ? undefined : 'PRESELECCIONADO';
  const r = await mutar(id, 'panel/board/desasignar', {}, { editor_asignado: '', ...(estado ? { estado } : {}) });
  if (r.status !== 'ok') alert(r.message || 'No se pudo desasignar.');
}

// Abre el selector de archivo para "Enviar correcciones al autor" (adjuntar PDF + mensaje).
async function abrirSelectorEnviarCorrecciones(id: string) {
  const group = document.getElementById('enviarCorreccionesGroup');
  const select = document.getElementById('enviar-archivo') as HTMLSelectElement | null;
  if (!group || !select) return;
  const r = await api('panel/board/archivos', { id });
  if (r.status !== 'ok') { alert(r.message || 'No se pudieron listar los archivos.'); return; }
  const archivos = r.archivos || [];
  if (!archivos.length) { alert('No hay archivos en la carpeta de esta producción.'); return; }
  select.innerHTML = archivos
    .map((a: { fileId: string; nombre: string; carpeta: string }) => `<option value="${esc(a.fileId)}">${esc(a.nombre)} — ${esc(a.carpeta)}</option>`)
    .join('');
  group.hidden = false;
}

// Abre el selector de archivo para "Consultar al autor" (adjuntar PDF).
async function abrirSelectorConsulta(id: string) {
  const group = document.getElementById('consultaGroup');
  const select = document.getElementById('consulta-archivo') as HTMLSelectElement | null;
  if (!group || !select) return;
  const r = await api('panel/board/archivos', { id });
  if (r.status !== 'ok') { alert(r.message || 'No se pudieron listar los archivos.'); return; }
  const archivos = r.archivos || [];
  if (!archivos.length) { alert('No hay archivos en la carpeta de esta producción.'); return; }
  select.innerHTML = archivos
    .map((a: { fileId: string; nombre: string; carpeta: string }) => `<option value="${esc(a.fileId)}">${esc(a.nombre)} — ${esc(a.carpeta)}</option>`)
    .join('');
  group.hidden = false;
}

// ── detalle ──
async function abrirDetalle(id: string) {
  const modal = document.getElementById('detailModal') as HTMLDialogElement;
  const content = document.getElementById('detailContent')!;
  const data = await api('panel/board/detail', { id });
  if (data.status !== 'ok') {
    alert(data.message || 'No se pudo cargar el detalle.');
    return;
  }
  const c: Produccion = data.produccion;
  const hist: { timestamp: string; actor: string; accion: string; detalle: string }[] = data.historial || [];
  const soyTitular = c.editor_asignado === user?.email;

  const acciones: string[] = [];
  if (soyTitular && c.estado === 'EN_REVISIÓN') {
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="pedir">Pedir correcciones</button>`);
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="terminar">Revisión terminada</button>`);
  }
  if (esGestor && c.estado === 'CORRECCIONES_SOLICITADAS' && !c.enviado_autor) {
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="enviar-correcciones">Enviar correcciones al autor</button>`);
  }
  if (esGestor && c.estado === 'ESPERANDO_APROBACIÓN') {
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="consultar">Consultar al autor</button>`);
    acciones.push(`<button type="button" class="btn-enviar btn-enviar-solid" data-detalle-accion="aprobar">Aprobar</button>`);
  }
  if (esGestor && c.estado === 'RECHAZADO_POR_AUTOR') {
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="devolver">Devolver al editor</button>`);
    acciones.push(`<button type="button" class="btn-ghost" data-detalle-accion="descartar">Descartar</button>`);
  }
  if (c.url_doc_correccion) {
    acciones.push(`<a class="btn-enviar" href="${esc(c.url_doc_correccion)}" target="_blank" rel="noopener noreferrer">Abrir Doc</a>`);
  }
  if (c.url_carpeta_drive) {
    acciones.push(`<a class="btn-ghost" href="${esc(c.url_carpeta_drive)}" target="_blank" rel="noopener noreferrer">Carpeta Drive</a>`);
  }
  if (esAdmin && c.estado !== 'PUBLICADO') {
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="marcar-publicable">Marcar publicable</button>`);
    acciones.push(`<button type="button" class="btn-ghost" data-detalle-accion="borrar">Borrar envío</button>`);
  }
  if (c.url_publicable) {
    acciones.push(`<a class="btn-ghost" href="${esc(c.url_publicable)}" target="_blank" rel="noopener noreferrer">Publicable</a>`);
  }

  const timeline = hist.map((h) => `
    <li><span class="tl-fecha">${fmtRelativa(h.timestamp)}</span>
        <span class="tl-accion">${esc(h.accion || 'Actualización')}</span>
        ${h.detalle ? `<span class="tl-detalle">${esc(h.detalle)}</span>` : ''}</li>`,
  ).join('');

  const edicionesOpts = ['<option value="">Sin edición</option>']
    .concat(ediciones.map((e) => `<option value="${esc(e.numero)}"${String(c.edicion ?? '').trim() === String(e.numero) ? ' selected' : ''}>Edición ${esc(e.numero)}</option>`))
    .join('');

  content.innerHTML = `
    <h2 class="detail-titulo">${esc(c.titulo)}</h2>
    <div class="detail-badge">${badge(c.estado)}${c.estado !== 'PUBLICADO' && c.url_publicable ? ` <span class="badge badge-green">Publicable</span>` : ''}</div>
    <dl class="detail-meta">
      <div><dt>Autor</dt><dd>${esc(c.autor)} <span class="td-cat">(${esc(c.email_autor)})</span></dd></div>
      <div><dt>Categoría</dt><dd>${esc(c.categoria || 'Sin clasificar')}</dd></div>
      <div><dt>Convocatoria</dt><dd>${convocatoriaLabel(c.convocatoria)}</dd></div>
      <div><dt>Versión</dt><dd>${esc(c.version_actual || '1')}</dd></div>
      <div><dt>Titular</dt><dd>${c.titular ? esc(c.titular) : '<em>libre</em>'}</dd></div>
    </dl>
    ${esGestor ? `
      <div class="form-group" style="margin-bottom:1rem;">
        <label for="cambiar-edicion">Edición de esta publicación</label>
        <select id="cambiar-edicion" class="filter-select" aria-label="Cambiar la edición de esta publicación">${edicionesOpts}</select>
      </div>` : ''}
    ${esAdmin ? `
      <div class="form-group" style="margin-bottom:1rem;">
        <label for="cambiar-estado">Cambiar estado (administración)</label>
        <select id="cambiar-estado" class="filter-select" aria-label="Cambiar el estado de esta publicación">
          ${Object.keys(ESTADOS).filter((k) => k !== 'PUBLICADO').map((k) => `<option value="${k}"${c.estado === k ? ' selected' : ''}>${esc(ESTADOS[k].label)}</option>`).join('')}
        </select>
        <button type="button" class="btn-mini" id="btn-cambiar-estado" style="margin-top:0.5rem;">Aplicar estado</button>
      </div>` : ''}
    <h3 class="detail-sub">Historial</h3>
    <ol class="timeline">${timeline || '<li>Sin actividad.</li>'}</ol>
    <div class="detail-acciones">${acciones.join(' ')}</div>
    ${esGestor ? `
      <div class="form-group" id="enviarCorreccionesGroup" hidden>
        <label for="enviar-archivo">Elegí el archivo a adjuntar al autor (se envía como PDF)</label>
        <select id="enviar-archivo" class="filter-select" aria-label="Archivo a adjuntar al autor"></select>
        <label for="enviar-mensaje" style="margin-top:0.75rem;">Mensaje adicional (opcional)</label>
        <textarea id="enviar-mensaje" rows="3" placeholder="Qué cambiar…"></textarea>
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;">
          <button type="button" class="btn-mini" id="btn-confirmar-enviar">Enviar al autor</button>
          <button type="button" class="btn-mini btn-ghost" id="btn-cancelar-enviar">Cancelar</button>
        </div>
      </div>` : ''}
    ${esAdmin ? `
      <div class="form-group" id="publicableGroup" hidden>
        <label for="publicable-archivo">Elegí el archivo para copiar a PUBLICABLES</label>
        <select id="publicable-archivo" class="filter-select" aria-label="Archivo para publicable"></select>
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;">
          <button type="button" class="btn-mini" id="btn-confirmar-publicable">Confirmar</button>
          <button type="button" class="btn-mini btn-ghost" id="btn-cancelar-publicable">Cancelar</button>
        </div>
      </div>` : ''}
    ${esGestor ? `
      <div class="form-group" id="consultaGroup" hidden>
        <label for="consulta-archivo">Elegí el archivo a adjuntar al autor (se envía como PDF)</label>
        <select id="consulta-archivo" class="filter-select" aria-label="Archivo a adjuntar al autor"></select>
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;">
          <button type="button" class="btn-mini" id="btn-confirmar-consulta">Enviar al autor</button>
          <button type="button" class="btn-mini btn-ghost" id="btn-cancelar-consulta">Cancelar</button>
        </div>
      </div>` : ''}
  `;

  modal.showModal();

  const edicionSelect = content.querySelector('#cambiar-edicion') as HTMLSelectElement | null;
  edicionSelect?.addEventListener('change', async () => {
    const r = await mutar(id, 'panel/board/cambiar-edicion', { edicion: edicionSelect.value }, { edicion: edicionSelect.value });
    if (r.status !== 'ok') alert(r.message || 'No se pudo cambiar la edición.');
  });

  content.querySelector('[data-detalle-accion="pedir"]')?.addEventListener('click', async () => {
    if (!confirm('¿Marcar que el autor debe hacer correcciones? El coordinador le enviará luego el mail.')) return;
    const r = await mutar(id, 'panel/board/pedir-correcciones', {}, { estado: 'CORRECCIONES_SOLICITADAS' });
    modal.close();
    if (r.status !== 'ok') alert(r.message || 'No se pudo marcar.');
  });

  content.querySelector('[data-detalle-accion="enviar-correcciones"]')?.addEventListener('click', () => abrirSelectorEnviarCorrecciones(id));

  content.querySelector('#btn-confirmar-enviar')?.addEventListener('click', async () => {
    const select = document.getElementById('enviar-archivo') as HTMLSelectElement | null;
    if (!select || !select.value) { alert('Elegí un archivo.'); return; }
    const mensaje = (document.getElementById('enviar-mensaje') as HTMLTextAreaElement).value.trim();
    if (!confirm('¿Enviar las correcciones al autor (con el archivo como PDF)?')) return;
    const btn = content.querySelector('#btn-confirmar-enviar') as HTMLButtonElement | null;
    btnCargando(btn, true);
    const r = await mutar(id, 'panel/board/enviar-correcciones', { fileId: select.value, mensaje }, { enviado_autor: true, estado: 'CORRECCIONES_SOLICITADAS' });
    btnCargando(btn, false);
    if (r.status === 'ok') { modal.close(); return; }
    alert(r.message || 'No se pudo enviar.');
  });

  content.querySelector('#btn-cancelar-enviar')?.addEventListener('click', () => {
    const group = document.getElementById('enviarCorreccionesGroup');
    if (group) group.hidden = true;
  });

  content.querySelector('[data-detalle-accion="terminar"]')?.addEventListener('click', async () => {
    if (!confirm('¿Marcar la revisión como terminada?')) return;
    const r = await mutar(id, 'panel/board/revision-terminada', {}, { estado: 'ESPERANDO_APROBACIÓN' });
    modal.close();
    if (r.status !== 'ok') alert(r.message || 'No se pudo.');
  });

  content.querySelector('[data-detalle-accion="consultar"]')?.addEventListener('click', () => abrirSelectorConsulta(id));

  content.querySelector('#btn-confirmar-consulta')?.addEventListener('click', async () => {
    const select = document.getElementById('consulta-archivo') as HTMLSelectElement | null;
    if (!select || !select.value) { alert('Elegí un archivo.'); return; }
    if (!confirm('¿Enviar este archivo (como PDF) al autor para aprobación?')) return;
    const btn = content.querySelector('#btn-confirmar-consulta') as HTMLButtonElement | null;
    btnCargando(btn, true);
    const r = await mutar(id, 'panel/board/consultar-autor', { fileId: select.value }, { estado: 'CONSULTA_AUTOR' });
    btnCargando(btn, false);
    if (r.status === 'ok') { modal.close(); return; }
    alert(r.message || 'No se pudo consultar al autor.');
  });

  content.querySelector('#btn-cancelar-consulta')?.addEventListener('click', () => {
    const group = document.getElementById('consultaGroup');
    if (group) group.hidden = true;
  });

  content.querySelector('[data-detalle-accion="aprobar"]')?.addEventListener('click', async () => {
    if (!confirm('¿Aprobar esta producción?')) return;
    const r = await mutar(id, 'panel/board/aprobar', {}, { estado: 'APROBADO' });
    modal.close();
    if (r.status !== 'ok') alert(r.message || 'No se pudo aprobar.');
  });

  const estadoSelect = content.querySelector('#cambiar-estado') as HTMLSelectElement | null;
  content.querySelector('#btn-cambiar-estado')?.addEventListener('click', async () => {
    const estado = estadoSelect?.value;
    if (!estado) return;
    if (estado === 'CONSULTA_AUTOR') {
      // Consultar al autor requiere elegir el archivo a adjuntar como PDF.
      await abrirSelectorConsulta(id);
      return;
    }
    if (!confirm('¿Cambiar el estado de esta publicación a "' + estado + '"?')) return;
    const r = await mutar(id, 'panel/board/cambiar-estado', { estado }, { estado });
    modal.close();
    if (r.status !== 'ok') alert(r.message || 'No se pudo cambiar el estado.');
  });

  content.querySelector('[data-detalle-accion="devolver"]')?.addEventListener('click', async () => {
    if (!confirm('¿Devolver esta producción al editor para retrabajarla?')) return;
    const r = await mutar(id, 'panel/board/resolver-rechazo', { resolucion: 'devolver' }, { estado: 'EN_REVISIÓN' });
    modal.close();
    if (r.status !== 'ok') alert(r.message || 'No se pudo devolver al editor.');
  });

  content.querySelector('[data-detalle-accion="descartar"]')?.addEventListener('click', async () => {
    if (!confirm('¿Descartar definitivamente esta producción?')) return;
    const r = await mutar(id, 'panel/board/resolver-rechazo', { resolucion: 'descartar' }, { estado: 'DESCARTADO' });
    modal.close();
    if (r.status !== 'ok') alert(r.message || 'No se pudo descartar.');
  });

  content.querySelector('[data-detalle-accion="marcar-publicable"]')?.addEventListener('click', async () => {
    if (c.url_publicable) {
      if (!confirm('¿Marcar esta producción como publicable?')) return;
      const r = await mutar(id, 'panel/board/marcar-publicable', {}, { estado: 'PUBLICADO' });
      modal.close();
      if (r.status !== 'ok') alert(r.message || 'No se pudo marcar publicable.');
      return;
    }
    const group = document.getElementById('publicableGroup');
    const select = document.getElementById('publicable-archivo') as HTMLSelectElement | null;
    if (!group || !select) return;
    const r = await api('panel/board/archivos', { id });
    if (r.status !== 'ok') { alert(r.message || 'No se pudieron listar los archivos.'); return; }
    const archivos = r.archivos || [];
    if (!archivos.length) { alert('No hay archivos en la carpeta de esta producción.'); return; }
    select.innerHTML = archivos
      .map((a: { fileId: string; nombre: string; carpeta: string }) => `<option value="${esc(a.fileId)}">${esc(a.nombre)} — ${esc(a.carpeta)}</option>`)
      .join('');
    group.hidden = false;
  });

  content.querySelector('#btn-confirmar-publicable')?.addEventListener('click', async () => {
    const select = document.getElementById('publicable-archivo') as HTMLSelectElement | null;
    if (!select || !select.value) { alert('Elegí un archivo.'); return; }
    if (!confirm('¿Copiar este archivo a PUBLICABLES y marcar la producción como publicable?')) return;
    const btn = content.querySelector('#btn-confirmar-publicable') as HTMLButtonElement | null;
    btnCargando(btn, true);
    const r = await mutar(id, 'panel/board/marcar-publicable', { fileId: select.value }, { estado: 'PUBLICADO' });
    btnCargando(btn, false);
    if (r.status === 'ok') { modal.close(); return; }
    alert(r.message || 'No se pudo marcar publicable.');
  });

  content.querySelector('#btn-cancelar-publicable')?.addEventListener('click', () => {
    const group = document.getElementById('publicableGroup');
    if (group) group.hidden = true;
  });

  content.querySelector('[data-detalle-accion="borrar"]')?.addEventListener('click', async () => {
    if (!confirm('¿Borrar este envío por completo? Se eliminará la carpeta de Drive, la copia en PUBLICABLES, la fila y su historial. Esta acción no se puede deshacer.')) return;
    const r = await mutar(id, 'panel/board/borrar', {}, (c) => {
      producciones = producciones.filter((p) => p.id !== c.id);
    });
    modal.close();
    if (r.status !== 'ok') alert(r.message || 'No se pudo borrar el envío.');
  });
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

  renderNav();
  cargar();
}

init();
