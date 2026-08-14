// ediciones.gs — Ediciones de la revista: ciclo abrir/cerrar con reglas de fecha
// y reasignación de la edición de cada envío. Cerrar/abrir = ADMIN/WEBMASTER;
// reasignar por publicación = ADMIN/WEBMASTER/SUPERVISOR.
// Al cerrar/abrir se crea una cita automática en la Agenda.

var EDICION_INICIAL = 3; // edición que estaba abierta al migrar al nuevo sistema

function clearEdicionesCache() {
  CacheService.getScriptCache().remove('ediciones-list');
}

// Número de la edición abierta (o ''). Defensivo: si la hoja no existe
// (migración pendiente) el circuito de envíos no debe romperse.
function edicionActual() {
  var sheet = getSheet('Ediciones');
  if (!sheet || sheet.getLastRow() <= 1) return '';
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.estado]) === 'abierta') {
      return String(data[i][idx.numero]);
    }
  }
  return '';
}

function listarEdiciones() {
  var sheet = getSheet('Ediciones');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][idx.numero] == null || data[i][idx.numero] === '') continue;
    out.push({
      numero: String(data[i][idx.numero]),
      estado: String(data[i][idx.estado] || ''),
      fecha_apertura: data[i][idx.fecha_apertura] == null ? '' : String(data[i][idx.fecha_apertura]),
      fecha_cierre: data[i][idx.fecha_cierre] == null ? '' : String(data[i][idx.fecha_cierre]),
    });
  }
  out.sort(function (a, b) { return Number(a.numero) - Number(b.numero); });
  return out;
}

function existeEdicion(numero) {
  return listarEdiciones().some(function (e) { return e.numero === String(numero); });
}

// ── listado (gestores; el tablero lo usa para reasignar) ──
function handleEdicionesList(idToken) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  var cache = CacheService.getScriptCache();
  var cached = cache.get('ediciones-list');
  if (cached) return JSON.parse(cached);
  var result = ok({
    ediciones: listarEdiciones(),
    actual: edicionActual(),
    puede_gestionar: esAdmin(user),
  });
  cache.put('ediciones-list', JSON.stringify(result), 30);
  return result;
}

// ── cerrar edición N (ADMIN/WEBMASTER) ──
function handleCerrarEdicion(idToken, numero) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo ADMINISTRADOR o WEBMASTER puede gestionar ediciones.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ediciones = listarEdiciones();
    var ed = null;
    ediciones.forEach(function (e) { if (e.numero === String(numero)) ed = e; });
    if (!ed) throw new ApiError('Edición no encontrada.');
    if (ed.estado !== 'abierta') throw new ApiError('La edición ' + ed.numero + ' no está abierta.');

    var fechaCierre = hoyKey();
    var sheet = getSheet('Ediciones');
    var row = findRowIndex(sheet, 'numero', ed.numero);
    setCell(sheet, row, 'estado', 'cerrada');
    setCell(sheet, row, 'fecha_cierre', fechaCierre);
    clearEdicionesCache();
    clearAgendaCache();

    crearCitaAutomatica(
      fechaCierre,
      'Cierre de recepción — Edición ' + ed.numero,
      'La recepción de la edición ' + ed.numero + ' cerró el ' + fechaCierre + '.',
      'cierre_edicion',
      user.email
    );

    return ok({ message: 'Edición ' + ed.numero + ' cerrada.', estado: 'cerrada', fecha_cierre: fechaCierre });
  } finally {
    lock.releaseLock();
  }
}

// ── abrir edición N+1 (ADMIN/WEBMASTER) ──
// Reglas: la última edición debe tener fecha_cierre y solo se puede abrir
// desde el día calendario siguiente a esa fecha.
function handleAbrirEdicion(idToken) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo ADMINISTRADOR o WEBMASTER puede gestionar ediciones.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ediciones = listarEdiciones();
    var abiertas = ediciones.filter(function (e) { return e.estado === 'abierta'; });
    if (abiertas.length > 0) {
      throw new ApiError('La edición ' + abiertas[0].numero + ' sigue abierta. Cerrala antes de abrir una nueva.');
    }
    var ultima = ediciones[ediciones.length - 1];
    if (!ultima || !ultima.fecha_cierre) {
      throw new ApiError('No hay una edición cerrada con fecha de cierre. Cerra la edición actual primero.');
    }
    if (hoyKey() <= ultima.fecha_cierre) {
      throw new ApiError('La nueva edición recién puede abrirse desde el día siguiente calendario a la fecha de cierre (' + ultima.fecha_cierre + ').');
    }

    var numeroNuevo = (Number(ultima.numero) || 0) + 1;
    var fechaApertura = hoyKey();
    getSheet('Ediciones').appendRow([String(numeroNuevo), 'abierta', fechaApertura, '']);
    clearEdicionesCache();
    clearAgendaCache();

    crearCitaAutomatica(
      fechaApertura,
      'Apertura de recepción — Edición ' + numeroNuevo,
      'La recepción de la edición ' + numeroNuevo + ' abrió el ' + fechaApertura + '.',
      'evento',
      user.email
    );

    return ok({ message: 'Edición ' + numeroNuevo + ' abierta.', numero: String(numeroNuevo) });
  } finally {
    lock.releaseLock();
  }
}

// ── reasignar la edición de una publicación (ADMIN/WEBMASTER/SUPERVISOR) ──
function handleCambiarEdicion(idToken, id, edicion) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var edicionStr = String(edicion == null ? '' : edicion).trim();
  if (edicionStr && !existeEdicion(edicionStr)) throw new ApiError('La edición elegida no existe.');

  var c = findCuentoById(id);
  if (!c) throw new ApiError('Cuento no encontrado.');

  var sheet = getSheet('Tablero');
  setCell(sheet, c._rowIndex, 'edicion', edicionStr);
  addHistory(c.id, displayName(user.email), 'EDICION_CAMBIADA',
    edicionStr ? 'Reasignado a la edición ' + edicionStr : 'Edición sin asignar');
  clearBoardCache();
  return ok({ message: 'Edición del cuento actualizada.', edicion: edicionStr });
}

// Migración única: columna `edicion` en Tablero + hoja Ediciones sembrada.
// Ejecutar una vez desde el editor de Apps Script (Run migrateEdiciones).
function migrateEdiciones() {
  ensureSchema(); // crea las hojas nuevas (Ediciones, Agenda, AgendaComentarios) si faltan

  var tablero = getSheet('Tablero');
  var idx = headerIndex(tablero);
  if (idx.edicion === undefined) {
    tablero.insertColumnAfter(tablero.getLastColumn());
    tablero.getRange(1, tablero.getLastColumn()).setValue('edicion');
  }
  // Backfill: todos los envíos existentes pasan a la edición inicial.
  var idx2 = headerIndex(tablero);
  var data = tablero.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][idx2.edicion] == null || String(data[i][idx2.edicion]) === '') {
      tablero.getRange(i + 1, idx2.edicion + 1).setValue(String(EDICION_INICIAL));
    }
  }

  var ediciones = getSheet('Ediciones');
  if (ediciones.getLastRow() <= 1) {
    ediciones.appendRow([String(EDICION_INICIAL), 'abierta', hoyKey(), '']);
  }
  clearBoardCache();
  clearEdicionesCache();
  Logger.log('migrateEdiciones: edición inicial ' + EDICION_INICIAL + ' sembrada como abierta.');
  return 'OK';
}
