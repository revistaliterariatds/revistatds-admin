// actividad.ts — solapa "Actividad": donut SVG hecho a mano con la
// participación de cada usuario del equipo. El backend (`panel/actividad/list`)
// devuelve el dataset completo y compacto (diccionarios + eventos posicionales);
// acá se filtra por período/edición/rol/usuario y se calcula el peso combinado
// (acciones ponderadas + producciones distintas). Visible solo para gestores.

import { api, getIdToken, getUser } from './api';
import { esGestor, esc, renderNav } from './ui';

const user = getUser();
const esGestorRol = esGestor(user);

interface ActividadUsuario { i: number; e: string; n: string; r: string; a: boolean }
interface ActividadDataset {
  generado: string;
  meses: string[];
  ediciones: string[];
  usuarios: ActividadUsuario[];
  acciones: string[];
  ids: string[];
  eventos: number[][]; // [mesIdx, edIdx, usuarioIdx, accionIdx, idIdx, n]
  descartados: number;
  colisiones: number;
}

let dataset: ActividadDataset | null = null;

// ── métrica combinada (constantes ajustables) ──
// Acciones que implican trabajo asíncrono real (mail al autor o Drive/publicación) valen 2.
const PESO_ACCION: Record<string, number> = {
  CORRECCIONES_ENVIADAS: 2,
  CONSULTA_AUTOR: 2,
  MARCADO_PUBLICABLE: 2,
  PUBLICADO: 2,
};
const PESO_PRODUCCION_DISTINTA = 3;

// ── labels en español por tipo de acción (fallback: valor humanizado) ──
const LABELS_ACCION: Record<string, string> = {
  ASIGNADO: 'Asignación',
  DESASIGNADO: 'Desasignación',
  REASIGNADO: 'Reasignación',
  CORRECCIONES_SOLICITADAS: 'Correcciones marcadas',
  CORRECCIONES_ENVIADAS: 'Correcciones enviadas al autor',
  REVISION_TERMINADA: 'Revisión terminada',
  CONSULTA_AUTOR: 'Consulta al autor',
  DEVUELTO_A_EDITOR: 'Devuelto al editor',
  DESCARTADO: 'Descarte',
  APROBADO: 'Aprobación',
  MARCADO_PUBLICABLE: 'Marcado como publicable',
  PUBLICADO: 'Publicación',
  ESTADO_CAMBIADO: 'Cambio de estado',
  EDICION_CAMBIADA: 'Cambio de edición',
  AUDITORIA_USUARIO: 'Cambios en usuarios',
  AUDITORIA_CONFIG: 'Cambios en configuración',
};

function labelAccion(valor: string): string {
  if (LABELS_ACCION[valor]) return LABELS_ACCION[valor];
  const texto = valor.replace(/_/g, ' ').toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ── colores estables: asignados sobre la lista COMPLETA de usuarios (orden
// alfabético que viene del server), nunca sobre el subconjunto filtrado ──
const PALETA = ['#d95f1a', '#33557a', '#2d7a4f', '#7a3b5e', '#b84d12', '#3f7f7a', '#946b2d', '#6b4e71', '#c0392b', '#556b2f', '#7d5a3c', '#4a443e'];

function colorDe(usuario: ActividadUsuario): string {
  return PALETA[usuario.i % PALETA.length];
}

// ── caché local (stale-while-revalidate; clearSession la barre al salir) ──
const CACHE_KEY = 'tds-actividad-cache-v1';

function leerCache(): ActividadDataset | null {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

function guardarCache(ds: ActividadDataset) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(ds)); } catch { /* sin caché local */ }
}

// ── filtros ──
// `usuario` NO achica la torta: la resalta (sector elegido vs. resto atenuado)
// y abre el desglose por tipo de acción, como se acordó.
const filtros = { periodo: '', edicion: 'todas', rol: 'equipo', usuario: 'todos' };

