# PanelTDS — backend Apps Script

API pura (Google Apps Script) del sistema editorial. Sheets como DB, Drive para
archivos, Docs para corrección, MailApp para mails. Un único deployment "Anyone"
que se ejecuta como la cuenta emisora (`revistaliterariatds@gmail.com`).

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `Code.gs` | Router HTTP (`doPost`/`doGet`) + `setup()` |
| `enums.gs` | Roles, estados, categorías, convocatorias |
| `utils.gs` | Helpers (`ok`, `err`, `isValidEmail`, `escapeHtml`) |
| `config.gs` | Script Properties (secretos) + hoja `Config` |
| `sheets.gs` | Schema de Sheets + helpers de lectura/escritura |
| `auth.gs` | Validación ID token (`tokeninfo`) + RBAC + `whoami` |
| `files.gs` | Carpetas de Drive + guardado de adjuntos |
| `history.gs` | Historial append-only |
| `mail.gs` | Mails con estilo TDS inline |
| `envio.gs` | Endpoint público `envio` (compatible con el sitio) |
| `board.gs` | Tablero del panel (lectura) |
| `agenda.gs` | Agenda: citas, comentarios y auto-citas de ediciones |
| `ediciones.gs` | Ciclo de ediciones (abrir/cerrar con fecha elegida, sin solapamiento) |
| `users.gs` | Gestión de usuarios y roles |
| `analytics.gs` | Snapshots diarios y consulta histórica de visitas |
| `descargas.gs` | Registro y consulta de descargas/lecturas de ediciones PDF |
| `appsscript.json` | Manifest: scopes + webapp (executeAs `USER_DEPLOYING`, access `ANYONE_ANONYMOUS`) |

## Generar `PanelTDS.gs` (un solo archivo para pegar)

Todos los `.gs` (incluido `Code.gs`, que contiene `doPost`/`doGet`) se concatenan
en un único `PanelTDS.gs`. El orden no afecta la ejecución (scope global de Apps
Script), pero **no debe faltar ningún archivo** — omitir `Code.gs` deja el
deployment sin `doPost` y responde "No se encontró la función de la secuencia de
comandos: doPost".

```bash
ORDER="Code enums utils sheets config auth files history mail envio board agenda ediciones users analytics descargas autor reminders revistas"
for f in $ORDER; do cat "gas/$f.gs"; echo; done > /tmp/revistatds-panel-gas/PanelTDS.gs
# Verificar que nada falte:
for f in gas/*.gs; do rg -o "function [A-Za-z_][A-Za-z0-9_]*" "$f"; done | sed 's/function //' | sort -u > /tmp/f_src.txt
rg -o "function [A-Za-z_][A-Za-z0-9_]*" /tmp/revistatds-panel-gas/PanelTDS.gs | sed 's/function //' | sort -u > /tmp/f_cmb.txt
comm -23 /tmp/f_src.txt /tmp/f_cmb.txt   # vacío = OK
```

## Puesta en marcha (manual, sin clasp)

1. Ir a https://script.google.com → **Nuevo proyecto** (renombrar a `PanelTDS`).
2. Borrar el `myFunction` de ejemplo y crear un archivo por cada `.gs` de acá,
   pegando el contenido (los nombres de archivo no importan para la ejecución:
   Apps Script comparte el scope global entre archivos).
3. En **Configuración del proyecto** → activar "Mostrar `appsscript.json`" y pegar
   el manifest (o dejar que se genere y ajustar `webapp`/scopes). **Importante**:
   el manifest habilita el **Advanced Drive Service** (`enabledAdvancedServices`,
   Drive API v2) para convertir Word/ODT/RTF/TXT a PDF en "Consultar al autor".
   Hay que **habilitarlo también en el editor** (Servicios → Drive API).
4. **Ejecutar `setup()` una vez** (autorizar los permisos):
    - crea el Spreadsheet `PanelTDS` con las hojas `Roles`, `Tablero`, `Historial`, `Config`, `Agenda`, `AgendaComentarios`, `Ediciones` (la hoja `Analiticas` se crea al primer snapshot);
   - siembra `Config` y los roles iniciales (COORDINADOR + emisor).
5. **Script Properties** (Configuración del proyecto → Propiedades de secuencia de
   comandos) — agregar:
   - `OAUTH_CLIENT_ID`: el OAuth Client ID (tipo Web) de Google Cloud (obligatorio para `auth.gs`).
   - `ADMIN_EMAIL`: `revistatramasdelsur@gmail.com` (ya es default).
   - `EMITTER_EMAIL`: `revistaliterariatds@gmail.com` (ya es default).
   - `SPREADSHEET_ID`: lo setea `setup()` automáticamente.
