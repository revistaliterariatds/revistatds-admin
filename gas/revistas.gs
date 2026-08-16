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
    // la subida ya se completó en un intento anterior (respuesta perdida por red)
    if (sesion.received === sesion.totalChunks) {
      return { status: 'ok', received: sesion.received, completo: true };
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

  if (code === 201 || code === 200) {
    // la subida se completó con este chunk (Drive puede responder 200 o 201)
    var body = res.getContentText();
    if (body) {
      try {
        var metaCompleta = JSON.parse(body);
        if (metaCompleta.id) sesion.fileId = metaCompleta.id;
      } catch (e) { /* body sin recurso */ }
    }
    if (!sesion.fileId) {
      // fallback: buscar el archivo por nombre en la carpeta de subidas
      var folderSubidas = getOrCreateFolder(getRootFolder(), REVISTAS_UPLOAD_FOLDER);
      var filesSubidos = folderSubidas.getFilesByName('rtds' + sesion.num + '.pdf');
      if (filesSubidos.hasNext()) sesion.fileId = filesSubidos.next().getId();
    }
    sesion.received = sesion.totalChunks;
  } else if (code === 308) {
    sesion.received = index + 1;
    // si Drive informa hasta qué byte recibió, sincroniza el conteo
    var rango = res.getHeaders()['Range'] || res.getHeaders()['range'];
    if (rango) {
      var ultimo = Number(String(rango).split('-')[1]);
      if (!isNaN(ultimo)) {
        var recibidos = Math.floor((ultimo + 1) / REVISTAS_CHUNK_BYTES);
        if (recibidos > sesion.received && recibidos <= sesion.totalChunks) sesion.received = recibidos;
      }
    }
  } else {
    throw new ApiError('Error subiendo el chunk ' + (index + 1) + ' (HTTP ' + code + '): ' + String(res.getContentText()).slice(0, 200) + ' Reintentá la subida.');
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
  agendarAvisoEdicion(sesion.num, sesion.titulo);
  agendarAvisoAutores(sesion.num, sesion.titulo);

  return {
    status: 'ok',
    message: 'Edición ' + sesion.titulo + ' en proceso de publicación. Aparecerá en el sitio en ~1 minuto, avisamos al equipo por mail en ~2 y a los autores en ~10.',
    num: sesion.num,
  };
}

// ── aviso al equipo editorial (2 minutos después de publicar) ──
// Se agenda con un trigger de una sola ejecución; los datos del aviso viven en
// Script Properties (los triggers no reciben argumentos). Si el envío falla,
// se re-agenda en 3 minutos conservando el aviso pendiente.

var AVISO_EDICION_KEY = 'aviso-edicion-pendiente';

function agendarAvisoEdicion(num, titulo) {
  PropertiesService.getScriptProperties().setProperty(AVISO_EDICION_KEY, JSON.stringify({ num: num, titulo: titulo }));
  ScriptApp.newTrigger('enviarAvisoEdicionPublicada').timeBased().after(2 * 60 * 1000).create();
}

function enviarAvisoEdicionPublicada() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(AVISO_EDICION_KEY);
  if (!raw) return; // nada pendiente (o ya enviado)
  var pendiente = JSON.parse(raw);

  try {
    var emails = getEmailsByRoles(ROLES_NOTIF_INTERNOS);
    if (emails.length === 0) return;
    var sitio = siteBase();
    var pdfUrl = REVISTAS_BASE_URL + 'rtds' + pendiente.num + '.pdf';
    var subject = 'Nueva edición de Tramas del Sur: ' + pendiente.titulo + ' — a leer y difundir';
    var html = [
      '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
      '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">Nueva edición: ' + escapeHtml(pendiente.titulo) + '</h1>',
      '  <p style="font-size:16px;line-height:1.6;margin:0 0 12px;">Ya está publicada la edición <strong>' + escapeHtml(pendiente.titulo) + '</strong> de Tramas del Sur. Te invitamos a leerla y a difundirla: compartila con tus contactos, en tus redes y en tu comunidad.</p>',
      '  <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">Cada mano que la acerque a más lectores hace crecer la revista. ¡Gracias por ser parte!</p>',
      '  <p style="margin:0 0 12px;"><a href="' + sitio + '" style="display:inline-block;background:#d95f1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Leer la nueva edición</a></p>',
      '  <p style="margin:0 0 24px;"><a href="' + pdfUrl + '" style="display:inline-block;border:1px solid #d95f1a;color:#d95f1a;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Descargar el PDF</a></p>',
      '  <p style="font-size:13px;color:#8a837a;margin:0;">Tramas del Sur — Revista literaria independiente</p>',
      '</div>',
    ].join('');
    emails.forEach(function (e) { sendHtmlMail(e, subject, html); });
    props.deleteProperty(AVISO_EDICION_KEY);
  } catch (err) {
    // reintenta en 3 minutos, conservando el aviso pendiente
    ScriptApp.newTrigger('enviarAvisoEdicionPublicada').timeBased().after(3 * 60 * 1000).create();
    return;
  }

  // limpieza: elimina triggers sobrantes de este handler
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'enviarAvisoEdicionPublicada') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
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
// ── aviso a los autores publicados (10 minutos después de publicar) ──
// Felicitaciones a los autores cuyas producciones (estado PUBLICADO) forman
// parte de la edición publicada. Prolijo y seguro:
//  - un solo mail por autor (agrupado por email), cada uno solo con su info
//  - registro en la hoja "Avisos" → idempotente, nunca se reenvía
//  - link personal de estado solo si existe token (nunca se expone el token)
//  - si falla el envío, reintenta en 3 minutos conservando lo pendiente

