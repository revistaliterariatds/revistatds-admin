// history.gs — Historial append-only de acciones sobre cada producción
// + auditoría de cambios administrativos (usuarios, configuración).

function addHistory(idProduccion, actor, accion, detalle) {
  getSheet('Historial').appendRow([
    idProduccion,
    new Date(),
    actor,
    accion,
    detalle || '',
  ]);
}

// ── Auditoría administrativa ──
// Quién cambió qué en Usuarios y Configuración (el Historial solo cubre
// producciones). Append-only, con actor, valor anterior y nuevo. Un fallo de
// registro no debe bloquear la operación que se está auditando.
// El schema vive en SHEETS.Auditoria (sheets.gs), única fuente de verdad.

function auditoriaSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Auditoria');
  if (!sheet) {
    sheet = ss.insertSheet('Auditoria');
    sheet.appendRow(SHEETS.Auditoria);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEETS.Auditoria);
  }
  return sheet;
}

function addAuditoria(actorEmail, entidad, clave, detalle) {
  try {
    auditoriaSheet().appendRow([
      new Date(),
      String(actorEmail || ''),
      String(entidad || ''),
      String(clave || ''),
      String(detalle || '').slice(0, 500),
    ]);
  } catch (e) {
    Logger.log('addAuditoria falló: ' + (e.message || e));
  }
}
