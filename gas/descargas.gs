// descargas.gs — contador de descargas/lecturas de las ediciones PDF del sitio público.

var DESCARGAS_ACCIONES = ['leer', 'descargar'];

function descargasSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Descargas');
  if (!sheet) {
    sheet = ss.insertSheet('Descargas');
    sheet.appendRow(SHEETS.Descargas);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEETS.Descargas);
  }
  return sheet;
}

function clearDescargasCache() {
  var cache = CacheService.getScriptCache();
  ['all', '1', '7', '30', '90', '365'].forEach(function (key) { cache.remove('descargas-summary:' + key); });
}

// Endpoint público (sin token): registra un clic de leer/descargar un PDF.
function handleDescarga(data) {
  data = data || {};
  var archivo = String(data.archivo || '').trim().replace(/[^\w.-]/g, '').slice(0, 120);
  var accion = String(data.accion || '').trim();
  if (!archivo || !/\.pdf$/i.test(archivo)) return err('Archivo inválido.');
  if (DESCARGAS_ACCIONES.indexOf(accion) < 0) accion = 'leer';

  var cache = CacheService.getScriptCache();
  var rateKey = 'desc:' + archivo + ':' + accion;
  var n = parseInt(cache.get(rateKey) || '0', 10);
  if (n >= 100) return err('Límite temporal alcanzado.');
  cache.put(rateKey, String(n + 1), 21600);

  descargasSheet().appendRow([archivo, accion, new Date()]);
  clearDescargasCache();
  return ok({ message: 'ok' });
}

// Listado para el panel (COORDINADOR/WEBMASTER/SUPERVISOR).
function handleDescargasList(idToken, requestedDays) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var value = String(requestedDays || 'all');
  var days = value === 'all' ? 0 : parseInt(value, 10);
  if (value !== 'all' && [1, 7, 30, 90, 365].indexOf(days) < 0) throw new ApiError('Período inválido.');

  var cache = CacheService.getScriptCache();
  var cacheKey = 'descargas-summary:' + (value === 'all' ? 'all' : days);
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var data = descargasSheet().getDataRange().getValues();
  var now = new Date();
  var cutoff = days ? new Date(now.getTime() - days * 86400000) : null;
  var porArchivo = {};
  var acciones = { leer: 0, descargar: 0 };
  var total = 0;
  var totalHistorico = 0;
  for (var i = 1; i < data.length; i++) {
    var ts = data[i][2];
    if (!(ts instanceof Date)) continue;
    var archivo = String(data[i][0] || '');
    var accion = String(data[i][1] || '');
    if (!archivo) continue;
    totalHistorico++;
    if (cutoff && ts.getTime() < cutoff.getTime()) continue;
    porArchivo[archivo] = (porArchivo[archivo] || 0) + 1;
    if (DESCARGAS_ACCIONES.indexOf(accion) >= 0) acciones[accion] = (acciones[accion] || 0) + 1;
    total++;
  }
  var porArchivoArr = Object.keys(porArchivo)
    .sort(function (a, b) { return porArchivo[b] - porArchivo[a]; })
    .map(function (k) { return { archivo: k, total: porArchivo[k] }; });

  var result = ok({ total: total, total_historico: totalHistorico, porArchivo: porArchivoArr, acciones: acciones });
  cache.put(cacheKey, JSON.stringify(result), 300);
  return result;
}
