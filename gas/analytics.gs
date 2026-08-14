// analytics.gs — Cloudflare Web Analytics para ADMIN/SUPERVISOR.

var CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
var CF_CACHE_SECONDS = 600;

function handleAnalyticsDaily(idToken, days) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  days = parseInt(days || '7', 10);
  if ([7, 30].indexOf(days) < 0) throw new ApiError('Período inválido.');

  var token = getSecret('CLOUDFLARE_API_TOKEN');
  var accountTag = getSecret('CLOUDFLARE_ACCOUNT_TAG');
  var siteTag = getSecret('CLOUDFLARE_SITE_TAG');
  if (!token || !accountTag || !siteTag) {
    throw new ApiError('Analíticas no configuradas: faltan propiedades de Cloudflare.');
  }

  var end = new Date();
  var start = new Date(end.getTime() - (days - 1) * 86400000);
  var startDate = Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var endDate = Utilities.formatDate(end, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var cache = CacheService.getScriptCache();
  var cacheKey = 'analytics:' + days + ':' + endDate;
  var cached = cache.get(cacheKey);
  if (cached) return ok({ days: days, daily: JSON.parse(cached), cached: true });

  var query = 'query DailyVisits($accountTag: String!, $startDate: Date!, $endDate: Date!, $siteTag: String!) {'
    + ' viewer { accounts(filter: { accountTag: $accountTag }) {'
    + ' webAnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $startDate, date_leq: $endDate, siteTag: $siteTag, action: "visit" }, orderBy: [date_ASC])'
    + ' { count dimensions { date } } } } }';
  var response = UrlFetchApp.fetch(CF_GRAPHQL_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: query, variables: { accountTag: accountTag, startDate: startDate, endDate: endDate, siteTag: siteTag } }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new ApiError('Cloudflare devolvió HTTP ' + response.getResponseCode() + '.');

  var body = JSON.parse(response.getContentText());
  if (body.errors && body.errors.length) throw new ApiError('Cloudflare: ' + body.errors[0].message);
  var groups = (((body.data || {}).viewer || {}).accounts || [])[0];
  groups = groups ? groups.webAnalyticsAdaptiveGroups || [] : [];
  var daily = groups.map(function (group) {
    return { date: group.dimensions.date, visits: Number(group.count || 0) };
  });
  cache.put(cacheKey, JSON.stringify(daily), CF_CACHE_SECONDS);
  return ok({ days: days, daily: daily, cached: false });
}
