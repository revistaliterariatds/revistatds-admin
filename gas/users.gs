// users.gs — gestión de Roles (ADMIN modifica, SUPERVISOR solo lee).

function handleUsersList(idToken) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var cache = CacheService.getScriptCache();
  var cached = cache.get('users-list');
  if (cached) return JSON.parse(cached);

  var sheet = getSheet('Roles');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var users = [];
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
  var result = ok({ users: users, puede_editar: user.rol === ROLES.ADMINISTRADOR || user.rol === ROLES.WEBMASTER });
  cache.put('users-list', JSON.stringify(result), 60);
  return result;
}

function handleUserSave(idToken, payload) {
  var actor = requireInternalUser(idToken);
  if (actor.rol !== ROLES.ADMINISTRADOR && actor.rol !== ROLES.WEBMASTER) throw new AuthError('Solo ADMINISTRADOR o WEBMASTER puede modificar usuarios.');
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

  var values = [email, rol, nombre, alias, usarAlias ? 'TRUE' : 'FALSE', activo ? 'TRUE' : 'FALSE'];
  if (row < 0) sheet.appendRow(values);
  else sheet.getRange(row + 1, 1, 1, values.length).setValues([values]);
  CacheService.getScriptCache().remove('users-list');
  return ok({ message: row < 0 ? 'Usuario agregado.' : 'Usuario actualizado.' });
}
