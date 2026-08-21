// ediciones.gs — Ediciones de la revista: ciclo abrir/cerrar con reglas de fecha
// y reasignación de la edición de cada envío. Cerrar/abrir = COORDINADOR/WEBMASTER;
// reasignar por publicación = COORDINADOR/WEBMASTER/SUPERVISOR.
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

// Número de la última edición (sin importar el estado), o '' si no hay ninguna.
function ultimaEdicion() {
  var ediciones = listarEdiciones();
  return ediciones.length ? ediciones[ediciones.length - 1].numero : '';
}

// Edición cuyo rango [apertura, cierre] contiene la fecha dada (cierre vacío =
// abierta, sin límite superior). Las ediciones no se superponen, así que a lo
// sumo una contiene la fecha; devuelve '' si ninguna la contiene.
function edicionPorFecha(fechaKey) {
  var ediciones = listarEdiciones();
  if (!ediciones.length) return '';
  var mejor = '';
  ediciones.forEach(function (e) {
    var apertura = e.fecha_apertura || '';
    var cierre = e.fecha_cierre || '';
    if (!apertura) return;
    if (fechaKey < apertura) return;
    if (cierre && fechaKey > cierre) return;
    mejor = e.numero;
  });
  return mejor;
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
      fecha_apertura: fmtCelda(data[i][idx.fecha_apertura], 'yyyy-MM-dd'),
      fecha_cierre: fmtCelda(data[i][idx.fecha_cierre], 'yyyy-MM-dd'),
    });
  }
  out.sort(function (a, b) { return Number(a.numero) - Number(b.numero); });
  return out;
}

// Valida que la fecha elegida sea una fecha calendario real (YYYY-MM-DD).
function validarFechaInput(valor) {
  var s = String(valor == null ? '' : valor).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  var p = s.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  if (d.getFullYear() !== Number(p[0]) || d.getMonth() + 1 !== Number(p[1]) || d.getDate() !== Number(p[2])) return '';
  return s;
}

// Dos rangos se superponen si comparten al menos un día.
// Fin vacío = abierta (sin límite).
function rangoSeSuperpone(inicio1, fin1, inicio2, fin2) {
  var i1 = inicio1 || '';
  var f1 = fin1 || '9999-12-31';
  var i2 = inicio2 || '';
  var f2 = fin2 || '9999-12-31';
  if (!i1 || !i2) return true;
  return i1 <= f2 && i2 <= f1;
}

function existeEdicion(numero) {
  return listarEdiciones().some(function (e) { return e.numero === String(numero); });
}

// ── listado (gestores; el tablero lo usa para reasignar) ──
function handleEdicionesList(idToken) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  var cache = CacheService.getScriptCache();
  // Caché solo de la parte compartida; puede_gestionar es por-request.
  var cached = cache.get('ediciones-list');
  var base;
  if (cached) {
    base = JSON.parse(cached);
  } else {
    base = { ediciones: listarEdiciones(), actual: edicionActual() };
    cache.put('ediciones-list', JSON.stringify(base), 30);
  }
  return ok({
    ediciones: base.ediciones,
    actual: base.actual,
    puede_gestionar: esAdmin(user),
  });
}

