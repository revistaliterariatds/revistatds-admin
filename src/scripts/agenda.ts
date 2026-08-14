// agenda.ts — vista de la Agenda: calendario mensual, citas, hilo de comentarios.

import { api, clearSession, getUser, getIdToken } from './api';

interface Cita {
  id: string;
  fecha: string;
  hora: string;
  titulo: string;
  comentario: string;
  tipo: string;
  meet_link: string;
  edicion: string;
  creado_por: string;
  creado_por_nombre: string;
  creado_at: string;
  comentarios: number;
}

interface Comentario { autor: string; comentario: string; creado_at: string; }

const TIPOS: Record<string, { label: string; color: string }> = {
  reunion: { label: 'Reunión', color: '#b84d12' },
  cierre_edicion: { label: 'Cierre de edición', color: '#c0392b' },
  evento: { label: 'Evento', color: '#2d7a4f' },
  otro: { label: 'Otro', color: '#8a837a' },
};

const user = getUser();
const esGestor = user?.rol === 'ADMINISTRADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';
const esAdmin = user?.rol === 'ADMINISTRADOR' || user?.rol === 'WEBMASTER';

let citas: Cita[] = [];
let mesVisible = new Date();
let diaActivo = '';
let citaActiva: Cita | null = null;

const AGENDA_CACHE_KEY = 'tds-agenda-cache-v2';

function readCachedCitas(): Cita[] | null {
  try { return JSON.parse(localStorage.getItem(AGENDA_CACHE_KEY) || 'null'); } catch { return null; }
}

function saveCachedCitas(list: Cita[]) {
  try { localStorage.setItem(AGENDA_CACHE_KEY, JSON.stringify(list)); } catch { /* sin caché local */ }
}

function clearCachedCitas() {
  try { localStorage.removeItem(AGENDA_CACHE_KEY); } catch { /* sin caché local */ }
}

// ── sesión ──
function renderNav() {
  const navUser = document.getElementById('nav-user');
  if (!navUser || !user) return;
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
  const el = document.getElementById('agenda-alert')!;
  el.hidden = false;
  el.className = `status-card${error ? ' error' : ''}`;
  el.textContent = message;
}

function hideAlert() {
  document.getElementById('agenda-alert')!.hidden = true;
}

// ── utilidades de fecha ──
function pad(n: number): string { return String(n).padStart(2, '0'); }

