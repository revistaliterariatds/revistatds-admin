# revistatds-admin — Panel editorial de Tramas del Sur

Panel editorial (SPA estática en **Astro**) para el circuito editorial de
[Tramas del Sur](https://tramasdelsur.com.ar). Publicado en
**redaccion.tramasdelsur.com.ar** vía GitHub Pages.

> Parte del sistema descrito en `revistatds/docs/plan-editorial.md` (Arquitectura B).
> Backend: Apps Script `PanelTDS` (API pura). DB: Google Sheets. Auth: Google Identity Services.

## Stack

- **Astro** (static SSG) — sin integraciones, sin framework de UI.
- **Google Identity Services** (popup) → ID token → API GAS (`Authorization: Bearer`).
- Identidad visual **TDS** (tokens copiados de `assets/css/variables.css` del sitio).

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
├── scripts/login.ts       ← GIS popup + decode ID token
└── styles/
    ├── tokens.css         ← design tokens (copia de variables.css del sitio)
    └── global.css
```

## Estado

Fase 1 (esqueleto): login + identidad. Ver `revistatds/docs/plan-editorial.md`.
