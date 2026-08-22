// actividad.gs — actividad del equipo editorial para la solapa "Actividad"
// (COORDINADOR/WEBMASTER/SUPERVISOR; el EDITOR no la ve). Agrega Historial +
// Auditoria en un cubo compacto de eventos [mes, edición, usuario, acción,
// producción] con contador de repeticiones; el cliente filtra por mes/edición/
// rol/usuario y calcula los puntos de la torta. Sin parámetros: el endpoint
// devuelve SIEMPRE el dataset completo (los filtros son multidimensionales y
// el agregado por combinación no escala como claves de caché).

var ACTIVIDAD_TZ = 'America/Argentina/Buenos_Aires';
var ACTIVIDAD_TTL = 600;        // 10 min, sin invalidación por escritura (como revistas-list)
var ACTIVIDAD_CACHE_VER = 'v1'; // bump si cambia el shape del dataset
var ACTIVIDAD_CHUNK = 1500;     // eventos por clave de caché (~30 KB; tope CacheService 100 KB)

function handleActividadList(idToken) {
  var user = requireInternalUser(idToken);
  if (!esGestor(user)) throw new AuthError('Sin permisos.');

  var cached = actividadCacheLeer();
  if (cached) { cached.cacheado = true; return ok(cached); }

  var dataset = actividadConstruir();
  actividadCacheGuardar(dataset);
  dataset.cacheado = false;
  return ok(dataset);
}

// ── construcción del dataset ──

function actividadConstruir() {
  var indiceData = actividadIndiceUsuarios();
  var mapaEdiciones = actividadMapaEdiciones();
  var descartados = 0;
  var tuples = [];  // { m: 'yyyy-MM', e: edicion, u: usuarioIdx, a: accion, i: idProduccion | '' }

  // Historial: `actor` guarda displayName (alias || nombre || email), no email
  // → resolución por índice inverso. Actores sintéticos excluidos antes del lookup.
  var historial = getSheet('Historial');
  if (historial) {
    var hIdx = headerIndex(historial);
    var colId = historialIdIndex(historial); // fallback legacy id_cuento
    var data = historial.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var actor = String(data[i][hIdx.actor] || '').trim();
      if (actor === 'AUTOR' || actor === 'Sistema') continue;
      var usuarioIdx = indiceData.indice[actividadNormalizar(actor)];
      if (usuarioIdx === undefined) { descartados++; continue; }
      var ts = data[i][hIdx.timestamp];
      if (!(ts instanceof Date)) continue;
      var accion = String(data[i][hIdx.accion] || '').trim();
      if (!accion) continue;
      var idProd = String(data[i][colId] || '').trim();
      var edicion = idProd && mapaEdiciones[idProd] ? mapaEdiciones[idProd] : 'SIN_EDICION';
      tuples.push({
        m: Utilities.formatDate(ts, ACTIVIDAD_TZ, 'yyyy-MM'),
        e: edicion,
        u: usuarioIdx,
        a: accion,
        i: idProd,
      });
    }
  }

  // Auditoria: acá `actor` SÍ es el email. Eventos admin sin producción ni edición.
  var auditoria = getSheet('Auditoria');
  if (auditoria) {
    var aIdx = headerIndex(auditoria);
    var dataA = auditoria.getDataRange().getValues();
    for (var j = 1; j < dataA.length; j++) {
      var entidad = String(dataA[j][aIdx.entidad] || '').trim().toLowerCase();
      if (entidad !== 'usuario' && entidad !== 'config') continue;
      var usuarioIdxA = indiceData.indice[actividadNormalizar(dataA[j][aIdx.actor])];
      if (usuarioIdxA === undefined) { descartados++; continue; }
      var tsA = dataA[j][aIdx.timestamp];
      if (!(tsA instanceof Date)) continue;
      tuples.push({
        m: Utilities.formatDate(tsA, ACTIVIDAD_TZ, 'yyyy-MM'),
        e: 'SIN_EDICION',
        u: usuarioIdxA,
        a: entidad === 'usuario' ? 'AUDITORIA_USUARIO' : 'AUDITORIA_CONFIG',
        i: '',
      });
    }
  }

  // Diccionarios ordenados ANTES de asignar índices (los eventos referencian
  // posiciones; ordenar después rompería el mapeo).
  var meses = actividadUnicos(tuples, 'm').sort();
  var ediciones = actividadUnicos(tuples, 'e').sort(actividadCompararEdiciones);
  var acciones = actividadUnicos(tuples, 'a').sort();
  var ids = actividadUnicos(tuples, 'i').filter(function (id) { return id !== ''; }).sort();
  var mesIdx = actividadIndiceDe(meses);
  var edIdx = actividadIndiceDe(ediciones);
  var accIdx = actividadIndiceDe(acciones);
  var idIdx = actividadIndiceDe(ids);

  // Agrupación por tupla completa con contador (un evento ≈ 20 bytes).
  var grupos = {};
  tuples.forEach(function (t) {
    var clave = mesIdx[t.m] + '|' + edIdx[t.e] + '|' + t.u + '|' + accIdx[t.a] + '|' + (t.i === '' ? -1 : idIdx[t.i]);
    grupos[clave] = (grupos[clave] || 0) + 1;
  });
  var eventos = Object.keys(grupos).map(function (clave) {
    var p = clave.split('|');
    return [Number(p[0]), Number(p[1]), Number(p[2]), Number(p[3]), Number(p[4]), grupos[clave]];
  });

  return {
    generado: nowIso(),
    meses: meses,
    ediciones: ediciones,
    usuarios: indiceData.usuarios,
    acciones: acciones,
    ids: ids,
    eventos: eventos,
    descartados: descartados,
    colisiones: indiceData.colisiones,
  };
}

