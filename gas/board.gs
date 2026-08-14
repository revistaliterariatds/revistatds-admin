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

// ── tablero completo (lectura) ──
function handleBoardList(idToken) {
  var user = requireInternalUser(idToken);
  var sheet = getSheet('Tablero');
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = { _rowIndex: i };
    SHEETS.Tablero.forEach(function (h, j) { row[h] = data[i][j]; });
    rows.push(cuentoPublico(row));
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
  try { sendAsignacion(editorEmail, c, docUrl); } catch (e) { /* el mail no bloquea la asignación */ }
  return docUrl;
}

function esGestor(user) {
  return user.rol === ROLES.ADMINISTRADOR || user.rol === ROLES.SUPERVISOR;
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
  if (ROLES_INTERNOS.indexOf(user.rol) < 0) throw new AuthError('Sin permisos.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (c.editor_asignado) throw new ApiError('El cuento ya tiene editor.');
    if (c.estado !== ESTADOS.RECIBIDO) throw new ApiError('Solo cuentos RECIBIDO pueden autoasignarse.');

    var docUrl = asignarCuento(c, user.email, displayName(user.email));
    notifyTeam('Asignado', displayName(user.email) + ' se asignó "' + c.titulo + '"');

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

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (c.editor_asignado) throw new ApiError('El cuento ya tiene editor.');
    if (c.estado !== ESTADOS.RECIBIDO) throw new ApiError('Solo cuentos RECIBIDO pueden asignarse.');

    var docUrl = asignarCuento(c, editorEmail, displayName(user.email));
    notifyTeam('Asignado', displayName(user.email) + ' asignó "' + c.titulo + '" a ' + displayName(editorEmail));

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
    // Vuelve a RECIBIDO salvo en CONSULTA_AUTOR / RECHAZADO_POR_AUTOR.
    if (c.estado !== ESTADOS.CONSULTA_AUTOR && c.estado !== ESTADOS.RECHAZADO_POR_AUTOR) {
      setEstado(c, ESTADOS.RECIBIDO);
    }
    addHistory(c.id, displayName(user.email), 'DESASIGNADO', 'Liberado ' + displayName(editorAnterior));
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

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = findCuentoById(id);
    if (!c) throw new ApiError('Cuento no encontrado.');
    if (!c.editor_asignado) throw new ApiError('El cuento no tiene editor.');

    var anterior = c.editor_asignado;
    setCell(getSheet('Tablero'), c._rowIndex, 'editor_asignado', editorEmail);
    addHistory(c.id, displayName(user.email), 'REASIGNADO', 'De ' + displayName(anterior) + ' a ' + displayName(editorEmail));
    // Notifica al nuevo editor con el Doc existente (no se recrea).
    sendAsignacion(editorEmail, c, c.url_doc_correccion);

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

    var admins = getEmailsByRoles([ROLES.ADMINISTRADOR, ROLES.SUPERVISOR]);
    if (admins.length === 0) admins = [getSecret('ADMIN_EMAIL')].filter(Boolean);
    sendRevisionTerminada(admins, c, displayName(user.email));

    return ok({ message: 'Revisión terminada.', estado: ESTADOS.ESPERANDO_APROBACION });
  } finally {
    lock.releaseLock();
  }
}
