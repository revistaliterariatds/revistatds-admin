// sheets.gs — DB en Google Sheets: schema, acceso y helpers.

var SHEETS = {
  Roles: ['email', 'rol', 'nombre', 'alias', 'usar_alias_notif', 'activo'],
  Tablero: [
    'id', 'titulo', 'autor', 'email_autor', 'edad', 'categoria', 'estado',
    'editor_asignado', 'url_carpeta_drive', 'url_doc_correccion',
    'version_actual', 'token_autor', 'token_expira', 'convocatoria',
    'fecha_recibido', 'fecha_actualizacion', 'edicion', 'url_publicable',
    'accion_autor', 'accion_autor_fecha', 'accion_autor_detalle',
  ],
  Historial: ['id_produccion', 'timestamp', 'actor', 'accion', 'detalle'],
  Config: ['clave', 'valor'],
  Descargas: ['archivo', 'accion', 'fecha'],
  Ediciones: ['numero', 'estado', 'fecha_apertura', 'fecha_cierre'],
  Agenda: [
    'id', 'fecha', 'hora', 'hora_fin', 'titulo', 'comentario', 'tipo', 'meet_link',
    'edicion', 'creado_por', 'creado_at', 'actualizado_at',
  ],
  AgendaComentarios: ['id', 'cita_id', 'autor', 'comentario', 'creado_at'],
  Avisos: ['num_edicion', 'produccion_id', 'email_autor', 'fecha'],
  Feriados: ['fecha', 'nombre', 'tipo', 'origen'],
};

function getSpreadsheet() {
  var id = getSecret('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID no configurado. Ejecutá setup() primero.');
  return SpreadsheetApp.openById(id);
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

function ensureSchema() {
  var ss = getSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(SHEETS[name]);
    } else if (sheet.getLastRow() === 0) {
      sheet.appendRow(SHEETS[name]);
    }
  });
  migrarAgendaHoraFin();
  ensureTableroSchema();
}

// Migración idempotente: agrega la columna 'hora_fin' (después de 'hora') a la
// hoja Agenda si no existe. Requerida para horarios con inicio y fin.
function migrarAgendaHoraFin() {
  var sheet = getSheet('Agenda');
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  var headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (headers.indexOf('hora_fin') >= 0) return;
  var horaIdx = headers.indexOf('hora');
  if (horaIdx < 0) return; // sin columna 'hora' no hay nada que migrar
  sheet.insertColumnAfter(horaIdx + 1); // insertColumnAfter es 1-based
  sheet.getRange(1, horaIdx + 2).setValue('hora_fin');
}

// Migración idempotente: agrega al final de la hoja Tablero las columnas de
// SHEETS.Tablero que falten. Evita errores de "columna demasiado pequeña" al
// escribir en columnas agregadas con el tiempo (url_doc_correccion, edicion…).
function ensureTableroSchema() {
  var sheet = getSheet('Tablero');
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) { sheet.appendRow(SHEETS.Tablero); return; }
  var idx = headerIndex(sheet);
  var col = lastCol + 1;
  SHEETS.Tablero.forEach(function (h) {
    if (idx[h] === undefined) {
      sheet.getRange(1, col).setValue(h);
      col++;
    }
  });
}

// Devuelve {index, columns} donde index es un mapa nombre->índice de columna.
function headerIndex(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });
  return idx;
}

// Devuelve el índice de columna del id en Historial, con fallback a la columna
// legacy `id_cuento` (si la migración de renombre aún no se ejecutó).
function historialIdIndex(sheet) {
  var idx = headerIndex(sheet);
  if (idx.id_produccion !== undefined) return idx.id_produccion;
  return idx.id_cuento;
}

// Migración idempotente: renombra la columna `id_cuento` → `id_produccion` en
// la hoja Historial (el resto de las columnas queda igual).
function migrateHistorialIdColumna() {
  var sheet = getSheet('Historial');
  if (!sheet || sheet.getLastRow() < 1) return 'OK (sin Historial)';
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === 'id_cuento') {
      sheet.getRange(1, i + 1).setValue('id_produccion');
      return 'OK (id_cuento → id_produccion)';
    }
  }
  return 'OK (ya migrado)';
}

// Devuelve el índice de fila (0-based, sin contar el header) o -1.
function findRowIndex(sheet, colName, value) {
  var idx = headerIndex(sheet);
  if (idx[colName] === undefined) throw new Error('Columna no encontrada: ' + colName);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx[colName]]) === String(value)) return i;
  }
  return -1;
}

function setCell(sheet, rowIndex, colName, value) {
  var idx = headerIndex(sheet);
  if (idx[colName] === undefined) throw new Error('Columna no encontrada en la hoja: ' + colName);
  sheet.getRange(rowIndex + 1, idx[colName] + 1).setValue(value);
}

// Construye una fila en el orden REAL de columnas de la hoja a partir de un
// mapa {nombreColumna: valor}. Útil para appendRow sin depender del orden de
// SHEETS (robusto si una columna fue agregada al final por migración).
function filaSegunHeader(sheet, headers, valores) {
  var idx = headerIndex(sheet);
  var fila = [];
  headers.forEach(function (h) { fila[idx[h]] = valores[h]; });
  return fila;
}