// Usuarios internos (gestores + EDITOR) ordenados alfabético por nombre visible.
// El orden lo fija el server para que el cliente asigne colores estables sobre
// la lista COMPLETA (nunca sobre el subconjunto filtrado). Incluye inactivos:
// su historia sigue siendo historia. Índice inverso displayName → posición.
function actividadIndiceUsuarios() {
  var sheet = getSheet('Roles');
  if (!sheet) return { usuarios: [], indice: {}, colisiones: 0 };
  var idx = headerIndex(sheet);
  var data = sheet.getDataRange().getValues();
  var rolesValidos = {};
  ROLES_INTERNOS.forEach(function (rol) { rolesValidos[rol] = true; });

  var filas = [];
  for (var i = 1; i < data.length; i++) {
    var email = String(data[i][idx.email] || '').trim();
    var rol = String(data[i][idx.rol] || '').trim();
    if (!email || !rolesValidos[rol]) continue;
    filas.push({
      email: email,
      rol: rol,
      nombre: String(data[i][idx.nombre] || '').trim(),
      alias: String(data[i][idx.alias] || '').trim(),
      activo: String(data[i][idx.activo]).toUpperCase() === 'TRUE',
    });
  }
  filas.sort(function (a, b) {
    return actividadNombreVisible(a).localeCompare(actividadNombreVisible(b), 'es');
  });

  var usuarios = [];
  var indice = {};
  var colisiones = 0;
  filas.forEach(function (fila) {
    var usuario = { i: usuarios.length, e: fila.email.toLowerCase(), n: actividadNombreVisible(fila), r: fila.rol, a: fila.activo };
    usuarios.push(usuario);
    [fila.email, fila.nombre, fila.alias].forEach(function (clave) {
      var normalizada = actividadNormalizar(clave);
      if (!normalizada) return;
      if (indice[normalizada] !== undefined && indice[normalizada] !== usuario.i) { colisiones++; return; }
      indice[normalizada] = usuario.i;
    });
  });
  return { usuarios: usuarios, indice: indice, colisiones: colisiones };
}

