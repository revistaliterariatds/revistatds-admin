// board.gs — tablero del panel (Fase 3: lectura + autoasignación + acciones del titular).

// ── helpers ──
function produccionPublica(c) {
  var out = {};
  SHEETS.Tablero.forEach(function (h, j) { out[h] = c[h]; });
  out.enviado_autor = !!c.token_autor; // ya se envió un mail con token al autor
  out.token_autor = '';      // nunca exponer el token
  out.token_expira = '';
  out.titular = c.editor_asignado ? titularInfo(c.editor_asignado) : '';
  return out;
}

function clearBoardCache() {
  CacheService.getScriptCache().remove('board-list');
}

// ── tablero completo (lectura) ──
function handleBoardList(idToken) {
  var user = requireInternalUser(idToken);
  ensureTableroSchema();
  var cache = CacheService.getScriptCache();
  var rows = null;
  var cached = cache.get('board-list');
  if (cached) {
    rows = JSON.parse(cached);
  } else {
    var sheet = getSheet('Tablero');
    var idx = headerIndex(sheet);
    var data = sheet.getDataRange().getValues();
    rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = { _rowIndex: i };
      SHEETS.Tablero.forEach(function (h) { row[h] = data[i][idx[h]]; });
      rows.push(produccionPublica(row));
    }
    cache.put('board-list', JSON.stringify(rows), 30);
  }

  // Visibilidad por rol: RECIBIDO solo lo ven COORDINADOR/WEBMASTER/SUPERVISOR.
  // El EDITOR ve desde PRESELECCIONADO en adelante.
  if (user.rol === ROLES.EDITOR) {
    rows = rows.filter(function (r) { return r.estado !== ESTADOS.RECIBIDO; });
  }

  return ok({ producciones: rows, yo: { email: user.email, rol: user.rol } });
}

// ── detalle de una producción + historial ──
function handleBoardDetail(idToken, id) {
  var user = requireInternalUser(idToken);
  var c = findProduccionById(id);
  if (!c) throw new ApiError('Producción no encontrada.');
  // Misma política de visibilidad que el listado: RECIBIDO solo lo ven los
  // gestores. Se responde "no encontrada" (y no AuthError) para que el cliente
  // no interprete la regla de visibilidad como sesión expirada.
  if (user.rol === ROLES.EDITOR && c.estado === ESTADOS.RECIBIDO) {
    throw new ApiError('Producción no encontrada.');
  }
  return ok({ produccion: produccionPublica(c), historial: getHistorial(c.id) });
}

// ── asignación compartida (auto o manual) ──
function asignarProduccion(c, editorEmail, actor) {
  // El Doc se crea primero: si falla (scope), no se asigna nada.
  var docUrl = createDocCorreccion(c, editorEmail);
  var sheet = getSheet('Tablero');
  setCell(sheet, c._rowIndex, 'editor_asignado', editorEmail);
  setCell(sheet, c._rowIndex, 'url_doc_correccion', docUrl);
  setEstado(c, ESTADOS.EN_REVISION);
  addHistory(c.id, actor, 'ASIGNADO', 'Asignado a ' + displayName(editorEmail));
  clearBoardCache();
  try { sendAsignacion(editorEmail, c, docUrl); } catch (e) { /* el mail no bloquea la asignación */ }
  return docUrl;
}

function esGestor(user) {
  return ROLES_GESTORES.indexOf(user.rol) >= 0;
}

function esEditorActivo(email) {
  var u = resolveUser(email);
  return !!u && u.rol === ROLES.EDITOR && u.activo;
}

// ── listado de editores activos (para el dropdown "Asignar a…") ──
function handleBoardEditors(idToken) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  var sheet = getSheet('Roles');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var activo = String(data[i][idx.activo]).toUpperCase() === 'TRUE';
    if (activo && data[i][idx.rol] === ROLES.EDITOR) {
      out.push({ email: data[i][idx.email], nombre: data[i][idx.alias] || data[i][idx.nombre] || data[i][idx.email] });
    }
  }
  return ok({ editores: out });
}

