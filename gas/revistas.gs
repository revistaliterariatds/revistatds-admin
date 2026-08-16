// revistas.gs — Ediciones publicadas de la revista (lectura, todos los roles).
// Proxy del índice del sitio público (tramasdelsur.com.ar/assets/docs/index.json):
// una edición nueva que se suba a la revista aparece automáticamente en el panel.

var REVISTAS_INDEX_URL = 'https://tramasdelsur.com.ar/assets/docs/index.json';
var REVISTAS_BASE_URL = 'https://tramasdelsur.com.ar/assets/docs/';

function handleListarRevistas(idToken) {
  requireInternalUser(idToken);

  var cache = CacheService.getScriptCache();
  var cached = cache.get('revistas-list');
  if (cached) return { status: 'ok', revistas: JSON.parse(cached) };

  var revistas = [];
  try {
    var res = UrlFetchApp.fetch(REVISTAS_INDEX_URL, { muteHttpExceptions: true, timeoutSeconds: 15 });
    if (res.getResponseCode() === 200) {
      var items = JSON.parse(res.getContentText());
      revistas = (items || []).map(function (it) {
        var num = String(it.num || '');
        return {
          num: num,
          titulo: it.titulo || 'N° ' + num,
          pdf_url: REVISTAS_BASE_URL + 'rtds' + num + '.pdf',
          portada_url: REVISTAS_BASE_URL + 'rtds' + num + '.jpeg',
        };
      });
      revistas.sort(function (a, b) { return Number(b.num) - Number(a.num); });
    } else {
      throw new ApiError('El sitio de la revista no respondió (HTTP ' + res.getResponseCode() + ').');
    }
  } catch (ex) {
    if (ex instanceof ApiError) throw ex;
    throw new ApiError('No se pudo consultar el índice de la revista: ' + ex.message);
  }

  cache.put('revistas-list', JSON.stringify(revistas), 600); // 10 min
  return { status: 'ok', revistas: revistas };
}