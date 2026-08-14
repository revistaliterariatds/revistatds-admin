// config.gs — Script Properties (secretos) + hoja Config (valores editables).

// Valores por defecto para la hoja Config (no secretos).
var CONFIG_DEFAULTS = {
  expira_token_dias: '30',
  convocatoria_actual: 'general',
  site_base_url: 'https://tramasdelsur.com.ar',
  mail_subject_confirmation: 'Recibimos tu envío — {{titulo}}',
  mail_subject_correcciones: 'Correcciones solicitadas — {{titulo}}',
  mail_subject_revision: 'Revisión terminada — {{titulo}}',
  mail_subject_consulta: 'Tu producción está lista para aprobación — {{titulo}}',
  mail_subject_version: 'Nueva versión recibida — {{titulo}}',
  mail_subject_devolucion: 'Cuento devuelto a revisión — {{titulo}}',
};

var CONFIG_EDITABLES = [
  'expira_token_dias', 'convocatoria_actual', 'site_base_url',
  'mail_subject_confirmation', 'mail_subject_correcciones', 'mail_subject_revision',
  'mail_subject_consulta', 'mail_subject_version', 'mail_subject_devolucion',
];

function scriptProps() {
  return PropertiesService.getScriptProperties();
}

// Secretos en Script Properties (nunca en el repo ni en la hoja).
function getSecret(key) {
  return scriptProps().getProperty(key);
}

function setSecret(key, value) {
  scriptProps().setProperty(key, value);
}

function getConfig(key) {
  var sheet = getSheet('Config');
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      return data[i][1] == null ? '' : String(data[i][1]);
    }
  }
  return CONFIG_DEFAULTS[key] || '';
}

function setConfig(key, value) {
  var sheet = getSheet('Config');
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      sheet.getRange(i + 1, 2).setValue(String(value));
      return;
    }
  }
  sheet.appendRow([key, String(value)]);
}

function getMailSubject(key, fallback, variables) {
  var subject = getConfig(key) || fallback;
  Object.keys(variables || {}).forEach(function (name) {
    subject = subject.replace(new RegExp('\\{\\{' + name + '\\}\\}', 'g'), String(variables[name] || ''));
  });
  return subject.slice(0, 200);
}

function handleConfigList(idToken) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  var values = {};
  CONFIG_EDITABLES.forEach(function (key) { values[key] = getConfig(key); });
  return ok({ config: values });
}

function handleConfigSave(idToken, key, value) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  if (CONFIG_EDITABLES.indexOf(key) < 0) throw new ApiError('Clave de configuración no editable.');

  value = String(value == null ? '' : value).trim();
  if (key === 'expira_token_dias') {
    var days = parseInt(value, 10);
    if (!/^\d+$/.test(value) || days < 1 || days > 365) throw new ApiError('La expiración debe estar entre 1 y 365 días.');
    value = String(days);
  }
  if (key === 'convocatoria_actual' && ['general', 'docentes'].indexOf(value) < 0) {
    throw new ApiError('Convocatoria inválida.');
  }
  if (key === 'site_base_url' && !/^https:\/\//i.test(value)) {
    throw new ApiError('La URL del sitio debe usar HTTPS.');
  }
  if (key.indexOf('mail_subject_') === 0 && (!value || value.length > 200)) {
    throw new ApiError('El asunto debe tener entre 1 y 200 caracteres.');
  }
  setConfig(key, value);
  return ok({ message: 'Configuración guardada.', key: key, value: value });
}

// OAuth Client ID (aud del ID token). Vive en Script Properties.
function getOAuthClientId() {
  return getSecret('OAUTH_CLIENT_ID') || '';
}
