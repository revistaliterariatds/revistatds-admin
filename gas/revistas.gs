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
var REVISTAS_PDF_MAX_BYTES = 40 * 1024 * 1024;    // las ediciones pesan 20–35 MB
var REVISTAS_PORTADA_MAX_BYTES = 4 * 1024 * 1024;
var REVISTAS_CHUNK_BYTES = 5 * 1024 * 1024;       // chunks de la subida resumable a Drive
var REVISTAS_SESION_KEY = 'revista-subida-sesion';

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
// El PDF viaja en chunks de 5 MB (base64) y se reconstruye en Drive con la
// subida resumable de Drive API v3: así soporta ediciones de 20–35 MB sin
// chocar con el límite de memoria de Apps Script (50 MB). La sesión de subida
// vive en CacheService y se reanuda si un chunk falla.

function sesionSubidaKey(email) {
  return REVISTAS_SESION_KEY + '-' + email;
}

// Valida número/título contra el índice actual de la revista.
function validarNumRevista(payload) {
  var num = String((payload && payload.num) || '').trim();
  var titulo = String((payload && payload.titulo) || '').trim();
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
  return { num: num, titulo: titulo || ('N° ' + num) };
}

// Abre la sesión resumable de Drive (llamada con el chunk 0).
function crearSesionSubida(email, num, totalBytes, totalChunks) {
  // valida el token de GitHub antes de gastar la subida
  var token = getSecret('GITHUB_TOKEN_REVISTA');
  if (!token) {
    throw new ApiError('Falta la Script Property GITHUB_TOKEN_REVISTA (token de GitHub del repo de la revista).');
  }

  var cache = CacheService.getScriptCache();
  var key = sesionSubidaKey(email);
  var prev = cache.get(key);
  if (prev) {
    // aborta una sesión anterior sin terminar
    try { UrlFetchApp.fetch(JSON.parse(prev).url, { method: 'delete', muteHttpExceptions: true }); } catch (e) { /* sin abort */ }
  }

  var folder = getOrCreateFolder(getRootFolder(), REVISTAS_UPLOAD_FOLDER);
  var init = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ name: 'rtds' + num + '.pdf', mimeType: 'application/pdf', parents: [folder.getId()] }),
    contentType: 'application/json',
    muteHttpExceptions: true,
    timeoutSeconds: 30,
  });
  if (init.getResponseCode() !== 200) {
    throw new ApiError('No se pudo iniciar la subida a Drive (HTTP ' + init.getResponseCode() + ').');
  }
  var sesion = {
    url: init.getHeaders()['Location'],
    num: num,
    titulo: '',
    totalBytes: totalBytes,
    totalChunks: totalChunks,
    received: 0,
    fileId: '',
  };
  cache.put(key, JSON.stringify(sesion), 1800); // 30 min para completar
  return sesion;
}

function leerSesion(email) {
  var raw = CacheService.getScriptCache().get(sesionSubidaKey(email));
  return raw ? JSON.parse(raw) : null;
}

