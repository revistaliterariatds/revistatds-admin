// history.gs — Historial append-only de acciones sobre cada producción.

function addHistory(idProduccion, actor, accion, detalle) {
  getSheet('Historial').appendRow([
    idProduccion,
    new Date(),
    actor,
    accion,
    detalle || '',
  ]);
}
