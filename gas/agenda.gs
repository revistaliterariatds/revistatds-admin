// agenda.gs — Agenda del panel: citas por día + hilo de comentarios.
// Permisos: ver/crear/comentar = todos los internos; editar/borrar = COORDINADOR/WEBMASTER.

var TIPOS_AGENDA = {
  reunion: { label: 'Reunión' },
  cierre_edicion: { label: 'Cierre de edición' },
  evento: { label: 'Evento' },
  otro: { label: 'Otro' },
};

function esAdmin(user) {
  return user.rol === ROLES.COORDINADOR || user.rol === ROLES.WEBMASTER;
}

function hoyKey() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function clearAgendaCache() {
  CacheService.getScriptCache().remove('agenda-list');
}

function citaPublica(c) {
  var out = {};
  SHEETS.Agenda.forEach(function (h, j) { out[h] = c[h]; });
  out.comentarios = 0;
  return out;
}

// Sheets convierte strings "YYYY-MM-DD" y "HH:mm" en valores Date al guardarlos;
// al leerlos llegan como Date. Se normalizan a string canónico acá (fecha y hora).
function fmtCelda(valor, patron) {
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone(), patron);
  if (valor == null) return '';
  return String(valor);
}

function normalizarCita(c) {
  c.fecha = fmtCelda(c.fecha, 'yyyy-MM-dd');
  c.hora = fmtCelda(c.hora, 'HH:mm');
  c.hora_fin = fmtCelda(c.hora_fin, 'HH:mm');
  return c;
}

function findCitaById(id) {
  migrarAgendaHoraFin();
  var sheet = getSheet('Agenda');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.id]) === String(id)) {
      var c = { _rowIndex: i };
      SHEETS.Agenda.forEach(function (h) { c[h] = data[i][idx[h]]; });
      return normalizarCita(c);
    }
  }
  return null;
}

// Comentarios de una cita (orden cronológico).
function comentariosDeCita(citaId) {
  var sheet = getSheet('AgendaComentarios');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.cita_id]) === String(citaId)) {
      out.push({
        autor: String(data[i][idx.autor] || ''),
        comentario: String(data[i][idx.comentario] || ''),
        creado_at: String(data[i][idx.creado_at] || ''),
      });
    }
  }
  return out;
}

function contarComentarios() {
  var sheet = getSheet('AgendaComentarios');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var cont = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][idx.cita_id]);
    cont[key] = (cont[key] || 0) + 1;
  }
  return cont;
}

// ── listado completo (el cliente filtra por mes) ──
function handleAgendaList(idToken) {
  var user = requireInternalUser(idToken);
  migrarAgendaHoraFin();
  var cache = CacheService.getScriptCache();
  var cached = cache.get('agenda-list');
  if (cached) return JSON.parse(cached);

  var sheet = getSheet('Agenda');
  if (!sheet) return ok({ citas: [], yo: { email: user.email, rol: user.rol, es_admin: esAdmin(user) } });
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var cont = contarComentarios();
  var citas = [];
  for (var i = 1; i < data.length; i++) {
    var c = citaPublica({});
    SHEETS.Agenda.forEach(function (h) { c[h] = data[i][idx[h]]; });
    normalizarCita(c);
    c.comentarios = cont[String(c.id)] || 0;
    c.creado_por_nombre = displayName(c.creado_por);
    citas.push(c);
  }
  var result = ok({ citas: citas, yo: { email: user.email, rol: user.rol, es_admin: esAdmin(user) } });
  cache.put('agenda-list', JSON.stringify(result), 30);
  return result;
}

// ── detalle de una cita + hilo ──
function handleAgendaDetalle(idToken, id) {
  requireInternalUser(idToken);
  var c = findCitaById(id);
  if (!c) throw new ApiError('Cita no encontrada.');
  return ok({ cita: citaPublica(c), comentarios: comentariosDeCita(c.id) });
}

