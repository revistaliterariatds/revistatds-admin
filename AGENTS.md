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
- Secretos solo en Script Properties (nunca en el repo): `OAUTH_CLIENT_ID`, `ADMIN_EMAIL`, `EMITTER_EMAIL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_TAG`.
- `ADMIN_EMAIL` es el email del coordinador (Script Property), **no** es un rol: no renombrarlo.
- Migraciones idempotentes que se corren una vez desde el editor: `migrateEdiciones()`, `migrateRoles()`, `migrateEstructuraDrive()`, `migrateEdicionesPorFecha()`, `migrateHistorialIdColumna()`.
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
