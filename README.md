# revistatds-admin — Panel editorial de Tramas del Sur

Panel editorial (SPA estática en **Astro**) para el circuito editorial de
[Tramas del Sur](https://tramasdelsur.com.ar). Publicado en
**redaccion.tramasdelsur.com.ar** vía GitHub Pages.

> Parte del sistema descrito en `revistatds/docs/plan-editorial.md` (Arquitectura B).
> Backend: Apps Script `PanelTDS` (API pura). DB: Google Sheets. Auth: Google Identity Services.

## Stack

- **Astro** (static SSG) — sin integraciones, sin framework de UI.
- **Google Identity Services** (popup) → ID token en body → API GAS (evita preflight CORS).
- Identidad visual **TDS** (tokens copiados de `assets/css/variables.css` del sitio).
- RBAC: `COORDINADOR`/`WEBMASTER` (gestión completa, incl. cambio de estado de cualquier publicación), `SUPERVISOR` (operación y lectura de Usuarios, puede aprobar) y `EDITOR` (tablero desde `PRESELECCIONADO`, autoasignación y producciones asignadas).

## Requisitos

- Node `>= 22.12` (ver `engines` en `package.json`).

## Setup

```bash
npm install
cp .env.example .env   # completar PUBLIC_GOOGLE_CLIENT_ID y PUBLIC_APPS_SCRIPT_URL
npm run dev            # http://localhost:4321
```

## Build

```bash
npm run build          # genera dist/
npm run preview
```

## Deploy

Push a `main` → GitHub Actions (`.github/workflows/deploy.yml`) publica en
GitHub Pages. Dominio custom vía `public/CNAME`.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `PUBLIC_GOOGLE_CLIENT_ID` | OAuth Client ID (tipo Web) de Google Cloud, origins `https://redaccion.tramasdelsur.com.ar` y `http://localhost:4321`. |
| `PUBLIC_APPS_SCRIPT_URL` | URL del deployment de `PanelTDS` (Apps Script). |

## Estructura

```
src/
├── layouts/Layout.astro   ← nav + footer + CSP + fuentes (identidad TDS)
├── pages/index.astro      ← login + "hola <email>"
├── pages/tablero.astro     ← tablero editorial y detalle
├── pages/usuarios.astro    ← usuarios y roles
├── pages/configuracion.astro ← configuración y asuntos de mail
├── pages/analiticas.astro  ← visitas, contador histórico y snapshots
├── pages/actividad.astro   ← torta de actividad del equipo por usuario (solo gestores)
├── pages/descargas.astro   ← descargas/lecturas de ediciones PDF
├── pages/agenda.astro      ← calendario de citas (crear/comentar/editar)
├── pages/ediciones.astro   ← ciclo de apertura/cierre de ediciones
├── pages/revistas.astro    ← ediciones publicadas + lector + subida de edición nueva
├── scripts/login.ts        ← GIS popup + decode ID token
├── scripts/tablero.ts      ← filtros, asignaciones y transiciones
├── scripts/usuarios.ts     ← gestión RBAC de usuarios
├── scripts/configuracion.ts ← valores operativos y asuntos
├── scripts/analiticas.ts   ← gráfico SVG de visitas
├── scripts/actividad.ts    ← torta de actividad + desglose por acción (solo gestores)
├── scripts/descargas.ts    ← contadores por edición
├── scripts/agenda.ts       ← calendario, citas, comentarios, caché local
├── scripts/ediciones.ts    ← abrir/cerrar ediciones con fecha elegida
└── scripts/revistas.ts     ← grilla, lector y subida por chunks (solo gestores)
└── styles/
    ├── tokens.css         ← design tokens (copia de variables.css del sitio)
    └── global.css
```

## Tablero y flujo editorial

- **Estados** (en orden): `RECIBIDO` → `PRESELECCIONADO` → `EN_REVISIÓN` → `CORRECCIONES_SOLICITADAS` → `ESPERANDO_APROBACIÓN` → `CONSULTA_AUTOR` / `APROBADO` → `PUBLICADO` (+ `RECHAZADO_POR_AUTOR`, `DESCARTADO`).
- **Visibilidad por rol**: `RECIBIDO` (bandeja de entrada) solo lo ven COORDINADOR/WEBMASTER/SUPERVISOR. El EDITOR ve desde `PRESELECCIONADO` y **se autoasigna desde ahí**.
- **Acceso al documento**: todo usuario logueado ve el botón **"Doc"** en cada fila desde el primer momento (apunta al doc de corrección; si aún no existe, a la carpeta con el original).
- **Aprobar**: COORDINADOR/WEBMASTER/SUPERVISOR pueden pasar `ESPERANDO_APROBACIÓN` → `APROBADO` directamente (botón "Aprobar" junto a "Consultar al autor").
- **Control administrativo**: COORDINADOR/WEBMASTER pueden **cambiar el estado de cualquier publicación en cualquier momento** desde el detalle (selector "Cambiar estado"). Si eligen `CONSULTA_AUTOR`, se abre el selector de archivo (igual que "Consultar al autor").
- **Marcar publicable** (COORDINADOR/WEBMASTER): elige un archivo de la carpeta y lo copia a `PUBLICABLES/<id>-<nombre>` (guarda `url_publicable`).
- **Borrar envío** (COORDINADOR/WEBMASTER): elimina por completo la carpeta de Drive, la copia en PUBLICABLES, la fila del tablero y su historial.
- **Contacto con el autor centralizado en gestores**: el EDITOR solo **marca** ("Pedir correcciones"); el gestor **envía** el mail al autor ("Enviar correcciones al autor" / "Consultar al autor") eligiendo archivo → PDF adjunto.
- El backend filtra `RECIBIDO` para el editor y valida que la autoasignación sea solo desde `PRESELECCIONADO`; `desasignar` devuelve la publicación a `PRESELECCIONADO`.

## Estructura de Drive

```
Tramas del Sur / EDICIONES / EDICION N° xx / { RECIBIDOS, PUBLICABLES }
```
- Cada envío vive en `RECIBIDOS/<id>/` (original, `correccion/`, `v2…`, `version_aprobada/`). `PUBLICABLES/<id>-<nombre>` guarda las copias marcadas como publicables.
- El envío nuevo cae en la edición cuyo rango apertura–cierre contiene la fecha de recepción (abierta → última → `SIN_EDICION`). Nombre de edición con cero a la izquierda (`EDICION N° 03`).
- Migraciones: `migrateEstructuraDrive()` (mueve la carpeta legacy `Cuentos/<id>` a `RECIBIDOS`), `migrateEdicionesPorFecha()`, `migrateHistorialIdColumna()` (`id_cuento` → `id_produccion`).

## Rendimiento

- Keep-warm de Apps Script: trigger cada 5 min (`keepAlive` + `setupKeepAliveTrigger`) para evitar el cold start.
- Caché backend en `CacheService`: Config 10 min, Usuarios 60 s, Tablero 30 s (invalidada en cada mutación), analíticas y descargas 5 min (invalidada al registrar).
- Frontend con render instantáneo (`localStorage`) y carga en paralelo en el tablero.

## Medición de descargas

El sitio público registra clics en los PDF de ediciones (`descarga`, público). El panel muestra totales por edición con desglose "leer"/"descargar", filtro por período y **contador histórico** (clics desde la activación, como en Visitas). Los datos son append-only en la hoja `Descargas` y crecen históricamente.

## Actividad del equipo

- Solapa **Actividad** (solo gestores: COORDINADOR/WEBMASTER/SUPERVISOR): **torta donut SVG** con la participación de cada integrante del equipo editorial (roles `COORDINADOR`, `SUPERVISOR` y `EDITOR` por defecto; el WEBMASTER aparece al elegir "Todos los roles" o su rol), cada persona identificada con un **color estable** (asignado sobre el orden alfabético global que fija el backend).
- **Filtros combinables**: período (mes concreto o histórico completo), número de edición, rol y usuario. Al seleccionar un usuario su sector se resalta en la torta y se abre un **desglose por tipo de acción** en barras.
- **Métrica** = puntos ponderados: acciones registradas (peso 2 para las que implican mail a autores o publicación) + 3 puntos por producción distinta gestionada.
- Fuente: hojas `Historial` + `Auditoria` vía `panel/actividad/list`. Como el `actor` del Historial guarda el nombre visible (no el email), el backend resuelve la identidad con un índice inverso desde `Roles`; los eventos sin dueño quedan contados (`descartados`) y visibles al pie. La edición de cada evento es la **actual** de la producción (aproximación documentada).
- Respuesta compacta posicional (diccionarios + eventos `[mes, edicion, usuario, acción, id, n]`) cacheada en `CacheService` por chunks (~1500 eventos c/u, TTL 10 min sin invalidación). El cliente filtra localmente: cambiar filtros no genera red.

## Agenda

- Pestaña visible para todos los logueados: calendario mensual (lun–dom), hoy resaltado, **varias citas por día** (contador + tooltip con creador y nº de comentarios) y "próximas citas".
- Tipos con color (`reunion` · `cierre_edicion` · `evento` · `otro`), Meet manual (link + acceso a `meet.google.com/home`), **horario con inicio y fin** (`hora` / `hora_fin`, ambos opcionales), hilo de comentarios por cita.
- Permisos: **ver/crear/comentar** todos los logueados; **editar/borrar** COORDINADOR/WEBMASTER.
- Mail al crear (checkbox "Notificar por mail"): a todos los roles activos, con botones **"Ver agenda"** y **"Agregar a mi calendario"** (Google Calendar `action=TEMPLATE`, con horario o día completo) y link de Meet.
- Caché: `CacheService` 30 s + `localStorage` (`tds-agenda-cache-v2`) con render instantáneo e invalidación en cada mutación.
- Auto-citas al **cerrar/abrir ediciones** (tipo `cierre_edicion`/`evento`, sin mail).
- **Feriados nacionales** marcados en el calendario: se traen de `date.nager.at` una vez por año y quedan persistidos en la hoja `Feriados` (trigger anual en enero que se re-agenda solo + botón "Actualizar feriados" para COORDINADOR/WEBMASTER); `panel/agenda/list` los incluye (cache 6 h). Feriados **propios** (p. ej. Día del Maestro) se agregan/quitan desde la Agenda (COORDINADOR/WEBMASTER) y el sync anual no los borra.
- Normalización al leer: Sheets convierte `YYYY-MM-DD`/`HH:mm` a `Date`; se normaliza a texto en el backend (las citas existentes quedan correctas sin migrar).

## Ediciones

- Ciclo de recepción: hoja `Ediciones` (`numero · estado · fecha_apertura · fecha_cierre`) + columna `edicion` en `Tablero` (etiqueta de cada envío).
- **Abrir** (COORDINADOR/WEBMASTER): fecha de apertura elegida; la nueva edición nace **sin fecha de cierre** (se define al cerrar). **Cerrar**: fecha de cierre elegida. Validación de **no solapamiento** entre ediciones (compartir días), solo una abierta a la vez, `numero` = último+1.
- **Reasignar edición** de un envío: COORDINADOR/WEBMASTER/SUPERVISOR desde el tablero.
- **Etiquetado por fecha**: cada envío nuevo cae en la edición cuyo rango apertura–cierre contiene la fecha de recepción (incluye ediciones cerradas con cierre futuro); si ninguna, en la abierta y, si no, en la última.
- **Modificar cierre / reabrir**: COORDINADOR/WEBMASTER pueden cambiar la `fecha_cierre` de una edición cerrada o reabrirla (dejarla abierta), validando que no se superponga con la edición siguiente.
- Migraciones idempotentes `migrateEdiciones()` (hoja + columna `edicion`) y `migrateEdicionesPorFecha()` (reetiqueta envíos según `fecha_recibido`).

## Revistas (ediciones publicadas)

- Solapa **Revistas** (todos los roles): grilla con portada, título y botones **Leer** (modal con lector PDF integrado) y **Descargar**. Lee el mismo índice que el sitio público (`tramasdelsur.com.ar/assets/docs/index.json`) vía proxy GAS (`panel/revistas/list`, cache 10 min) + cache local (`tds-revistas-cache-v1`): una edición subida a la revista aparece sola en el panel.
- **Subir edición nueva** (COORDINADOR/WEBMASTER): formulario con PDF (hasta 40 MB) y portada opcional (4 MB), número opcional (auto = último + 1, valida duplicados). El PDF viaja por **chunks de 5 MB** (`panel/revistas/subir-chunk`, reanudable vía `panel/revistas/subir-estado`) y se reconstruye en Drive con la **subida resumable de Drive API v3** (misma cuenta del script, sin scopes nuevos). `panel/revistas/finalizar` cierra: portada, acceso público y **dispatch a GitHub**.
- **Publicación automática**: el repo `revistaliterariatds/revistatds` tiene el workflow `publicar-edicion` (repository_dispatch): baja el PDF/portada del link de Drive, valida que el número no exista en `index.json`, commitea `assets/docs/rtds{n}.pdf` (+ `.jpeg`) y **actualiza `index.json`** (agrega `{num, titulo}` y ordena), y pushea — el deploy de Pages publica el sitio.
- **Avisos por mail al publicar** (triggers de una sola ejecución, reintento a los 3 min si falla):
  - **Equipo editorial** a los **2 min** (`ROLES_NOTIF_INTERNOS`, sin WEBMASTER): invita a leer y difundir, con botones al sitio y al PDF.
  - **Autores publicados** de esa edición a los **10 min** (filas de `Tablero` con `estado = PUBLICADO` y `edicion` = la publicada, lista congelada al publicar): felicitaciones, gracias por participar e invitación a leer/difundir. Un solo mail por autor (agrupado por `email_autor`), solo su info; link personal de estado solo si existe token (nunca se expone). Registro **idempotente** en la hoja `Avisos` (`num_edicion | produccion_id | email_autor | fecha`).
  - Los avisos a autores pueden salir desde **otra casilla Gmail** (alias "Send mail as", Script Property `MAIL_FROM_AUTORES`); sin configurar usan la cuenta del script.

### Script Properties del backend (además de las de siempre)

| Clave | Uso |
|---|---|
| `GITHUB_TOKEN_REVISTA` | Fine-grained PAT de GitHub (solo el repo `revistaliterariatds/revistatds`, permiso `Contents: write`) que permite disparar el workflow `publicar-edicion`. |
| `MAIL_FROM_AUTORES` | (opcional) Alias Gmail ("Enviar correo como") desde el que salen los avisos a autores; requiere `GmailApp` (re-autorización del script la primera vez). |

## Mails al autor

- El contacto con el autor lo hacen **solo los gestores** (COORDINADOR/WEBMASTER/SUPERVISOR); el EDITOR solo **marca** las correcciones.
- **Consultar al autor**: el gestor **elige el archivo** de la carpeta de la producción; el sistema lo convierte a **PDF** (`convertirAPdf`) y lo adjunta (el autor nunca recibe links de Drive ni docs editables).
- **Enviar correcciones al autor**: mismo selector de archivo + **campo de mensaje adicional** (opcional); adjunta el PDF y el mensaje, con link de un solo uso para subir la nueva versión.
- Tres **botones iguales con colores TDS** (Aprobar verde / Modificar naranja / No aprobar rojo), de **un solo uso** (el token se consume con la primera acción).
- Explica que modificar requiere enviar un **nuevo archivo**: adjuntándolo **respondiendo el correo**, o como **nueva producción** con botón directo al formulario (`enviar.html`).
- Si el autor sube una versión desde `CONSULTA_AUTOR`, **editor asignado + COORDINADOR/SUPERVISOR** reciben aviso de que el autor solicita modificar su producción (WEBMASTER no recibe mails).
- La página del autor (`/autor/`) muestra un **popup de confirmación** del resultado (aprobada / rechazo aceptado + invitación / versión recibida).

## Estado verificado

- Login GIS y expiración automática del ID token.
- Tablero, filtros, asignación, reasignación y detalle editorial.
- Flujo de autor: estado, aprobación, rechazo y nuevas versiones.
- Usuarios, Configuración, Visitas y Descargas con permisos por rol.
- Snapshots diarios de visitas en la hoja `Analiticas` e histórico indefinido práctico.
- Contador histórico de visitas y medición de descargas de ediciones (con contador histórico).
- Agenda (citas, comentarios, Meet, horarios con inicio/fin, mails, caché local) y ciclo de Ediciones (fechas elegibles sin solapamiento, auto-citas).
- Tablero: estado `PRESELECCIONADO` con visibilidad por rol, botón "Doc" para todos, aprobar desde "En aprobación" y cambio de estado administrativo.
- Mail de aprobación y de correcciones con PDF adjunto (archivo elegido por el gestor) y botones de un solo uso; aviso al equipo cuando el autor pide modificar.
- Rol `ADMINISTRADOR` renombrado a `COORDINADOR` (migración `migrateRoles()`); `WEBMASTER` con acceso total idéntico pero **sin recibir mails**.
- Estructura de Drive por ediciones (`EDICIONES/EDICION N° xx/RECIBIDOS|PUBLICABLES`), etiquetado por fecha, "marcar publicable", "borrar envío" y "modificar cierre / reabrir edición".
- Término **"producción"** (antes "cuento") aplicado en código, mails, UI y columnas de hoja (`id_produccion`).
- Contacto con el autor centralizado en gestores; el editor solo marca.
- Circuito productivo actual de `enviar.js` y `enviar-docentes.js` preservado sin cambios.
- QA automatizado ejecutado (24/24 PASS contra producción, sin login) — ver log en `revistatds/docs/plan-editorial.md`.
- Solapa Revistas: listado de ediciones publicadas (proxy del índice del sitio), lector PDF en modal, y **publicación de ediciones nuevas desde el panel** (chunks → Drive → dispatch → workflow `publicar-edicion` del repo de la revista), verificada en producción (edición 3).
- Avisos automáticos al publicar: mail al equipo editorial (2 min) y felicitaciones a autores publicados (10 min, hoja `Avisos` idempotente), con alias Gmail opcional para los autores.

Ver el plan completo en `revistatds/docs/plan-editorial.md` y el contrato GAS en `gas/README.md`.
