// reminders.gs — Fase 5: recordatorio semanal a editores, digest semanal a
// gestores y alerta diaria de tokens de autor vencidos (con dedupe).

// Ejecutar una vez: trigger diario 09:00 a runDailyReminders (idempotente).
function setupRemindersTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runDailyReminders') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runDailyReminders').timeBased().everyDays(1).atHour(9).create();
}

// Lunes: recordatorio a editores + digest a gestores. Todos los días: tokens vencidos.
function runDailyReminders() {
  alertarTokensVencidos();
  var hoy = new Date();
  if (hoy.getDay() === 1) {
    enviarRecordatorioSemanal();
    enviarDigestGestores();
  }
}

function diasDesde(fecha) {
  if (!fecha) return 9999;
  var t = new Date(fecha).getTime();
  if (!t || isNaN(t)) return 9999;
  return Math.floor((Date.now() - t) / 86400000);
}

function leerTableroCompleto() {
  var sheet = getSheet('Tablero');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = { _rowIndex: i };
    SHEETS.Tablero.forEach(function (h) { row[h] = data[i][idx[h]]; });
    out.push(row);
  }
  return out;
}

// Recordatorio semanal: EN_REVISIÓN con editor asignado e inactividad >= umbral.
function enviarRecordatorioSemanal() {
  var umbral = parseInt(getConfig('recordatorio_editores_dias') || '3', 10);
  var porEditor = {};
  leerTableroCompleto().forEach(function (c) {
    if (c.estado === ESTADOS.EN_REVISION && c.editor_asignado && diasDesde(c.fecha_actualizacion) >= umbral) {
      var email = String(c.editor_asignado);
      if (!porEditor[email]) porEditor[email] = [];
      porEditor[email].push(c);
    }
  });
  Object.keys(porEditor).forEach(function (email) {
    sendRecordatorioEditor(email, porEditor[email].map(function (c) {
      return { titulo: c.titulo, autor: c.autor, edicion: c.edicion, dias: diasDesde(c.fecha_actualizacion) };
    }));
  });
}

// Digest semanal: resumen del circuito para COORDINADOR + SUPERVISOR.
function enviarDigestGestores() {
  var desde = new Date(Date.now() - 7 * 86400000);
  var filas = leerTableroCompleto();
  var semana = function (fecha) {
    var t = new Date(fecha).getTime();
    return !!t && t >= desde.getTime();
  };
  var item = function (c, extra) { return { titulo: c.titulo, autor: c.autor, extra: extra || '' }; };

  var bloques = [];

  var nuevos = filas.filter(function (c) { return c.estado === ESTADOS.RECIBIDO && semana(c.fecha_recibido); });
  bloques.push({ titulo: 'Recibidos en la semana', items: nuevos.map(function (c) { return item(c); }) });

  var porEditor = {};
  filas.forEach(function (c) {
    if (c.estado === ESTADOS.EN_REVISION && c.editor_asignado) {
      var email = String(c.editor_asignado);
      if (!porEditor[email]) porEditor[email] = [];
      porEditor[email].push(c);
    }
  });
  var enRevision = [];
  Object.keys(porEditor).forEach(function (email) {
    porEditor[email].forEach(function (c) { enRevision.push(item(c, email)); });
  });
  bloques.push({ titulo: 'En revisión por editor', items: enRevision });

  var correccionesSinEnviar = filas.filter(function (c) {
    return c.estado === ESTADOS.CORRECCIONES_SOLICITADAS && !c.token_autor;
  });
  bloques.push({ titulo: 'Correcciones marcadas sin enviar al autor', items: correccionesSinEnviar.map(function (c) { return item(c); }) });

  var enAprobacion = filas.filter(function (c) {
    return c.estado === ESTADOS.ESPERANDO_APROBACION || c.estado === ESTADOS.CONSULTA_AUTOR;
  });
  bloques.push({ titulo: 'En aprobación o consulta al autor', items: enAprobacion.map(function (c) { return item(c); }) });

  var rechazados = filas.filter(function (c) { return c.estado === ESTADOS.RECHAZADO_POR_AUTOR; });
  bloques.push({ titulo: 'Rechazados sin resolver', items: rechazados.map(function (c) { return item(c); }) });

  var aprobados = filas.filter(function (c) { return c.estado === ESTADOS.APROBADO && semana(c.fecha_actualizacion); });
  bloques.push({ titulo: 'Aprobados en la semana', items: aprobados.map(function (c) { return item(c); }) });

  var publicables = filas.filter(function (c) { return c.estado === ESTADOS.PUBLICADO && semana(c.fecha_actualizacion); });
  bloques.push({ titulo: 'Marcados publicables en la semana', items: publicables.map(function (c) { return item(c); }) });

  bloques = bloques.filter(function (b) { return b.items.length > 0; });
  if (!bloques.length) return;

  var fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  sendDigestGestores({ fecha: fecha, bloques: bloques });
}

// Alerta de tokens vencidos (CORRECCIONES_SOLICITADAS/CONSULTA_AUTOR enviados).
// Dedupe: se registra ALERTA_TOKEN_VENCIDO en el Historial y solo se re-alerta
// si el último aviso de esa producción tiene más de 7 días.
function alertarTokensVencidos() {
  var items = [];
  var producciones = [];
  leerTableroCompleto().forEach(function (c) {
    if (!c.token_autor || !c.token_expira) return;
    if (new Date(c.token_expira).getTime() >= Date.now()) return;
    if (c.estado !== ESTADOS.CORRECCIONES_SOLICITADAS && c.estado !== ESTADOS.CONSULTA_AUTOR) return;
    var avisoReciente = getHistorial(c.id).some(function (h) {
      return h.accion === 'ALERTA_TOKEN_VENCIDO' &&
        new Date(h.timestamp).getTime() >= Date.now() - 7 * 86400000;
    });
    if (avisoReciente) return;
    items.push({ titulo: c.titulo, autor: c.autor, diasVencido: diasDesde(c.token_expira) });
    producciones.push(c);
  });
  if (!items.length) return;
  sendAlertaTokensVencidos(items);
  producciones.forEach(function (c) {
    addHistory(c.id, 'Sistema', 'ALERTA_TOKEN_VENCIDO', 'Token vencido notificado al equipo.');
  });
}