6. **Desplegar**: Implementar → Nueva implementación → **Aplicación web** →
   *Ejecutar como*: yo (cuenta emisora) → *Quién tiene acceso*: **Cualquiera** →
   copiar la URL `/exec`.
7. Pegar esa URL en:
   - `revistatds-admin/.env` → `PUBLIC_APPS_SCRIPT_URL`
   - `revistatds/assets/js/enviar.js` y `enviar-docentes.js` → `APPS_SCRIPT_URL` (checklist #7)

## Contrato `envio` (compatible con el sitio)

POST JSON (`Content-Type: text/plain`) a `/exec`:

```json
{
  "nombre": "...", "edad": "13 a 17", "email": "...",
  "genero": "...", "escuela": "...", "nombrePublicacion": "...",
  "titulo": "...", "descripcion": "...",
  "archivos": [{ "fileName": "...", "fileData": "<base64>", "mimeType": "..." }],
  "adultoNombre": "...", "adultoEmail": "...", "adultoTel": "..."
}
```

Formulario docente agrega `"tipo": "docente"` y no manda `edad`/`genero`/adulto.
`categoria` no viene del formulario (H2) → nace "Sin clasificar".

Respuesta: `{ "status": "ok" | "error", ... }`.

## Endpoints del panel (POST a `/exec`, con `action` + `idToken` en el body)

| `action` en body | Auth | Devuelve |
|---|---|---|
| `panel/auth/whoami` | idToken | `{ status, email, rol, nombre }` |
| `panel/board/list` | idToken | `{ status, producciones: [...] }` (el EDITOR no recibe los `RECIBIDO`) |
| `panel/board/aprobar` | idToken + gestor | pasa `ESPERANDO_APROBACIÓN` → `APROBADO` |
| `panel/board/pedir-correcciones` | idToken + editor titular | marca `CORRECCIONES_SOLICITADAS` **sin enviar mail** (avisa al equipo) |
| `panel/board/enviar-correcciones` | idToken + gestor | envía al autor el `fileId` (→ PDF) + `mensaje`, genera token, estado `CORRECCIONES_SOLICITADAS` |
| `panel/board/consultar-autor` | idToken + gestor | envía al autor el `fileId` (→ PDF) para aprobación, genera token, estado `CONSULTA_AUTOR` |
| `panel/board/cambiar-estado` | idToken + COORDINADOR/WEBMASTER | cambia el estado a cualquiera de `ESTADOS` (control administrativo) |
| `panel/board/cambiar-edicion` | idToken + gestor | reasigna la edición de un envío (mueve también su carpeta a `RECIBIDOS` de la edición nueva) |
| `panel/board/archivos` | idToken + gestor | lista los archivos de la carpeta de la producción (recursivo) para el selector |
| `panel/board/marcar-publicable` | idToken + COORDINADOR/WEBMASTER | unifica "publicable" = "publicado": copia el `fileId` (si `url_publicable` vacío) a `PUBLICABLES/<id>-<nombre>`, guarda `url_publicable` y pasa el estado a `PUBLICADO` |
| `panel/board/borrar` | idToken + COORDINADOR/WEBMASTER | elimina el envío por completo (carpeta de Drive, copia en PUBLICABLES, fila del Tablero e historial) |
| `panel/ediciones/list` | idToken + COORDINADOR/WEBMASTER | lista de ediciones (con `fecha_apertura`/`fecha_cierre`) |
| `panel/ediciones/abrir` | idToken + COORDINADOR/WEBMASTER | abre nueva edición con `fecha_apertura` (nace sin fecha de cierre) |
| `panel/ediciones/cerrar` | idToken + COORDINADOR/WEBMASTER | cierra edición con `fecha_cierre` elegida |
| `panel/ediciones/editar-cierre` | idToken + COORDINADOR/WEBMASTER | modifica la `fecha_cierre` o reabre la edición (sin superponerse con otra) |
| `panel/agenda/list` | idToken | citas del mes (fecha/hora y `hora_fin` normalizadas, contador de comentarios) |
| `panel/agenda/detalle` | idToken | cita + hilo de comentarios |
| `panel/agenda/crear` | idToken | crea cita (con `notificar` opcional → mail a roles activos) |
| `panel/agenda/comentar` | idToken | agrega comentario al hilo |
| `panel/agenda/editar` | idToken + COORDINADOR/WEBMASTER | edita cita |
| `panel/agenda/borrar` | idToken + COORDINADOR/WEBMASTER | borra cita y sus comentarios |
| `panel/users/list` | idToken + COORDINADOR/SUPERVISOR/WEBMASTER | `{ status, users: [...], puede_editar }` |
| `panel/users/save` | idToken + COORDINADOR/WEBMASTER | alta/edición de una fila de `Roles` |
| `panel/config/list` | idToken + COORDINADOR/SUPERVISOR | valores no secretos de `Config` |
| `panel/config/save` | idToken + COORDINADOR/SUPERVISOR | actualiza un valor permitido de `Config` |
| `panel/analytics/daily` | idToken + COORDINADOR/SUPERVISOR | serie de visitas por día desde Cloudflare |
| `descarga` | pública (anónima) | registra un clic de leer/descargar una edición PDF |
| `panel/descargas/list` | idToken + COORDINADOR/WEBMASTER/SUPERVISOR | totales y desglose por edición |

La consulta usa el dataset GraphQL soportado `httpRequestsAdaptiveGroups`,
filtrado por hostname y agrupado por hora. `snapshotAnalyticsYesterday()` guarda
una fila diaria en la hoja `Analiticas`, por lo que el panel puede conservar un
histórico indefinido mientras exista espacio en Sheets. Ejecutar una vez
`snapshotAnalyticsLastDays()` para recuperar los días aún disponibles y luego
`setupAnalyticsTrigger()` para instalar el trigger diario. Configurar en Script Properties
`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ZONE_TAG` (el ID de zona del dominio).
El trigger requiere el scope `https://www.googleapis.com/auth/script.scriptapp`.

## Keep-warm y caché

- `setupKeepAliveTrigger()` instala un trigger cada 5 minutos a `keepAlive()` para
  evitar el cold start de Apps Script.
- `CacheService` cachea Config (10 min), Usuarios (60 s), Tablero (30 s, invalidado
  en cada mutación) y analíticas/descargas (5 min, invalidados al registrar datos).
- Las funciones de limpieza invalidan por período:
  `clearAnalyticsCache()` y `clearDescargasCache()`.

## Recordatorios, digest y tokens vencidos (Fase 5)

- `setupRemindersTrigger()` instala un trigger diario 09:00 a `runDailyReminders()`.
- **Frecuencia configurable por rol y tipo** desde Configuración (`frec_*`): cada
  combo (recordatorio→EDITOR, digest→COORDINADOR, digest→SUPERVISOR,
  tokens→COORDINADOR, tokens→SUPERVISOR) tiene intervalo en días (1-30) + día de
  la semana (0=domingo…6=sábado). Regla: pasa el intervalo → y si el intervalo es
  > 1, además debe ser el día configurado; con intervalo 1 se envía todos los días.
- El último envío de cada combo se guarda en Script Properties (`last_sent_*`);
  el primer envío ocurre al día siguiente de instalar el trigger.
- Contenidos:
  - **Recordatorio a editores**: `EN_REVISIÓN` inactiva ≥ `recordatorio_editores_dias` (default 3).
  - **Digest**: recibidos, en revisión por editor, correcciones sin enviar, en
    aprobación, rechazados, aprobados/publicables de la semana.
  - **Tokens vencidos**: estados `CORRECCIONES_SOLICITADAS`/`CONSULTA_AUTOR` con
    token enviado y vencido; registra `ALERTA_TOKEN_VENCIDO` en `Historial` (trazabilidad).
- Claves de `Config`: `recordatorio_editores_dias`, `frec_*`,
  `mail_subject_recordatorio|digest|token_vencido` y `mail_body_*` (texto interior
  editable, Opción A — el wrapper TDS queda en código).

## Descargas de ediciones

- `descarga` (público): registra `{ archivo, accion (leer|descargar) }` en la hoja `Descargas`.
- `panel/descargas/list`: totales por edición y desglose por acción (COORDINADOR/WEBMASTER/SUPERVISOR).
- El sitio público agrega un tracker aditivo en `assets/js/app.js` que no interfiere con el circuito de envíos.
El token es secreto y no debe guardarse en el repositorio ni en la hoja `Config`.

## Endpoints del autor (POST a `/exec`, con `action` + `token` en el body)

| `action` en body | Consume token | Devuelve |
|---|---|---|
| `autor/estado` | no | `{ status, titulo, estado, version, historial }` |
| `autor/approve` | sí | `{ status, message, estado }` (CONSULTA_AUTOR → APROBADO) |
| `autor/reject` | sí | `{ status, message, estado }` (CONSULTA_AUTOR → RECHAZADO_POR_AUTOR, con `motivo`) |
| `autor/edit` | sí | `{ status, message, version, estado }` (sube versión → EN_REVISIÓN) |

### Mails del autor

- **Consulta de aprobación**: el coordinador **elige el archivo** de la carpeta de la producción (selector `panel/board/archivos`); el backend lo convierte a **PDF** (`convertirAPdf`: PDF → tal cual, Google nativo → `getAs`, Word/ODT/RTF/TXT → Advanced Drive Service, imágenes → tal cual) y lo adjunta, sin links de Drive ni docs editables. Tres botones iguales con colores TDS (**Aprobar** verde / **Modificar** naranja / **No aprobar** rojo) — token de un solo uso (la primera acción invalida el resto). El texto aclara que modificar requiere un **nuevo archivo**: adjuntándolo **respondiendo el correo** o como **nueva producción** por el formulario (botón a `enviar.html`).
- **Autor pide modificar** (`autor/edit` desde `CONSULTA_AUTOR`): `sendSolicitudModificacion` avisa a **editor asignado + COORDINADOR/SUPERVISOR** (sin WEBMASTER) para que se contacten y definan. Desde `CORRECCIONES_SOLICITADAS` solo avisa al editor (`sendNuevaVersion`).
- **Pedir correcciones** (dos pasos, contacto centralizado en gestores):
  1. El **editor** marca (`panel/board/pedir-correcciones`) → `CORRECCIONES_SOLICITADAS` sin mail ni token, y avisa al equipo.
  2. El **gestor** envía (`panel/board/enviar-correcciones`) eligiendo el archivo (→ PDF) + un **mensaje adicional** opcional → genera el token y manda el mail con el link de un solo uso para subir versión.
- **Confirmación de recibido**: primer link de seguimiento (token).

### Validación de archivos

El backend valida independientemente del navegador hasta 3 archivos por operación,
con un máximo de 10 MB por archivo. Se acepta cualquier formato, igual que el
formulario productivo actual; se normaliza el nombre y se rechaza base64 inválido.
Si falla el guardado de un archivo, se eliminan los archivos ya creados de esa
operación y no se avanza la versión ni el estado.

Los asuntos de mail se pueden editar desde Configuración. Admiten la variable
`{{titulo}}`; los cuerpos HTML siguen siendo plantillas controladas por código
hasta completar la siguiente etapa de parametrización.

## Estructura de Drive por ediciones

- `Tramas del Sur / EDICIONES / EDICION N° xx / { RECIBIDOS, PUBLICABLES }`.
- Cada envío vive en `RECIBIDOS/<id>/` (carpeta de trabajo: original, `correccion/`,
  `v2…`, `version_aprobada/`). Sin edición abierta, se guarda en `RECIBIDOS` de la
  última edición (aunque esté cerrada); si no hay ninguna, en `SIN_EDICION`.
- "Marcar publicable" es la única acción para publicar: copia el archivo elegido a
  `PUBLICABLES/<id>-<nombre>` (sueltos) y deja la producción en estado `PUBLICADO`
  (se muestra "Publicable"). El estado `PUBLICADO` siempre implica publicable.
- El nombre de edición lleva cero a la izquierda (`EDICION N° 03`) para ordenar bien.
- Migración única `migrateEstructuraDrive()`: mueve la carpeta legacy `Cuentos/<id>` → `RECIBIDOS/<edicion>`.
- **Etiquetado por fecha**: `edicionDestino()` asigna el envío a la edición cuyo rango
  apertura–cierre contiene hoy (abierta → última → `SIN_EDICION` como fallback).

## Notificaciones (WEBMASTER excluido)

WEBMASTER conserva todos los permisos de edición, pero **no recibe mails**: las
notificaciones al equipo usan `ROLES_NOTIF_GESTORES`/`ROLES_NOTIF_INTERNOS`
(COORDINADOR + SUPERVISOR, + EDITOR), sin WEBMASTER.

Nota importante: el routing se hace por el campo `action` del body (NO por path,
p. ej. `/exec/panel/auth/whoami`), porque agregar path a la URL de GAS rompe CORS
(la respuesta pierde `Access-Control-Allow-Origin`). El ID token viaja en el body
(`idToken`), no en header `Authorization`, por la misma razón (evita preflight).

## Alternativa con clasp

```bash
npm i -g @google/clasp
clasp login
clasp clone <scriptId>       # o clasp create --type webapp --title PanelTDS
# copiar los .gs + appsscript.json acá
clasp push
clasp open
```
