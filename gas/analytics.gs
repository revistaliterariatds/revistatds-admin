// analytics.gs — snapshots diarios de visitas para ADMIN/SUPERVISOR.

var CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
var CF_CACHE_SECONDS = 600;
var ANALYTICS_HEADERS = ['date', 'visits', 'source', 'updated_at'];

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
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
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
  var start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
  var end = new Date(start.getTime() + 86400000 - 1);
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
  var cutoff = days ? new Date(Date.now() - days * 86400000) : null;
  return data.slice(1).filter(function (row) {
    var key = analyticsCellDate(row[0]);
    if (!key) return false;
    if (!cutoff) return true;
    return new Date(key + 'T00:00:00Z').getTime() >= cutoff.getTime();
  }).map(function (row) {
    return { date: analyticsCellDate(row[0]), visits: Number(row[1] || 0) };
  }).sort(function (a, b) { return a.date.localeCompare(b.date); });
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
  if (cached) return ok({ days: value === 'all' ? 'all' : days, daily: JSON.parse(cached), cached: true });
  var daily = readAnalyticsSnapshots(days);
  cache.put(cacheKey, JSON.stringify(daily), CF_CACHE_SECONDS);
  return ok({ days: value === 'all' ? 'all' : days, daily: daily, cached: false });
}
