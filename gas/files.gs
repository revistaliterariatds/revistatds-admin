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
