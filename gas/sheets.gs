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
    'id', 'fecha', 'hora', 'titulo', 'comentario', 'tipo', 'meet_link',
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
