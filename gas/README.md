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
| `appsscript.json` | Manifest: scopes + webapp (executeAs `USER_DEPLOYING`, access `ANYONE_ANONYMOUS`) |

## Puesta en marcha (manual, sin clasp)

1. Ir a https://script.google.com → **Nuevo proyecto** (renombrar a `PanelTDS`).
2. Borrar el `myFunction` de ejemplo y crear un archivo por cada `.gs` de acá,
   pegando el contenido (los nombres de archivo no importan para la ejecución:
   Apps Script comparte el scope global entre archivos).
3. En **Configuración del proyecto** → activar "Mostrar `appsscript.json`" y pegar
   el manifest (o dejar que se genere y ajustar `webapp`/scopes).
4. **Ejecutar `setup()` una vez** (autorizar los permisos):
   - crea el Spreadsheet `PanelTDS` con las hojas `Roles`, `Tablero`, `Historial`, `Config`;
   - siembra `Config` y los roles iniciales (ADMINISTRADOR + emisor).
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
| `panel/board/list` | idToken | `{ status, cuentos: [...] }` |
| `panel/users/list` | idToken + ADMIN/SUPERVISOR | `{ status, users: [...], puede_editar }` |
| `panel/users/save` | idToken + ADMIN | alta/edición de una fila de `Roles` |
| `panel/config/list` | idToken + ADMIN/SUPERVISOR | valores no secretos de `Config` |
| `panel/config/save` | idToken + ADMIN/SUPERVISOR | actualiza un valor permitido de `Config` |

## Endpoints del autor (POST a `/exec`, con `action` + `token` en el body)

| `action` en body | Consume token | Devuelve |
|---|---|---|
| `autor/estado` | no | `{ status, titulo, estado, version, historial }` |
| `autor/approve` | sí | `{ status, message, estado }` (CONSULTA_AUTOR → APROBADO) |
| `autor/reject` | sí | `{ status, message, estado }` (CONSULTA_AUTOR → RECHAZADO_POR_AUTOR, con `motivo`) |
| `autor/edit` | sí | `{ status, message, version, estado }` (sube versión → EN_REVISIÓN) |

### Validación de archivos

El backend valida independientemente del navegador hasta 3 archivos por operación,
con un máximo de 10 MB por archivo. Se acepta cualquier formato, igual que el
formulario productivo actual; se normaliza el nombre y se rechaza base64 inválido.
Si falla el guardado de un archivo, se eliminan los archivos ya creados de esa
operación y no se avanza la versión ni el estado.

Los asuntos de mail se pueden editar desde Configuración. Admiten la variable
`{{titulo}}`; los cuerpos HTML siguen siendo plantillas controladas por código
hasta completar la siguiente etapa de parametrización.

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