var AVISO_AUTORES_KEY = 'aviso-autores-pendiente';

function produccionesPublicadasDeEdicion(num) {
  var sheet = getSheet('Tablero');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var objetivo = nombreEdicion(num);
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.estado]) === ESTADOS.PUBLICADO &&
        String(data[i][idx.edicion]) === objetivo) {
      out.push({
        _rowIndex: i,
        id: String(data[i][idx.id] || ''),
        titulo: String(data[i][idx.titulo] || ''),
        autor: String(data[i][idx.autor] || ''),
        email: String(data[i][idx.email_autor] || '').trim(),
        token: String(data[i][idx.token_autor] || ''),
      });
    }
  }
  return out;
}

function avisoYaEnviado(num, produccionId) {
  var sheet = getSheet('Avisos');
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(num) && String(data[i][1]) === String(produccionId)) return true;
  }
  return false;
}

function registrarAviso(num, produccionId, email) {
  getSheet('Avisos').appendRow([String(num), String(produccionId), String(email), new Date()]);
}

// Mails a autores: pueden salir desde un alias Gmail (Script Property
// MAIL_FROM_AUTORES = email del alias, dado de alta en "Send mail as" de la
// cuenta dueña). Si no está configurado, usa la cuenta del script (MailApp).
function sendMailAutores(to, subject, html) {
  var desde = getSecret('MAIL_FROM_AUTORES');
  if (desde) {
    GmailApp.sendEmail({ to: to, subject: subject, htmlBody: html, from: desde, name: MAIL_FROM_NAME });
  } else {
    sendHtmlMail(to, subject, html);
  }
}

function joinTitulos(titulos) {
  var out = [];
  titulos.forEach(function (t) { out.push('«' + escapeHtml(t) + '»'); });
  if (out.length === 1) return out[0];
  return out.slice(0, -1).join(', ') + ' y ' + out[out.length - 1];
}

