// board.gs — tablero del panel (Fase 3: lectura + autoasignación + acciones del titular).

// ── helpers ──
function cuentoPublico(c) {
  var out = {};
  SHEETS.Tablero.forEach(function (h, j) { out[h] = c[h]; });
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
      rows.push(cuentoPublico(row));
    }
    cache.put('board-list', JSON.stringify(rows), 30);
  }

  // Visibilidad por rol: RECIBIDO solo lo ven ADMIN/WEBMASTER/SUPERVISOR.
  // El EDITOR ve desde PRESELECCIONADO en adelante.
  if (user.rol === ROLES.EDITOR) {
    rows = rows.filter(function (r) { return r.estado !== ESTADOS.RECIBIDO; });
  }

  return ok({ cuentos: rows, yo: { email: user.email, rol: user.rol } });
}

// ── detalle de un cuento + historial ──
function handleBoardDetail(idToken, id) {
  requireInternalUser(idToken);
  var c = findCuentoById(id);
  if (!c) throw new ApiError('Cuento no encontrado.');
  return ok({ cuento: cuentoPublico(c), historial: getHistorial(c.id) });
}

// ── asignación compartida (auto o manual) ──
function asignarCuento(c, editorEmail, actor) {
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
  if (user.rol !== ROLES.EDITOR) throw new AuthError('Solo EDITOR puede autoasignarse cuentos.');
  ensureTableroSchema();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (c.editor_asignado) throw new ApiError('El cuento ya tiene editor.');
    if (c.estado !== ESTADOS.PRESELECCIONADO) throw new ApiError('Solo cuentos PRESELECCIONADO pueden autoasignarse.');

    var docUrl = asignarCuento(c, user.email, displayName(user.email));
    try { notifyTeam('Asignado', displayName(user.email) + ' se asignó "' + c.titulo + '"'); } catch (e) { /* el aviso no bloquea la asignación */ }

    return ok({ message: 'Cuento asignado.', estado: ESTADOS.EN_REVISION, doc_url: docUrl });
  } finally {
    lock.releaseLock();
  }
}

// ── asignar (ADMIN/SUPERVISOR) ──
function handleAsignar(idToken, id, editorEmail) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  if (!editorEmail) throw new ApiError('Falta el editor.');
  if (!esEditorActivo(editorEmail)) throw new ApiError('El destino debe ser un EDITOR activo.');
  ensureTableroSchema();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (c.editor_asignado) throw new ApiError('El cuento ya tiene editor.');
    if (c.estado !== ESTADOS.PRESELECCIONADO) throw new ApiError('Solo cuentos PRESELECCIONADO pueden asignarse.');

    var docUrl = asignarCuento(c, editorEmail, displayName(user.email));
    try { notifyTeam('Asignado', displayName(user.email) + ' asignó "' + c.titulo + '" a ' + displayName(editorEmail)); } catch (e) { /* el aviso no bloquea la asignación */ }

    return ok({ message: 'Cuento asignado.', estado: ESTADOS.EN_REVISION, doc_url: docUrl });
  } finally {
    lock.releaseLock();
  }
}

// ── desasignar (ADMIN/SUPERVISOR) ──
function handleDesasignar(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (!c.editor_asignado) throw new ApiError('El cuento no tiene editor.');

    var editorAnterior = c.editor_asignado;
    setCell(getSheet('Tablero'), c._rowIndex, 'editor_asignado', '');
    // Vuelve a PRESELECCIONADO salvo en CONSULTA_AUTOR / RECHAZADO_POR_AUTOR.
    if (c.estado !== ESTADOS.CONSULTA_AUTOR && c.estado !== ESTADOS.RECHAZADO_POR_AUTOR) {
      setEstado(c, ESTADOS.PRESELECCIONADO);
    }
    addHistory(c.id, displayName(user.email), 'DESASIGNADO', 'Liberado ' + displayName(editorAnterior));
    clearBoardCache();
    sendLiberacion(editorAnterior, c);

    return ok({ message: 'Cuento desasignado.', estado: c.estado });
  } finally {
    lock.releaseLock();
  }
}

