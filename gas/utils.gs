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

function nowIso() {
  return new Date().toISOString();
}
