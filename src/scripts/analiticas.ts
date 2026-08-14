import { api, clearSession, getIdToken, getUser } from './api';

const user = getUser();
const esGestor = user?.rol === 'ADMINISTRADOR' || user?.rol === 'SUPERVISOR';
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

function renderChart(data: Visit[]) {
  const svg = document.getElementById('visits-chart')!;
  svg.replaceChildren();
  const width = 800; const height = 320; const pad = 36;
  const max = Math.max(1, ...data.map((item) => item.visits));
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const ns = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(ns, 'polyline');
  const points = data.map((item, index) => `${pad + step * index},${height - pad - (item.visits / max) * (height - pad * 2)}`).join(' ');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#d95f1a'); line.setAttribute('stroke-width', '3');
  svg.appendChild(line);
  data.forEach((item, index) => {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(pad + step * index));
    circle.setAttribute('cy', String(height - pad - (item.visits / max) * (height - pad * 2)));
    circle.setAttribute('r', '4'); circle.setAttribute('fill', '#d95f1a');
    const title = document.createElementNS(ns, 'title'); title.textContent = `${item.date}: ${item.visits} visitas`;
    circle.appendChild(title); svg.appendChild(circle);
  });
  const total = data.reduce((sum, item) => sum + item.visits, 0);
  document.getElementById('analytics-summary')!.textContent = `${total} visitas registradas en el período seleccionado.`;
}

async function load() {
  const days = Number((document.getElementById('analytics-days') as HTMLSelectElement).value);
  const data = await api('panel/analytics/daily', { days });
  if (data.status !== 'ok') { showAlert(data.message || 'No se pudieron cargar las analíticas.'); return; }
  renderChart(data.daily || []);
}

function init() {
  if (!user || !getIdToken() || !esGestor) { window.location.replace('/tablero/'); return; }
  renderNav();
  document.getElementById('analytics-days')?.addEventListener('change', load);
  load();
}

init();