// ── autoasignación (EDITOR) ──
function handleAsignarme(idToken, id) {
  var user = requireInternalUser(idToken);
  if (user.rol !== ROLES.EDITOR) throw new AuthError('Solo EDITOR puede autoasignarse producciones.');
  ensureTableroSchema();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (c.editor_asignado) throw new ApiError('La producción ya tiene editor.');
    if (c.estado !== ESTADOS.PRESELECCIONADO) throw new ApiError('Solo producciones PRESELECCIONADAS pueden autoasignarse.');

    var docUrl = asignarProduccion(c, user.email, displayName(user.email));
    try { notifyTeam('Asignado', displayName(user.email) + ' se asignó "' + c.titulo + '"'); } catch (e) { /* el aviso no bloquea la asignación */ }

    return ok({ message: 'Producción asignada.', estado: ESTADOS.EN_REVISION, doc_url: docUrl });
  } finally {
    lock.releaseLock();
  }
}

// ── asignar (COORDINADOR/SUPERVISOR) ──
function handleAsignar(idToken, id, editorEmail) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  if (!editorEmail) throw new ApiError('Falta el editor.');
  if (!esEditorActivo(editorEmail)) throw new ApiError('El destino debe ser un EDITOR activo.');
  ensureTableroSchema();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (c.editor_asignado) throw new ApiError('La producción ya tiene editor.');
    if (c.estado !== ESTADOS.PRESELECCIONADO) throw new ApiError('Solo producciones PRESELECCIONADAS pueden asignarse.');

    var docUrl = asignarProduccion(c, editorEmail, displayName(user.email));
    try { notifyTeam('Asignado', displayName(user.email) + ' asignó "' + c.titulo + '" a ' + displayName(editorEmail)); } catch (e) { /* el aviso no bloquea la asignación */ }

    return ok({ message: 'Producción asignada.', estado: ESTADOS.EN_REVISION, doc_url: docUrl });
  } finally {
    lock.releaseLock();
  }
}

// ── desasignar (COORDINADOR/SUPERVISOR) ──
function handleDesasignar(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (!c.editor_asignado) throw new ApiError('La producción no tiene editor.');

    var editorAnterior = c.editor_asignado;
    setCell(getSheet('Tablero'), c._rowIndex, 'editor_asignado', '');
    // Vuelve a PRESELECCIONADO salvo en CONSULTA_AUTOR / RECHAZADO_POR_AUTOR.
    if (c.estado !== ESTADOS.CONSULTA_AUTOR && c.estado !== ESTADOS.RECHAZADO_POR_AUTOR) {
      setEstado(c, ESTADOS.PRESELECCIONADO);
    }
    addHistory(c.id, displayName(user.email), 'DESASIGNADO', 'Liberado ' + displayName(editorAnterior));
    clearBoardCache();
    sendLiberacion(editorAnterior, c);

    return ok({ message: 'Producción desasignada.', estado: c.estado });
  } finally {
    lock.releaseLock();
  }
}

// ── reasignar (COORDINADOR/SUPERVISOR) ──
function handleReasignar(idToken, id, editorEmail) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  if (!editorEmail) throw new ApiError('Falta el editor.');
  if (!esEditorActivo(editorEmail)) throw new ApiError('El destino debe ser un EDITOR activo.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (!c.editor_asignado) throw new ApiError('La producción no tiene editor.');

    var anterior = c.editor_asignado;
    setCell(getSheet('Tablero'), c._rowIndex, 'editor_asignado', editorEmail);
    addHistory(c.id, displayName(user.email), 'REASIGNADO', 'De ' + displayName(anterior) + ' a ' + displayName(editorEmail));
    clearBoardCache();
    // Notifica al nuevo editor con el Doc existente (no se recrea).
    try { sendAsignacion(editorEmail, c, c.url_doc_correccion); } catch (e) { /* el mail no bloquea la reasignación */ }

    return ok({ message: 'Producción reasignada.', estado: c.estado });
  } finally {
    lock.releaseLock();
  }
}