function agendarAvisoAutores(num, titulo) {
  var producciones = produccionesPublicadasDeEdicion(num);
  // agrupa por email: un solo mail por autor con todas sus producciones
  var grupos = {};
  producciones.forEach(function (p) {
    if (!p.email) return;
    if (!grupos[p.email]) grupos[p.email] = { autor: p.autor, token: '', producciones: [] };
    var g = grupos[p.email];
    g.producciones.push({ id: p.id, titulo: p.titulo });
    if (!g.token && p.token) g.token = p.token;
  });
  var lista = [];
  Object.keys(grupos).forEach(function (email) {
    var g = grupos[email];
    lista.push({ email: email, autor: g.autor, token: g.token, producciones: g.producciones });
  });
  if (lista.length === 0) return; // sin autores publicados para esta edición
  PropertiesService.getScriptProperties().setProperty(
    AVISO_AUTORES_KEY, JSON.stringify({ num: num, titulo: titulo, grupos: lista }));
  ScriptApp.newTrigger('enviarAvisoAutoresPublicados').timeBased().after(10 * 60 * 1000).create();
}

function enviarAvisoAutoresPublicados() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(AVISO_AUTORES_KEY);
  if (!raw) return; // nada pendiente (o ya enviado)
  var pendiente = JSON.parse(raw);
  var sitio = siteBase();
  var pdfUrl = REVISTAS_BASE_URL + 'rtds' + pendiente.num + '.pdf';

  try {
    pendiente.grupos.forEach(function (g) {
      var pendientes = g.producciones.filter(function (p) {
        return !avisoYaEnviado(pendiente.num, p.id);
      });
      if (pendientes.length === 0) return; // ya notificado antes
      var titulos = pendientes.map(function (p) { return p.titulo; });
      var subject = 'Tu publicación en Tramas del Sur — ' + pendiente.titulo;
      var html = [
        '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
        '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">¡Felicitaciones!</h1>',
        '  <p style="font-size:16px;line-height:1.6;margin:0 0 12px;">Hola ' + escapeHtml(g.autor || '') + ',</p>',
        '  <p style="font-size:16px;line-height:1.6;margin:0 0 12px;">Tu producción ' + joinTitulos(titulos) + ' forma parte de la edición ' + escapeHtml(pendiente.titulo) + ' de Tramas del Sur, ya publicada.</p>',
        '  <p style="font-size:16px;line-height:1.6;margin:0 0 12px;">Gracias por participar y por confiar en la revista: es un orgullo tener tu trabajo en estas páginas.</p>',
        '  <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">Te invitamos a leerla y a difundirla: compartila con tus contactos y en tus redes.</p>',
        '  <p style="margin:0 0 12px;"><a href="' + sitio + '" style="display:inline-block;background:#d95f1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Leer la nueva edición</a></p>',
        '  <p style="margin:0 0 12px;"><a href="' + pdfUrl + '" style="display:inline-block;border:1px solid #d95f1a;color:#d95f1a;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Descargar el PDF</a></p>',
      ];
      if (g.token) {
        html.push('  <p style="margin:0 0 24px;"><a href="' + autorLink(g.token, 'estado') + '" style="display:inline-block;border:1px solid #d95f1a;color:#d95f1a;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Ver el estado de mi envío</a></p>');
      } else {
        html.push('  <p style="margin:0 0 24px;"></p>');
      }
      html.push('  <p style="font-size:13px;color:#8a837a;margin:0;">Tramas del Sur — Revista literaria independiente</p>');
      html.push('</div>');
      sendMailAutores(g.email, subject, html.join(''));
      pendientes.forEach(function (p) { registrarAviso(pendiente.num, p.id, g.email); });
    });
    props.deleteProperty(AVISO_AUTORES_KEY);
  } catch (err) {
    // reintenta en 3 minutos, conservando lo pendiente
    ScriptApp.newTrigger('enviarAvisoAutoresPublicados').timeBased().after(3 * 60 * 1000).create();
    return;
  }

  // limpieza: elimina triggers sobrantes de este handler
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'enviarAvisoAutoresPublicados') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
