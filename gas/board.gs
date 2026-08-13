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

    var sheet = getSheet('Tablero');
    setCell(sheet, c._rowIndex, 'editor_asignado', user.email);
    setEstado(c, ESTADOS.EN_REVISION);
    addHistory(c.id, displayName(user.email), 'ASIGNADO', 'Autoasignado a ' + displayName(user.email));

    var docUrl = createDocCorreccion(c, user.email);
    setCell(sheet, c._rowIndex, 'url_doc_correccion', docUrl);

    sendAsignacion(user.email, c, docUrl);
    notifyTeam('Asignado', displayName(user.email) + ' se asignó "' + c.titulo + '"');

    return ok({ message: 'Cuento asignado.', estado: ESTADOS.EN_REVISION, doc_url: docUrl });
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

    setEstado(c, ESTADOS.CORRECCIONES_SOLICITADAS);

    // Token fresco para que el autor suba la versión.
    var token = Utilities.getUuid();
    var expiraDias = parseInt(getConfig('expira_token_dias') || '30', 10);
    var sheet = getSheet('Tablero');
    setCell(sheet, c._rowIndex, 'token_autor', token);
    setCell(sheet, c._rowIndex, 'token_expira', new Date(Date.now() + expiraDias * 24 * 3600 * 1000));

    addHistory(c.id, displayName(user.email), 'CORRECCIONES_SOLICITADAS', motivo || '');
    sendPedirCorrecciones(c.email_autor, c, token);

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
