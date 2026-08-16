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
├── pages/descargas.astro   ← descargas/lecturas de ediciones PDF
├── pages/agenda.astro      ← calendario de citas (crear/comentar/editar)
├── pages/ediciones.astro   ← ciclo de apertura/cierre de ediciones
├── scripts/login.ts        ← GIS popup + decode ID token
├── scripts/tablero.ts      ← filtros, asignaciones y transiciones
├── scripts/usuarios.ts     ← gestión RBAC de usuarios
├── scripts/configuracion.ts ← valores operativos y asuntos
├── scripts/analiticas.ts   ← gráfico SVG de visitas
├── scripts/descargas.ts    ← contadores por edición
├── scripts/agenda.ts       ← calendario, citas, comentarios, caché local
├── scripts/ediciones.ts    ← abrir/cerrar ediciones con fecha elegida
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

## Agenda

- Pestaña visible para todos los logueados: calendario mensual (lun–dom), hoy resaltado, **varias citas por día** (contador + tooltip con creador y nº de comentarios) y "próximas citas".
- Tipos con color (`reunion` · `cierre_edicion` · `evento` · `otro`), Meet manual (link + acceso a `meet.google.com/home`), **horario con inicio y fin** (`hora` / `hora_fin`, ambos opcionales), hilo de comentarios por cita.
- Permisos: **ver/crear/comentar** todos los logueados; **editar/borrar** COORDINADOR/WEBMASTER.
- Mail al crear (checkbox "Notificar por mail"): a todos los roles activos, con botones **"Ver agenda"** y **"Agregar a mi calendario"** (Google Calendar `action=TEMPLATE`, con horario o día completo) y link de Meet.
- Caché: `CacheService` 30 s + `localStorage` (`tds-agenda-cache-v2`) con render instantáneo e invalidación en cada mutación.
- Auto-citas al **cerrar/abrir ediciones** (tipo `cierre_edicion`/`evento`, sin mail).
- Normalización al leer: Sheets convierte `YYYY-MM-DD`/`HH:mm` a `Date`; se normaliza a texto en el backend (las citas existentes quedan correctas sin migrar).

## Ediciones

- Ciclo de recepción: hoja `Ediciones` (`numero · estado · fecha_apertura · fecha_cierre`) + columna `edicion` en `Tablero` (etiqueta de cada envío).
- **Abrir** (COORDINADOR/WEBMASTER): fecha de apertura elegida; la nueva edición nace **sin fecha de cierre** (se define al cerrar). **Cerrar**: fecha de cierre elegida. Validación de **no solapamiento** entre ediciones (compartir días), solo una abierta a la vez, `numero` = último+1.
- **Reasignar edición** de un envío: COORDINADOR/WEBMASTER/SUPERVISOR desde el tablero.
- **Etiquetado por fecha**: cada envío nuevo cae en la edición cuyo rango apertura–cierre contiene la fecha de recepción (incluye ediciones cerradas con cierre futuro); si ninguna, en la abierta y, si no, en la última.
- **Modificar cierre / reabrir**: COORDINADOR/WEBMASTER pueden cambiar la `fecha_cierre` de una edición cerrada o reabrirla (dejarla abierta), validando que no se superponga con la edición siguiente.
- Migraciones idempotentes `migrateEdiciones()` (hoja + columna `edicion`) y `migrateEdicionesPorFecha()` (reetiqueta envíos según `fecha_recibido`).

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

Ver el plan completo en `revistatds/docs/plan-editorial.md` y el contrato GAS en `gas/README.md`.
