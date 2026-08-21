// utils.gs — helpers transversales.

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(email) {
  return EMAIL_RE.test(String(email || ''));
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ok(payload) {
  var out = { status: 'ok' };
  if (payload) {
    Object.keys(payload).forEach(function (k) { out[k] = payload[k]; });
  }
  return out;
}

function err(message) {
  return { status: 'error', message: message };
}

// Error de dominio para las rutas del autor (token inválido, estado incorrecto).
function ApiError(message) {
  this.name = 'ApiError';
  this.message = message;
}

function nowIso() {
  return new Date().toISOString();
}

// SHA-256 hex de un string (para hashear tokens de autor en la hoja).
function sha256Hex(str) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    var byte = b < 0 ? b + 256 : b;
    return ('0' + byte.toString(16)).slice(-2);
  }).join('');
}

// Token de autor en la hoja: 's1:<sha256>' del token real que viaja por mail.
// El prefijo evita que Sheets interprete el hex como número y documenta el
// esquema para futuras rotaciones. Las filas legacy (UUID plano) se siguen
// aceptando hasta migrar (ver migrateAutorTokens en autor.gs).
var TOKEN_HASH_PREFIX = 's1:';

function hashearTokenAutor(token) {
  return TOKEN_HASH_PREFIX + sha256Hex(token);
}
