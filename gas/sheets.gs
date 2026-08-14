// sheets.gs — DB en Google Sheets: schema, acceso y helpers.

var SHEETS = {
  Roles: ['email', 'rol', 'nombre', 'alias', 'usar_alias_notif', 'activo'],
  Tablero: [
    'id', 'titulo', 'autor', 'email_autor', 'edad', 'categoria', 'estado',
    'editor_asignado', 'url_carpeta_drive', 'url_doc_correccion',
    'version_actual', 'token_autor', 'token_expira', 'convocatoria',
    'fecha_recibido', 'fecha_actualizacion', 'edicion',
  ],
  Historial: ['id_cuento', 'timestamp', 'actor', 'accion', 'detalle'],
  Config: ['clave', 'valor'],
  Descargas: ['archivo', 'accion', 'fecha'],
  Ediciones: ['numero', 'estado', 'fecha_apertura', 'fecha_cierre'],
  Agenda: [
    'id', 'fecha', 'hora', 'hora_fin', 'titulo', 'comentario', 'tipo', 'meet_link',
    'edicion', 'creado_por', 'creado_at', 'actualizado_at',
  ],
  AgendaComentarios: ['id', 'cita_id', 'autor', 'comentario', 'creado_at'],
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

// Devuelve {index, columns} donde index es un mapa nombre->índice de columna.
function headerIndex(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });
  return idx;
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
  sheet.getRange(rowIndex + 1, idx[colName] + 1).setValue(value);
}
