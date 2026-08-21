// users.gs — gestión de Roles (COORDINADOR modifica, SUPERVISOR solo lee).

function handleUsersList(idToken) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  // La caché guarda SOLO la parte compartida (users); puede_editar se calcula
  // por request: si se cacheara, dentro de la ventana un SUPERVISOR recibía
  // el puede_editar del COORDINADOR que llenó la caché (y viceversa).
  var cache = CacheService.getScriptCache();
  var cached = cache.get('users-list');
  var users;
  if (cached) {
    users = JSON.parse(cached);
  } else {
    users = [];
    var sheet = getSheet('Roles');
    var idx = headerIndex(sheet);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (!data[i][idx.email]) continue;
      users.push({
        email: String(data[i][idx.email]),
        rol: String(data[i][idx.rol] || ''),
        nombre: String(data[i][idx.nombre] || ''),
        alias: String(data[i][idx.alias] || ''),
        usar_alias_notif: String(data[i][idx.usar_alias_notif]).toUpperCase() === 'TRUE',
        activo: String(data[i][idx.activo]).toUpperCase() === 'TRUE',
      });
    }
    cache.put('users-list', JSON.stringify(users), 60);
  }

  return ok({ users: users, puede_editar: user.rol === ROLES.COORDINADOR || user.rol === ROLES.WEBMASTER });
}

function handleUserSave(idToken, payload) {
  var actor = requireInternalUser(idToken);
  if (actor.rol !== ROLES.COORDINADOR && actor.rol !== ROLES.WEBMASTER) throw new AuthError('Solo COORDINADOR o WEBMASTER puede modificar usuarios.');
  payload = payload || {};

  var email = String(payload.email || '').trim().toLowerCase();
  var rol = String(payload.rol || '').trim();
  var nombre = String(payload.nombre || '').trim().slice(0, 120);
  var alias = String(payload.alias || '').trim().slice(0, 120);
  var activo = payload.activo === true || String(payload.activo).toUpperCase() === 'TRUE';
  var usarAlias = payload.usar_alias_notif === true || String(payload.usar_alias_notif).toUpperCase() === 'TRUE';

  if (!/^[^@\s]+@gmail\.com$/.test(email)) throw new ApiError('Solo se permiten cuentas @gmail.com.');
  if (ROLES_INTERNOS.indexOf(rol) < 0) throw new ApiError('Rol inválido.');
  if (email === actor.email.toLowerCase() && !activo) throw new ApiError('No podés desactivar tu propia cuenta.');

  var sheet = getSheet('Roles');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var row = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.email]).toLowerCase() === email) { row = i; break; }
  }

  // Auditoría: diff del cambio (o alta) antes de pisar la fila.
  var cambios;
  if (row < 0) {
    cambios = 'Alta (rol ' + rol + ')';
  } else {
    var diffs = [];
    if (String(data[row][idx.rol] || '') !== rol) diffs.push('rol: ' + data[row][idx.rol] + ' → ' + rol);
    if (String(data[row][idx.nombre] || '') !== nombre) diffs.push('nombre modificado');
    if (String(data[row][idx.alias] || '') !== alias) diffs.push('alias modificado');
    if (String(data[row][idx.usar_alias_notif]).toUpperCase() === 'TRUE' !== usarAlias) diffs.push('usar_alias_notif');
    if ((String(data[row][idx.activo]).toUpperCase() === 'TRUE') !== activo) diffs.push('activo: ' + String(data[row][idx.activo]) + ' → ' + (activo ? 'TRUE' : 'FALSE'));
    cambios = diffs.length ? diffs.join('; ') : 'Guardado sin cambios efectivos';
  }

  var values = [email, rol, nombre, alias, usarAlias ? 'TRUE' : 'FALSE', activo ? 'TRUE' : 'FALSE'];
  if (row < 0) sheet.appendRow(values);
  else sheet.getRange(row + 1, 1, 1, values.length).setValues([values]);
  CacheService.getScriptCache().remove('users-list');
  addAuditoria(actor.email, 'usuario', email, cambios);
  return ok({ message: row < 0 ? 'Usuario agregado.' : 'Usuario actualizado.' });
}

// Migración única: renombra el rol ADMINISTRADOR → COORDINADOR en la hoja Roles.
// Ejecutar una vez desde el editor de Apps Script (Run migrateRoles). Idempotente.
function migrateRoles() {
  var sheet = getSheet('Roles');
  var idx = headerIndex(sheet);
  if (idx.rol === undefined) throw new ApiError('Columna "rol" no encontrada en Roles.');

  var data = sheet.getDataRange().getValues();
  var updated = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.rol]).toUpperCase() === 'ADMINISTRADOR') {
      sheet.getRange(i + 1, idx.rol + 1).setValue(ROLES.COORDINADOR);
      updated++;
    }
  }
  CacheService.getScriptCache().remove('users-list');
  Logger.log('migrateRoles: ' + updated + ' fila(s) renombrada(s) a COORDINADOR.');
  return 'OK (' + updated + ' fila(s) actualizada(s))';
}
