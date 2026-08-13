// board.gs — endpoints del panel para roles internos.
// Fase 1: lectura básica del tablero (las vistas completas son Fase 3).

function handleBoardList(idToken) {
  requireInternalUser(idToken); // cualquier rol interno
  var sheet = getSheet('Tablero');
  var data = sheet.getDataRange().getValues();
  var headers = SHEETS.Tablero;

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    headers.forEach(function (h, j) { row[h] = data[i][j]; });
    row.token_autor = '';   // nunca exponer el token
    row.token_expira = '';
    rows.push(row);
  }
  return ok({ cuentos: rows });
}
