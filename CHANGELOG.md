# Changelog

Todas las novedades relevantes de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/)
y versionado semántico (SemVer).

## [0.1.0] — unreleased

### Added
- Tablero: la última decisión del autor (aprobar / no aprobar / subir versión) queda registrada como dato en cada producción (`accion_autor` + fecha + detalle en `Tablero`), visible como badge en la fila y en el detalle. Escrita por `registrarAccionAutor()` en los handlers de token (`autor.gs`); las columnas se auto-agregan vía `ensureTableroSchema()`.
- Scaffold Astro static SSG (`site: https://redaccion.tramasdelsur.com.ar`, `base: /`).
- Identidad visual TDS: tokens (`src/styles/tokens.css`), logo, nav y footer idénticos al sitio.
- Layout base con CSP y fuentes (Playfair Display + Lato).
- Página de login con Google Identity Services (popup) y "hola `<email>`".
- Pipeline de deploy a GitHub Pages (`.github/workflows/deploy.yml`) + `CNAME`.

### Changed
- Rol `ADMINISTRADOR` renombrado a `COORDINADOR` (backend `gas/` + frontend `src/`), con migración idempotente `migrateRoles()` en `users.gs`. `WEBMASTER` conserva acceso total idéntico.

### Security
- Fase A (revisión de seguridad):
  - `auth.gs`: el `OAUTH_CLIENT_ID` pasa a ser obligatorio y se valida además `iss` (solo Google). Sin la property configurada, se rechaza el token en vez de saltear el chequeo de audiencia.
  - `board.gs`: `panel/board/detail` aplica la misma política de visibilidad que el listado — las producciones `RECIBIDO` devuelven "no encontrada" a un EDITOR.
  - `envio.gs`: honeypot anti-bots (input oculto `website`; éxito falso sin crear nada) + tope global diario de envíos (`ENVIO_GLOBAL_DIARIO = 100`, contador por fecha en CacheService) para frenar flood con emails rotados. Requiere agregar el input oculto al formulario del sitio público para máxima efectividad.
  - `tablero.ts`: `badge()` escapa siempre label y color (la hoja es editable a mano).
  - `revistas.ts`: reemplazado el handler `onerror` inline de portadas (JS construido desde datos externos) por un listener con DOM API.
