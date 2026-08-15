// analytics.gs — snapshots diarios de visitas para COORDINADOR/SUPERVISOR.

var CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
var CF_CACHE_SECONDS = 600;
var ANALYTICS_HEADERS = ['date', 'visits', 'source', 'updated_at'];
var ANALYTICS_TZ = 'America/Argentina/Buenos_Aires';

function analyticsSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Analiticas');
  if (!sheet) {
    sheet = ss.insertSheet('Analiticas');
    sheet.appendRow(ANALYTICS_HEADERS);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(ANALYTICS_HEADERS);
  }
  return sheet;
}

function analyticsDateKey(date) {
  return Utilities.formatDate(date, ANALYTICS_TZ, 'yyyy-MM-dd');
}

// Diferencia local↔UTC en minutos para la instancia dada (Argentina sin DST, robusto igual).
function analyticsTzOffsetMinutes(date) {
  var local = Utilities.formatDate(date, ANALYTICS_TZ, 'yyyy-MM-dd HH:mm:ss');
  var asUtc = new Date(local.replace(' ', 'T') + 'Z');
  return (asUtc.getTime() - date.getTime()) / 60000;
}

// Ventana UTC que cubre el día calendario local (desde medianoche local).
function cloudflareDayWindow(date) {
  var parts = analyticsDateKey(date).split('-').map(Number);
  var offset = analyticsTzOffsetMinutes(date);
  var start = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]) - offset * 60000);
  return { start: start, end: new Date(start.getTime() + 86400000 - 1) };
}

function analyticsCellDate(value) {
  if (value instanceof Date) return Utilities.formatDate(value, 'UTC', 'yyyy-MM-dd');
  var text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function cloudflareConfig() {
  var token = getSecret('CLOUDFLARE_API_TOKEN');
  var zoneTag = getSecret('CLOUDFLARE_ZONE_TAG');
  if (!token || !zoneTag) throw new ApiError('Analíticas no configuradas: faltan CLOUDFLARE_API_TOKEN o CLOUDFLARE_ZONE_TAG.');
  var host = String(getConfig('site_base_url') || 'https://tramasdelsur.com.ar').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return { token: token, zoneTag: zoneTag, host: host };
}

function fetchCloudflareDay(date, config) {
  var window = cloudflareDayWindow(date);
  var start = window.start;
  var end = window.end;
  var query = 'query DailyVisits($zoneTag: String!, $startDate: Time!, $endDate: Time!, $host: String!) {'
    + ' viewer { zones(filter: { zoneTag: $zoneTag }) {'
    + ' httpRequestsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $startDate, datetime_leq: $endDate, clientRequestHTTPHost: $host, requestSource: "eyeball" })'
    + ' { sum { visits } dimensions { datetimeHour } } } } }';
  var response = UrlFetchApp.fetch(CF_GRAPHQL_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + config.token },
    payload: JSON.stringify({ query: query, variables: { zoneTag: config.zoneTag, startDate: start.toISOString(), endDate: end.toISOString(), host: config.host } }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new ApiError('Cloudflare devolvió HTTP ' + response.getResponseCode() + '.');
  var body = JSON.parse(response.getContentText());
  if (body.errors && body.errors.length) throw new ApiError('Cloudflare: ' + body.errors[0].message);
  var zone = (((body.data || {}).viewer || {}).zones || [])[0];
  var groups = zone ? zone.httpRequestsAdaptiveGroups || [] : [];
  return groups.reduce(function (total, group) { return total + Number((group.sum || {}).visits || 0); }, 0);
}

function saveAnalyticsSnapshot(date, visits) {
  var sheet = analyticsSheet();
  var key = analyticsDateKey(date);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (analyticsCellDate(data[i][0]) === key) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[visits, 'cloudflare-http', new Date()]]);
      clearAnalyticsCache();
      return;
    }
  }
  sheet.appendRow([key, visits, 'cloudflare-http', new Date()]);
  clearAnalyticsCache();
}

function clearAnalyticsCache() {
  var cache = CacheService.getScriptCache();
  ['1', '7', '30', '90', '365', 'all'].forEach(function (key) { cache.remove('analytics-snapshots:' + key); });
  cache.remove('analytics-total');
}

function totalHistoricoVisitas() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('analytics-total');
  if (cached) return parseInt(cached, 10);
  var total = readAnalyticsSnapshots(0).reduce(function (sum, item) { return sum + item.visits; }, 0);
  cache.put('analytics-total', String(total), CF_CACHE_SECONDS);
  return total;
}

// Trigger diario: se ejecuta sobre el día UTC anterior, ya cerrado.
function snapshotAnalyticsYesterday() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var date = new Date(Date.now() - 86400000);
    saveAnalyticsSnapshot(date, fetchCloudflareDay(date, cloudflareConfig()));
  } finally { lock.releaseLock(); }
}

// Ejecutar una vez para instalar el trigger diario. Es idempotente.
function setupAnalyticsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'snapshotAnalyticsYesterday') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('snapshotAnalyticsYesterday').timeBased().everyDays(1).atHour(3).create();
}

// Ejecutar una vez después de instalarlo para recuperar hasta los 7 días aún disponibles.
function snapshotAnalyticsLastDays() {
  var config = cloudflareConfig();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    for (var offset = 1; offset <= 7; offset++) {
      var date = new Date(Date.now() - offset * 86400000);
      saveAnalyticsSnapshot(date, fetchCloudflareDay(date, config));
    }
  } finally { lock.releaseLock(); }
}

function readAnalyticsSnapshots(days) {
  var sheet = analyticsSheet();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var todayKey = analyticsDateKey(now);
  var cutoffKey = days ? analyticsDateKey(new Date(now.getTime() - days * 86400000)) : null;
  var byDate = {};
  data.slice(1).forEach(function (row) {
    var key = analyticsCellDate(row[0]);
    if (!key || key >= todayKey || (cutoffKey && key < cutoffKey)) return;
    // Evita duplicar filas históricas creadas antes de normalizar fechas.
    byDate[key] = Number(row[1] || 0);
  });
  return Object.keys(byDate).sort().map(function (date) {
    return { date: date, visits: byDate[date] };
  });
}

function handleAnalyticsDaily(idToken, requestedDays) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  var value = String(requestedDays || '7');
  var days = value === 'all' ? 0 : parseInt(value, 10);
  if (value !== 'all' && [1, 7, 30, 90, 365].indexOf(days) < 0) throw new ApiError('Período inválido.');

  var cache = CacheService.getScriptCache();
  var cacheKey = 'analytics-snapshots:' + (value === 'all' ? 'all' : days);
  var cached = cache.get(cacheKey);
  var daily = cached ? JSON.parse(cached) : readAnalyticsSnapshots(days);
  if (!cached) cache.put(cacheKey, JSON.stringify(daily), CF_CACHE_SECONDS);
  return ok({
    days: value === 'all' ? 'all' : days,
    daily: daily,
    total_historico: totalHistoricoVisitas(),
    cached: !!cached,
  });
}
