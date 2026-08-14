import { api, clearSession, getIdToken, getUser } from './api';

const user = getUser();
const esGestor = user?.rol === 'ADMINISTRADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';
type Visit = { date: string; visits: number };

function renderNav() {
  const nav = document.getElementById('nav-user');
  if (!nav || !user) return;
  nav.hidden = false;
  document.getElementById('nav-user-name')!.textContent = user.nombre || user.email;
  document.getElementById('nav-user-role')!.textContent = user.rol;
  (document.getElementById('nav-users') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-config') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-analytics') as HTMLElement).hidden = !esGestor;
  document.getElementById('nav-logout')?.addEventListener('click', () => { clearSession(); window.location.replace('/'); });
}

function showAlert(message: string) {
  const el = document.getElementById('analytics-alert')!;
  el.hidden = false;
  el.textContent = message;
}

function svgElement(name: string, attrs: Record<string, string>) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function formatDate(value: string, withYear = false) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

function renderChart(data: Visit[]) {
  const svg = document.getElementById('visits-chart')!;
  svg.replaceChildren();
  const empty = document.getElementById('analytics-empty')!;
  empty.hidden = data.length > 0;
  if (data.length === 0) {
    document.getElementById('kpi-total')!.textContent = '0';
    document.getElementById('kpi-average')!.textContent = '0';
    document.getElementById('kpi-peak')!.textContent = '0';
    document.getElementById('kpi-peak-date')!.textContent = 'sin datos';
    return;
  }

  const width = 920; const height = 380;
  const left = 62; const right = 24; const top = 24; const bottom = 58;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const max = Math.max(1, ...data.map((item) => item.visits));
  const scaleMax = Math.max(5, Math.ceil(max / 5) * 5);
  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;
  const y = (value: number) => top + plotHeight - (value / scaleMax) * plotHeight;
  const x = (index: number) => left + step * index;
  const ns = 'http://www.w3.org/2000/svg';
  const defs = svgElement('defs', {});
  const gradient = svgElement('linearGradient', { id: 'visits-fill', x1: '0', x2: '0', y1: '0', y2: '1' });
  gradient.appendChild(svgElement('stop', { offset: '0%', 'stop-color': '#d95f1a', 'stop-opacity': '0.24' }));
  gradient.appendChild(svgElement('stop', { offset: '100%', 'stop-color': '#d95f1a', 'stop-opacity': '0.02' }));
  defs.appendChild(gradient); svg.appendChild(defs);

  for (let index = 0; index <= 4; index++) {
    const value = (scaleMax / 4) * index;
    const yPos = y(value);
    svg.appendChild(svgElement('line', { x1: String(left), x2: String(width - right), y1: String(yPos), y2: String(yPos), class: 'chart-grid' }));
    const label = svgElement('text', { x: String(left - 12), y: String(yPos + 4), class: 'chart-y-label', 'text-anchor': 'end' });
    label.textContent = String(Math.round(value)); svg.appendChild(label);
  }

  const points = data.map((item, index) => `${x(index)},${y(item.visits)}`);
  const area = `M ${x(0)} ${height - bottom} L ${points.join(' L ')} L ${x(data.length - 1)} ${height - bottom} Z`;
  svg.appendChild(svgElement('path', { d: area, class: 'chart-area' }));
  svg.appendChild(svgElement('polyline', { points: points.join(' '), class: 'chart-line' }));
  data.forEach((item, index) => {
    const circle = svgElement('circle', { cx: String(x(index)), cy: String(y(item.visits)), r: '4', class: 'chart-point' });
    const title = svgElement('title', {}); title.textContent = `${formatDate(item.date, true)}: ${item.visits} visitas`;
    circle.appendChild(title); svg.appendChild(circle);
    if (data.length <= 7 || index === 0 || index === data.length - 1 || index % 5 === 0) {
      const label = svgElement('text', { x: String(x(index)), y: String(height - 20), class: 'chart-x-label', 'text-anchor': 'middle' });
      label.textContent = formatDate(item.date); svg.appendChild(label);
    }
  });
  const total = data.reduce((sum, item) => sum + item.visits, 0);
  const peak = data.reduce((best, item) => item.visits > best.visits ? item : best, data[0]);
  document.getElementById('kpi-total')!.textContent = total.toLocaleString('es-AR');
  document.getElementById('kpi-average')!.textContent = Math.round(total / data.length).toLocaleString('es-AR');
  document.getElementById('kpi-peak')!.textContent = peak.visits.toLocaleString('es-AR');
  document.getElementById('kpi-peak-date')!.textContent = formatDate(peak.date, true);
  document.getElementById('analytics-summary')!.textContent = `${data.length} días con datos en el período seleccionado.`;
}

function analyticsCacheKey(days: number | string): string {
  return `tds-analytics-cache-${days}`;
}

function readCachedChart(days: number | string): Visit[] | null {
  try { return JSON.parse(localStorage.getItem(analyticsCacheKey(days)) || 'null'); } catch { return null; }
}

async function load() {
  const selected = (document.getElementById('analytics-days') as HTMLSelectElement).value;
  const days: number | string = selected === 'all' ? 'all' : Number(selected);
  const cached = readCachedChart(days);
  if (cached) renderChart(cached);
  const data = await api('panel/analytics/daily', { days });
  if (data.status !== 'ok') { if (!cached) showAlert(data.message || 'No se pudieron cargar las analíticas.'); return; }
  const daily = data.daily || [];
  renderChart(daily);
  try { localStorage.setItem(analyticsCacheKey(days), JSON.stringify(daily)); } catch { /* sin caché local */ }
}

function init() {
  if (!user || !getIdToken() || !esGestor) { window.location.replace('/tablero/'); return; }
  renderNav();
  document.getElementById('analytics-days')?.addEventListener('change', load);
  load();
}

init();
