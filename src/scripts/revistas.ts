// revistas.ts — Ediciones publicadas de la revista (todos los roles).

import { api, btnCargando, clearSession, getIdToken, getUser } from './api';

interface Revista {
  num: string;
  titulo: string;
  pdf_url: string;
  portada_url: string;
}

const user = getUser();
const esGestor = user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';
const esAdmin = user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER';

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

function clearCachedRevistas() {
  try { localStorage.removeItem(REVISTAS_CACHE_KEY); } catch { /* sin caché local */ }
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

// ── subida de una edición nueva (COORDINADOR/WEBMASTER) ──
// El PDF viaja por chunks de 5 MB (base64); el backend lo reconstruye en Drive.
// Si un chunk falla por red, se consulta el estado y se reanuda desde ahí.
const REVISTAS_PDF_MAX = 40 * 1024 * 1024;
const REVISTAS_PORTADA_MAX = 4 * 1024 * 1024;
const CHUNK_BYTES = 5 * 1024 * 1024;

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      resolve(raw.slice(raw.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

async function subirPdf(pdfFile: File, num: string, titulo: string, btn: HTMLButtonElement | null) {
  const totalChunks = Math.ceil(pdfFile.size / CHUNK_BYTES);
  let sent = 0;
  while (sent < totalChunks) {
    const slice = pdfFile.slice(sent * CHUNK_BYTES, Math.min((sent + 1) * CHUNK_BYTES, pdfFile.size));
    const chunk_b64 = await fileToBase64(slice);
    if (btn) btn.textContent = `Subiendo… ${Math.round((sent / totalChunks) * 100)}%`;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const data = await api('panel/revistas/subir-chunk', {
          chunk_b64,
          index: sent,
          total_chunks: totalChunks,
          total_bytes: pdfFile.size,
          num: sent === 0 ? num : undefined,
          titulo: sent === 0 ? titulo : undefined,
        });
        if (data.status !== 'ok') throw new Error(data.message || 'Error subiendo el PDF.');
        sent = Number(data.received) || sent + 1;
        ok = true;
      } catch (err) {
        if (attempt === 2) throw err;
        const st = await api('panel/revistas/subir-estado');
        sent = Number((st as { received?: number })?.received) || sent;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
}

function initSubida() {
  if (!esAdmin) return;
  const section = document.getElementById('revista-subir');
  if (!section) return;
  section.hidden = false;

  document.getElementById('revista-subir-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const pdfInput = document.getElementById('revista-pdf') as HTMLInputElement;
    const portadaInput = document.getElementById('revista-portada') as HTMLInputElement;
    const tituloInput = document.getElementById('revista-titulo') as HTMLInputElement;
    const numInput = document.getElementById('revista-num') as HTMLInputElement;
    const btn = (event as SubmitEvent).submitter as HTMLButtonElement | null;

    const pdfFile = pdfInput.files?.[0];
    if (!pdfFile) { showAlert('Elegí el PDF de la edición.'); return; }
    if (pdfFile.size > REVISTAS_PDF_MAX) { showAlert('El PDF supera el máximo de 40 MB.'); return; }
    const portadaFile = portadaInput.files?.[0];
    if (portadaFile && portadaFile.size > REVISTAS_PORTADA_MAX) { showAlert('La portada supera el máximo de 4 MB.'); return; }

    if (btn) btnCargando(btn, true);
    try {
      const portada_b64 = portadaFile ? await fileToBase64(portadaFile) : '';
      const titulo = tituloInput.value.trim();
      const num = numInput.value.trim();
      if (btn) btn.textContent = 'Subiendo… 0%';
      await subirPdf(pdfFile, num, titulo, btn);
      if (btn) btn.textContent = 'Publicando…';
      const data = await api('panel/revistas/finalizar', { portada_b64 });
      if (data.status !== 'ok') { showAlert(data.message || 'No se pudo publicar la edición.'); return; }
      form.reset();
      showAlert(data.message || 'Edición en proceso de publicación.');
      clearCachedRevistas();
      window.setTimeout(load, 60000); // la edición aparece sola cuando el sitio la publica
    } catch (err) {
      showAlert((err as Error).message || 'No se pudo subir la edición. Reintentá.');
    } finally {
      if (btn) btnCargando(btn, false);
    }
  });
}

function init() {
  if (!user || !getIdToken()) { window.location.replace('/'); return; }
  renderNav();
  document.getElementById('btn-cerrar-revista')?.addEventListener('click', () => {
    (document.getElementById('revistaModal') as HTMLDialogElement).close();
  });
  document.getElementById('btn-refrescar-revistas')?.addEventListener('click', load);
  initSubida();
  load();
}

init();