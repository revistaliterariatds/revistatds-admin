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
├── scripts/login.ts        ← GIS popup + decode ID token
├── scripts/tablero.ts      ← filtros, asignaciones y transiciones
├── scripts/usuarios.ts     ← gestión RBAC de usuarios
├── scripts/configuracion.ts ← valores operativos y asuntos
├── scripts/analiticas.ts   ← gráfico SVG de visitas
├── scripts/descargas.ts    ← contadores por edición
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

## Estado verificado

- Login GIS y expiración automática del ID token.
- Tablero, filtros, asignación, reasignación y detalle editorial.
- Flujo de autor: estado, aprobación, rechazo y nuevas versiones.
- Usuarios, Configuración, Visitas y Descargas con permisos por rol.
- Snapshots diarios de visitas en la hoja `Analiticas` e histórico indefinido práctico.
- Contador histórico de visitas y medición de descargas de ediciones.
- Circuito productivo actual de `enviar.js` y `enviar-docentes.js` preservado sin cambios.
- QA integral y corte productivo todavía pendientes.

Ver el plan completo en `revistatds/docs/plan-editorial.md` y el contrato GAS en `gas/README.md`.
