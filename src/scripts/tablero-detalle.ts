// tablero-detalle.ts — modal de detalle de una producción (render + acciones).
// Importa estado/helpers de tablero.ts y le exporta abrirDetalle; el ciclo es
// solo a nivel de función (nunca durante la evaluación de los módulos).

import { api, getUser } from './api';
import { esc, esGestor as esGestorRol, esAdmin as esAdminRol, confirmar } from './ui';
import {
  type Produccion,
  ESTADOS,
  badge,
  fmtRelativa,
  convocatoriaLabel,
  accionAutorInfo,
  accionAutorBadge,
  mutar,
  getEdiciones,
  buscarProduccion,
  quitarProduccion,
} from './tablero';

// Booleanos de rol para las plantillas (la función de ui.ts es siempre truthy).
const esGestor = esGestorRol(getUser());
const esAdmin = esAdminRol(getUser());

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

let detalleReq = 0;

export async function abrirDetalle(id: string) {
  const modal = document.getElementById('detailModal') as HTMLDialogElement;
  const content = document.getElementById('detailContent')!;
  const req = ++detalleReq;

  // Abre al instante con los datos que ya están en el tablero (caché local)
  // y refresca el detalle completo (historial incluido) en segundo plano.
  const local = buscarProduccion(id);
  if (local) renderDetalle(content, modal, local, [], id);

  const data = await api('panel/board/detail', { id });
  if (req !== detalleReq) return; // ya se abrió otro detalle mientras tanto
  if (data.status !== 'ok') {
    if (!local) alert(data.message || 'No se pudo cargar el detalle.');
    return;
  }
  renderDetalle(content, modal, data.produccion, data.historial || [], id);
}

