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
- RBAC: `ADMINISTRADOR`/`WEBMASTER` (gestión completa), `SUPERVISOR` (operación y lectura de Usuarios) y `EDITOR` (solo Tablero y cuentos asignados).

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

## Rendimiento

- Keep-warm de Apps Script: trigger cada 5 min (`keepAlive` + `setupKeepAliveTrigger`) para evitar el cold start.
- Caché backend en `CacheService`: Config 10 min, Usuarios 60 s, Tablero 30 s (invalidada en cada mutación), analíticas y descargas 5 min (invalidada al registrar).
- Frontend con render instantáneo (`localStorage`) y carga en paralelo en el tablero.

## Medición de descargas

El sitio público registra clics en los PDF de ediciones (`descarga`, público). El panel muestra totales por edición con desglose "leer"/"descargar" y filtro por período. Los datos son append-only en la hoja `Descargas` y crecen históricamente desde su activación.

## Agenda

- Pestaña visible para todos los logueados: calendario mensual (lun–dom), hoy resaltado, **varias citas por día** (contador + tooltip con creador y nº de comentarios) y "próximas citas".
- Tipos con color (`reunion` · `cierre_edicion` · `evento` · `otro`), Meet manual (link + acceso a `meet.google.com/new`), hilo de comentarios por cita.
- Permisos: **ver/crear/comentar** todos los logueados; **editar/borrar** ADMIN/WEBMASTER.
- Mail al crear (checkbox "Notificar por mail"): a todos los roles activos, con botones **"Ver agenda"** y **"Agregar a mi calendario"** (Google Calendar `action=TEMPLATE`, con horario o día completo) y link de Meet.
- Caché: `CacheService` 30 s + `localStorage` (`tds-agenda-cache-v2`) con render instantáneo e invalidación en cada mutación.
- Auto-citas al **cerrar/abrir ediciones** (tipo `cierre_edicion`/`evento`, sin mail).
- Normalización al leer: Sheets convierte `YYYY-MM-DD`/`HH:mm` a `Date`; se normaliza a texto en el backend (las citas existentes quedan correctas sin migrar).

## Ediciones

- Ciclo de recepción: hoja `Ediciones` (`numero · estado · fecha_apertura · fecha_cierre`) + columna `edicion` en `Tablero` (etiqueta de cada envío).
- **Abrir** (ADMIN/WEBMASTER): fecha de apertura elegida; la nueva edición nace **sin fecha de cierre** (se define al cerrar). **Cerrar**: fecha de cierre elegida. Validación de **no solapamiento** entre ediciones (compartir días), solo una abierta a la vez, `numero` = último+1.
- **Reasignar edición** de un envío: ADMIN/WEBMASTER/SUPERVISOR desde el tablero.
- Migración idempotente `migrateEdiciones()` (crea hoja, agrega columna `edicion` y siembra edición inicial 3) — ejecutable una sola vez.

## Mail de aprobación al autor

- Adjunta el **documento de corrección del editor en PDF** (el autor nunca recibe links de Drive ni docs editables; fallback al texto en el cuerpo si no hay doc).
- Tres **botones iguales con colores TDS** (Aprobar verde / Modificar naranja / No aprobar rojo), de **un solo uso** (el token se consume con la primera acción).
- Explica que modificar requiere enviar un **nuevo archivo**: adjuntándolo **respondiendo el correo**, o como **nueva producción** con botón directo al formulario (`enviar.html`).
- Si el autor sube una versión desde `CONSULTA_AUTOR`, **editor asignado + ADMIN/WEBMASTER/SUPERVISOR** reciben aviso de que el autor solicita modificar su cuento.
- La página del autor (`/autor/`) muestra un **popup de confirmación** del resultado (aprobada / rechazo aceptado + invitación / versión recibida).

## Estado verificado

- Login GIS y expiración automática del ID token.
- Tablero, filtros, asignación, reasignación y detalle editorial.
- Flujo de autor: estado, aprobación, rechazo y nuevas versiones.
- Usuarios, Configuración, Visitas y Descargas con permisos por rol.
- Snapshots diarios de visitas en la hoja `Analiticas` e histórico indefinido práctico.
- Contador histórico de visitas y medición de descargas de ediciones.
- Agenda (citas, comentarios, Meet, mails, caché local) y ciclo de Ediciones (fechas elegibles sin solapamiento, auto-citas).
- Mail de aprobación con PDF adjunto y botones de un solo uso; aviso al equipo cuando el autor pide modificar.
- Circuito productivo actual de `enviar.js` y `enviar-docentes.js` preservado sin cambios.
- QA integral y corte productivo todavía pendientes.

Ver el plan completo en `revistatds/docs/plan-editorial.md` y el contrato GAS en `gas/README.md`.