function actividadNombreVisible(fila) {
  return fila.alias || fila.nombre || fila.email;
}

// Replica cómo displayName() arma el actor al escribir en Historial:
// minúsculas, sin espacios dobles y sin acentos (V8 runtime).
function actividadNormalizar(valor) {
  return String(valor || '').trim().toLowerCase().replace(/\s+/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// id_produccion → edición ACTUAL según Tablero ('' y 'SIN_EDICION' al mismo
// bucket). Aproximación documentada: los eventos se atribuyen a la edición
// actual de la producción, no a la vigente al momento del evento.
function actividadMapaEdiciones() {
  var mapa = {};
  var sheet = getSheet('Tablero');
  if (!sheet) return mapa;
  var idx = headerIndex(sheet);
  if (idx.id === undefined || idx.edicion === undefined) return mapa;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][idx.id] || '').trim();
    if (!id) continue;
    var edicion = String(data[i][idx.edicion] || '').trim();
    mapa[id] = edicion && edicion !== 'SIN_EDICION' ? edicion : 'SIN_EDICION';
  }
  return mapa;
}

function actividadUnicos(tuples, campo) {
  var vistos = {};
  var unicos = [];
  tuples.forEach(function (t) {
    if (vistos[t[campo]]) return;
    vistos[t[campo]] = true;
    unicos.push(t[campo]);
  });
  return unicos;
}

function actividadIndiceDe(lista) {
  var indice = {};
  lista.forEach(function (valor, i) { indice[valor] = i; });
  return indice;
}

// Números sin ceros ('1', '2', '10') ordenados numérico; SIN_EDICION al final.
function actividadCompararEdiciones(a, b) {
  if (a === 'SIN_EDICION') return 1;
  if (b === 'SIN_EDICION') return -1;
  var na = Number(a);
  var nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── caché chunked (base + meta + N slices de eventos; falta una pieza → null) ──

function actividadCacheLeer() {
  try {
    var cache = CacheService.getScriptCache();
    var prefix = 'actividad:' + ACTIVIDAD_CACHE_VER + ':';
    var baseRaw = cache.get(prefix + 'base');
    var metaRaw = cache.get(prefix + 'meta');
    if (!baseRaw || !metaRaw) return null;
    var meta = JSON.parse(metaRaw);
    var eventos = [];
    for (var i = 0; i < meta.chunks; i++) {
      var chunk = cache.get(prefix + 'e' + i);
      if (!chunk) return null;
      eventos = eventos.concat(JSON.parse(chunk));
    }
    var dataset = JSON.parse(baseRaw);
    dataset.eventos = eventos;
    return dataset;
  } catch (ex) {
    Logger.log('actividadCacheLeer: ' + ex);
    return null;
  }
}

function actividadCacheGuardar(dataset) {
  try {
    var cache = CacheService.getScriptCache();
    var prefix = 'actividad:' + ACTIVIDAD_CACHE_VER + ':';
    var base = {};
    Object.keys(dataset).forEach(function (k) { if (k !== 'eventos') base[k] = dataset[k]; });
    var chunks = [];
    for (var i = 0; i < dataset.eventos.length; i += ACTIVIDAD_CHUNK) {
      chunks.push(JSON.stringify(dataset.eventos.slice(i, i + ACTIVIDAD_CHUNK)));
    }
    cache.put(prefix + 'base', JSON.stringify(base), ACTIVIDAD_TTL);
    cache.put(prefix + 'meta', JSON.stringify({ chunks: chunks.length, total: dataset.eventos.length }), ACTIVIDAD_TTL);
    chunks.forEach(function (chunk, n) { cache.put(prefix + 'e' + n, chunk, ACTIVIDAD_TTL); });
  } catch (ex) {
    Logger.log('actividadCacheGuardar: ' + ex); // sin caché el endpoint recomputa
  }
}