// ── cerrar edición N con fecha elegida (COORDINADOR/WEBMASTER) ──
function handleCerrarEdicion(idToken, numero, fechaCierre) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede gestionar ediciones.');

  var fecha = validarFechaInput(fechaCierre);
  if (!fecha) throw new ApiError('Ingresá una fecha de cierre válida.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ediciones = listarEdiciones();
    var ed = null;
    ediciones.forEach(function (e) { if (e.numero === String(numero)) ed = e; });
    if (!ed) throw new ApiError('Edición no encontrada.');
    if (ed.estado !== 'abierta') throw new ApiError('La edición ' + ed.numero + ' no está abierta.');
    if (ed.fecha_apertura && fecha < ed.fecha_apertura) {
      throw new ApiError('La fecha de cierre no puede ser anterior a la apertura (' + ed.fecha_apertura + ').');
    }
    ediciones.forEach(function (f) {
      if (f.numero === ed.numero) return;
      if (rangoSeSuperpone(ed.fecha_apertura, fecha, f.fecha_apertura, f.fecha_cierre)) {
        throw new ApiError('La fecha de cierre se superpone con la edición ' + f.numero + '.');
      }
    });

    var sheet = getSheet('Ediciones');
    var row = findRowIndex(sheet, 'numero', ed.numero);
    setCell(sheet, row, 'estado', 'cerrada');
    setCell(sheet, row, 'fecha_cierre', fecha);
    clearEdicionesCache();
    clearAgendaCache();

    crearCitaAutomatica(
      fecha,
      'Cierre de recepción — Edición ' + ed.numero,
      'La recepción de la edición ' + ed.numero + ' cerró el ' + fecha + '.',
      'cierre_edicion',
      user.email
    );

    return ok({ message: 'Edición ' + ed.numero + ' cerrada.', estado: 'cerrada', fecha_cierre: fecha });
  } finally {
    lock.releaseLock();
  }
}

// ── abrir nueva edición con fecha elegida (COORDINADOR/WEBMASTER) ──
// La nueva edición nace sin fecha de cierre (se define al cerrarla).
// Regla: la fecha de apertura no puede superponerse con ninguna edición existente
// (por eso la anterior debe estar cerrada y con cierre anterior a esa fecha).
function handleAbrirEdicion(idToken, fechaApertura) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede gestionar ediciones.');

  var fecha = validarFechaInput(fechaApertura);
  if (!fecha) throw new ApiError('Ingresá una fecha de apertura válida.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ediciones = listarEdiciones();
    ediciones.forEach(function (f) {
      if (rangoSeSuperpone(fecha, '', f.fecha_apertura, f.fecha_cierre)) {
        throw new ApiError('La fecha de apertura se superpone con la edición ' + f.numero +
          (f.fecha_cierre ? '' : ' (que sigue abierta, sin fecha de cierre)') + '.');
      }
    });

    var numeroNuevo = 1;
    if (ediciones.length > 0) {
      numeroNuevo = (Number(ediciones[ediciones.length - 1].numero) || 0) + 1;
    }
    getSheet('Ediciones').appendRow([String(numeroNuevo), 'abierta', fecha, '']);
    // Estructura de Drive de la nueva edición: RECIBIDOS y PUBLICABLES.
    getRecibidosFolder(String(numeroNuevo));
    getPublicablesFolder(String(numeroNuevo));
    clearEdicionesCache();
    clearAgendaCache();

    crearCitaAutomatica(
      fecha,
      'Apertura de recepción — Edición ' + numeroNuevo,
      'La recepción de la edición ' + numeroNuevo + ' abrió el ' + fecha + '.',
      'evento',
      user.email
    );

    return ok({ message: 'Edición ' + numeroNuevo + ' abierta.', numero: String(numeroNuevo) });
  } finally {
    lock.releaseLock();
  }
}