// ── pedir correcciones al autor (editor titular: solo marca, NO envía mail) ──
function handlePedirCorrecciones(idToken, id) {
  var user = requireInternalUser(idToken);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (String(c.editor_asignado) !== String(user.email)) {
      throw new AuthError('Solo el editor asignado puede marcar esta producción.');
    }
    if (c.estado !== ESTADOS.EN_REVISION) throw new ApiError('La producción no está en revisión.');

    setEstado(c, ESTADOS.CORRECCIONES_SOLICITADAS);
    addHistory(c.id, displayName(user.email), 'CORRECCIONES_SOLICITADAS', 'El editor pidió correcciones (pendiente de envío al autor).');
    clearBoardCache();

    // Avisa al equipo para que el coordinador envíe el mail al autor.
    try { notifyTeam('Correcciones pendientes', displayName(user.email) + ' pidió correcciones para "' + c.titulo + '".'); }
    catch (e) { /* el aviso no bloquea la marca */ }

    return ok({ message: 'Correcciones marcadas. El coordinador debe enviarlas al autor.', estado: ESTADOS.CORRECCIONES_SOLICITADAS });
  } finally {
    lock.releaseLock();
  }
}

// ── enviar correcciones al autor (gestor): adjunta PDF + mensaje ──
function handleEnviarCorrecciones(idToken, id, fileId, mensaje) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Solo un gestor puede enviar el mail al autor.');
  if (!fileId) throw new ApiError('Elegí el archivo a adjuntar al autor.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (c.estado !== ESTADOS.CORRECCIONES_SOLICITADAS) throw new ApiError('La producción no está en correcciones solicitadas.');
    if (c.token_autor) throw new ApiError('Ya se envió el mail de correcciones al autor.');

    // El archivo elegido debe pertenecer a la carpeta de la producción.
    var pertenece = listarArchivosProduccion(c).some(function (a) { return a.fileId === String(fileId); });
    if (!pertenece) throw new ApiError('El archivo no pertenece a la carpeta de esta producción.');

    var pdfBlob = convertirAPdf(String(fileId));

    var token = Utilities.getUuid(); // crudo SOLO para el mail; en la hoja va hasheado
    var expiraDias = parseInt(getConfig('expira_token_dias') || '30', 10);
    var sheet = getSheet('Tablero');
    setCell(sheet, c._rowIndex, 'token_autor', hashearTokenAutor(token));
    setCell(sheet, c._rowIndex, 'token_expira', new Date(Date.now() + expiraDias * 24 * 3600 * 1000));

    try {
      sendPedirCorrecciones(c.email_autor, c, token, pdfBlob, mensaje);
    } catch (e) {
      setCell(sheet, c._rowIndex, 'token_autor', '');
      setCell(sheet, c._rowIndex, 'token_expira', '');
      throw new ApiError('No se pudo enviar el mail al autor: ' + (e.message || e));
    }

    addHistory(c.id, displayName(user.email), 'CORRECCIONES_ENVIADAS', 'El equipo envió las correcciones al autor.');
    clearBoardCache();

    return ok({ message: 'Se enviaron las correcciones al autor.', estado: ESTADOS.CORRECCIONES_SOLICITADAS });
  } finally {
    lock.releaseLock();
  }
}

// ── revisión terminada (editor titular) ──
function handleRevisionTerminada(idToken, id) {
  var user = requireInternalUser(idToken);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (String(c.editor_asignado) !== String(user.email)) {
      throw new AuthError('Solo el editor asignado puede operar esta producción.');
    }
    if (c.estado !== ESTADOS.EN_REVISION) throw new ApiError('La producción no está en revisión.');

    setEstado(c, ESTADOS.ESPERANDO_APROBACION);
    addHistory(c.id, displayName(user.email), 'REVISION_TERMINADA', 'El editor terminó la revisión.');
    clearBoardCache();

    var admins = getEmailsByRoles(ROLES_NOTIF_GESTORES);
    if (admins.length === 0) admins = [getSecret('ADMIN_EMAIL')].filter(Boolean);
    sendRevisionTerminada(admins, c, displayName(user.email));

    return ok({ message: 'Revisión terminada.', estado: ESTADOS.ESPERANDO_APROBACION });
  } finally {
    lock.releaseLock();
  }
}