function dateToKey(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function keyToDate(key: string): Date { const p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

function hoyKey(): string { return dateToKey(new Date()); }

function fmtFecha(key: string): string {
  return keyToDate(key).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtFechaCorta(key: string): string {
  return keyToDate(key).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function fmtHora(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function citasDelDia(key: string): Cita[] {
  return citas.filter((c) => c.fecha === key).sort((a, b) => (a.hora || '99:99').localeCompare(b.hora || '99:99'));
}

function tipoInfo(t: string): { label: string; color: string } {
  return TIPOS[t] || TIPOS.otro;
}

// ── calendario ──
function renderCalendario() {
  const titulo = document.getElementById('cal-titulo')!;
  titulo.textContent = mesVisible.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  const anio = mesVisible.getFullYear();
  const mes = mesVisible.getMonth();
  const primero = new Date(anio, mes, 1);
  const diasMes = new Date(anio, mes + 1, 0).getDate();
  const offset = (primero.getDay() + 6) % 7; // lunes = 0
  const celdas = Math.ceil((offset + diasMes) / 7) * 7;
  const hoy = hoyKey();

  const grid = document.getElementById('cal-grid')!;
  const celdasHtml: string[] = [];
  for (let i = 0; i < celdas; i++) {
    const diaNum = i - offset + 1;
    if (diaNum < 1 || diaNum > diasMes) {
      celdasHtml.push('<div class="cal-cell cal-cell-out" aria-hidden="true"></div>');
      continue;
    }
    const key = `${anio}-${pad(mes + 1)}-${pad(diaNum)}`;
    const delDia = citasDelDia(key);
    const esHoy = key === hoy;
    const tituloTip = delDia.length
      ? `${delDia.length} cita${delDia.length > 1 ? 's' : ''} · cread${delDia.length > 1 ? 'as' : 'a'} por ${delDia[0].creado_por_nombre || delDia[0].creado_por} · ${delDia.reduce((n, c) => n + (c.comentarios || 0), 0)} comentario${delDia.reduce((n, c) => n + (c.comentarios || 0), 0) !== 1 ? 's' : ''}`
      : 'Sin citas. Clic para crear.';
    const dots = delDia.slice(0, 3).map((c) => `<i class="cal-dot" style="background:${tipoInfo(c.tipo).color}" aria-hidden="true"></i>`).join('');
    const badge = delDia.length ? `<span class="cal-count">${delDia.length}</span>` : '';
    celdasHtml.push(`<button type="button" class="cal-cell${esHoy ? ' cal-cell-today' : ''}${delDia.length ? ' cal-cell-has' : ''}" data-key="${key}" title="${esc(tituloTip)}">
      <span class="cal-day">${diaNum}</span>${badge}<span class="cal-dots">${dots}${delDia.length > 3 ? `<em>+${delDia.length - 3}</em>` : ''}</span>
    </button>`);
  }
  grid.innerHTML = celdasHtml.join('');

  grid.querySelectorAll('.cal-cell').forEach((cel) => {
    cel.addEventListener('click', () => abrirDia((cel as HTMLElement).dataset.key || ''));
  });
}

// ── próximas citas ──
function renderProximas() {
  const hoy = hoyKey();
  const proximas = citas
    .filter((c) => c.fecha >= hoy)
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
    .slice(0, 5);

  const lista = document.getElementById('proximas-list')!;
  if (proximas.length === 0) {
    lista.innerHTML = '<li class="proximas-empty">Sin citas próximas. Clic en un día para agendar.</li>';
    return;
  }
  lista.innerHTML = proximas.map((c) => `
    <li>
      <button type="button" class="proxima-item" data-cita-id="${esc(c.id)}">
        <span class="proxima-dot" style="background:${tipoInfo(c.tipo).color}" aria-hidden="true"></span>
        <span class="proxima-fecha">${fmtFechaCorta(c.fecha)}${c.hora ? ' · ' + esc(c.hora) : ''}</span>
        <span class="proxima-titulo">${esc(c.titulo)}</span>
      </button>
    </li>`).join('');
  lista.querySelectorAll('[data-cita-id]').forEach((btn) => {
    btn.addEventListener('click', () => abrirDetalle((btn as HTMLElement).dataset.citaId || ''));
  });
}

function renderLeyenda() {
  document.getElementById('tipo-leyenda')!.innerHTML = Object.entries(TIPOS).map(([k, v]) =>
    `<li><i style="background:${v.color}" aria-hidden="true"></i>${esc(v.label)}</li>`).join('');
}

// ── modal: vista por día ──
function abrirDia(key: string) {
  diaActivo = key;
  const delDia = citasDelDia(key);
  if (delDia.length === 0) { abrirCrear(key); return; }

  const modal = document.getElementById('citaModal') as HTMLDialogElement;
  const content = document.getElementById('citaContent')!;
  content.innerHTML = `
    <h2 class="detail-titulo">${esc(fmtFecha(key))}</h2>
    <p class="detail-sub">${delDia.length} cita${delDia.length > 1 ? 's' : ''} este día</p>
    <div class="agenda-dia-lista">
      ${delDia.map((c) => `
        <button type="button" class="cita-item" data-cita-id="${esc(c.id)}">
          <i class="cal-dot" style="background:${tipoInfo(c.tipo).color}" aria-hidden="true"></i>
          <span class="cita-item-hora">${c.hora ? esc(c.hora) : 'Todo el día'}</span>
          <span class="cita-item-titulo">${esc(c.titulo)}</span>
          <span class="cita-item-meta">${c.comentarios} coment. · ${esc(c.creado_por_nombre || c.creado_por)}</span>
        </button>`).join('')}
    </div>
    <div class="detail-acciones">
      <button type="button" class="btn-enviar" id="cita-nueva">Nueva cita</button>
    </div>`;
  modal.showModal();

  content.querySelectorAll('[data-cita-id]').forEach((btn) => {
    btn.addEventListener('click', () => abrirDetalle((btn as HTMLElement).dataset.citaId || ''));
  });
  content.querySelector('#cita-nueva')?.addEventListener('click', () => abrirCrear(key));
}

// ── modal: formulario crear/editar ──
function abrirCrear(key: string) {
  diaActivo = key;
  renderFormulario(null, key);
}

function abrirEditar(cita: Cita) {
  renderFormulario(cita, cita.fecha);
}

function renderFormulario(cita: Cita | null, key: string) {
  const modal = document.getElementById('citaModal') as HTMLDialogElement;
  const content = document.getElementById('citaContent')!;
  const esNueva = !cita;
  content.innerHTML = `
    <h2 class="detail-titulo">${esNueva ? 'Nueva cita' : 'Editar cita'}</h2>
    <p class="config-intro">${esNueva ? esc(fmtFecha(key)) : esc(fmtFecha(cita.fecha))}</p>
    <form id="cita-form" class="cita-form">
      <div class="form-group">
        <label for="cita-titulo">Título <span>(obligatorio)</span></label>
        <input id="cita-titulo" type="text" maxlength="200" required value="${esc(cita?.titulo || '')}" />
      </div>
      <div class="form-group">
        <label for="cita-hora">Horario <span>(opcional)</span></label>
        <input id="cita-hora" type="time" value="${esc(cita?.hora || '')}" />
      </div>
      <div class="form-group">
        <label for="cita-tipo">Tipo</label>
        <select id="cita-tipo" class="filter-select">
          ${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${cita?.tipo === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="cita-comentario">Comentario</label>
        <textarea id="cita-comentario" rows="3" maxlength="2000" placeholder="Detalle de la cita…">${esc(cita?.comentario || '')}</textarea>
      </div>
      <div class="form-group">
        <label for="cita-meet">Link de reunión (Meet) <span>(opcional)</span></label>
        <input id="cita-meet" type="url" maxlength="500" value="${esc(cita?.meet_link || '')}" placeholder="https://meet.google.com/…" />
        <small>Creá tu reunión en <a href="https://meet.google.com/new" target="_blank" rel="noopener noreferrer">meet.google.com/new</a> y pegá el link acá.</small>
      </div>
      ${esNueva ? `
      <div class="check-row">
        <label><input id="cita-notificar" type="checkbox" /> Notificar por mail</label>
        <small>Envía un mail a todos los usuarios con rol con el detalle y el link para agregarla a su calendario.</small>
      </div>` : ''}
      <div class="detail-acciones">
        <button type="submit" class="btn-enviar btn-enviar-solid">Guardar</button>
        <button type="button" class="btn-ghost" id="cita-cancelar">Cancelar</button>
      </div>
    </form>`;
  modal.showModal();

  content.querySelector('#cita-cancelar')?.addEventListener('click', () => {
    if (esNueva) modal.close();
    else abrirDetalle(cita.id);
  });

  content.querySelector('#cita-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      fecha: key,
      hora: (document.getElementById('cita-hora') as HTMLInputElement).value,
      titulo: (document.getElementById('cita-titulo') as HTMLInputElement).value.trim(),
      comentario: (document.getElementById('cita-comentario') as HTMLTextAreaElement).value.trim(),
      tipo: (document.getElementById('cita-tipo') as HTMLSelectElement).value,
      meet_link: (document.getElementById('cita-meet') as HTMLInputElement).value.trim(),
    };
    const notificar = esNueva ? (document.getElementById('cita-notificar') as HTMLInputElement).checked : false;
    try {
      const data = esNueva
        ? await api('panel/agenda/crear', { ...payload, notificar })
        : await api('panel/agenda/editar', { id: cita.id, ...payload });
      if (data.status !== 'ok') throw new Error(data.message || 'No se pudo guardar.');
      modal.close();
      clearCachedCitas();
      await recargar();
    } catch (err) { showAlert(err instanceof Error ? err.message : 'No se pudo guardar.', true); }
  });
}

// ── modal: detalle de cita + comentarios ──
async function abrirDetalle(id: string) {
  const modal = document.getElementById('citaModal') as HTMLDialogElement;
  const content = document.getElementById('citaContent')!;
  const data = await api('panel/agenda/detalle', { id });
  if (data.status !== 'ok') { showAlert(data.message || 'No se pudo cargar la cita.', true); return; }

  const c: Cita = data.cita;
  citaActiva = c;
  const comentarios: Comentario[] = data.comentarios || [];
  const tipo = tipoInfo(c.tipo);

  content.innerHTML = `
    <div class="cita-detalle-top" style="border-top:4px solid ${tipo.color}">
      <h2 class="detail-titulo">${esc(c.titulo)}</h2>
      <p class="cita-detalle-meta">${esc(fmtFecha(c.fecha))}${c.hora ? ' · ' + esc(c.hora) : ''} · ${esc(tipo.label)}</p>
      ${c.comentario ? `<p class="cita-detalle-comentario">${esc(c.comentario)}</p>` : ''}
      ${c.meet_link ? `<p class="cita-detalle-meta"><a href="${esc(c.meet_link)}" target="_blank" rel="noopener noreferrer">Unirse a la reunión (Meet)</a></p>` : ''}
      <p class="cita-detalle-meta cita-detalle-autor">Creada por ${esc(c.creado_por_nombre || c.creado_por)}${c.edicion ? ' · Edición ' + esc(c.edicion) : ''}</p>
    </div>
    <h3 class="detail-sub">Comentarios (${comentarios.length})</h3>
    <ol class="timeline">
      ${comentarios.map((cm) => `
        <li><span class="tl-fecha">${esc(fmtHora(cm.creado_at))} · ${esc(cm.autor)}</span>
        <span class="tl-detalle">${esc(cm.comentario)}</span></li>`).join('') || '<li>Sin comentarios todavía.</li>'}
    </ol>
    <form id="cita-comentar-form" class="cita-comentar">
      <label class="cita-comentar-label" for="cita-nuevo-comentario">Agregar comentario</label>
      <textarea id="cita-nuevo-comentario" rows="2" maxlength="2000" placeholder="Escribí un comentario…"></textarea>
      <button type="submit" class="btn-mini">Comentar</button>
    </form>
    <div class="detail-acciones">
      <button type="button" class="btn-ghost" id="cita-volver">← Volver al día</button>
      ${esAdmin ? `
        <button type="button" class="btn-enviar" id="cita-editar">Editar</button>
        <button type="button" class="btn-enviar btn-enviar-peligro" id="cita-borrar">Borrar</button>` : ''}
    </div>`;
  modal.showModal();

  content.querySelector('#cita-volver')?.addEventListener('click', () => abrirDia(c.fecha));

  content.querySelector('#cita-editar')?.addEventListener('click', () => abrirEditar(c));

  content.querySelector('#cita-borrar')?.addEventListener('click', async () => {
    if (!confirm(`¿Borrar la cita "${c.titulo}" y sus comentarios?`)) return;
    const r = await api('panel/agenda/borrar', { id: c.id });
    if (r.status === 'ok') { modal.close(); clearCachedCitas(); await recargar(); }
    else showAlert(r.message || 'No se pudo borrar.', true);
  });

  content.querySelector('#cita-comentar-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = (document.getElementById('cita-nuevo-comentario') as HTMLTextAreaElement).value.trim();
    if (!texto) return;
    const r = await api('panel/agenda/comentar', { id: c.id, comentario: texto });
    if (r.status === 'ok') {
      modal.close();
      clearCachedCitas();
      await recargar();
    }
    else showAlert(r.message || 'No se pudo comentar.', true);
  });
}

// ── datos ──
async function recargar() {
  hideAlert();
  const cached = readCachedCitas();
  if (cached) {
    citas = cached;
    renderCalendario();
    renderProximas();
  }
  const data = await api('panel/agenda/list');
  if (data.status !== 'ok') {
    if (!cached) showAlert(data.message || 'No se pudo cargar la agenda.', true);
    return;
  }
  citas = data.citas || [];
  renderCalendario();
  renderProximas();
  saveCachedCitas(citas);
}

function init() {
  if (!user || !getIdToken()) { window.location.href = '/'; return; }
  renderNav();
  renderLeyenda();

  document.getElementById('btn-cerrar-cita')?.addEventListener('click', () => {
    (document.getElementById('citaModal') as HTMLDialogElement).close();
  });

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    mesVisible = new Date(mesVisible.getFullYear(), mesVisible.getMonth() - 1, 1);
    renderCalendario();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    mesVisible = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + 1, 1);
    renderCalendario();
  });
  document.getElementById('agenda-hoy')?.addEventListener('click', () => {
    mesVisible = new Date();
    renderCalendario();
  });
  document.getElementById('agenda-refrescar')?.addEventListener('click', recargar);

  recargar();
}

init();
