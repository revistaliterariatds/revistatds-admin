// mail.gs — envío de mails con MailApp (estilo TDS inline).

var MAIL_FROM_NAME = 'Tramas del Sur';

function sendHtmlMail(to, subject, html) {
  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: html,
    name: MAIL_FROM_NAME,
  });
}

function sendConfirmation(destinatario, nombre, titulo, seguimientoUrl) {
  var subject = getMailSubject('mail_subject_confirmation', 'Recibimos tu envío — {{titulo}}', { titulo: titulo || 'sin título' });
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">Hola ' + escapeHtml(nombre || '') + ',</h1>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 12px;">Gracias por enviarnos <strong>' + escapeHtml(titulo || 'tu producción') + '</strong>. Ya está en nuestra bandeja y el equipo de redacción lo revisará.</p>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">Podés seguir el estado de tu envío en este enlace (es personal, no lo compartas):</p>',
    '  <p style="margin:0 0 24px;"><a href="' + seguimientoUrl + '" style="display:inline-block;background:#d95f1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Ver estado de mi envío</a></p>',
    '  <p style="font-size:13px;color:#8a837a;margin:0;">Tramas del Sur — Revista literaria independiente</p>',
    '</div>',
  ].join('');
  sendHtmlMail(destinatario, subject, html);
}

// ── Fase 3: mails del circuito editorial ──

var PANEL_URL = 'https://redaccion.tramasdelsur.com.ar';

function siteBase() {
  return getConfig('site_base_url') || 'https://tramasdelsur.com.ar';
}

function autorLink(token, accion) {
  var link = siteBase() + '/autor/?token=' + token;
  if (accion) link += '&accion=' + accion;
  return link;
}

function sendAsignacion(editorEmail, cuento, docUrl) {
  var subject = 'Nuevo cuento asignado — ' + cuento.titulo + ' · ' + cuento.autor;
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">Nuevo cuento asignado</h1>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;"><strong>' + escapeHtml(cuento.titulo) + '</strong> · ' + escapeHtml(cuento.autor) + '</p>',
    '  <p style="margin:0 0 12px;"><a href="' + PANEL_URL + '" style="display:inline-block;background:#d95f1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Abrir panel</a></p>',
    '  <p style="margin:0 0 24px;"><a href="' + docUrl + '" style="display:inline-block;border:1px solid #d95f1a;color:#d95f1a;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Abrir documento de corrección</a></p>',
    '  <p style="font-size:13px;color:#8a837a;margin:0;">Tramas del Sur — Redacción</p>',
    '</div>',
  ].join('');
  sendHtmlMail(editorEmail, subject, html);
}

function notifyTeam(tipo, detalle) {
  var emails = getEmailsByRoles(ROLES_GESTORES);
  if (emails.length === 0) return;
  var subject = '[' + tipo + '] ' + detalle;
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:24px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <p style="font-size:16px;line-height:1.6;margin:0;">' + escapeHtml(detalle) + '</p>',
    '  <p style="margin:16px 0 0;"><a href="' + PANEL_URL + '" style="color:#d95f1a;">Ver panel</a></p>',
    '</div>',
  ].join('');
  emails.forEach(function (e) { sendHtmlMail(e, subject, html); });
}

function sendPedirCorrecciones(autorEmail, cuento, token) {
  var subject = getMailSubject('mail_subject_correcciones', 'Correcciones solicitadas — {{titulo}}', { titulo: cuento.titulo });
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">Hola ' + escapeHtml(cuento.autor) + ',</h1>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">El equipo editorial te pidió correcciones sobre <strong>' + escapeHtml(cuento.titulo) + '</strong>. Subí tu nueva versión desde este enlace (personal, no lo compartas):</p>',
    '  <p style="margin:0 0 24px;"><a href="' + autorLink(token, 'edit') + '" style="display:inline-block;background:#d95f1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Subir nueva versión</a></p>',
    '  <p style="font-size:13px;color:#8a837a;margin:0;">Tramas del Sur — Revista literaria independiente</p>',
    '</div>',
  ].join('');
  sendHtmlMail(autorEmail, subject, html);
}

function sendRevisionTerminada(adminEmails, cuento, editorNombre) {
  var subject = getMailSubject('mail_subject_revision', 'Revisión terminada — {{titulo}}', { titulo: cuento.titulo });
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">Revisión terminada</h1>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 12px;"><strong>' + escapeHtml(cuento.titulo) + '</strong> · ' + escapeHtml(cuento.autor) + '</p>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">' + escapeHtml(editorNombre) + ' terminó la revisión. Queda en ESPERANDO_APROBACIÓN.</p>',
    '  <p style="margin:0;"><a href="' + PANEL_URL + '" style="color:#d95f1a;">Ver panel</a></p>',
    '</div>',
  ].join('');
  adminEmails.forEach(function (e) { sendHtmlMail(e, subject, html); });
}

