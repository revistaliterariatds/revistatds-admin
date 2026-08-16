// autor.gs — endpoints del autor (token de un solo uso).
//
// Flujo: el autor recibe por mail un link `…/autor/?token=X&accion=…`.
// `estado` (lectura) no consume el token; `approve`/`reject`/`edit` sí
// (un solo uso por ronda, con LockService anti doble clic).

function findProduccion(colName, value) {
  var sheet = getSheet('Tablero');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx[colName]]) === String(value)) {
      var row = { _rowIndex: i };
      SHEETS.Tablero.forEach(function (h) { row[h] = data[i][idx[h]]; });
      return row;
    }
  }
  return null;
}

function findProduccionByToken(token) { return findProduccion('token_autor', token); }
function findProduccionById(id) { return findProduccion('id', id); }

function requireToken(token) {
  if (!token) throw new ApiError('Falta el token.');
  var produccion = findProduccionByToken(token);
  if (!produccion) throw new ApiError('Link inválido o ya utilizado.');
  if (produccion.token_expira && new Date(produccion.token_expira).getTime() < Date.now()) {
    throw new ApiError('El link venció.');
  }
  return produccion;
}

function setEstado(produccion, nuevoEstado) {
  var sheet = getSheet('Tablero');
  setCell(sheet, produccion._rowIndex, 'estado', nuevoEstado);
  setCell(sheet, produccion._rowIndex, 'fecha_actualizacion', new Date());
  produccion.estado = nuevoEstado;
}

function consumeToken(produccion) {
  setCell(getSheet('Tablero'), produccion._rowIndex, 'token_autor', '');
  produccion.token_autor = '';
}

function getHistorial(idProduccion) {
  var sheet = getSheet('Historial');
  var idx = headerIndex(sheet);
  var colId = historialIdIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colId]) === String(idProduccion)) {
      out.push({
        timestamp: data[i][idx.timestamp],
        actor: data[i][idx.actor],
        accion: data[i][idx.accion],
        detalle: data[i][idx.detalle],
      });
    }
  }
  return out;
}

// ── estado (lectura, no consume) ──
function handleAutorEstado(token) {
  var c = requireToken(token);
  return ok({
    titulo: c.titulo,
    autor: c.autor,
    estado: c.estado,
    version: c.version_actual,
    convocatoria: c.convocatoria,
    fecha_recibido: c.fecha_recibido,
    historial: getHistorial(c.id),
  });
}

// ── aprobar (CONSULTA_AUTOR → APROBADO) ──
function handleAutorApprove(token) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = requireToken(token);
    if (c.estado !== ESTADOS.CONSULTA_AUTOR) {
      throw new ApiError('No hay una consulta pendiente de aprobación.');
    }
    // La copia aprobada queda persistida antes de cambiar el estado.
    guardarVersionAprobada(c);
    setEstado(c, ESTADOS.APROBADO);
    consumeToken(c);
    addHistory(c.id, 'AUTOR', 'APROBADO', 'El autor aprobó la versión.');
    clearBoardCache();
    return ok({ message: 'Aprobado. ¡Gracias!', estado: ESTADOS.APROBADO });
  } finally {
    lock.releaseLock();
  }
}

// ── no aprobar (CONSULTA_AUTOR → RECHAZADO_POR_AUTOR) ──
function handleAutorReject(token, motivo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = requireToken(token);
    if (c.estado !== ESTADOS.CONSULTA_AUTOR) {
      throw new ApiError('No hay una consulta pendiente.');
    }
    setEstado(c, ESTADOS.RECHAZADO_POR_AUTOR);
    consumeToken(c);
    addHistory(c.id, 'AUTOR', 'NO_APROBADO', (motivo || '') ? 'Motivo: ' + motivo : 'Sin motivo.');
    clearBoardCache();
    return ok({ message: 'Recibido. El equipo editorial lo revisará.', estado: ESTADOS.RECHAZADO_POR_AUTOR });
  } finally {
    lock.releaseLock();
  }
}

// ── subir versión (CORRECCIONES_SOLICITADAS o CONSULTA_AUTOR → EN_REVISIÓN) ──
function handleAutorEdit(token, archivos) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = requireToken(token);
    if (c.estado !== ESTADOS.CORRECCIONES_SOLICITADAS && c.estado !== ESTADOS.CONSULTA_AUTOR) {
      throw new ApiError('No corresponde subir una versión en este estado.');
    }
    var archivosArr = validarArchivos(archivos);

    // Guardar la nueva versión en la carpeta de la producción.
    var version = parseInt(c.version_actual || '1', 10) + 1;
    var estadoAnterior = c.estado;
    var folder = getProduccionFolder(c);
    var subfolder = getOrCreateFolder(folder, 'v' + version);
    saveFiles(subfolder, archivosArr);

    var sheet = getSheet('Tablero');
    setCell(sheet, c._rowIndex, 'version_actual', String(version));
    c.version_actual = String(version);
    if (c.editor_asignado) {
      var docUrl = createDocCorreccion(c, c.editor_asignado, subfolder);
      setCell(sheet, c._rowIndex, 'url_doc_correccion', docUrl);
      c.url_doc_correccion = docUrl;
    }
    setEstado(c, ESTADOS.EN_REVISION);
    consumeToken(c);
    addHistory(c.id, 'AUTOR', 'NUEVA_VERSION', 'El autor subió la versión ' + version + '.');
    clearBoardCache();
    if (c.editor_asignado) {
      try {
        // Desde CONSULTA_AUTOR el autor pide modificar: aviso a editor + COORDINADOR/SUPERVISOR
        // para que se contacten y definan. Desde CORRECCIONES_SOLICITADAS solo al editor.
        if (estadoAnterior === ESTADOS.CONSULTA_AUTOR) sendSolicitudModificacion(c);
        else sendNuevaVersion(c.editor_asignado, c);
      } catch (e) { notifyTeam('Notificación pendiente', 'No se pudo avisar al equipo sobre la nueva versión de "' + c.titulo + '".'); }
    }
    return ok({ message: 'Versión recibida. El editor la revisará.', version: String(version), estado: ESTADOS.EN_REVISION });
  } finally {
    lock.releaseLock();
  }
}

function getProduccionFolder(produccion) {
  var url = produccion.url_carpeta_drive;
  if (url) {
    try {
      var m = url.match(/\/folders\/([-\w]+)/);
      if (m) return DriveApp.getFolderById(m[1]);
    } catch (e) { /* fallback abajo */ }
  }
  return createProduccionFolder(produccion.id);
}
