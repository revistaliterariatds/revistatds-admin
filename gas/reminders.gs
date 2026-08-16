// reminders.gs — Fase 5: recordatorio a editores, digest a gestores y alerta de
// tokens de autor vencidos, cada uno con frecuencia configurable por rol y tipo
// (días + día de semana) desde Configuración.

// Combos (rol × tipo) con su par de claves de Config y su función de envío.
var REMINDER_COMBOS = [
  { clave: 'recordatorio_editor', rol: ROLES.EDITOR, enviar: 'enviarRecordatorioSemanal' },
  { clave: 'digest_coordinador', rol: ROLES.COORDINADOR, enviar: 'enviarDigestGestores' },
  { clave: 'digest_supervisor', rol: ROLES.SUPERVISOR, enviar: 'enviarDigestGestores' },
  { clave: 'tokens_coordinador', rol: ROLES.COORDINADOR, enviar: 'alertarTokensVencidos' },
  { clave: 'tokens_supervisor', rol: ROLES.SUPERVISOR, enviar: 'alertarTokensVencidos' },
];

// Ejecutar una vez: trigger diario 09:00 a runDailyReminders (idempotente).
function setupRemindersTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runDailyReminders') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runDailyReminders').timeBased().everyDays(1).atHour(9).create();
}

// Cada combo se envía solo si: pasaron >= N días desde el último envío Y
// (N == 1 → todos los días, ignorando el día; N > 1 → solo el día configurado).
function deberiaEnviar(clave, hoy) {
  var intervalo = parseInt(getConfig('frec_' + clave) || '7', 10);
  var dia = parseInt(getConfig('frec_' + clave + '_dia') || '1', 10);
  if (isNaN(intervalo) || intervalo < 1) intervalo = 7;
  if (isNaN(dia) || dia < 0 || dia > 6) dia = 1;
  var ultimo = parseInt(getSecret('last_sent_' + clave) || '0', 10);
  if (Date.now() - ultimo < intervalo * 86400000) return false;
  if (intervalo > 1 && hoy.getDay() !== dia) return false;
  return true;
}

function marcarEnviado(clave) {
  setSecret('last_sent_' + clave, String(Date.now()));
}

function runDailyReminders() {
  var hoy = new Date();
  REMINDER_COMBOS.forEach(function (combo) {
    if (deberiaEnviar(combo.clave, hoy)) {
      if (combo.enviar === 'enviarRecordatorioSemanal') enviarRecordatorioSemanal();
      else if (combo.enviar === 'enviarDigestGestores') enviarDigestGestores(combo.rol);
      else alertarTokensVencidos(combo.rol);
      marcarEnviado(combo.clave);
    }
  });
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

// Digest: resumen del circuito para un rol concreto (COORDINADOR o SUPERVISOR).
function enviarDigestGestores(rol) {
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
  sendDigestGestores(rol, { fecha: fecha, bloques: bloques });
}

// Alerta de tokens vencidos (CORRECCIONES_SOLICITADAS/CONSULTA_AUTOR enviados)
// para un rol concreto (COORDINADOR o SUPERVISOR). Registra ALERTA_TOKEN_VENCIDO
// en el Historial (trazabilidad); la frecuencia la controla la Config.
function alertarTokensVencidos(rol) {
  var items = [];
  var producciones = [];
  leerTableroCompleto().forEach(function (c) {
    if (!c.token_autor || !c.token_expira) return;
    if (new Date(c.token_expira).getTime() >= Date.now()) return;
    if (c.estado !== ESTADOS.CORRECCIONES_SOLICITADAS && c.estado !== ESTADOS.CONSULTA_AUTOR) return;
    items.push({ titulo: c.titulo, autor: c.autor, diasVencido: diasDesde(c.token_expira) });
    producciones.push(c);
  });
  if (!items.length) return;
  sendAlertaTokensVencidos(rol, items);
  producciones.forEach(function (c) {
    addHistory(c.id, 'Sistema', 'ALERTA_TOKEN_VENCIDO', 'Token vencido notificado al equipo.');
  });
}