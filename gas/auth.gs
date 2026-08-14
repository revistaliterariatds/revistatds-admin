// auth.gs — validación de ID token (tokeninfo) + RBAC + whoami.

function AuthError(message) {
  this.name = 'AuthError';
  this.message = message;
}

// Clave de caché ligada al token (no reutilizable entre tokens distintos).
function tokenCacheKey(idToken) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8);
  return 'tok:' + digest.map(function (b) {
    var byte = b < 0 ? b + 256 : b;
    return ('0' + byte.toString(16)).slice(-2);
  }).join('');
}

function decodeJwtPayload(token) {
  try {
    var parts = String(token).split('.');
    if (parts.length < 2) return null;
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    var padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Utilities.newBlob(Utilities.base64Decode(padded)).getDataAsString());
  } catch (e) {
    return null;
  }
}

function validateIdToken(idToken) {
  if (!idToken) throw new AuthError('Falta el token.');

  var payload = decodeJwtPayload(idToken);
  if (!payload) throw new AuthError('Token inválido.');
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new AuthError('Token expirado.');

  var cache = CacheService.getScriptCache();
  var cacheKey = tokenCacheKey(idToken);
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new AuthError('Token no verificado.');
  var info = JSON.parse(resp.getContentText());

  var clientId = getOAuthClientId();
  if (clientId && info.aud !== clientId) throw new AuthError('Audience inválido.');
  if (info.email_verified !== 'true' && info.email_verified !== true) {
    throw new AuthError('Email no verificado.');
  }

  var result = {
    email: info.email,
    name: info.name || payload.name || '',
    sub: info.sub || payload.sub,
  };
  cache.put(cacheKey, JSON.stringify(result), 600); // 10 min
  return result;
}

function resolveUser(email) {
  var sheet = getSheet('Roles');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var target = String(email).toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.email]).toLowerCase() === target) {
      return {
        email: data[i][idx.email],
        rol: data[i][idx.rol],
        nombre: data[i][idx.nombre],
        alias: data[i][idx.alias],
        usar_alias_notif: String(data[i][idx.usar_alias_notif]).toUpperCase() === 'TRUE',
        activo: String(data[i][idx.activo]).toUpperCase() === 'TRUE',
      };
    }
  }
  return null;
}

function updateUserName(email, name) {
  var sheet = getSheet('Roles');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var target = String(email).toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.email]).toLowerCase() === target && !data[i][idx.nombre]) {
      sheet.getRange(i + 1, idx.nombre + 1).setValue(name);
      return;
    }
  }
}

// Valida token + regla de acceso (gmail.com + rol activo) → devuelve el usuario.
function requireInternalUser(idToken) {
  var info = validateIdToken(idToken);
  var email = String(info.email || '').toLowerCase();
  if (!/^[^@\s]+@gmail\.com$/.test(email)) {
    throw new AuthError('Solo se permiten cuentas @gmail.com.');
  }
  var user = resolveUser(email);
  if (!user) throw new AuthError('Sin rol asignado.');
  if (!user.activo) throw new AuthError('Usuario inactivo.');
  if (ROLES_INTERNOS.indexOf(user.rol) < 0) throw new AuthError('Rol inválido.');
  if (!user.nombre && info.name) updateUserName(email, info.name);
  return user;
}

function handleWhoami(idToken) {
  var user = requireInternalUser(idToken);
  return ok({
    email: user.email,
    rol: user.rol,
    nombre: user.alias || user.nombre || user.email,
  });
}

// Nombre visible (alias → nombre → email).
function displayName(email) {
  var u = resolveUser(email);
  return u ? (u.alias || u.nombre || u.email) : String(email || '');
}

// "Nombre · Rol" para la columna titular del tablero.
function titularInfo(email) {
  var u = resolveUser(email);
  return u ? ((u.alias || u.nombre || u.email) + ' · ' + u.rol) : String(email || '');
}

// Emails activos de uno o más roles.
function getEmailsByRoles(roles) {
  var sheet = getSheet('Roles');
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var activo = String(data[i][idx.activo]).toUpperCase() === 'TRUE';
    if (activo && roles.indexOf(data[i][idx.rol]) >= 0) {
      out.push(data[i][idx.email]);
    }
  }
  return out;
}
