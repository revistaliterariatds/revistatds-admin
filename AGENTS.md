# revistatds-admin — memoria del proyecto

Panel editorial de **Tramas del Sur** (SPA estática en Astro), publicado en
`redaccion.tramasdelsur.com.ar`. Backend: Apps Script **`PanelTDS`** (API pura,
un solo deployment) con Google Sheets como DB. Los archivos del backend viven en
`gas/` (se combinan en un único `PanelTDS.gs` para pegar en Apps Script).

## Roles (RBAC) — vigente

- `COORDINADOR` — acceso total (rol de Karina). **Antes se llamaba `ADMINISTRADOR`**; renombrado el 15/08/2026.
- `WEBMASTER` — acceso total, idéntico a `COORDINADOR` (usuario técnico). **No recibe mails** (ni copias): las notificaciones usan `ROLES_NOTIF_*` (sin WEBMASTER).
- `SUPERVISOR` — todo, menos modificar usuarios (Usuarios en solo lectura).
- `EDITOR` — tablero desde `PRESELECCIONADO`, autoasignación y solo sus asignados. **No envía mail al autor** (solo marca).
- `AUTOR` — solo su producción vía token de un solo uso.

**Contacto con el autor centralizado**: solo los gestores (COORDINADOR/WEBMASTER/SUPERVISOR)
envían mails al autor. El EDITOR "marca" (`pedir-correcciones`) y el gestor "envía"
(`enviar-correcciones`), igual que `consultar-autor`.

Regla: **no reintroducir `ADMINISTRADOR`**. El backend rechaza roles desconocidos
(`auth.gs` valida contra `ROLES_INTERNOS`), así que cualquier fila de `Roles` con
el string viejo da 403. `migrateRoles()` (`users.gs`) renombra las filas viejas →
`COORDINADOR`; ya fue ejecutado en producción.

## Convenciones del backend (importantes)

- Routing por el campo **`action` del body**, no por path (agregar path a `/exec` rompe CORS en Apps Script). Ver `gas/Code.gs`.
- El **ID token viaja en el body** (`idToken`), no en header `Authorization` (evita preflight).
- Secretos solo en Script Properties (nunca en el repo): `OAUTH_CLIENT_ID`, `ADMIN_EMAIL`, `EMITTER_EMAIL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_TAG`, `GITHUB_TOKEN_REVISTA`, `MAIL_FROM_AUTORES`.
- `GITHUB_TOKEN_REVISTA`: fine-grained PAT de GitHub (solo repo `revistaliterariatds/revistatds`, permiso `Contents: write`) para disparar el workflow `publicar-edicion` (subida de ediciones nuevas desde el panel).
- `MAIL_FROM_AUTORES` (opcional): alias Gmail ("Enviar correo como") desde el que salen los avisos a autores; requiere `GmailApp` (re-autorización del script). Sin la propiedad, los avisos salen desde la cuenta del script (MailApp).
- `ADMIN_EMAIL` es el email del coordinador (Script Property), **no** es un rol: no renombrarlo.
- Migraciones idempotentes que se corren una vez desde el editor: `migrateEdiciones()`, `migrateRoles()`, `migrateEstructuraDrive()`, `migrateEdicionesPorFecha()`, `migrateHistorialIdColumna()`, `migrateAutorTokens()` (hashea `token_autor` → `s1:<sha256>`; opcional, la búsqueda acepta legacy).
- **Advanced Drive Service** (Drive API **v2**, en `appsscript.json` `enabledAdvancedServices`) para `convertirAPdf` (Word/ODT/RTF/TXT → PDF). Debe habilitarse también en Servicios del editor.
- Término canónico: **"producción"** (antes "cuento"). Los envíos pueden ser cuentos, ilustraciones, historias, etc.

## Estructura de Drive (vigente)

```
Tramas del Sur / EDICIONES / EDICION N° xx / { RECIBIDOS, PUBLICABLES }
```
- Cada envío vive en `RECIBIDOS/<id>/` (original, `correccion/`, `v2…`, `version_aprobada/`).
- `PUBLICABLES/<id>-<nombre>`: copia marcada como publicable (sueltos, sin subcarpeta).
- Etiquetado por fecha: `edicionDestino()` asigna el envío a la edición cuyo rango apertura–cierre contiene hoy (abierta → última → `SIN_EDICION`).
- El nombre de edición lleva cero a la izquierda (`EDICION N° 03`).
- Columna `url_publicable` en `Tablero`; columna `id_produccion` en `Historial`.

## Agenda — feriados nacionales (18/08/2026)

- El calendario marca los **feriados nacionales argentinos** (fondo suave + ✶ + tooltip con el nombre).
- Se sincronizan desde `date.nager.at` (API de terceros) **una vez por año** y quedan **persistidos en la hoja `Feriados`** (`fecha | nombre | tipo | origen`): el runtime no depende de la API.
- `origen` distingue `api` (nacionales) de `manual` (propios, p. ej. Día del Maestro): el sync anual **no borra los manuales**. Alta/baja a demanda: `panel/feriados/agregar|quitar` (COORDINADOR/WEBMASTER), botones "Agregar feriado" y "✕" en la Agenda.
- Trigger anual `sincronizarFeriadosAnio` (2 de enero 02:00, `setupFeriadosTrigger()`) que **se re-agenda solo** al correr; a demanda: botón "Actualizar feriados" (COORDINADOR/WEBMASTER) → `panel/feriados/sync`.
- `panel/agenda/list` devuelve `feriados` (cache 6 h, `feriadosPersistidos()`).

## Revistas (ediciones publicadas) — 17/08/2026

- **Solapa Revistas** (todos los roles): grilla + lector PDF en modal + "Subir edición nueva" (COORDINADOR/WEBMASTER). Lee el índice del sitio (`tramasdelsur.com.ar/assets/docs/index.json`) por proxy GAS (`panel/revistas/list`, cache 10 min) + cache local `tds-revistas-cache-v1`.
- **Subida** (`revistas.gs`): PDF en chunks de 5 MB (`panel/revistas/subir-chunk` / `subir-estado` / `finalizar`) → reconstruido en Drive con subida **resumable** de Drive API v3 (misma cuenta, sin scopes nuevos; aceptar 200 o 201 como cierre) → acceso público → `repository_dispatch` al repo de la revista.
- **Workflow** `publicar-edicion` (repo `revistaliterariatds/revistatds`, `on: repository_dispatch types: [publicar-edicion]` + `workflow_dispatch`): baja archivos de Drive, valida número contra `index.json` (auto = último + 1), commitea `rtds{n}.pdf`/`.jpeg` y actualiza `index.json`, pushea (GITHUB_TOKEN del propio workflow).
- **Avisos por mail al publicar** (triggers de una sola ejecución, reintento 3 min, limpieza de triggers al terminar):
  - Equipo editorial (`ROLES_NOTIF_INTERNOS`, sin WEBMASTER) a los **2 min** → `enviarAvisoEdicionPublicada` (pendiente en `aviso-edicion-pendiente`).
  - Autores publicados a los **10 min** → `enviarAvisoAutoresPublicados` (pendiente en `aviso-autores-pendiente`): filas de Tablero con `estado = PUBLICADO` y `edicion = nombreEdicion(num)` al momento de publicar; un mail por autor agrupado por `email_autor`; link personal solo si hay `token_autor`; registro idempotente en hoja `Avisos` (`num_edicion | produccion_id | email_autor | fecha`, creada por `ensureSchema`); remitente `MAIL_FROM_AUTORES` si está seteada (`sendMailAutores`).

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
