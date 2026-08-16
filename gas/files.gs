// files.gs — Drive: carpeta por cuento y guardado de adjuntos.

var DRIVE_ROOT = 'Tramas del Sur';
var MAX_FILES = 3;
var MAX_FILE_BYTES = 10 * 1024 * 1024;
var MAX_FILE_NAME_LENGTH = 120;

function getOrCreateFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function getRootFolder() {
  var it = DriveApp.getFoldersByName(DRIVE_ROOT);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_ROOT);
}

// ── Estructura por ediciones ──
// Tramas del Sur / EDICIONES / EDICION N° xx / {RECIBIDOS, PUBLICABLES}
// El número lleva cero a la izquierda para que Drive ordene alfabéticamente.
function nombreEdicion(numero) {
  var n = String(numero);
  while (n.length < 2) n = '0' + n;
  return 'EDICION N° ' + n;
}

function getEdicionesRoot() {
  return getOrCreateFolder(getRootFolder(), 'EDICIONES');
}

function getEdicionFolder(numero) {
  return getOrCreateFolder(getEdicionesRoot(), nombreEdicion(numero));
}

function getRecibidosFolder(numero) {
  return getOrCreateFolder(getEdicionFolder(numero), 'RECIBIDOS');
}

function getPublicablesFolder(numero) {
  return getOrCreateFolder(getEdicionFolder(numero), 'PUBLICABLES');
}

// Edición a la que pertenece un envío nuevo: la que contenga la fecha de hoy
// (por rango apertura–cierre; incluye ediciones cerradas con cierre futuro);
// si no hay ninguna, la edición abierta; si no, la última; si no, SIN_EDICION.
function edicionDestino() {
  var porFecha = edicionPorFecha(hoyKey());
  if (porFecha) return porFecha;
  var abierta = edicionActual();
  if (abierta) return abierta;
  return ultimaEdicion() || 'SIN_EDICION';
}

function createCuentoFolder(id) {
  return getRecibidosFolder(edicionDestino()).createFolder(id);
}

// Copia un archivo del cuento a PUBLICABLES/<id>-<nombre> (sueltos, sin subcarpeta).
function copiarAPublicables(cuento, fileId) {
  var edicion = String(cuento.edicion || edicionDestino());
  var destino = getPublicablesFolder(edicion);
  var file = DriveApp.getFileById(fileId);
  var nombre = String(cuento.id || '') + '-' + file.getName();
  return file.makeCopy(nombre, destino).getUrl();
}

// Lista recursiva de archivos en la carpeta del cuento (para el selector del panel).
function listarArchivosCuento(cuento) {
  var out = [];
  (function walk(folder, ruta) {
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      out.push({ fileId: f.getId(), nombre: f.getName(), mime: f.getMimeType(), carpeta: ruta, url: f.getUrl() });
    }
    var subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      var sub = subfolders.next();
      walk(sub, ruta + '/' + sub.getName());
    }
  })(getCuentoFolder(cuento), 'raíz');
  return out;
}

// Migración única (idempotente): mueve las carpetas existentes de Cuentos/<id>
// a RECIBIDOS/<edicion> de la estructura por ediciones y crea las carpetas base.
function migrateEstructuraDrive() {
  ensureSchema();

  listarEdiciones().forEach(function (e) {
    getRecibidosFolder(e.numero);
    getPublicablesFolder(e.numero);
  });

  var tablero = getSheet('Tablero');
  var edicionById = {};
  if (tablero && tablero.getLastRow() > 1) {
    var idx = headerIndex(tablero);
    var data = tablero.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      edicionById[String(data[i][idx.id])] = String(data[i][idx.edicion] || '');
    }
  }

  var root = getRootFolder();
  var cuentos = getOrCreateFolder(root, 'Cuentos');
  var movidos = 0;
  var folders = cuentos.getFolders();
  while (folders.hasNext()) {
    var f = folders.next();
    var edicion = edicionById[f.getName()] || ultimaEdicion();
    if (!edicion) continue;
    f.moveTo(getRecibidosFolder(edicion));
    movidos++;
  }

  Logger.log('migrateEstructuraDrive: ' + movidos + ' carpeta(s) movidas a RECIBIDOS.');
  return 'OK (' + movidos + ' carpeta(s) movidas)';
}

