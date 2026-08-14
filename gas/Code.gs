// Code.gs — router HTTP + setup inicial del proyecto.

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var data = {};
    try { data = JSON.parse(body); } catch (errParse) { data = {}; }

    // Routing por `action` en el body (SIEMPRE a /exec, sin path):
    // agregar path (/exec/panel/...) rompe el CORS de Apps Script
    // (la respuesta pierde Access-Control-Allow-Origin). Por eso el router
    // usa un campo del body, con fallback a query param y pathInfo.
    var action = (data && data.action)
      || (e && e.parameter && e.parameter.action)
      || (e && e.pathInfo ? String(e.pathInfo).replace(/^\//, '') : '');

    var result;
    if (!action) {
      result = handleEnvio(data);                      // público (formularios del sitio)
    } else if (action === 'descarga') {
      result = handleDescarga(data);                   // público (clic en ediciones PDF)
    } else if (action === 'panel/descargas/list') {
      result = handleDescargasList(tokenFrom(data, e), data && data.days);
    } else if (action === 'panel/auth/whoami') {
      result = handleWhoami(tokenFrom(data, e));       // login → email + rol
    } else if (action === 'panel/board/list') {
      result = handleBoardList(tokenFrom(data, e));    // tablero (lectura)
    } else if (action === 'panel/board/detail') {
      result = handleBoardDetail(tokenFrom(data, e), data && data.id);
    } else if (action === 'panel/board/asignarme') {
      result = handleAsignarme(tokenFrom(data, e), data && data.id);
    } else if (action === 'panel/board/editors') {
      result = handleBoardEditors(tokenFrom(data, e));
    } else if (action === 'panel/board/asignar') {
      result = handleAsignar(tokenFrom(data, e), data && data.id, data && data.editorEmail);
    } else if (action === 'panel/board/desasignar') {
      result = handleDesasignar(tokenFrom(data, e), data && data.id);
    } else if (action === 'panel/board/reasignar') {
      result = handleReasignar(tokenFrom(data, e), data && data.id, data && data.editorEmail);
    } else if (action === 'panel/board/pedir-correcciones') {
      result = handlePedirCorrecciones(tokenFrom(data, e), data && data.id, data && data.motivo);
    } else if (action === 'panel/board/revision-terminada') {
      result = handleRevisionTerminada(tokenFrom(data, e), data && data.id);
    } else if (action === 'panel/board/consultar-autor') {
      result = handleConsultarAutor(tokenFrom(data, e), data && data.id);
    } else if (action === 'panel/board/publicar') {
      result = handlePublicar(tokenFrom(data, e), data && data.id);
    } else if (action === 'panel/board/resolver-rechazo') {
      result = handleResolverRechazo(tokenFrom(data, e), data && data.id, data && data.resolucion);
    } else if (action === 'panel/users/list') {
      result = handleUsersList(tokenFrom(data, e));
    } else if (action === 'panel/users/save') {
      result = handleUserSave(tokenFrom(data, e), data);
    } else if (action === 'panel/config/list') {
      result = handleConfigList(tokenFrom(data, e));
    } else if (action === 'panel/config/save') {
      result = handleConfigSave(tokenFrom(data, e), data && data.key, data && data.value);
    } else if (action === 'panel/analytics/daily') {
      result = handleAnalyticsDaily(tokenFrom(data, e), data && data.days);
    } else if (action === 'autor/estado') {
      result = handleAutorEstado(data && data.token);  // autor: ver estado
    } else if (action === 'autor/approve') {
      result = handleAutorApprove(data && data.token); // autor: aprobar
    } else if (action === 'autor/reject') {
      result = handleAutorReject(data && data.token, data && data.motivo); // autor: no aprobar
    } else if (action === 'autor/edit') {
      result = handleAutorEdit(data && data.token, data && data.archivos); // autor: subir versión
    } else {
      result = err('Ruta no encontrada: ' + action);
    }
    return jsonResponse(result);
  } catch (ex) {
    return jsonResponse({
      status: 'error',
      code: ex.name || 'Error',
      message: ex.message || 'Error interno.',
    });
  }
}

function doGet(e) {
  return jsonResponse({ status: 'ok', message: 'PanelTDS API', now: nowIso() });
}

// El ID token viaja en el body (idToken) o como query param.
// El plan preveía "Authorization: Bearer", pero un header custom dispara
// preflight OPTIONS que Apps Script no maneja → se evita mandando el token
// en el body con Content-Type text/plain (request "simple", sin preflight).
function tokenFrom(data, e) {
  if (data && data.idToken) return data.idToken;
  if (e && e.parameter && e.parameter.idToken) return e.parameter.idToken;
  return null;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Ejecutar UNA vez (desde el editor: seleccionar setup, Run) para:
// 1. crear el Spreadsheet "PanelTDS" y su schema (Roles/Tablero/Historial/Config)
// 2. sembrar Config y los roles iniciales.
function setup() {
  var ssId = getSecret('SPREADSHEET_ID');
  var ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.create('PanelTDS');
  setSecret('SPREADSHEET_ID', ss.getId());

  ensureSchema();
  seedConfig();
  seedRoles();

  Logger.log('Setup completo: ' + ss.getUrl());
  return ss.getUrl();
}

function seedConfig() {
  setConfig('expira_token_dias', '30');
  setConfig('site_base_url', 'https://tramasdelsur.com.ar');
}

// Mantiene el runtime caliente para evitar el cold start de Apps Script.
function keepAlive() {
  CacheService.getScriptCache().put('keepalive', String(Date.now()), 300);
}

// Ejecutar una vez: trigger cada 5 minutos a keepAlive (idempotente).
function setupKeepAliveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'keepAlive') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('keepAlive').timeBased().everyMinutes(5).create();
}

function seedRoles() {
  var sheet = getSheet('Roles');
  if (sheet.getLastRow() > 1) return; // ya sembrado

  var admin = getSecret('ADMIN_EMAIL') || 'revistatramasdelsur@gmail.com';
  var emitter = getSecret('EMITTER_EMAIL') || 'revistaliterariatds@gmail.com';

  sheet.appendRow([admin, ROLES.ADMINISTRADOR, '', '', 'FALSE', 'TRUE']);
  if (emitter && String(emitter).toLowerCase() !== String(admin).toLowerCase()) {
    sheet.appendRow([emitter, ROLES.ADMINISTRADOR, '', '', 'FALSE', 'TRUE']);
  }
}
