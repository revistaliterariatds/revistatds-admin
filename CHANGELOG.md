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
- Fase B (hardening):
  - **CSP sin `'unsafe-inline'` en `script-src`**: el único script inline (nav + SW) se permite por hash SHA-256. Nuevo guard `postbuild` (`scripts/verify-csp.mjs`) que falla el build si aparece un script inline sin hash en la política. `style-src` conserva `'unsafe-inline'` (atributos `style="…"`, documentado).
  - **Tokens de autor hasheados en la hoja** (`s1:<sha256>`, `hashearTokenAutor()`): el token crudo solo viaja en el mail; la hoja guarda el hash (`envio.gs`, `board.gs`). Búsqueda dual en `autor.gs` (`filaCoincideToken`): acepta token crudo contra hash, filas legacy en texto plano y links "estado" armados con el valor almacenado. Migración idempotente opcional: `migrateAutorTokens()`.
  - **Auditoría administrativa**: nueva hoja `Auditoria` (`timestamp | actor | entidad | clave | detalle`). `handleUserSave` registra alta/diff del cambio; `handleConfigSave` registra valor anterior → nuevo. Fallo de registro no bloquea la operación.
- Fase C (diseño/refactor):
  - Nuevo módulo compartido `src/scripts/ui.ts`: `esc()`, `esGestor()`/`esAdmin()`, `renderNav()` (una sola implementación para las 9 vistas) y `confirmar()` — diálogo de confirmación estilizado basado en `<dialog>` que reemplaza a los `confirm()` nativos (Escape y "Cancelar" resuelven false; fallback a `window.confirm`). Se apila sobre los otros modales.
  - `tablero.ts` dividido: el modal de detalle vive ahora en `tablero-detalle.ts` (710 → 397 + 312 líneas), con acceso al estado vía bindings exportados (ciclo solo a nivel de función, verificado en build y runtime).
  - Fix de tipografía: la cabecera del calendario usaba `font-weight: 700` con Lato cargada solo en 300/400 (faux bold) → 400 con fondo suave.
  - Fix de estados en el update optimista de Ediciones (`'CERRADA'`/`'ABIERTA'` → `'cerrada'`/`'abierta'`, como los guarda el backend).
