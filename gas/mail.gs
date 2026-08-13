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
  var subject = 'Recibimos tu envío — ' + (titulo || 'sin título');
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
