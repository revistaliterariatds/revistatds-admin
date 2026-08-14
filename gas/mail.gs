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

function autorLink(token, accion) {
  var base = getConfig('site_base_url') || 'https://tramasdelsur.com.ar';
  var link = base + '/autor/?token=' + token;
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

function sendConsultaAutor(autorEmail, cuento, token, textoCorregido) {
  var subject = getMailSubject('mail_subject_consulta', 'Tu producción está lista para aprobación — {{titulo}}', { titulo: cuento.titulo });
  var html = [
    '<div style="font-family:Lato,Arial,sans-serif;color:#1e1a17;background:#f0ece3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #cec8bc;">',
    '  <h1 style="font-family:\'Playfair Display\',Georgia,serif;color:#1e1a17;font-weight:400;margin:0 0 12px;">Tu producción está lista</h1>',
    '  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">El equipo editorial terminó la revisión de <strong>' + escapeHtml(cuento.titulo) + '</strong>. Revisá la versión y elegí una opción:</p>',
    '  <div style="background:#ffffff;border:1px solid #cec8bc;padding:18px;margin:0 0 22px;white-space:pre-wrap;font-size:15px;line-height:1.7;">' + escapeHtml(textoCorregido || 'La versión está disponible en el panel editorial.') + '</div>',
    '  <p style="margin:0 0 12px;"><a href="' + autorLink(token, 'approve') + '" style="display:inline-block;background:#4b7f52;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Aprobar versión</a></p>',
    '  <p style="margin:0 0 12px;"><a href="' + autorLink(token, 'edit') + '" style="display:inline-block;background:#d95f1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">Modificar versión</a></p>',
    '  <p style="margin:0 0 24px;"><a href="' + autorLink(token, 'reject') + '" style="color:#a53d35;">No aprobar esta versión</a></p>',
    '  <p style="font-size:13px;color:#8a837a;margin:0;">Tramas del Sur — Revista literaria independiente</p>',
    '</div>',
  ].join('');
  sendHtmlMail(autorEmail, subject, html);
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
