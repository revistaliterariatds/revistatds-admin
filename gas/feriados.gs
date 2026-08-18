// feriados.gs — Feriados nacionales argentinos, persistidos en la hoja `Feriados`.
// Se sincronizan desde date.nager.at una vez por año (o a demanda desde el panel)
// y quedan guardados en Sheets: el calendario los lee sin depender de la API en
// runtime. Un trigger anual (enero) los refresca solo.

var FERIADOS_API = 'https://date.nager.at/api/v3/PublicHolidays/{year}/AR';

// Sheets convierte "YYYY-MM-DD" a Date al guardarlo; se normaliza a texto acá.
function feriadoFechaStr(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(valor || '').slice(0, 10);
}

// Garantiza la columna `origen` (api|manual) en la hoja Feriados y backfillea
// las filas existentes como 'api' (todas las cargadas por sync). Idempotente.
function ensureFeriadosSchema() {
  var sheet = getSheet('Feriados');
  if (!sheet) { ensureSchema(); sheet = getSheet('Feriados'); }
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  var headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (headers.indexOf('origen') < 0) {
    sheet.getRange(1, lastCol + 1).setValue('origen');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  if (sheet.getLastRow() < 2) return;
  var idx = headerIndex(sheet);
  var data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  for (var i = 1; i < data.length; i++) {
    if (!data[i][idx.origen]) sheet.getRange(i + 1, idx.origen + 1).setValue('api');
  }
}

// Persiste los feriados de un año en la hoja `Feriados`, reemplazando las filas
// de ese año. Devuelve {año, cantidad}.
function sincronizarFeriados(año) {
  ensureFeriadosSchema();
  var sheet = getSheet('Feriados');
  if (!sheet) throw new ApiError('No se pudo crear la hoja Feriados.');

  var url = FERIADOS_API.replace('{year}', String(año));
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('No se pudieron obtener los feriados de ' + año + ' (HTTP ' + res.getResponseCode() + ').');
  }
  var items = JSON.parse(res.getContentText());
  if (!Array.isArray(items)) throw new Error('Respuesta inesperada de la API de feriados.');

  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var filas = [];
  for (var i = 1; i < data.length; i++) {
    var origen = String(data[i][idx.origen] || 'api');
    if (origen !== 'manual' && feriadoFechaStr(data[i][idx.fecha]).slice(0, 4) === String(año)) filas.push(i + 1);
  }
  filas.sort(function (a, b) { return b - a; });
  filas.forEach(function (f) { sheet.deleteRow(f); });

  items.forEach(function (h) {
    sheet.appendRow(filaSegunHeader(sheet, SHEETS.Feriados, {
      fecha: h.date,
      nombre: h.localName || h.name || '',
      tipo: (h.types && h.types[0]) || 'Public',
      origen: 'api',
    }));
  });
  clearFeriadosCache();
  return { año: año, cantidad: items.length };
}

// Sincroniza el año en curso y el siguiente (trigger anual o a demanda) y
// re-agenda el trigger para el próximo enero.
function sincronizarFeriadosAnio() {
  var ahora = new Date();
  var años = [];
  años.push(sincronizarFeriados(ahora.getFullYear()));
  años.push(sincronizarFeriados(ahora.getFullYear() + 1));
  clearFeriadosCache();
  clearAgendaCache(); // invalida el listado cacheado (trae feriados vacíos si se cacheó antes del sync)
  scheduleFeriadosTrigger();
  return ok({ message: 'Feriados actualizados.', años: años });
}