// ── editar el cierre de una edición (COORDINADOR/WEBMASTER) ──
// Permite cambiar la fecha de cierre o reabrir la edición (dejarla sin cierre).
// La nueva fecha (o la reapertura) no puede superponerse con otra edición.
function handleEditarCierre(idToken, numero, fechaCierre) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede editar el cierre.');

  var fecha = '';
  if (fechaCierre) {
    fecha = validarFechaInput(fechaCierre);
    if (!fecha) throw new ApiError('Ingresá una fecha de cierre válida.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ediciones = listarEdiciones();
    var ed = null;
    ediciones.forEach(function (e) { if (e.numero === String(numero)) ed = e; });
    if (!ed) throw new ApiError('Edición no encontrada.');

    if (fecha && ed.fecha_apertura && fecha < ed.fecha_apertura) {
      throw new ApiError('La fecha de cierre no puede ser anterior a la apertura (' + ed.fecha_apertura + ').');
    }

    // No solapamiento con las demás ediciones (reapertura = sin límite superior).
    ediciones.forEach(function (f) {
      if (f.numero === ed.numero) return;
      if (rangoSeSuperpone(ed.fecha_apertura, fecha, f.fecha_apertura, f.fecha_cierre)) {
        throw new ApiError('La fecha se superpone con la edición ' + f.numero + '.');
      }
    });

    var sheet = getSheet('Ediciones');
    var row = findRowIndex(sheet, 'numero', ed.numero);
    if (fecha) {
      setCell(sheet, row, 'fecha_cierre', fecha);
      setCell(sheet, row, 'estado', 'cerrada');
    } else {
      setCell(sheet, row, 'fecha_cierre', '');
      setCell(sheet, row, 'estado', 'abierta');
    }
    clearEdicionesCache();
    clearAgendaCache();
    clearBoardCache();

    return ok({
      message: fecha ? 'Fecha de cierre actualizada.' : 'Edición reabierta.',
      estado: fecha ? 'cerrada' : 'abierta',
      fecha_cierre: fecha || null,
    });
  } finally {
    lock.releaseLock();
  }
}

// Migración idempotente: reetiqueta los envíos existentes según la edición que
// contenga su `fecha_recibido` (rellena la columna `edicion` cuando difiere).
function migrateEdicionesPorFecha() {
  ensureTableroSchema();
  var tablero = getSheet('Tablero');
  if (!tablero || tablero.getLastRow() <= 1) return 'OK (sin filas)';
  var idx = headerIndex(tablero);
  if (idx.fecha_recibido === undefined || idx.edicion === undefined) return 'OK (faltan columnas)';

  var data = tablero.getDataRange().getValues();
  var actualizados = 0;
  for (var i = 1; i < data.length; i++) {
    var fechaRecibido = fmtCelda(data[i][idx.fecha_recibido], 'yyyy-MM-dd');
    if (!fechaRecibido) continue;
    var edicion = edicionPorFecha(fechaRecibido);
    if (!edicion) continue;
    if (String(data[i][idx.edicion]) === edicion) continue;
    tablero.getRange(i + 1, idx.edicion + 1).setValue(edicion);
    actualizados++;
  }
  clearBoardCache();
  Logger.log('migrateEdicionesPorFecha: ' + actualizados + ' envío(s) reetiquetados por fecha.');
  return 'OK (' + actualizados + ' envío(s) reetiquetados)';
}

// ── reasignar la edición de una publicación (COORDINADOR/WEBMASTER/SUPERVISOR) ──
function handleCambiarEdicion(idToken, id, edicion) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var edicionStr = String(edicion == null ? '' : edicion).trim();
  if (edicionStr && !existeEdicion(edicionStr)) throw new ApiError('La edición elegida no existe.');

  var c = findProduccionById(id);
  if (!c) throw new ApiError('Producción no encontrada.');

  var sheet = getSheet('Tablero');
  setCell(sheet, c._rowIndex, 'edicion', edicionStr);
  // Mueve la carpeta de trabajo a RECIBIDOS de la edición nueva (solo si se
  // asigna una edición concreta; la copia en PUBLICABLES, si existe, no se toca).
  if (edicionStr) {
    try { getProduccionFolder(c).moveTo(getRecibidosFolder(edicionStr)); }
    catch (e) { /* el cambio de etiqueta no debe fallar por un problema de Drive */ }
  }
  addHistory(c.id, displayName(user.email), 'EDICION_CAMBIADA',
    edicionStr ? 'Reasignado a la edición ' + edicionStr : 'Edición sin asignar');
  clearBoardCache();
  return ok({ message: 'Edición de la producción actualizada.', edicion: edicionStr });
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