function handleSubirRevistaChunk(idToken, payload) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede subir una edición.');
  var email = user.email;

  var chunkB64 = String((payload && payload.chunk_b64) || '');
  var index = Number(payload && payload.index);
  var totalChunks = Number(payload && payload.total_chunks);
  var totalBytes = Number(payload && payload.total_bytes);
  if (!chunkB64 || isNaN(index) || isNaN(totalChunks) || isNaN(totalBytes) ||
      totalBytes <= 0 || totalBytes > REVISTAS_PDF_MAX_BYTES || totalChunks < 1) {
    throw new ApiError('Parámetros de subida inválidos (PDF máximo 40 MB).');
  }

  var sesion;
  if (index === 0) {
    var meta = validarNumRevista(payload);
    sesion = crearSesionSubida(email, meta.num, totalBytes, totalChunks);
    sesion.titulo = meta.titulo;
  } else {
    sesion = leerSesion(email);
    if (!sesion) throw new ApiError('La subida expiró o se reinició. Empezá de nuevo.');
    if (index !== sesion.received) {
      throw new ApiError('La subida se desincronizó (se recibió hasta el chunk ' + sesion.received + ').');
    }
  }

  var bytes = Utilities.base64Decode(chunkB64);
  var start = index * REVISTAS_CHUNK_BYTES;
  var esperado = index === sesion.totalChunks - 1
    ? sesion.totalBytes - start
    : Math.min(REVISTAS_CHUNK_BYTES, sesion.totalBytes - start);
  if (bytes.length !== esperado) {
    throw new ApiError('El chunk ' + (index + 1) + ' no tiene el tamaño esperado. Reintentá la subida.');
  }
  var end = start + bytes.length;

  var res = UrlFetchApp.fetch(sesion.url, {
    method: 'put',
    headers: { 'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + sesion.totalBytes },
    payload: Utilities.newBlob(bytes, 'application/octet-stream'),
    muteHttpExceptions: true,
    followRedirects: false, // 308 Resume Incomplete: que no re-suba el cuerpo
    timeoutSeconds: 60,
  });
  var code = res.getResponseCode();

  if (code === 201) {
    // la subida se completó con este chunk
    var metaCompleta = JSON.parse(res.getContentText());
    sesion.fileId = metaCompleta.id;
    sesion.received = sesion.totalChunks;
  } else if (code === 308) {
    sesion.received = index + 1;
  } else {
    throw new ApiError('Error subiendo el chunk ' + (index + 1) + ' (HTTP ' + code + '). Reintentá la subida.');
  }

  CacheService.getScriptCache().put(sesionSubidaKey(email), JSON.stringify(sesion), 1800);
  return { status: 'ok', received: sesion.received, completo: sesion.received === sesion.totalChunks };
}

// Estado de la subida actual (para reanudar tras un error de red del cliente).
function handleSubirRevistaEstado(idToken) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede subir una edición.');
  var sesion = leerSesion(user.email);
  return { status: 'ok', received: sesion ? sesion.received : 0 };
}

// Cierra la subida: portada (opcional), acceso público y dispatch a GitHub.
function handleSubirRevistaFinal(idToken, payload) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede subir una edición.');

  var sesion = leerSesion(user.email);
  if (!sesion || sesion.received !== sesion.totalChunks) {
    throw new ApiError('El PDF no terminó de subirse. Reintentá la subida.');
  }
  if (!sesion.fileId) throw new ApiError('El PDF no quedó registrado en Drive. Reintentá la subida.');

  var pdfFile = DriveApp.getFileById(sesion.fileId);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var pdfUrl = 'https://drive.google.com/uc?export=download&id=' + pdfFile.getId();

  var portadaUrl = '';
  var portadaB64 = String((payload && payload.portada_b64) || '').trim();
  if (portadaB64) {
    var portadaBytes = Utilities.base64Decode(portadaB64);
    if (portadaBytes.length > REVISTAS_PORTADA_MAX_BYTES) {
      throw new ApiError('La portada supera el máximo de 4 MB.');
    }
    var folder = getOrCreateFolder(getRootFolder(), REVISTAS_UPLOAD_FOLDER);
    var portadaFile = folder.createFile(Utilities.newBlob(portadaBytes, 'image/jpeg', 'rtds' + sesion.num + '.jpeg'));
    portadaFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    portadaUrl = 'https://drive.google.com/uc?export=download&id=' + portadaFile.getId();
  }

  dispatchearPublicarEdicion({ num: sesion.num, titulo: sesion.titulo, pdf_url: pdfUrl, portada_url: portadaUrl });

  CacheService.getScriptCache().remove(sesionSubidaKey(user.email));

  return {
    status: 'ok',
    message: 'Edición ' + sesion.titulo + ' en proceso de publicación. Aparecerá en el sitio en ~1 minuto.',
    num: sesion.num,
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