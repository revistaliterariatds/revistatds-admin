// envio.gs — endpoint público de alta. Contrato compatible con
// assets/js/enviar.js y assets/js/enviar-docentes.js (POST JSON, text/plain).
// Hallazgo H2: `categoria` no viene del formulario → nace "Sin clasificar".

function handleEnvio(data) {
  data = data || {};

  var email = String(data.email || '').trim();
  if (!email) return err('Falta el email del autor.');
  if (!isValidEmail(email)) return err('Email del autor inválido.');

  var esMenor = String(data.edad || '') === '13 a 17';
  var emailAutor = email;
  if (esMenor) {
    var adultoEmail = String(data.adultoEmail || '').trim();
    if (!adultoEmail) return err('Falta el email del adulto responsable.');
    if (!isValidEmail(adultoEmail)) return err('Email del adulto responsable inválido.');
    emailAutor = adultoEmail; // decisión 9: correspondencia al adulto
  }

  var titulo = String(data.titulo || '').trim() || 'Sin título';
  var autor = String(data.nombre || '').trim() || 'Anónimo';
  var convocatoria = data.tipo === 'docente' ? CONVOCATORIAS.DOCENTES : CONVOCATORIAS.GENERAL;

  var id = 'C' + Date.now().toString(36) + '-' + Utilities.getUuid().slice(0, 8);
  var token = Utilities.getUuid();
  var expiraDias = parseInt(getConfig('expira_token_dias') || '30', 10);
  var tokenExpira = new Date(Date.now() + expiraDias * 24 * 3600 * 1000);

  var folder = createCuentoFolder(id);
  var archivos = Array.isArray(data.archivos) ? data.archivos : [];
  archivos.forEach(function (f) {
    try { saveFile(folder, f); } catch (e) { /* archivo corrupto no debe tirar el alta */ }
  });

  var now = new Date();
  getSheet('Tablero').appendRow([
    id,              // id
    titulo,          // titulo
    autor,           // autor
    emailAutor,      // email_autor
    data.edad || '', // edad
    CATEGORIA_DEFAULT, // categoria (H2)
    ESTADOS.RECIBIDO,  // estado
    '',              // editor_asignado
    folder.getUrl(), // url_carpeta_drive
    '',              // url_doc_correccion
    '1',             // version_actual
    token,           // token_autor
    tokenExpira,     // token_expira
    convocatoria,    // convocatoria
    now,             // fecha_recibido
    now,             // fecha_actualizacion
  ]);

  addHistory(id, 'AUTOR', 'ENVIO_RECIBIDO', 'Alta desde formulario (' + convocatoria + ')');

  var siteBase = getConfig('site_base_url');
  var seguimientoUrl = siteBase + '/autor/?token=' + token;
  try {
    sendConfirmation(emailAutor, autor, titulo, seguimientoUrl);
  } catch (e) { /* el mail no debe tirar el alta */ }

  return ok({ message: 'Envío recibido.', id: id });
}