function validarCamposCita(payload) {
  payload = payload || {};
  var fecha = String(payload.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ApiError('Fecha inválida.');
  var hora = String(payload.hora || '').trim();
  if (hora && !/^\d{2}:\d{2}$/.test(hora)) throw new ApiError('Horario de inicio inválido (HH:mm).');
  var horaFin = String(payload.hora_fin || '').trim();
  if (horaFin && !/^\d{2}:\d{2}$/.test(horaFin)) throw new ApiError('Horario de fin inválido (HH:mm).');
  if (horaFin && !hora) throw new ApiError('Para definir una hora de fin primero indicá el inicio.');
  if (hora && horaFin && horaFin <= hora) throw new ApiError('La hora de fin debe ser posterior a la de inicio.');
  var titulo = String(payload.titulo || '').trim().slice(0, 200);
  if (!titulo) throw new ApiError('El título de la cita es obligatorio.');
  var tipo = String(payload.tipo || 'otro').trim();
  if (!TIPOS_AGENDA[tipo]) tipo = 'otro';
  var meet = String(payload.meet_link || '').trim().slice(0, 500);
  if (meet && !/^https?:\/\//i.test(meet)) throw new ApiError('El link de reunión debe ser una URL válida.');
  return { fecha: fecha, hora: hora, hora_fin: horaFin, titulo: titulo, tipo: tipo, meet_link: meet };
}

// ── crear cita (todos los internos) ──
function handleAgendaCrear(idToken, payload) {
  var user = requireInternalUser(idToken);
  migrarAgendaHoraFin();
  var v = validarCamposCita(payload);
  var comentario = String(payload.comentario || '').trim().slice(0, 2000);
  var notificar = payload.notificar === true || String(payload.notificar).toUpperCase() === 'TRUE';

  var id = 'A' + Date.now().toString(36) + '-' + Utilities.getUuid().slice(0, 8);
  var ahora = nowIso();
  getSheet('Agenda').appendRow([
    id, v.fecha, v.hora, v.hora_fin, v.titulo, comentario, v.tipo, v.meet_link,
    '', user.email, ahora, ahora,
  ]);
  clearAgendaCache();

  if (notificar) {
    try {
      sendAgendaNotificacion({ id: id, fecha: v.fecha, hora: v.hora, hora_fin: v.hora_fin, titulo: v.titulo, comentario: comentario, meet_link: v.meet_link });
    } catch (e) {
      return ok({ message: 'Cita creada, pero no se pudieron enviar las notificaciones: ' + (e.message || e), id: id });
    }
  }
  return ok({ message: notificar ? 'Cita creada y notificada por mail.' : 'Cita creada.', id: id });
}

// ── comentar una cita (todos los internos) ──
function handleAgendaComentar(idToken, id, comentario) {
  var user = requireInternalUser(idToken);
  var c = findCitaById(id);
  if (!c) throw new ApiError('Cita no encontrada.');
  comentario = String(comentario || '').trim().slice(0, 2000);
  if (!comentario) throw new ApiError('El comentario está vacío.');

  getSheet('AgendaComentarios').appendRow([
    'AC' + Date.now().toString(36) + '-' + Utilities.getUuid().slice(0, 8),
    id, user.email, comentario, nowIso(),
  ]);
  clearAgendaCache();
  return ok({ message: 'Comentario agregado.' });
}

// ── editar cita (COORDINADOR/WEBMASTER) ──
function handleAgendaEditar(idToken, id, payload) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede editar citas.');
  migrarAgendaHoraFin();
  var c = findCitaById(id);
  if (!c) throw new ApiError('Cita no encontrada.');

  var v = validarCamposCita(payload);
  var comentario = String(payload.comentario || '').trim().slice(0, 2000);
  var sheet = getSheet('Agenda');
  setCell(sheet, c._rowIndex, 'fecha', v.fecha);
  setCell(sheet, c._rowIndex, 'hora', v.hora);
  setCell(sheet, c._rowIndex, 'hora_fin', v.hora_fin);
  setCell(sheet, c._rowIndex, 'titulo', v.titulo);
  setCell(sheet, c._rowIndex, 'comentario', comentario);
  setCell(sheet, c._rowIndex, 'tipo', v.tipo);
  setCell(sheet, c._rowIndex, 'meet_link', v.meet_link);
  setCell(sheet, c._rowIndex, 'actualizado_at', nowIso());
  clearAgendaCache();
  return ok({ message: 'Cita actualizada.' });
}

// ── borrar cita (COORDINADOR/WEBMASTER) — elimina también sus comentarios ──
function handleAgendaBorrar(idToken, id) {
  var user = requireInternalUser(idToken);
  if (!esAdmin(user)) throw new AuthError('Solo COORDINADOR o WEBMASTER puede borrar citas.');
  var c = findCitaById(id);
  if (!c) throw new ApiError('Cita no encontrada.');

  getSheet('Agenda').deleteRow(c._rowIndex + 1);

  var comments = getSheet('AgendaComentarios');
  var idx = headerIndex(comments);
  var data = comments.getDataRange().getValues();
  var filas = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.cita_id]) === String(id)) filas.push(i + 1);
  }
  filas.sort(function (a, b) { return b - a; });
  filas.forEach(function (f) { comments.deleteRow(f); });

  clearAgendaCache();
  return ok({ message: 'Cita eliminada.' });
}

// ── cita automática del sistema (sin mail), usada por Ediciones ──
function crearCitaAutomatica(fecha, titulo, comentario, tipo, creadorEmail) {
  migrarAgendaHoraFin();
  var id = 'A' + Date.now().toString(36) + '-' + Utilities.getUuid().slice(0, 8);
  var ahora = nowIso();
  getSheet('Agenda').appendRow([
    id, fecha, '', '', titulo, comentario, tipo, '', '', creadorEmail || 'Sistema', ahora, ahora,
  ]);
  clearAgendaCache();
  return id;
}
