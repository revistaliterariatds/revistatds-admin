// history.gs — Historial append-only de acciones sobre cada cuento.

function addHistory(idCuento, actor, accion, detalle) {
  getSheet('Historial').appendRow([
    idCuento,
    new Date(),
    actor,
    accion,
    detalle || '',
  ]);
}