function sendConsultaAutor(autorEmail, cuento, token, textoCorregido, pdfBlob) {
  var subject = getMailSubject('mail_subject_consulta', 'Tu producción está lista para aprobación — {{titulo}}', { titulo: cuento.titulo });
  var versionBlock = pdfBlob
    ? '  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">Adjuntamos el documento con las correcciones del editor en formato PDF.</p>'
    : '  <div style="background:#ffffff;border:1px solid #cec8bc;padding:18px;margin:0 0 22px;white-space:pre-wrap;font-size:15px;line-height:1.7;">' + escapeHtml(textoCorregido || 'La versión está disponible en el panel editorial.') + '</div>';
  // Botones iguales: misma forma y tamaño, cada uno con su color (estilo TDS).
  function boton(color, url, label) {
    return '  <p style="margin:0 0 12px;"><a href="' + url + '" style="display:block;width:100%;text-align:center;background:' + color + ';color:#ffffff;padding:14px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;font-family:Lato,Arial,sans-serif;box-sizing:border-box;">' + label + '</a></p>';
  }
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">Tu producción está lista</h1>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">El equipo editorial terminó la revisión de <strong>' + escapeHtml(cuento.titulo) + '</strong>. Revisá la versión y elegí una opción (este enlace es de un solo uso):</p>',
    versionBlock,
    boton('#4b7f52', autorLink(token, 'approve'), 'Aprobar versión'),
    boton('#d95f1a', autorLink(token, 'edit'), 'Modificar versión'),
    boton('#a53d35', autorLink(token, 'reject'), 'No aprobar esta versión'),
    '  <p style="font-size:14px;line-height:1.6;margin:20px 0 12px;color:#4a443e;">En caso de que quieras <strong>modificar</strong> la producción editada, deberás enviar un <strong>nuevo archivo</strong>. Podés hacerlo de dos maneras: haciendo clic en el botón <strong>Modificar versión</strong> (arriba) y subiendo tu nuevo archivo desde el enlace, o enviando una nueva producción mediante el formulario de envío de la página:</p>',
    '  <p style="margin:0 0 24px;"><a href="' + siteBase() + '/enviar.html" style="display:block;width:100%;text-align:center;border:1px solid #d95f1a;color:#d95f1a;padding:14px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;font-family:Lato,Arial,sans-serif;box-sizing:border-box;">Enviar una nueva producción</a></p>',
    '  <p style="font-size:13px;color:#8a837a;margin:0;">Tramas del Sur — Revista literaria independiente</p>',
    '</div>',
  ].join('');
  var params = {
    to: autorEmail,
    subject: subject,
    htmlBody: html,
    name: MAIL_FROM_NAME,
  };
  if (pdfBlob) params.attachments = [pdfBlob];
  MailApp.sendEmail(params);
}

// Aviso al equipo cuando el autor pide modificar su cuento (subió una nueva
// versión desde CONSULTA_AUTOR): editor asignado + ADMINISTRADOR/WEBMASTER/SUPERVISOR.
function sendSolicitudModificacion(cuento) {
  var destinatarios = [];
  if (cuento.editor_asignado) destinatarios.push(String(cuento.editor_asignado));
  getEmailsByRoles(ROLES_GESTORES).forEach(function (e) {
    if (destinatarios.indexOf(e) < 0) destinatarios.push(e);
  });
  if (destinatarios.length === 0) return;
  var subject = 'El autor solicita modificar su cuento — ' + cuento.titulo + ' · ' + cuento.autor;
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">El autor quiere modificar su cuento</h1>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 12px;"><strong>' + escapeHtml(cuento.titulo) + '</strong> · ' + escapeHtml(cuento.autor) + '</p>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">El autor subió una nueva versión de su cuento y solicita que el equipo editorial se contacte con él para definir cómo proceder.</p>',
    '  <p style="margin:0;"><a href="' + PANEL_URL + '" style="display:inline-block;background:#d95f1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Abrir panel</a></p>',
    '  <p style="font-size:13px;color:#8a837a;margin:16px 0 0;">Tramas del Sur — Redacción</p>',
    '</div>',
  ].join('');
  destinatarios.forEach(function (e) { sendHtmlMail(e, subject, html); });
}

function sendNuevaVersion(editorEmail, cuento) {
  var subject = getMailSubject('mail_subject_version', 'Nueva versión recibida — {{titulo}}', { titulo: cuento.titulo });
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;font-weight:400;">Nueva versión recibida</h1>',
    '  <p style="font-size:16px;line-height:1.6;"><strong>' + escapeHtml(cuento.titulo) + '</strong> tiene una nueva versión (' + escapeHtml(cuento.version_actual) + ').</p>',
    '  <p><a href="' + PANEL_URL + '" style="color:#d95f1a;">Abrir el panel y continuar la revisión</a></p>',
    '</div>',
  ].join('');
  sendHtmlMail(editorEmail, subject, html);
}

