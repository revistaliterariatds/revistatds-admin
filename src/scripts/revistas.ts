// revistas.ts — Ediciones publicadas de la revista (todos los roles).

import { api, clearSession, getIdToken, getUser } from './api';

interface Revista {
  num: string;
  titulo: string;
  pdf_url: string;
  portada_url: string;
}

const user = getUser();
const esGestor = user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';

function renderNav() {
  const nav = document.getElementById('nav-user');
  if (!nav || !user) return;
  nav.hidden = false;
  document.getElementById('nav-user-name')!.textContent = user.nombre || user.email;
  document.getElementById('nav-user-role')!.textContent = user.rol;
  (document.getElementById('nav-users') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-config') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-analytics') as HTMLElement).hidden = !esGestor;
  (document.getElementById('nav-descargas') as HTMLElement).hidden = !esGestor;
  document.getElementById('nav-logout')?.addEventListener('click', () => { clearSession(); window.location.replace('/'); });
}

function showAlert(message: string) {
  const el = document.getElementById('revistas-alert')!;
  el.hidden = false;
  el.textContent = message;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function render(revistas: Revista[]) {
  const grid = document.getElementById('revistas-grid')!;
  const empty = document.getElementById('revistas-empty')!;
  empty.hidden = revistas.length > 0;
  grid.innerHTML = revistas.map((r) => `
    <article class="revista-card">
      <div class="revista-cover">
        <img
          src="${esc(r.portada_url)}"
          alt="Portada ${esc(r.titulo)}"
          loading="lazy"
          onerror="this.parentElement.innerHTML='<div class=\\'revista-cover-placeholder\\'>${esc(r.num)}</div>'"
        />
      </div>
      <div class="revista-info">
        <span class="revista-label">Edición</span>
        <span class="revista-num">${esc(r.titulo)}</span>
        <div class="revista-btns">
          <button type="button" class="btn-enviar" data-leer="${esc(r.num)}">Leer</button>
          <a class="btn-ghost" href="${esc(r.pdf_url)}" target="_blank" rel="noopener noreferrer">Descargar</a>
        </div>
      </div>
    </article>`).join('');

  grid.querySelectorAll('[data-leer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = revistas.find((x) => x.num === (btn as HTMLElement).dataset.leer);
      if (!r) return;
      (document.getElementById('revista-frame') as HTMLIFrameElement).src = r.pdf_url;
      (document.getElementById('revistaModal') as HTMLDialogElement).showModal();
    });
  });
}

// ── datos (stale-while-revalidate) ──
const REVISTAS_CACHE_KEY = 'tds-revistas-cache-v1';

function readCachedRevistas(): Revista[] | null {
  try { return JSON.parse(localStorage.getItem(REVISTAS_CACHE_KEY) || 'null'); } catch { return null; }
}

function saveCachedRevistas(revistas: Revista[]) {
  try { localStorage.setItem(REVISTAS_CACHE_KEY, JSON.stringify(revistas)); } catch { /* sin caché local */ }
}

async function load() {
  hideAlert();
  const cached = readCachedRevistas();
  if (cached) render(cached);
  const data = await api('panel/revistas/list');
  if (data.status !== 'ok') {
    if (!cached) showAlert(data.message || 'No se pudieron cargar las ediciones.');
    return;
  }
  const revistas: Revista[] = data.revistas || [];
  render(revistas);
  saveCachedRevistas(revistas);
  const grid = document.getElementById('revistas-grid')!;
  grid.setAttribute('aria-busy', 'false');
}

function hideAlert() {
  document.getElementById('revistas-alert')!.hidden = true;
}

function init() {
  if (!user || !getIdToken()) { window.location.replace('/'); return; }
  renderNav();
  document.getElementById('btn-cerrar-revista')?.addEventListener('click', () => {
    (document.getElementById('revistaModal') as HTMLDialogElement).close();
  });
  document.getElementById('btn-refrescar-revistas')?.addEventListener('click', load);
  load();
}

init();