// ── reasignar (ADMIN/SUPERVISOR) ──
function handleReasignar(idToken, id, editorEmail) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  if (!editorEmail) throw new ApiError('Falta el editor.');
  if (!esEditorActivo(editorEmail)) throw new ApiError('El destino debe ser un EDITOR activo.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (!c.editor_asignado) throw new ApiError('El cuento no tiene editor.');

    var anterior = c.editor_asignado;
    setCell(getSheet('Tablero'), c._rowIndex, 'editor_asignado', editorEmail);
    addHistory(c.id, displayName(user.email), 'REASIGNADO', 'De ' + displayName(anterior) + ' a ' + displayName(editorEmail));
    clearBoardCache();
    // Notifica al nuevo editor con el Doc existente (no se recrea).
    try { sendAsignacion(editorEmail, c, c.url_doc_correccion); } catch (e) { /* el mail no bloquea la reasignación */ }

    return ok({ message: 'Cuento reasignado.', estado: c.estado });
  } finally {
    lock.releaseLock();
  }
}

// ── pedir correcciones al autor (editor titular) ──
function handlePedirCorrecciones(idToken, id, motivo) {
  var user = requireInternalUser(idToken);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (String(c.editor_asignado) !== String(user.email)) {
      throw new AuthError('Solo el editor asignado puede operar este cuento.');
    }
    if (c.estado !== ESTADOS.EN_REVISION) throw new ApiError('El cuento no está en revisión.');

    // Token fresco + expiración (guardamos antes para que el link del mail valga).
    var token = Utilities.getUuid();
    var expiraDias = parseInt(getConfig('expira_token_dias') || '30', 10);
    var sheet = getSheet('Tablero');
    setCell(sheet, c._rowIndex, 'token_autor', token);
    setCell(sheet, c._rowIndex, 'token_expira', new Date(Date.now() + expiraDias * 24 * 3600 * 1000));

    // El mail es crítico: si falla, revertimos el token y NO cambiamos el estado.
    try {
      sendPedirCorrecciones(c.email_autor, c, token);
    } catch (e) {
      setCell(sheet, c._rowIndex, 'token_autor', '');
      throw new ApiError('No se pudo enviar el mail al autor: ' + (e.message || e));
    }

    setEstado(c, ESTADOS.CORRECCIONES_SOLICITADAS);
    addHistory(c.id, displayName(user.email), 'CORRECCIONES_SOLICITADAS', motivo || '');
    clearBoardCache();

    return ok({ message: 'Se pidieron correcciones al autor.', estado: ESTADOS.CORRECCIONES_SOLICITADAS });
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
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (String(c.editor_asignado) !== String(user.email)) {
      throw new AuthError('Solo el editor asignado puede operar este cuento.');
    }
    if (c.estado !== ESTADOS.EN_REVISION) throw new ApiError('El cuento no está en revisión.');

    setEstado(c, ESTADOS.ESPERANDO_APROBACION);
    addHistory(c.id, displayName(user.email), 'REVISION_TERMINADA', 'El editor terminó la revisión.');
    clearBoardCache();

    var admins = getEmailsByRoles(ROLES_GESTORES);
    if (admins.length === 0) admins = [getSecret('ADMIN_EMAIL')].filter(Boolean);
    sendRevisionTerminada(admins, c, displayName(user.email));

    return ok({ message: 'Revisión terminada.', estado: ESTADOS.ESPERANDO_APROBACION });
  } finally {
    lock.releaseLock();
  }
}