// Lee los feriados persistidos (cache 6 h). Devuelve [{fecha, nombre, tipo, origen}].
function feriadosPersistidos() {
  ensureFeriadosSchema();
  var cache = CacheService.getScriptCache();
  var cached = cache.get('feriados');
  if (cached) return JSON.parse(cached);

  var sheet = getSheet('Feriados');
  var out = [];
  if (sheet && sheet.getLastRow() > 1) {
    var idx = headerIndex(sheet);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      out.push({
        fecha: feriadoFechaStr(data[i][idx.fecha]),
        nombre: String(data[i][idx.nombre] || ''),
        tipo: String(data[i][idx.tipo] || 'feriado'),
        origen: String(data[i][idx.origen] || 'api'),
      });
    }
  }
  cache.put('feriados', JSON.stringify(out), 21600);
  return out;
}

function clearFeriadosCache() {
  CacheService.getScriptCache().remove('feriados');
}

// Endpoint panel/feriados/sync (COORDINADOR/WEBMASTER) — actualización a demanda.
function handleFeriadosSync(idToken) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede actualizar feriados.');
  return sincronizarFeriadosAnio();
}

// Endpoint panel/feriados/agregar (COORDINADOR/WEBMASTER) — feriado propio
// (p. ej. Día del Maestro). Si la fecha ya existe (nacional), la marca como
// manual para que el sync anual no la borre y actualiza el nombre.
function handleFeriadosAgregar(idToken, fecha, nombre) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede agregar feriados.');
  ensureFeriadosSchema();
  fecha = String(fecha || '').trim();
  nombre = String(nombre || '').trim().slice(0, 100);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ApiError('Fecha inválida (YYYY-MM-DD).');
  if (!nombre) throw new ApiError('El nombre del feriado es obligatorio.');

  var sheet = getSheet('Feriados');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (feriadoFechaStr(data[i][idx.fecha]) === fecha) {
      sheet.getRange(i + 1, idx.origen + 1).setValue('manual');
      sheet.getRange(i + 1, idx.nombre + 1).setValue(nombre);
      clearFeriadosCache();
      clearAgendaCache();
      return ok({ message: 'Feriado actualizado: ' + fecha });
    }
  }
  sheet.appendRow(filaSegunHeader(sheet, SHEETS.Feriados, {
    fecha: fecha, nombre: nombre, tipo: 'manual', origen: 'manual',
  }));
  clearFeriadosCache();
  clearAgendaCache();
  return ok({ message: 'Feriado agregado: ' + fecha });
}

// Endpoint panel/feriados/quitar (COORDINADOR/WEBMASTER) — quita un feriado de
// la fecha indicada (los nacionales vuelven con el próximo sync).
function handleFeriadosQuitar(idToken, fecha) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede quitar feriados.');
  ensureFeriadosSchema();
  fecha = String(fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ApiError('Fecha inválida (YYYY-MM-DD).');

  var sheet = getSheet('Feriados');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var fila = -1;
  for (var i = 1; i < data.length; i++) {
    if (feriadoFechaStr(data[i][idx.fecha]) === fecha) { fila = i + 1; break; }
  }
  if (fila < 0) throw new ApiError('No existe un feriado para esa fecha.');
  sheet.deleteRow(fila);
  clearFeriadosCache();
  clearAgendaCache();
  return ok({ message: 'Feriado quitado: ' + fecha });
}

// Instala (o re-instala) el trigger anual que refresca feriados en enero. El
// propio handler lo re-agenda al correr, así queda siempre para el próximo año.
function setupFeriadosTrigger() {
  scheduleFeriadosTrigger();
  return 'Trigger anual de feriados programado para enero.';
}

function scheduleFeriadosTrigger() {
  var HANDLER = 'sincronizarFeriadosAnio';
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === HANDLER) ScriptApp.deleteTrigger(t);
  });
  var ahora = new Date();
  var year = ahora.getFullYear();
  var limite = new Date(year, 0, 2); // 2 de enero de este año
  if (ahora.getTime() >= limite.getTime()) year += 1; // ya pasó enero → próximo enero
  var fecha = Utilities.parseDate(year + '-01-02 02:00:00', Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  ScriptApp.newTrigger(HANDLER)
    .timeBased()
    .at(fecha)
    .create();
}