// feriados.gs — Feriados nacionales argentinos, persistidos en la hoja `Feriados`.
// Se sincronizan desde date.nager.at una vez por año (o a demanda desde el panel)
// y quedan guardados en Sheets: el calendario los lee sin depender de la API en
// runtime. Un trigger anual (enero) los refresca solo.

var FERIADOS_API = 'https://date.nager.at/api/v3/PublicHolidays/{year}/AR';

// Persiste los feriados de un año en la hoja `Feriados`, reemplazando las filas
// de ese año. Devuelve {año, cantidad}.
function sincronizarFeriados(año) {
  var sheet = getSheet('Feriados');
  if (!sheet) throw new ApiError('Falta la hoja Feriados. Ejecutá setup() o ensureSchema().');

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
    if (String(data[i][idx.fecha]).slice(0, 4) === String(año)) filas.push(i + 1);
  }
  filas.sort(function (a, b) { return b - a; });
  filas.forEach(function (f) { sheet.deleteRow(f); });

  items.forEach(function (h) {
    sheet.appendRow([h.date, h.localName || h.name || '', (h.types && h.types[0]) || 'Public']);
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
  scheduleFeriadosTrigger();
  return ok({ message: 'Feriados actualizados.', años: años });
}

// Lee los feriados persistidos (cache 6 h). Devuelve [{fecha, nombre, tipo}].
function feriadosPersistidos() {
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
        fecha: String(data[i][idx.fecha] || ''),
        nombre: String(data[i][idx.nombre] || ''),
        tipo: String(data[i][idx.tipo] || 'feriado'),
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
  ScriptApp.newTrigger(HANDLER)
    .timeBased()
    .atDate(year, 1, 2)
    .atHour(2)
    .create();
}