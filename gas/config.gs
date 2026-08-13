// config.gs — Script Properties (secretos) + hoja Config (valores editables).

// Valores por defecto para la hoja Config (no secretos).
var CONFIG_DEFAULTS = {
  expira_token_dias: '30',
  convocatoria_actual: 'general',
  site_base_url: 'https://tramasdelsur.com.ar',
};

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

// OAuth Client ID (aud del ID token). Vive en Script Properties.
function getOAuthClientId() {
  return getSecret('OAUTH_CLIENT_ID') || '';
}