function rolPermite(rol: string): boolean {
  if (filtros.rol === 'todos') return true;
  if (filtros.rol === 'equipo') return rol === 'COORDINADOR' || rol === 'SUPERVISOR' || rol === 'EDITOR';
  return rol === filtros.rol;
}

function mesActual(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

function labelMes(mes: string): string {
  const fecha = new Date(`${mes}-02T12:00:00`);
  if (Number.isNaN(fecha.getTime())) return mes;
  const texto = fecha.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function labelEdicion(valor: string): string {
  if (valor === 'SIN_EDICION') return 'Sin edición';
  const num = Number(valor);
  return Number.isFinite(num) ? `Edición N° ${String(num).padStart(2, '0')}` : valor;
}

// ── agregación ──

interface PuntoUsuario {
  usuario: ActividadUsuario;
  color: string;
  acciones: number;
  producciones: number;
  puntos: number;
}

function coincidePeriodo(mes: string): boolean {
  return filtros.periodo === 'todos' || mes === filtros.periodo;
}

function coincideEdicion(edicion: string): boolean {
  return filtros.edicion === 'todas' || edicion === filtros.edicion;
}

// Agrega la torta: todos los usuarios del filtro período×edición×rol
// (independiente del usuario resaltado).
function agregarPorUsuario(): PuntoUsuario[] {
  const ds = dataset;
  if (!ds) return [];
  const acumulado = new Map<number, { acciones: number; producciones: Set<number>; puntos: number }>();
  for (const ev of ds.eventos) {
    if (!Array.isArray(ev) || ev.length < 6) continue;
    const [mesIdx, edIdx, uIdx, accIdx, idIdx, n] = ev;
    const mes = ds.meses[mesIdx];
    const edicion = ds.ediciones[edIdx];
    const usuario = ds.usuarios[uIdx];
    if (mes === undefined || edicion === undefined || !usuario) continue;
    if (!coincidePeriodo(mes) || !coincideEdicion(edicion) || !rolPermite(usuario.r)) continue;
    const peso = PESO_ACCION[ds.acciones[accIdx]] ?? 1;
    let celda = acumulado.get(uIdx);
    if (!celda) { celda = { acciones: 0, producciones: new Set<number>(), puntos: 0 }; acumulado.set(uIdx, celda); }
    celda.acciones += n;
    celda.puntos += n * peso;
    if (idIdx >= 0) celda.producciones.add(idIdx);
  }
  return [...acumulado.entries()]
    .map(([uIdx, celda]) => ({
      usuario: ds.usuarios[uIdx],
      color: colorDe(ds.usuarios[uIdx]),
      acciones: celda.acciones,
      producciones: celda.producciones.size,
      puntos: celda.puntos + celda.producciones.size * PESO_PRODUCCION_DISTINTA,
    }))
    .sort((a, b) => b.puntos - a.puntos);
}

// Desglose del usuario resaltado por tipo de acción (mismos filtros activos).
function desgloseAcciones(email: string): { valor: string; n: number }[] {
  const ds = dataset;
  if (!ds) return [];
  const porAccion = new Map<number, number>();
  for (const ev of ds.eventos) {
    if (!Array.isArray(ev) || ev.length < 6) continue;
    const [mesIdx, edIdx, uIdx, accIdx, , n] = ev;
    const mes = ds.meses[mesIdx];
    const edicion = ds.ediciones[edIdx];
    const usuario = ds.usuarios[uIdx];
    if (mes === undefined || edicion === undefined || !usuario) continue;
    if (usuario.e !== email || !coincidePeriodo(mes) || !coincideEdicion(edicion) || !rolPermite(usuario.r)) continue;
    porAccion.set(accIdx, (porAccion.get(accIdx) || 0) + n);
  }
  return [...porAccion.entries()]
    .map(([accIdx, n]) => ({ valor: ds.acciones[accIdx] ?? '?', n }))
    .sort((a, b) => b.n - a.n);
}

// ── render ──

function showAlert(message: string) {
  const el = document.getElementById('actividad-alert');
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
}

function hideAlert() {
  const el = document.getElementById('actividad-alert');
  if (el) { el.hidden = true; el.textContent = ''; }
}

function svgElement(name: string, attrs: Record<string, string>) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

// Geometría del anillo (origen en las 12, sentido horario).
const CX = 170;
const CY = 170;
const R_EXT = 150;
const R_INT = 88;
const PAPEL = '#faf8f4';

function polar(r: number, ang: number): [number, number] {
  return [CX + r * Math.cos(ang), CY + r * Math.sin(ang)];
}

function sectorPath(a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(R_EXT, a0);
  const [x1, y1] = polar(R_EXT, a1);
  const [x2, y2] = polar(R_INT, a1);
  const [x3, y3] = polar(R_INT, a0);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R_EXT} ${R_EXT} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${R_INT} ${R_INT} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

function textoContraste(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1e1a17' : '#ffffff';
}

function usuarioElegido(): ActividadUsuario | null {
  if (filtros.usuario === 'todos' || !dataset) return null;
  return dataset.usuarios.find((u) => u.e === filtros.usuario) || null;
}

function seleccionarUsuario(email: string) {
  filtros.usuario = filtros.usuario === email ? 'todos' : email;
  const select = document.getElementById('filtro-usuario') as HTMLSelectElement | null;
  if (select) select.value = filtros.usuario;
  render();
}

function armarTooltip(p: PuntoUsuario, pct: number): string {
  return `${p.usuario.n} (${p.usuario.r}) — ${p.puntos} pts · ${pct}% · ${p.acciones} acciones · ${p.producciones} producciones`;
}

function renderTorta(puntos: PuntoUsuario[]) {
  const svg = document.getElementById('actividad-torta');
  const layout = document.getElementById('actividad-layout');
  const empty = document.getElementById('actividad-empty');
  if (!svg || !layout || !empty) return;
  svg.replaceChildren();
  const total = puntos.reduce((sum, p) => sum + p.puntos, 0);
  const hayDatos = total > 0;
  empty.hidden = hayDatos;
  layout.hidden = !hayDatos;
  svg.setAttribute('aria-label', hayDatos ? `Torta de actividad: ${puntos.length} usuarios con actividad` : 'Sin actividad para el filtro actual');
  if (!hayDatos) return;

  const elegido = usuarioElegido();

  // Un solo usuario con actividad: el path de 360° degenera → anillo completo.
  if (puntos.length === 1) {
    const p = puntos[0];
    const pct = 100;
    const anillo = svgElement('circle', {
      cx: String(CX), cy: String(CY), r: String((R_EXT + R_INT) / 2),
      fill: 'none', stroke: p.color, 'stroke-width': String(R_EXT - R_INT),
    });
    const title = svgElement('title', {});
    title.textContent = armarTooltip(p, pct);
    anillo.appendChild(title);
    anillo.setAttribute('class', 'actividad-sector');
    anillo.addEventListener('click', () => seleccionarUsuario(p.usuario.e));
    svg.appendChild(anillo);
    agregarCentro(svg, String(p.puntos), p.puntos === 1 ? 'punto' : 'puntos');
    return;
  }

  let ang = -Math.PI / 2;
  for (const p of puntos) {
    const fraccion = p.puntos / total;
    const a1 = ang + fraccion * Math.PI * 2;
    const pct = Math.round(fraccion * 100);
    const atenuado = elegido !== null && elegido.e !== p.usuario.e;
    const path = svgElement('path', {
      d: sectorPath(ang, a1),
      fill: p.color,
      stroke: PAPEL,
      'stroke-width': '1',
      'fill-opacity': atenuado ? '0.25' : '1',
      class: 'actividad-sector',
    });
    if (elegido?.e === p.usuario.e) {
      path.setAttribute('stroke', '#1e1a17');
      path.setAttribute('stroke-width', '2');
    }
    const title = svgElement('title', {});
    title.textContent = armarTooltip(p, pct);
    path.appendChild(title);
    path.addEventListener('click', () => seleccionarUsuario(p.usuario.e));
    svg.appendChild(path);

    // % en el radio medio solo si el sector es grande; el resto vive en tooltip + leyenda.
    if (fraccion >= 0.04) {
      const medio = (ang + a1) / 2;
      const [tx, ty] = polar((R_EXT + R_INT) / 2, medio);
      const label = svgElement('text', {
        x: tx.toFixed(1), y: ty.toFixed(1),
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        fill: textoContraste(p.color), class: 'act-pct',
      });
      label.textContent = `${pct}%`;
      svg.appendChild(label);
    }
    ang = a1;
  }

  agregarCentro(svg, String(total), 'puntos');
}

function agregarCentro(svg: Element, numero: string, caption: string) {
  const num = svgElement('text', { x: String(CX), y: String(CY - 4), 'text-anchor': 'middle', class: 'act-centro-num' });
  num.textContent = numero;
  const cap = svgElement('text', { x: String(CX), y: String(CY + 20), 'text-anchor': 'middle', class: 'act-centro-cap' });
  cap.textContent = caption;
  svg.appendChild(num);
  svg.appendChild(cap);
}

function renderLeyenda(puntos: PuntoUsuario[]) {
  const lista = document.getElementById('actividad-leyenda');
  if (!lista) return;
  const total = puntos.reduce((sum, p) => sum + p.puntos, 0);
  const elegido = usuarioElegido();
  lista.replaceChildren();
  for (const p of puntos) {
    const pct = total > 0 ? Math.round((p.puntos / total) * 100) : 0;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'actividad-leyenda-item';
    btn.setAttribute('aria-pressed', elegido?.e === p.usuario.e ? 'true' : 'false');
    if (elegido && elegido.e !== p.usuario.e) btn.classList.add('dim');
    btn.innerHTML = `
      <span class="actividad-swatch" style="background:${p.color}"></span>
      <span class="actividad-nombre">${esc(p.usuario.n)} <small>· ${esc(p.usuario.r)}</small></span>
      <span class="actividad-pts">${p.puntos} · ${pct}%</span>
      <span class="actividad-sub">${p.acciones} acciones · ${p.producciones} producciones</span>`;
    btn.addEventListener('click', () => seleccionarUsuario(p.usuario.e));
    li.appendChild(btn);
    lista.appendChild(li);
  }
}

function renderKpis(puntos: PuntoUsuario[]) {
  const total = puntos.reduce((sum, p) => sum + p.puntos, 0);
  const acciones = puntos.reduce((sum, p) => sum + p.acciones, 0);
  const producciones = new Set<number>();
  const ds = dataset;
  if (ds) {
    for (const ev of ds.eventos) {
      if (!Array.isArray(ev) || ev.length < 6) continue;
      const [mesIdx, edIdx, uIdx, , idIdx] = ev;
      const usuario = ds.usuarios[uIdx];
      if (idIdx < 0 || !usuario || !rolPermite(usuario.r)) continue;
      if (!coincidePeriodo(ds.meses[mesIdx] ?? '') || !coincideEdicion(ds.ediciones[edIdx] ?? '')) continue;
      producciones.add(idIdx);
    }
  }
  const set = (id: string, valor: string) => { const el = document.getElementById(id); if (el) el.textContent = valor; };
  set('kpi-puntos', total.toLocaleString('es-AR'));
  set('kpi-usuarios', String(puntos.filter((p) => p.puntos > 0).length));
  set('kpi-producciones', String(producciones.size));
  set('kpi-acciones', acciones.toLocaleString('es-AR'));
  const periodo = filtros.periodo === 'todos' ? 'histórico completo' : labelMes(filtros.periodo);
  set('kpi-periodo', periodo);
}

function renderDesglose() {
  const card = document.getElementById('actividad-desglose');
  const heading = document.getElementById('desglose-heading');
  const resumen = document.getElementById('desglose-resumen');
  const barras = document.getElementById('actividad-barras');
  if (!card || !heading || !resumen || !barras) return;
  const elegido = usuarioElegido();
  card.hidden = !elegido;
  barras.replaceChildren();
  if (!elegido) return;

  heading.textContent = `${elegido.n} · ${elegido.r}`;
  const desglose = desgloseAcciones(elegido.e);
  const puntos = agregarPorUsuario().find((p) => p.usuario.e === elegido.e);
  if (puntos) {
    resumen.textContent = `${puntos.puntos} puntos · ${puntos.acciones} acciones · ${puntos.producciones} producciones distintas en el filtro actual.`;
  }
  const max = Math.max(1, ...desglose.map((d) => d.n));
  for (const d of desglose) {
    const li = document.createElement('li');
    li.className = 'actividad-bar-item';
    li.innerHTML = `
      <span class="actividad-bar-head"><span class="actividad-bar-label">${esc(labelAccion(d.valor))}</span><span class="actividad-bar-n">${d.n}</span></span>
      <div class="actividad-bar-track"><div class="actividad-bar-fill" style="width:${Math.round((d.n / max) * 100)}%"></div></div>`;
    barras.appendChild(li);
  }
}

function renderSummary() {
  const el = document.getElementById('actividad-summary');
  if (!el || !dataset) return;
  const avisos: string[] = [];
  if (dataset.descartados > 0) avisos.push(`${dataset.descartados} movimientos sin atribuir a un usuario del equipo`);
  if (dataset.colisiones > 0) avisos.push(`${dataset.colisiones} nombre(s) ambiguos resueltos por orden alfabético`);
  const generado = new Date(dataset.generado);
  const cuando = Number.isNaN(generado.getTime())
    ? ''
    : `Datos actualizados ${generado.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`;
  el.hidden = false;
  el.textContent = [cuando, ...avisos].filter(Boolean).join(' ');
}

function render() {
  const puntos = agregarPorUsuario();
  renderTorta(puntos);
  renderLeyenda(puntos);
  renderKpis(puntos);
  renderDesglose();
  renderSummary();
}

// ── selects ──

function poblarPeriodo() {
  const select = document.getElementById('filtro-periodo') as HTMLSelectElement | null;
  if (!select || !dataset) return;
  const previo = select.value || (dataset.meses.includes(mesActual()) ? mesActual() : 'todos');
  select.replaceChildren();
  for (const mes of [...dataset.meses].reverse()) {
    const option = document.createElement('option');
    option.value = mes;
    option.textContent = labelMes(mes);
    select.appendChild(option);
  }
  const todos = document.createElement('option');
  todos.value = 'todos';
  todos.textContent = 'Histórico completo';
  select.appendChild(todos);
  select.value = dataset.meses.includes(previo) || previo === 'todos' ? previo : 'todos';
  filtros.periodo = select.value;
}

function poblarEdiciones() {
  const select = document.getElementById('filtro-edicion') as HTMLSelectElement | null;
  if (!select || !dataset) return;
  const previo = select.value || 'todas';
  select.replaceChildren();
  const todas = document.createElement('option');
  todas.value = 'todas';
  todas.textContent = 'Todas las ediciones';
  select.appendChild(todas);
  for (const edicion of dataset.ediciones) {
    const option = document.createElement('option');
    option.value = edicion;
    option.textContent = labelEdicion(edicion);
    select.appendChild(option);
  }
  select.value = previo === 'todas' || dataset.ediciones.includes(previo) ? previo : 'todas';
  filtros.edicion = select.value;
}

function poblarUsuarios() {
  const select = document.getElementById('filtro-usuario') as HTMLSelectElement | null;
  if (!select || !dataset) return;
  select.replaceChildren();
  const todos = document.createElement('option');
  todos.value = 'todos';
  todos.textContent = 'Todos los usuarios';
  select.appendChild(todos);
  for (const usuario of dataset.usuarios) {
    if (!rolPermite(usuario.r)) continue;
    const option = document.createElement('option');
    option.value = usuario.e;
    option.textContent = `${usuario.n}${usuario.a ? '' : ' (inactivo)'}`;
    select.appendChild(option);
  }
  if (filtros.usuario !== 'todos' && !dataset.usuarios.some((u) => u.e === filtros.usuario && rolPermite(u.r))) {
    filtros.usuario = 'todos';
  }
  select.value = filtros.usuario;
}

// ── carga (stale-while-revalidate, patrón revistas) ──

function mostrarCargando(activo: boolean) {
  const el = document.getElementById('actividad-cargando');
  if (el) el.hidden = !activo;
}

function normalizarDataset(raw: Record<string, unknown>): ActividadDataset {
  return {
    generado: typeof raw.generado === 'string' ? raw.generado : '',
    meses: Array.isArray(raw.meses) ? (raw.meses as string[]) : [],
    ediciones: Array.isArray(raw.ediciones) ? (raw.ediciones as string[]) : [],
    usuarios: Array.isArray(raw.usuarios) ? (raw.usuarios as ActividadUsuario[]) : [],
    acciones: Array.isArray(raw.acciones) ? (raw.acciones as string[]) : [],
    ids: Array.isArray(raw.ids) ? (raw.ids as string[]) : [],
    eventos: Array.isArray(raw.eventos) ? (raw.eventos as number[][]) : [],
    descartados: Number(raw.descartados || 0),
    colisiones: Number(raw.colisiones || 0),
  };
}

async function load() {
  hideAlert();
  const cached = leerCache();
  if (cached?.usuarios) {
    dataset = normalizarDataset(cached);
    mostrarCargando(false);
    poblarPeriodo();
    poblarEdiciones();
    poblarUsuarios();
    render();
  } else {
    mostrarCargando(true);
  }
  const data = await api('panel/actividad/list');
  if (data.status !== 'ok') {
    mostrarCargando(false);
    if (!cached) showAlert(data.message || 'No se pudo cargar la actividad.');
    return;
  }
  dataset = normalizarDataset(data);
  guardarCache(dataset);
  mostrarCargando(false);
  poblarPeriodo();
  poblarEdiciones();
  poblarUsuarios();
  render();
}

// ── init ──

function init() {
  if (!user || !getIdToken() || !esGestorRol) {
    window.location.replace('/tablero/');
    return;
  }
  renderNav(user);

  document.getElementById('filtro-periodo')?.addEventListener('change', (e) => {
    filtros.periodo = (e.target as HTMLSelectElement).value;
    render();
  });
  document.getElementById('filtro-edicion')?.addEventListener('change', (e) => {
    filtros.edicion = (e.target as HTMLSelectElement).value;
    render();
  });
  document.getElementById('filtro-rol')?.addEventListener('change', (e) => {
    filtros.rol = (e.target as HTMLSelectElement).value;
    poblarUsuarios();
    render();
  });
  document.getElementById('filtro-usuario')?.addEventListener('change', (e) => {
    filtros.usuario = (e.target as HTMLSelectElement).value;
    render();
  });
  document.getElementById('btn-limpiar-usuario')?.addEventListener('click', () => {
    filtros.usuario = 'todos';
    const select = document.getElementById('filtro-usuario') as HTMLSelectElement | null;
    if (select) select.value = 'todos';
    render();
  });
  document.getElementById('btn-refrescar-actividad')?.addEventListener('click', load);

  load();
}

init();
