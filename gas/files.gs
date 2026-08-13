// files.gs — Drive: carpeta por cuento y guardado de adjuntos.

var DRIVE_ROOT = 'Tramas del Sur';

function getOrCreateFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function getRootFolder() {
  var it = DriveApp.getFoldersByName(DRIVE_ROOT);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_ROOT);
}

function createCuentoFolder(id) {
  var root = getRootFolder();
  var cuentos = getOrCreateFolder(root, 'Cuentos');
  return cuentos.createFolder(id);
}

function saveFile(folder, file) {
  var bytes = Utilities.base64Decode(file.fileData);
  var blob = Utilities.newBlob(bytes, file.mimeType || 'application/octet-stream', file.fileName);
  return folder.createFile(blob);
}

// ── Doc de corrección (Fase 3) ──
// Crea un Google Doc en la carpeta del cuento con el texto del original
// (si es texto plano) y lo comparte con el editor.
function createDocCorreccion(cuento, editorEmail) {
  var folder = getCuentoFolder(cuento);
  var doc = DocumentApp.create('Corrección — ' + cuento.titulo);
  var body = doc.getBody();
  body.appendParagraph('Título: ' + cuento.titulo).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Autor: ' + cuento.autor);
  body.appendParagraph('Categoría: ' + (cuento.categoria || CATEGORIA_DEFAULT));
  body.appendParagraph('────────────────────────────────────────');
  body.appendParagraph('Texto del original:').setHeading(DocumentApp.ParagraphHeading.HEADING2);

  var texto = extractText(folder);
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
