// config.gs — Script Properties (secretos) + hoja Config (valores editables).

// Valores por defecto para la hoja Config (no secretos).
var CONFIG_DEFAULTS = {
  expira_token_dias: '30',
  recordatorio_editores_dias: '3',
  site_base_url: 'https://tramasdelsur.com.ar',
  mail_subject_confirmation: 'Recibimos tu envío — {{titulo}}',
  mail_subject_correcciones: 'Correcciones solicitadas — {{titulo}}',
  mail_subject_revision: 'Revisión terminada — {{titulo}}',
  mail_subject_consulta: 'Tu producción está lista para aprobación — {{titulo}}',
  mail_subject_version: 'Nueva versión recibida — {{titulo}}',
  mail_subject_devolucion: 'Producción devuelta a revisión — {{titulo}}',
  mail_subject_agenda: 'Nueva cita en la agenda — {{titulo}}',
  mail_subject_recordatorio: 'Producciones pendientes de revisión — {{cantidad}}',
  mail_subject_digest: 'Digest semanal del tablero — {{fecha}}',
  mail_subject_token_vencido: 'Tokens de autor vencidos — {{cantidad}}',
  // Cuerpos interiores (Opción A): solo el texto, el wrapper TDS queda en código.
  mail_body_confirmation: 'Gracias por enviarnos {{titulo}}. Ya está en nuestra bandeja y el equipo de redacción lo revisará.',
  mail_body_correcciones: 'El equipo editorial te pidió correcciones sobre {{titulo}}. Subí tu nueva versión desde este enlace (personal, no lo compartas):',
  mail_body_revision: '{{editor}} terminó la revisión. Queda en ESPERANDO_APROBACIÓN.',
  mail_body_consulta: 'El equipo editorial terminó la revisión de {{titulo}}. Revisá la versión y elegí una opción (este enlace es de un solo uso):',
  mail_body_version: '{{titulo}} tiene una nueva versión ({{version}}).',
  mail_body_devolucion: '{{titulo}} fue devuelto por el equipo luego de la respuesta del autor.',
  mail_body_recordatorio: 'Tenés {{cantidad}} producción/es pendientes de revisión en el tablero:',
  mail_body_digest: 'Resumen semanal del circuito editorial:',
  mail_body_token_vencido: 'Hay {{cantidad}} token/s de autor vencidos que requieren reenvío:',
};

var CONFIG_EDITABLES = [
  'expira_token_dias', 'recordatorio_editores_dias', 'site_base_url',
  'mail_subject_confirmation', 'mail_subject_correcciones', 'mail_subject_revision',
  'mail_subject_consulta', 'mail_subject_version', 'mail_subject_devolucion',
  'mail_subject_agenda', 'mail_subject_recordatorio', 'mail_subject_digest',
  'mail_subject_token_vencido',
  'mail_body_confirmation', 'mail_body_correcciones', 'mail_body_revision',
  'mail_body_consulta', 'mail_body_version', 'mail_body_devolucion',
  'mail_body_recordatorio', 'mail_body_digest', 'mail_body_token_vencido',
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

// Cuerpo interior configurable (Opción A): solo el texto, sin wrapper HTML.
function getMailBody(key, fallback, variables) {
  var body = getConfig(key) || fallback;
  Object.keys(variables || {}).forEach(function (name) {
    body = body.replace(new RegExp('\\{\\{' + name + '\\}\\}', 'g'), String(variables[name] || ''));
  });
  return body;
}

function handleConfigList(idToken) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');
  var cache = CacheService.getScriptCache();
  var cached = cache.get('config-list');
  if (cached) return JSON.parse(cached);
  var values = {};
  CONFIG_EDITABLES.forEach(function (key) { values[key] = getConfig(key); });
  var result = ok({ config: values });
  cache.put('config-list', JSON.stringify(result), 600);
  return result;
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
  if (key === 'recordatorio_editores_dias') {
    var dias = parseInt(value, 10);
    if (!/^\d+$/.test(value) || dias < 1 || dias > 30) throw new ApiError('El umbral de recordatorio debe estar entre 1 y 30 días.');
    value = String(dias);
  }
  if (key === 'site_base_url' && !/^https:\/\//i.test(value)) {
    throw new ApiError('La URL del sitio debe usar HTTPS.');
  }
  if (key.indexOf('mail_subject_') === 0 && (!value || value.length > 200)) {
    throw new ApiError('El asunto debe tener entre 1 y 200 caracteres.');
  }
  if (key.indexOf('mail_body_') === 0 && (!value || value.length > 2000)) {
    throw new ApiError('El cuerpo debe tener entre 1 y 2000 caracteres.');
  }
  setConfig(key, value);
  CacheService.getScriptCache().remove('config-list');
  return ok({ message: 'Configuración guardada.', key: key, value: value });
}

// OAuth Client ID (aud del ID token). Vive en Script Properties.
function getOAuthClientId() {
  return getSecret('OAUTH_CLIENT_ID') || '';
}