// ── enviar la versión corregida a aprobación del autor ──
function handleConsultarAutor(idToken, id, fileId) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  if (!fileId) throw new ApiError('Elegí el archivo a adjuntar al autor.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    // El coordinador puede consultar al autor desde cualquier estado (también
    // lo usa el selector administrativo "Cambiar estado" → CONSULTA_AUTOR).

    // El archivo elegido debe pertenecer a la carpeta de la producción.
    var pertenece = listarArchivosProduccion(c).some(function (a) { return a.fileId === String(fileId); });
    if (!pertenece) throw new ApiError('El archivo no pertenece a la carpeta de esta producción.');

    // Se convierte a PDF antes de generar el token: si falla, no queda nada a medias.
    var pdfBlob = convertirAPdf(String(fileId));

    var token = Utilities.getUuid(); // crudo SOLO para el mail; en la hoja va hasheado
    var expiraDias = parseInt(getConfig('expira_token_dias') || '30', 10);
    var sheet = getSheet('Tablero');
    setCell(sheet, c._rowIndex, 'token_autor', hashearTokenAutor(token));
    setCell(sheet, c._rowIndex, 'token_expira', new Date(Date.now() + expiraDias * 24 * 3600 * 1000));

    try {
      sendConsultaAutor(c.email_autor, c, token, textoDocCorreccion(c), pdfBlob);
    } catch (e) {
      setCell(sheet, c._rowIndex, 'token_autor', '');
      setCell(sheet, c._rowIndex, 'token_expira', '');
      throw new ApiError('No se pudo enviar el mail al autor: ' + (e.message || e));
    }

    setEstado(c, ESTADOS.CONSULTA_AUTOR);
    addHistory(c.id, displayName(user.email), 'CONSULTA_AUTOR', 'Se envió la versión al autor para aprobación.');
    clearBoardCache();
    return ok({ message: 'La versión fue enviada al autor.', estado: ESTADOS.CONSULTA_AUTOR });
  } finally {
    lock.releaseLock();
  }
}

// ── resolución de rechazo del autor (COORDINADOR/SUPERVISOR) ──
function handleResolverRechazo(idToken, id, resolucion) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  if (resolucion !== 'devolver' && resolucion !== 'descartar') {
    throw new ApiError('Resolución inválida.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (c.estado !== ESTADOS.RECHAZADO_POR_AUTOR) {
      throw new ApiError('La producción no está rechazada por el autor.');
    }

    var nuevoEstado = resolucion === 'devolver' ? ESTADOS.EN_REVISION : ESTADOS.DESCARTADO;
    setEstado(c, nuevoEstado);
    addHistory(c.id, displayName(user.email), resolucion === 'devolver' ? 'DEVUELTO_A_EDITOR' : 'DESCARTADO',
      resolucion === 'devolver' ? 'El equipo devolvió la producción al editor.' : 'El equipo descartó la producción.');
    clearBoardCache();
    if (resolucion === 'devolver' && c.editor_asignado) {
      try { sendDevolucionEditor(c.editor_asignado, c); }
      catch (e) { notifyTeam('Notificación pendiente', 'No se pudo avisar al editor sobre la devolución de "' + c.titulo + '".'); }
    }
    return ok({ message: resolucion === 'devolver' ? 'Producción devuelta al editor.' : 'Producción descartada.', estado: nuevoEstado });
  } finally {
    lock.releaseLock();
  }
}

// ── aprobar directamente (COORDINADOR/SUPERVISOR) desde ESPERANDO_APROBACIÓN ──
function handleAprobar(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (c.estado !== ESTADOS.ESPERANDO_APROBACION) {
      throw new ApiError('Solo se puede aprobar una revisión terminada.');
    }
    setEstado(c, ESTADOS.APROBADO);
    addHistory(c.id, displayName(user.email), 'APROBADO', 'Aprobado directamente por el equipo.');
    clearBoardCache();
    notifyTeam('Aprobado', displayName(user.email) + ' aprobó "' + c.titulo + '"');
    return ok({ message: 'Producción aprobada.', estado: ESTADOS.APROBADO });
  } finally {
    lock.releaseLock();
  }
}

// ── listar archivos de la carpeta de la producción (gestores, para el selector) ──
function handleBoardArchivos(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  var c = findProduccionById(id);
  if (!c) throw new ApiError('Producción no encontrada.');
  return ok({ archivos: listarArchivosProduccion(c) });
}

