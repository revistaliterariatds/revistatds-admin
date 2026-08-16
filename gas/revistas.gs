// revistas.gs — Ediciones publicadas de la revista (lectura, todos los roles).
// Proxy del índice del sitio público (tramasdelsur.com.ar/assets/docs/index.json):
// una edición nueva que se suba a la revista aparece automáticamente en el panel.
// Subida de ediciones nuevas = COORDINADOR/WEBMASTER: guarda el PDF en Drive con
// acceso público y dispara el GitHub Action del repo de la revista, que commitea
// los archivos y actualiza index.json (el sitio se publica solo).

var REVISTAS_INDEX_URL = 'https://tramasdelsur.com.ar/assets/docs/index.json';
var REVISTAS_BASE_URL = 'https://tramasdelsur.com.ar/assets/docs/';
var REVISTAS_GITHUB_REPO = 'revistaliterariatds/revistatds';
var REVISTAS_UPLOAD_FOLDER = 'PanelTDS - subidas';
var REVISTAS_PDF_MAX_BYTES = 12 * 1024 * 1024;    // límite práctico del pipeline (base64 + memoria de Apps Script)
var REVISTAS_PORTADA_MAX_BYTES = 4 * 1024 * 1024;

// Lee el índice actual de la revista. Lanza ApiError si el sitio no responde.
function fetchIndiceRevista() {
  var res = UrlFetchApp.fetch(REVISTAS_INDEX_URL, { muteHttpExceptions: true, timeoutSeconds: 15 });
  if (res.getResponseCode() !== 200) {
    throw new ApiError('El sitio de la revista no respondió (HTTP ' + res.getResponseCode() + ').');
  }
  try {
    return JSON.parse(res.getContentText()) || [];
  } catch (ex) {
    throw new ApiError('El índice de la revista no se pudo leer: ' + ex.message);
  }
}

function handleListarRevistas(idToken) {
  requireInternalUser(idToken);

  var cache = CacheService.getScriptCache();
  var cached = cache.get('revistas-list');
  if (cached) return { status: 'ok', revistas: JSON.parse(cached) };

  var revistas = fetchIndiceRevista().map(function (it) {
    var num = String(it.num || '');
    return {
      num: num,
      titulo: it.titulo || 'N° ' + num,
      pdf_url: REVISTAS_BASE_URL + 'rtds' + num + '.pdf',
      portada_url: REVISTAS_BASE_URL + 'rtds' + num + '.jpeg',
    };
  });
  revistas.sort(function (a, b) { return Number(b.num) - Number(a.num); });

  cache.put('revistas-list', JSON.stringify(revistas), 600); // 10 min
  return { status: 'ok', revistas: revistas };
}

// ── subida de una edición nueva (COORDINADOR/WEBMASTER) ──
function handleSubirRevista(idToken, payload) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede subir una edición.');

  var pdfB64 = String((payload && payload.pdf_b64) || '').trim();
  var portadaB64 = String((payload && payload.portada_b64) || '').trim();
  var titulo = String((payload && payload.titulo) || '').trim();
  var num = String((payload && payload.num) || '').trim();

  if (!pdfB64) throw new ApiError('Falta el PDF de la edición.');
  var pdfBytes = Utilities.base64Decode(pdfB64);
  if (pdfBytes.length > REVISTAS_PDF_MAX_BYTES) {
    throw new ApiError('El PDF supera el máximo de 12 MB.');
  }

  // Número: lo elige el coordinador o se deriva del índice actual de la revista.
  var indice = fetchIndiceRevista();
  if (num) {
    if (!/^\d+$/.test(num)) throw new ApiError('El número debe ser solo dígitos.');
    if (indice.some(function (r) { return String(r.num) === num; })) {
      throw new ApiError('La edición N° ' + num + ' ya existe en la revista.');
    }
  } else {
    var maxNum = 0;
    indice.forEach(function (r) { var n = Number(r.num); if (!isNaN(n) && n > maxNum) maxNum = n; });
    num = String(maxNum + 1);
  }
  var label = titulo || ('N° ' + num);

  // Guarda en Drive con acceso público: el GitHub Action lo descarga desde el link.
  var folder = getOrCreateFolder(getRootFolder(), REVISTAS_UPLOAD_FOLDER);
  var pdfFile = folder.createFile(Utilities.newBlob(pdfBytes, 'application/pdf', 'rtds' + num + '.pdf'));
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var pdfUrl = 'https://drive.google.com/uc?export=download&id=' + pdfFile.getId();

  var portadaUrl = '';
  if (portadaB64) {
    var portadaBytes = Utilities.base64Decode(portadaB64);
    if (portadaBytes.length > REVISTAS_PORTADA_MAX_BYTES) {
      throw new ApiError('La portada supera el máximo de 4 MB.');
    }
    var portadaFile = folder.createFile(Utilities.newBlob(portadaBytes, 'image/jpeg', 'rtds' + num + '.jpeg'));
    portadaFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    portadaUrl = 'https://drive.google.com/uc?export=download&id=' + portadaFile.getId();
  }

  dispatchearPublicarEdicion({ num: num, titulo: label, pdf_url: pdfUrl, portada_url: portadaUrl });

  return {
    status: 'ok',
    message: 'Edición ' + label + ' en proceso de publicación. Aparecerá en el sitio en ~1 minuto.',
    num: num,
  };
}

// Dispara el workflow "publicar-edicion" del repo de la revista.
// Requiere la Script Property GITHUB_TOKEN_REVISTA (fine-grained PAT, solo
// el repo revistaliterariatds/revistatds, permiso Contents: write).
function dispatchearPublicarEdicion(payload) {
  var token = getSecret('GITHUB_TOKEN_REVISTA');
  if (!token) {
    throw new ApiError('Falta la Script Property GITHUB_TOKEN_REVISTA (token de GitHub del repo de la revista).');
  }
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + REVISTAS_GITHUB_REPO + '/dispatches', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ event_type: 'publicar-edicion', client_payload: payload }),
    contentType: 'application/json',
    muteHttpExceptions: true,
    timeoutSeconds: 20,
  });
  if (res.getResponseCode() !== 204) {
    throw new ApiError('GitHub no aceptó la publicación (HTTP ' + res.getResponseCode() + '). Revisá GITHUB_TOKEN_REVISTA.');
  }
}