function sendDevolucionEditor(editorEmail, cuento) {
  var subject = getMailSubject('mail_subject_devolucion', 'Cuento devuelto a revisión — {{titulo}}', { titulo: cuento.titulo });
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;font-weight:400;">Cuento devuelto a revisión</h1>',
    '  <p style="font-size:16px;line-height:1.6;"><strong>' + escapeHtml(cuento.titulo) + '</strong> fue devuelto por el equipo luego de la respuesta del autor.</p>',
    '  <p><a href="' + PANEL_URL + '" style="color:#d95f1a;">Abrir el panel</a></p>',
    '</div>',
  ].join('');
  sendHtmlMail(editorEmail, subject, html);
}

function sendLiberacion(editorEmail, cuento) {
  var subject = 'Fuiste liberado de — ' + cuento.titulo;
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:24px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <p style="font-size:16px;line-height:1.6;margin:0;">Fuiste liberado de <strong>' + escapeHtml(cuento.titulo) + '</strong>.</p>',
    '  <p style="margin:16px 0 0;"><a href="' + PANEL_URL + '" style="color:#d95f1a;">Ver panel</a></p>',
    '</div>',
  ].join('');
  sendHtmlMail(editorEmail, subject, html);
}

// ── Agenda: notificación de nueva cita + link "Agregar a mi calendario" ──

// Link de Google Calendar pre-cargado (Opción A, sin scopes ni eventos reales).
function agendaCalendarLink(cita) {
  var text = encodeURIComponent(cita.titulo || 'Cita de agenda');
  var fecha = String(cita.fecha || '').replace(/-/g, '');
  var dates;
  if (cita.hora) {
    var parts = String(cita.hora).split(':');
    var mins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + 60; // 1 hora de duración
    var endKey = String(cita.fecha || '');
    var endMin = mins;
    if (endMin >= 1440) { endMin -= 1440; endKey = sumarDiasKey(endKey, 1); }
    var end = endKey.replace(/-/g, '') + 'T' +
      ('0' + Math.floor(endMin / 60)).slice(-2) + ('0' + (endMin % 60)).slice(-2) + '00';
    dates = fecha + 'T' + String(cita.hora).replace(':', '') + '00/' + end;
  } else {
    dates = fecha + '/' + sumarDiasKey(String(cita.fecha || ''), 1).replace(/-/g, '');
  }
  var detalles = (cita.comentario || '');
  if (cita.meet_link) detalles += '\nReunión: ' + cita.meet_link;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + text +
    '&dates=' + dates + '&details=' + encodeURIComponent(detalles);
}

function sumarDiasKey(key, dias) {
  var parts = String(key).split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setDate(d.getDate() + dias);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function sendAgendaNotificacion(cita) {
  var emails = getEmailsByRoles(ROLES_INTERNOS);
  if (emails.length === 0) return;
  var subject = getMailSubject('mail_subject_agenda', 'Nueva cita en la agenda — {{titulo}}', { titulo: cita.titulo });
  var fecha = String(cita.fecha || '');
  var hora = cita.hora ? ' · ' + String(cita.hora) : '';
  var meetHtml = cita.meet_link
    ? '  <p style="margin:0 0 24px;"><a href="' + escapeHtml(cita.meet_link) + '" style="color:#d95f1a;">Unirse a la reunión (Meet)</a></p>'
    : '';
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">Nueva cita en la agenda</h1>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 8px;"><strong>' + escapeHtml(cita.titulo) + '</strong></p>',
    '  <p style="font-size:14px;color:#4a443e;margin:0 0 16px;">' + escapeHtml(fecha) + hora + '</p>',
    cita.comentario ? '<p style="font-size:15px;line-height:1.6;margin:0 0 20px;white-space:pre-wrap;">' + escapeHtml(cita.comentario) + '</p>' : '',
    '  <p style="margin:0 0 12px;"><a href="' + PANEL_URL + '/agenda/" style="display:inline-block;background:#d95f1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Ver agenda</a></p>',
    '  <p style="margin:0 0 12px;"><a href="' + agendaCalendarLink(cita) + '" style="display:inline-block;border:1px solid #d95f1a;color:#d95f1a;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Agregar a mi calendario</a></p>',
    meetHtml,
    '  <p style="font-size:13px;color:#8a837a;margin:0;">Tramas del Sur — Redacción</p>',
    '</div>',
  ].join('');
  emails.forEach(function (e) { sendHtmlMail(e, subject, html); });
}