export function renderDetalle(content: HTMLElement, modal: HTMLDialogElement, c: Produccion, hist: { timestamp: string; actor: string; accion: string; detalle: string }[], id: string) {
  const soyTitular = c.editor_asignado === getUser()?.email;

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
    .concat(getEdiciones().map((e) => `<option value="${esc(e.numero)}"${String(c.edicion ?? '').trim() === String(e.numero) ? ' selected' : ''}>Edición ${esc(e.numero)}</option>`))
    .join('');

  const histAbierto = (content.querySelector('.detail-historial') as HTMLDetailsElement | null)?.open ?? false;

  content.innerHTML = `
    <h2 class="detail-titulo">${esc(c.titulo)}</h2>
    <div class="detail-badge">${badge(c.estado)}${c.estado !== 'PUBLICADO' && c.url_publicable ? ` <span class="badge badge-green">Publicable</span>` : ''}</div>
    <dl class="detail-meta">
      <div><dt>Autor</dt><dd>${esc(c.autor)} <span class="td-cat">(${esc(c.email_autor)})</span></dd></div>
      <div><dt>Categoría</dt><dd>${esc(c.categoria || 'Sin clasificar')}</dd></div>
      <div><dt>Convocatoria</dt><dd>${convocatoriaLabel(c.convocatoria)}</dd></div>
      <div><dt>Versión</dt><dd>${esc(c.version_actual || '1')}</dd></div>
      <div><dt>Titular</dt><dd>${c.titular ? esc(c.titular) : '<em>libre</em>'}</dd></div>
      ${accionAutorInfo(c) ? `<div><dt>Última decisión del autor</dt><dd>${accionAutorBadge(c)}${c.accion_autor_detalle ? ' <span class="td-cat">' + esc(c.accion_autor_detalle) + '</span>' : ''}</dd></div>` : ''}
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
    <details class="detail-historial" style="margin-bottom:0.75rem;">
      <summary class="detail-sub" style="cursor:pointer;user-select:none;">Historial${hist.length ? ` · ${hist.length} registro${hist.length === 1 ? '' : 's'}` : ''}</summary>
      <ol class="timeline">${timeline || '<li>Sin actividad.</li>'}</ol>
    </details>
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

  const det = content.querySelector('.detail-historial') as HTMLDetailsElement | null;
  if (det && histAbierto) det.open = true;

  const edicionSelect = content.querySelector('#cambiar-edicion') as HTMLSelectElement | null;
  edicionSelect?.addEventListener('change', async () => {
    const r = await mutar(id, 'panel/board/cambiar-edicion', { edicion: edicionSelect.value }, { edicion: edicionSelect.value });
    if (r.status !== 'ok') alert(r.message || 'No se pudo cambiar la edición.');
  });

  content.querySelector('[data-detalle-accion="pedir"]')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Marcar que el autor debe hacer correcciones? El coordinador le enviará luego el mail.'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/pedir-correcciones', {}, { estado: 'CORRECCIONES_SOLICITADAS' });
    if (r.status !== 'ok') alert(r.message || 'No se pudo marcar.');
  });

  content.querySelector('[data-detalle-accion="enviar-correcciones"]')?.addEventListener('click', () => abrirSelectorEnviarCorrecciones(id));

  content.querySelector('#btn-confirmar-enviar')?.addEventListener('click', async () => {
    const select = document.getElementById('enviar-archivo') as HTMLSelectElement | null;
    if (!select || !select.value) { alert('Elegí un archivo.'); return; }
    const mensaje = (document.getElementById('enviar-mensaje') as HTMLTextAreaElement).value.trim();
    if (!(await confirmar('¿Enviar las correcciones al autor (con el archivo como PDF)?'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/enviar-correcciones', { fileId: select.value, mensaje }, { enviado_autor: true, estado: 'CORRECCIONES_SOLICITADAS' });
    if (r.status !== 'ok') alert(r.message || 'No se pudo enviar.');
  });

  content.querySelector('#btn-cancelar-enviar')?.addEventListener('click', () => {
    const group = document.getElementById('enviarCorreccionesGroup');
    if (group) group.hidden = true;
  });

  content.querySelector('[data-detalle-accion="terminar"]')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Marcar la revisión como terminada?'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/revision-terminada', {}, { estado: 'ESPERANDO_APROBACIÓN' });
    if (r.status !== 'ok') alert(r.message || 'No se pudo.');
  });

  content.querySelector('[data-detalle-accion="consultar"]')?.addEventListener('click', () => abrirSelectorConsulta(id));

  content.querySelector('#btn-confirmar-consulta')?.addEventListener('click', async () => {
    const select = document.getElementById('consulta-archivo') as HTMLSelectElement | null;
    if (!select || !select.value) { alert('Elegí un archivo.'); return; }
    if (!(await confirmar('¿Enviar este archivo (como PDF) al autor para aprobación?'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/consultar-autor', { fileId: select.value }, { estado: 'CONSULTA_AUTOR' });
    if (r.status !== 'ok') alert(r.message || 'No se pudo consultar al autor.');
  });

  content.querySelector('#btn-cancelar-consulta')?.addEventListener('click', () => {
    const group = document.getElementById('consultaGroup');
    if (group) group.hidden = true;
  });

  content.querySelector('[data-detalle-accion="aprobar"]')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Aprobar esta producción?'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/aprobar', {}, { estado: 'APROBADO' });
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
    if (!(await confirmar('¿Cambiar el estado de esta publicación a "' + estado + '"?'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/cambiar-estado', { estado }, { estado });
    if (r.status !== 'ok') alert(r.message || 'No se pudo cambiar el estado.');
  });

  content.querySelector('[data-detalle-accion="devolver"]')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Devolver esta producción al editor para retrabajarla?'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/resolver-rechazo', { resolucion: 'devolver' }, { estado: 'EN_REVISIÓN' });
    if (r.status !== 'ok') alert(r.message || 'No se pudo devolver al editor.');
  });

  content.querySelector('[data-detalle-accion="descartar"]')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Descartar definitivamente esta producción?'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/resolver-rechazo', { resolucion: 'descartar' }, { estado: 'DESCARTADO' });
    if (r.status !== 'ok') alert(r.message || 'No se pudo descartar.');
  });

  content.querySelector('[data-detalle-accion="marcar-publicable"]')?.addEventListener('click', async () => {
    if (c.url_publicable) {
      if (!(await confirmar('¿Marcar esta producción como publicable?'))) return;
      modal.close();
      const r = await mutar(id, 'panel/board/marcar-publicable', {}, { estado: 'PUBLICADO' });
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
    if (!(await confirmar('¿Copiar este archivo a PUBLICABLES y marcar la producción como publicable?'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/marcar-publicable', { fileId: select.value }, { estado: 'PUBLICADO' });
    if (r.status !== 'ok') alert(r.message || 'No se pudo marcar publicable.');
  });

  content.querySelector('#btn-cancelar-publicable')?.addEventListener('click', () => {
    const group = document.getElementById('publicableGroup');
    if (group) group.hidden = true;
  });

  content.querySelector('[data-detalle-accion="borrar"]')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Borrar este envío por completo? Se eliminará la carpeta de Drive, la copia en PUBLICABLES, la fila y su historial. Esta acción no se puede deshacer.'))) return;
    modal.close();
    const r = await mutar(id, 'panel/board/borrar', {}, () => quitarProduccion(id));
    if (r.status !== 'ok') alert(r.message || 'No se pudo borrar el envío.');
  });
}