// ── marcar publicable (COORDINADOR/WEBMASTER) ──
// Unifica "publicable" = "publicado": copia el archivo elegido a PUBLICABLES
// (si falta) y pasa la producción al estado PUBLICADO (se muestra "Publicable").
function handleMarcarPublicable(idToken, id, fileId) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede marcar publicable.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    if (c.estado === ESTADOS.PUBLICADO) throw new ApiError('La producción ya está marcada como publicable.');

    // Si aún no está en PUBLICABLES, copiar el archivo elegido.
    if (!c.url_publicable) {
      if (!fileId) throw new ApiError('Elegí el archivo a copiar a PUBLICABLES.');
      var pertenece = listarArchivosProduccion(c).some(function (a) { return a.fileId === String(fileId); });
      if (!pertenece) throw new ApiError('El archivo no pertenece a la carpeta de esta producción.');
      var url = copiarAPublicables(c, String(fileId));
      setCell(getSheet('Tablero'), c._rowIndex, 'url_publicable', url);
      c.url_publicable = url;
      addHistory(c.id, displayName(user.email), 'MARCADO_PUBLICABLE', 'Copiado a PUBLICABLES (' + url + ')');
    }

    setEstado(c, ESTADOS.PUBLICADO);
    addHistory(c.id, displayName(user.email), 'PUBLICADO', 'La producción fue marcada como publicable.');
    clearBoardCache();
    notifyTeam('Publicable', displayName(user.email) + ' marcó "' + c.titulo + '" como publicable.');
    return ok({ message: 'Producción marcada como publicable.', estado: ESTADOS.PUBLICADO, url_publicable: c.url_publicable });
  } finally {
    lock.releaseLock();
  }
}

// ── borrar envío por completo (COORDINADOR/WEBMASTER) ──
// Elimina la carpeta de Drive (original, corrección, versiones, version_aprobada),
// la copia en PUBLICABLES, la fila del Tablero y su historial.
function handleBorrarProduccion(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede borrar un envío.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');

    // Carpeta de trabajo de la producción (con todo su contenido).
    if (c.url_carpeta_drive) {
      var mFolder = String(c.url_carpeta_drive).match(/\/folders\/([-\w]+)/);
      if (mFolder) {
        try { DriveApp.getFolderById(mFolder[1]).setTrashed(true); }
        catch (e) { /* el borrado no debe fallar por un problema de Drive */ }
      }
    }

    // Copia en PUBLICABLES, si existe.
    if (c.url_publicable) {
      var mFile = String(c.url_publicable).match(/\/d\/([\w-]+)/);
      if (mFile) {
        try { DriveApp.getFileById(mFile[1]).setTrashed(true); }
        catch (e) { /* idem */ }
      }
    }

    // Historial de la producción.
    var hist = getSheet('Historial');
    if (hist && hist.getLastRow() > 1) {
      var idx = headerIndex(hist);
      var data = hist.getDataRange().getValues();
      for (var i = data.length - 1; i >= 1; i--) {
        if (String(data[i][idx.id_produccion]) === String(id)) {
          hist.deleteRow(i + 1);
        }
      }
    }

    // Fila del Tablero.
    getSheet('Tablero').deleteRow(c._rowIndex + 1);
    clearBoardCache();

    return ok({ message: 'Envío eliminado por completo.' });
  } finally {
    lock.releaseLock();
  }
}

// ── cambiar estado arbitrario (COORDINADOR/WEBMASTER, en cualquier momento) ──
function handleCambiarEstado(idToken, id, nuevoEstado) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede cambiar estados.');

  var estado = String(nuevoEstado || '').trim();
  var estadosValidos = Object.keys(ESTADOS).map(function (k) { return ESTADOS[k]; });
  if (estadosValidos.indexOf(estado) < 0) throw new ApiError('Estado inválido.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findProduccionById(id);
    if (!c) throw new ApiError('Producción no encontrada.');
    setEstado(c, estado);
    addHistory(c.id, displayName(user.email), 'ESTADO_CAMBIADO', 'El equipo cambió el estado a ' + estado + '.');
    clearBoardCache();
    return ok({ message: 'Estado actualizado.', estado: estado });
  } finally {
    lock.releaseLock();
  }
}
