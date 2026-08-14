// tablero.ts — vista del tablero editorial (Fase 3).

import { api, getUser, clearSession, getIdToken } from './api';

interface Cuento {
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
  fecha_recibido: string;
  titular: string;
}

const ESTADOS: Record<string, { label: string; color: string }> = {
  'RECIBIDO': { label: 'Recibido', color: 'grey' },
  'EN_REVISIÓN': { label: 'En revisión', color: 'orange' },
  'CORRECCIONES_SOLICITADAS': { label: 'Correcciones', color: 'orange' },
  'ESPERANDO_APROBACIÓN': { label: 'En aprobación', color: 'orange' },
  'CONSULTA_AUTOR': { label: 'Consulta autor', color: 'orange' },
  'APROBADO': { label: 'Aprobado', color: 'green' },
  'PUBLICADO': { label: 'Publicado', color: 'green' },
  'RECHAZADO_POR_AUTOR': { label: 'Rechazado', color: 'red' },
  'DESCARTADO': { label: 'Descartado', color: 'grey' },
};

let cuentos: Cuento[] = [];
let estadoActivo = 'TODOS';
let convocatoriaActiva = 'TODAS';
let termino = '';
let editores: { email: string; nombre: string }[] = [];

// ── sesión ──
const user = getUser();
const esGestor = user?.rol === 'ADMINISTRADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';

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
  cuentos.forEach((c) => { cont[c.estado] = (cont[c.estado] || 0) + 1; });

  const el = document.getElementById('filtro-estado') as HTMLSelectElement;
  const options = [`<option value="TODOS">Todos los estados (${cuentos.length})</option>`];
  Object.keys(ESTADOS).forEach((k) => {
    const n = cont[k] || 0;
    options.push(`<option value="${k}">${esc(ESTADOS[k].label)} (${n})</option>`);
  });
  el.innerHTML = options.join('');
  el.value = estadoActivo;
}

function renderConvocatoriaSelect() {
  const cont: Record<string, number> = {};
  cuentos.forEach((c) => { cont[c.convocatoria] = (cont[c.convocatoria] || 0) + 1; });

  const el = document.getElementById('filtro-convocatoria') as HTMLSelectElement;
  const options = [`<option value="TODAS">Todas (${cuentos.length})</option>`];
  ['general', 'docentes'].forEach((k) => {
    const n = cont[k] || 0;
    options.push(`<option value="${k}">${esc(convocatoriaLabel(k))} (${n})</option>`);
  });
  el.innerHTML = options.join('');
  el.value = convocatoriaActiva;
}

