// analytics.gs — Cloudflare Web Analytics para ADMIN/SUPERVISOR.

var CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
var CF_CACHE_SECONDS = 600;

function handleAnalyticsDaily(idToken, days) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  days = parseInt(days || '7', 10);
  if ([7, 8].indexOf(days) < 0) throw new ApiError('Este origen permite consultar hasta 8 días.');

  var token = getSecret('CLOUDFLARE_API_TOKEN');
  var zoneTag = getSecret('CLOUDFLARE_ZONE_TAG');
  if (!token || !zoneTag) {
    throw new ApiError('Analíticas no configuradas: faltan CLOUDFLARE_API_TOKEN o CLOUDFLARE_ZONE_TAG.');
  }

  var end = new Date();
  var endCacheDate = Utilities.formatDate(end, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var cache = CacheService.getScriptCache();
  var cacheKey = 'analytics:' + days + ':' + endCacheDate;
  var cached = cache.get(cacheKey);
  if (cached) return ok({ days: days, daily: JSON.parse(cached), cached: true });

  var host = String(getConfig('site_base_url') || 'https://tramasdelsur.com.ar').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  var query = 'query DailyVisits($zoneTag: String!, $startDate: Time!, $endDate: Time!, $host: String!) {'
    + ' viewer { zones(filter: { zoneTag: $zoneTag }) {'
    + ' httpRequestsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $startDate, datetime_leq: $endDate, clientRequestHTTPHost: $host, requestSource: "eyeball" })'
    + ' { sum { visits } dimensions { datetimeHour } } } } }';
  var byDate = {};
  // Esta zona limita GraphQL a ventanas de un día como máximo.
  for (var offset = 0; offset < days; offset++) {
    var day = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - offset, 0, 0, 0));
    var nextDay = new Date(day.getTime() + 86400000 - 1);
    var response = UrlFetchApp.fetch(CF_GRAPHQL_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ query: query, variables: { zoneTag: zoneTag, startDate: day.toISOString(), endDate: nextDay.toISOString(), host: host } }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new ApiError('Cloudflare devolvió HTTP ' + response.getResponseCode() + '.');

    var body = JSON.parse(response.getContentText());
    if (body.errors && body.errors.length) throw new ApiError('Cloudflare: ' + body.errors[0].message);
    var zone = (((body.data || {}).viewer || {}).zones || [])[0];
    var groups = zone ? zone.httpRequestsAdaptiveGroups || [] : [];
    groups.forEach(function (group) {
      var date = String(group.dimensions.datetimeHour || '').slice(0, 10);
      if (date) byDate[date] = (byDate[date] || 0) + Number((group.sum || {}).visits || 0);
    });
  }
  var daily = Object.keys(byDate).sort().map(function (date) {
    return { date: date, visits: byDate[date] };
  });
  cache.put(cacheKey, JSON.stringify(daily), CF_CACHE_SECONDS);
  return ok({ days: days, daily: daily, cached: false });
}