// Valida y normaliza adjuntos antes de tocar Drive. El formulario productivo
// admite cualquier formato, por eso el límite server-side es tamaño/cantidad.
function validarArchivos(archivos) {
  if (!Array.isArray(archivos)) throw new ApiError('Los archivos deben ser una lista.');
  if (archivos.length === 0) throw new ApiError('Adjuntá al menos un archivo.');
  if (archivos.length > MAX_FILES) throw new ApiError('Podés subir hasta ' + MAX_FILES + ' archivos.');

  return archivos.map(function (file) {
    if (!file || typeof file.fileData !== 'string' || !file.fileData) {
      throw new ApiError('Archivo inválido.');
    }
    var data = file.fileData.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
      throw new ApiError('Contenido de archivo inválido.');
    }
    if (data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
      throw new ApiError('Un archivo supera los 10 MB permitidos.');
    }

    var bytes;
    try { bytes = Utilities.base64Decode(data); } catch (e) {
      throw new ApiError('No se pudo leer un archivo.');
    }
    if (bytes.length > MAX_FILE_BYTES) throw new ApiError('Un archivo supera los 10 MB permitidos.');

    var originalName = String(file.fileName || '').split(/[\\/]/).pop();
    var safeName = originalName.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, MAX_FILE_NAME_LENGTH);
    if (!safeName) throw new ApiError('Falta el nombre de un archivo.');

    return {
      fileName: safeName,
      fileData: data,
      mimeType: String(file.mimeType || 'application/octet-stream').slice(0, 120),
      _bytes: bytes,
    };
  });
}

function saveFile(folder, file) {
  var bytes = file._bytes || Utilities.base64Decode(file.fileData);
  var blob = Utilities.newBlob(bytes, file.mimeType || 'application/octet-stream', file.fileName);
  return folder.createFile(blob);
}

function saveFiles(folder, files) {
  var created = [];
  try {
    files.forEach(function (file) { created.push(saveFile(folder, file)); });
    return created;
  } catch (e) {
    created.forEach(function (file) { try { file.setTrashed(true); } catch (ignore) {} });
    throw new ApiError('No se pudieron guardar todos los archivos: ' + (e.message || e));
  }
}

// ── Doc de corrección (Fase 3) ──
// Crea un Google Doc en la carpeta del cuento con el texto del original
// (si es texto plano) y lo comparte con el editor.
function createDocCorreccion(cuento, editorEmail, sourceFolder) {
  var folder = getCuentoFolder(cuento);
  var doc = DocumentApp.create('Corrección — ' + cuento.titulo);
  var body = doc.getBody();
  body.appendParagraph('Título: ' + cuento.titulo).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Autor: ' + cuento.autor);
  body.appendParagraph('Categoría: ' + (cuento.categoria || CATEGORIA_DEFAULT));
  body.appendParagraph('────────────────────────────────────────');
  body.appendParagraph('Texto del original:').setHeading(DocumentApp.ParagraphHeading.HEADING2);

  var texto = extractText(sourceFolder || folder);
  if (texto) {
    body.appendParagraph(texto);
  } else {
    body.appendParagraph('(No se pudo extraer texto del adjunto original; ver archivo en Drive.)');
  }

  if (editorEmail) doc.addEditor(editorEmail);

  var file = DriveApp.getFileById(doc.getId());
  var docFolder = getOrCreateFolder(folder, 'correccion');
  file.moveTo(docFolder);
  return doc.getUrl();
}

function textoDocCorreccion(cuento) {
  if (!cuento.url_doc_correccion) return '';
  var match = String(cuento.url_doc_correccion).match(/\/d\/([\w-]+)/);
  if (!match) return '';
  try { return DocumentApp.openById(match[1]).getBody().getText(); } catch (e) { return ''; }
}

// PDF del doc de corrección para adjuntar al mail del autor.
// El autor nunca recibe links de Drive ni documentos editables:
// solo el archivo en formato PDF.
function pdfDocCorreccion(cuento) {
  if (!cuento.url_doc_correccion) return null;
  var match = String(cuento.url_doc_correccion).match(/\/d\/([\w-]+)/);
  if (!match) return null;
  try {
    return DriveApp.getFileById(match[1]).getAs('application/pdf');
  } catch (e) {
    return null;
  }
}

// Intenta extraer texto de un adjunto de texto plano (en la raíz de la carpeta).
function extractText(folder) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getMimeType() === 'text/plain') {
      try { return f.getBlob().getDataAsString(); } catch (e) { return null; }
    }
  }
  return null;
}

// Copia los archivos de la versión vigente a una carpeta estable para publicación.
function guardarVersionAprobada(cuento) {
  var folder = getCuentoFolder(cuento);
  var aprobada = getOrCreateFolder(folder, 'version_aprobada');
  if (aprobada.getFiles().hasNext()) return aprobada.getUrl();

  var version = 'v' + (cuento.version_actual || '1');
  var folders = folder.getFoldersByName(version);
  var origen = folders.hasNext() ? folders.next() : folder;
  var files = origen.getFiles();
  var copiados = 0;
  while (files.hasNext()) files.next().makeCopy(aprobada);
  // La primera entrega se guarda en la raíz; las siguientes, en vN.
  var confirmacion = aprobada.getFiles();
  while (confirmacion.hasNext()) { confirmacion.next(); copiados++; }
  if (copiados === 0) throw new ApiError('No hay archivos para guardar como versión aprobada.');
  return aprobada.getUrl();
}
