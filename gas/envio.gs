// envio.gs — endpoint público de alta. Contrato compatible con
// assets/js/enviar.js y assets/js/enviar-docentes.js (POST JSON, text/plain).
// Hallazgo H2: `categoria` no viene del formulario → nace "Sin clasificar".

var ENVIO_RATE_LIMIT = 50;
var ENVIO_GLOBAL_DIARIO = 100; // tope global por día (anti-flood con emails rotados)

// Honeypot anti-bots: el formulario público debe incluir un input oculto
// name="website" que una persona nunca completa. Si llega con contenido, se
// responde éxito falso sin crear nada (no se le revela al bot que falló).
// Compatible con el contrato actual: los formularios que no lo mandan pasan.
function esHoneypot(data) {
  return String((data && data.website) || '').trim() !== '';
}

// Contador global diario en cache, clave por fecha (se resetea solo).
// TTL 48 h: garantiza que el contador del día sobreviva hasta medianoche
// aunque el último intento haya sido temprano.
function contadorEnviosHoy() {
  var cache = CacheService.getScriptCache();
  var key = 'envios-global-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return { key: key, n: parseInt(cache.get(key) || '0', 10) || 0 };
}

function handleEnvio(data) {
  data = data || {};

  // Honeypot: éxito falso, sin tocar Drive ni las hojas.
  if (esHoneypot(data)) return ok({ message: 'Envío recibido.' });

  var email = String(data.email || '').trim();
  if (!email) return err('Falta el email del autor.');
  if (!isValidEmail(email)) return err('Email del autor inválido.');

  // Tope global diario: se cuenta todo intento con email válido, así la
  // rotación de emails también consume el cupo (el límite por email de abajo
  // solo frena a un mismo remitente).
  var cache = CacheService.getScriptCache();
  var hoy = contadorEnviosHoy();
  if (hoy.n >= ENVIO_GLOBAL_DIARIO) {
    return err('Se alcanzó el límite de envíos por día. Intentá mañana o escribinos por mail.');
  }
  cache.put(hoy.key, String(hoy.n + 1), 172800);

  // Límite anti-abuso por email en ventana de 6 horas (cache script).
  var rateKey = 'envio:' + email.toLowerCase();
  var envios = parseInt(cache.get(rateKey) || '0', 10);
  if (envios >= ENVIO_RATE_LIMIT) {
    return err('Se superó el límite temporal de envíos para este email. Intentá más tarde.');
  }
  cache.put(rateKey, String(envios + 1), 21600);

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
  var token = Utilities.getUuid(); // crudo SOLO para el mail; en la hoja va hasheado
  var expiraDias = parseInt(getConfig('expira_token_dias') || '30', 10);
  var tokenExpira = new Date(Date.now() + expiraDias * 24 * 3600 * 1000);

  var archivos = Array.isArray(data.archivos) ? data.archivos : [];
  var archivosValidados = validarArchivos(archivos);
  var folder = createProduccionFolder(id);
  saveFiles(folder, archivosValidados);

  var now = new Date();
  getSheet('Tablero').appendRow(filaSegunHeader(getSheet('Tablero'), SHEETS.Tablero, {
    id: id,
    titulo: titulo,
    autor: autor,
    email_autor: emailAutor,
    edad: data.edad || '',
    categoria: CATEGORIA_DEFAULT, // H2
    estado: ESTADOS.RECIBIDO,
    editor_asignado: '',
    url_carpeta_drive: folder.getUrl(),
    url_doc_correccion: '',
    version_actual: '1',
    token_autor: hashearTokenAutor(token),
    token_expira: tokenExpira,
    convocatoria: convocatoria,
    fecha_recibido: now,
    fecha_actualizacion: now,
    edicion: edicionDestino(), // por rango de fecha (abierta → última → SIN_EDICION)
  }));

  addHistory(id, 'AUTOR', 'ENVIO_RECIBIDO', 'Alta desde formulario (' + convocatoria + ')');
  clearBoardCache();

  var siteBase = getConfig('site_base_url');
  var seguimientoUrl = siteBase + '/autor/?token=' + token;
  try {
    sendConfirmation(emailAutor, autor, titulo, seguimientoUrl);
  } catch (e) { /* el mail no debe tirar el alta */ }

  return ok({ message: 'Envío recibido.', id: id });
}