// ── enviar la versión corregida a aprobación del autor ──
function handleConsultarAutor(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (c.estado !== ESTADOS.ESPERANDO_APROBACION) {
      throw new ApiError('Solo se puede consultar al autor una revisión terminada.');
    }

    var token = Utilities.getUuid();
    var expiraDias = parseInt(getConfig('expira_token_dias') || '30', 10);
    var sheet = getSheet('Tablero');
    setCell(sheet, c._rowIndex, 'token_autor', token);
    setCell(sheet, c._rowIndex, 'token_expira', new Date(Date.now() + expiraDias * 24 * 3600 * 1000));

    try {
      sendConsultaAutor(c.email_autor, c, token, textoDocCorreccion(c), pdfDocCorreccion(c));
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

// ── publicación (ADMIN/SUPERVISOR) ──
function handlePublicar(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (c.estado !== ESTADOS.APROBADO) throw new ApiError('Solo se puede publicar un cuento aprobado.');

    setEstado(c, ESTADOS.PUBLICADO);
    addHistory(c.id, displayName(user.email), 'PUBLICADO', 'La versión aprobada fue marcada como publicada.');
    clearBoardCache();
    notifyTeam('Publicado', displayName(user.email) + ' publicó "' + c.titulo + '"');
    return ok({ message: 'Cuento marcado como publicado.', estado: ESTADOS.PUBLICADO });
  } finally {
    lock.releaseLock();
  }
}

// ── resolución de rechazo del autor (ADMIN/SUPERVISOR) ──
function handleResolverRechazo(idToken, id, resolucion) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  if (resolucion !== 'devolver' && resolucion !== 'descartar') {
    throw new ApiError('Resolución inválida.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (c.estado !== ESTADOS.RECHAZADO_POR_AUTOR) {
      throw new ApiError('El cuento no está rechazado por el autor.');
    }

    var nuevoEstado = resolucion === 'devolver' ? ESTADOS.EN_REVISION : ESTADOS.DESCARTADO;
    setEstado(c, nuevoEstado);
    addHistory(c.id, displayName(user.email), resolucion === 'devolver' ? 'DEVUELTO_A_EDITOR' : 'DESCARTADO',
      resolucion === 'devolver' ? 'El equipo devolvió el cuento al editor.' : 'El equipo descartó el cuento.');
    clearBoardCache();
    if (resolucion === 'devolver' && c.editor_asignado) {
      try { sendDevolucionEditor(c.editor_asignado, c); }
      catch (e) { notifyTeam('Notificación pendiente', 'No se pudo avisar al editor sobre la devolución de "' + c.titulo + '".'); }
    }
    return ok({ message: resolucion === 'devolver' ? 'Cuento devuelto al editor.' : 'Cuento descartado.', estado: nuevoEstado });
  } finally {
    lock.releaseLock();
  }
}

// ── aprobar directamente (ADMIN/SUPERVISOR) desde ESPERANDO_APROBACIÓN ──
function handleAprobar(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (c.estado !== ESTADOS.ESPERANDO_APROBACION) {
      throw new ApiError('Solo se puede aprobar una revisión terminada.');
    }
    setEstado(c, ESTADOS.APROBADO);
    addHistory(c.id, displayName(user.email), 'APROBADO', 'Aprobado directamente por el equipo.');
    clearBoardCache();
    notifyTeam('Aprobado', displayName(user.email) + ' aprobó "' + c.titulo + '"');
    return ok({ message: 'Cuento aprobado.', estado: ESTADOS.APROBADO });
  } finally {
    lock.releaseLock();
  }
}

// ── cambiar estado arbitrario (ADMIN/WEBMASTER, en cualquier momento) ──
function handleCambiarEstado(idToken, id, nuevoEstado) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo ADMINISTRADOR o WEBMASTER puede cambiar estados.');

  var estado = String(nuevoEstado || '').trim();
  var estadosValidos = Object.keys(ESTADOS).map(function (k) { return ESTADOS[k]; });
  if (estadosValidos.indexOf(estado) < 0) throw new ApiError('Estado inválido.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    setEstado(c, estado);
    addHistory(c.id, displayName(user.email), 'ESTADO_CAMBIADO', 'El equipo cambió el estado a ' + estado + '.');
    clearBoardCache();
    return ok({ message: 'Estado actualizado.', estado: estado });
  } finally {
    lock.releaseLock();
  }
}