function visibles(): Cuento[] {
  return cuentos.filter((c) => {
    if (estadoActivo !== 'TODOS' && c.estado !== estadoActivo) return false;
    if (convocatoriaActiva !== 'TODAS' && c.convocatoria !== convocatoriaActiva) return false;
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
    const soyTitular = c.editor_asignado === user?.email;
    const puedoAsignarme = user?.rol === 'EDITOR' && libre && c.estado === 'RECIBIDO';

    const acciones: string[] = [];
    if (puedoAsignarme) {
      acciones.push(`<button type="button" class="btn-mini" data-accion="asignarme" data-id="${esc(c.id)}">Asignarme</button>`);
    }
    if (esGestor && libre && c.estado === 'RECIBIDO') {
      acciones.push(editorSelect('asignar', c.id));
    }
    if (esGestor && !libre) {
      acciones.push(editorSelect('reasignar', c.id));
      acciones.push(`<button type="button" class="btn-mini" data-accion="desasignar" data-id="${esc(c.id)}">Desasignar</button>`);
    }
    if (c.url_doc_correccion && (soyTitular || esGestor)) {
      acciones.push(`<a class="btn-mini" href="${esc(c.url_doc_correccion)}" target="_blank" rel="noopener noreferrer">Doc</a>`);
    }

    return `<tr class="board-row" data-id="${esc(c.id)}">
      <td data-label="Estado">${badge(c.estado)}</td>
      <td data-label="Cuento" class="td-titulo">
        <strong>${esc(c.titulo)}</strong>
        <span class="td-cat">${esc(c.categoria || 'Sin clasificar')}${c.edad ? ' · ' + esc(c.edad) : ''}</span>
      </td>
      <td data-label="Autor">${esc(c.autor)}</td>
      <td data-label="Convocatoria">${convocatoriaLabel(c.convocatoria)}</td>
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
  const edPromise = esGestor ? api('panel/board/editors') : Promise.resolve({ status: 'ok', editores: [] });
  const [data, ed] = await Promise.all([api('panel/board/list'), edPromise]);
  if (data.status !== 'ok') {
    alert(data.message || 'No se pudo cargar el tablero.');
    return;
  }
  cuentos = data.cuentos;
  if (esGestor && ed.status === 'ok') editores = ed.editores || [];
  renderEstadoSelect();
  renderConvocatoriaSelect();
  renderTable();
}

async function asignarme(id: string) {
  const data = await api('panel/board/asignarme', { id });
  if (data.status === 'ok') {
    await cargar();
  } else {
    alert(data.message || 'No se pudo asignar.');
  }
}

async function asignar(id: string, editorEmail: string) {
  const data = await api('panel/board/asignar', { id, editorEmail });
  if (data.status === 'ok') await cargar();
  else alert(data.message || 'No se pudo asignar.');
}

async function reasignar(id: string, editorEmail: string) {
  const data = await api('panel/board/reasignar', { id, editorEmail });
  if (data.status === 'ok') await cargar();
  else alert(data.message || 'No se pudo reasignar.');
}

async function desasignar(id: string) {
  if (!confirm('¿Desasignar este cuento?')) return;
  const data = await api('panel/board/desasignar', { id });
  if (data.status === 'ok') await cargar();
  else alert(data.message || 'No se pudo desasignar.');
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
  const c: Cuento = data.cuento;
  const hist: { timestamp: string; actor: string; accion: string; detalle: string }[] = data.historial || [];
  const soyTitular = c.editor_asignado === user?.email;

  const acciones: string[] = [];
  if (soyTitular && c.estado === 'EN_REVISIÓN') {
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="pedir">Pedir correcciones</button>`);
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="terminar">Revisión terminada</button>`);
  }
  if (esGestor && c.estado === 'ESPERANDO_APROBACIÓN') {
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="consultar">Consultar al autor</button>`);
  }
  if (esGestor && c.estado === 'APROBADO') {
    acciones.push(`<button type="button" class="btn-enviar" data-detalle-accion="publicar">Marcar publicado</button>`);
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

  const timeline = hist.map((h) => `
    <li><span class="tl-fecha">${fmtRelativa(h.timestamp)}</span>
        <span class="tl-accion">${esc(h.accion || 'Actualización')}</span>
        ${h.detalle ? `<span class="tl-detalle">${esc(h.detalle)}</span>` : ''}</li>`,
  ).join('');

  content.innerHTML = `
    <h2 class="detail-titulo">${esc(c.titulo)}</h2>
    <div class="detail-badge">${badge(c.estado)}</div>
    <dl class="detail-meta">
      <div><dt>Autor</dt><dd>${esc(c.autor)} <span class="td-cat">(${esc(c.email_autor)})</span></dd></div>
      <div><dt>Categoría</dt><dd>${esc(c.categoria || 'Sin clasificar')}</dd></div>
      <div><dt>Convocatoria</dt><dd>${convocatoriaLabel(c.convocatoria)}</dd></div>
      <div><dt>Versión</dt><dd>${esc(c.version_actual || '1')}</dd></div>
      <div><dt>Titular</dt><dd>${c.titular ? esc(c.titular) : '<em>libre</em>'}</dd></div>
    </dl>
    <h3 class="detail-sub">Historial</h3>
    <ol class="timeline">${timeline || '<li>Sin actividad.</li>'}</ol>
    <div class="detail-acciones">${acciones.join(' ')}</div>
    ${soyTitular && c.estado === 'EN_REVISIÓN' ? `
      <div class="form-group" id="motivoGroup" hidden>
        <label for="motivo">Motivo de las correcciones</label>
        <textarea id="motivo" rows="3" placeholder="Qué cambiar…"></textarea>
      </div>` : ''}
  `;

  modal.showModal();

  content.querySelector('[data-detalle-accion="pedir"]')?.addEventListener('click', async () => {
    const motivoGroup = document.getElementById('motivoGroup');
    if (motivoGroup && motivoGroup.hidden) { motivoGroup.hidden = false; return; }
    const motivo = (document.getElementById('motivo') as HTMLTextAreaElement).value.trim();
    const r = await api('panel/board/pedir-correcciones', { id, motivo });
    if (r.status === 'ok') { modal.close(); await cargar(); }
    else alert(r.message || 'No se pudo.');
  });

  content.querySelector('[data-detalle-accion="terminar"]')?.addEventListener('click', async () => {
    if (!confirm('¿Marcar la revisión como terminada?')) return;
    const r = await api('panel/board/revision-terminada', { id });
    if (r.status === 'ok') { modal.close(); await cargar(); }
    else alert(r.message || 'No se pudo.');
  });

  content.querySelector('[data-detalle-accion="consultar"]')?.addEventListener('click', async () => {
    if (!confirm('¿Enviar esta versión al autor para aprobación?')) return;
    const r = await api('panel/board/consultar-autor', { id });
    if (r.status === 'ok') { modal.close(); await cargar(); }
    else alert(r.message || 'No se pudo consultar al autor.');
  });

  content.querySelector('[data-detalle-accion="publicar"]')?.addEventListener('click', async () => {
    if (!confirm('¿Marcar este cuento como publicado?')) return;
    const r = await api('panel/board/publicar', { id });
    if (r.status === 'ok') { modal.close(); await cargar(); }
    else alert(r.message || 'No se pudo publicar.');
  });

  content.querySelector('[data-detalle-accion="devolver"]')?.addEventListener('click', async () => {
    if (!confirm('¿Devolver este cuento al editor para retrabajarlo?')) return;
    const r = await api('panel/board/resolver-rechazo', { id, resolucion: 'devolver' });
    if (r.status === 'ok') { modal.close(); await cargar(); }
    else alert(r.message || 'No se pudo devolver al editor.');
  });

  content.querySelector('[data-detalle-accion="descartar"]')?.addEventListener('click', async () => {
    if (!confirm('¿Descartar definitivamente este cuento?')) return;
    const r = await api('panel/board/resolver-rechazo', { id, resolucion: 'descartar' });
    if (r.status === 'ok') { modal.close(); await cargar(); }
    else alert(r.message || 'No se pudo descartar.');
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

  document.getElementById('btn-refrescar')?.addEventListener('click', cargar);

  document.getElementById('btn-limpiar-filtros')?.addEventListener('click', () => {
    estadoActivo = 'TODOS';
    convocatoriaActiva = 'TODAS';
    termino = '';
    if (buscador) buscador.value = '';
    renderEstadoSelect();
    renderConvocatoriaSelect();
    renderTable();
  });

  renderNav();
  cargar();
}

init();
