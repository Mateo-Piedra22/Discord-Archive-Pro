# Seguridad

Este documento describe qué protege la aplicación, de qué, y qué queda
explícitamente fuera de su alcance. Si vas a modificar la capa de Electron,
léelo antes: casi todas las decisiones raras del código están aquí justificadas.

---

## Modelo de amenaza

**Qué protegemos**

1. El **token de Discord** del usuario (equivale a su cuenta).
2. Los **archivos descargados**: pueden contener HTML, SVG o adjuntos de terceros.
3. El **resto del disco**: la app no debe poder leer nada fuera de su carpeta de salida.
4. La **privacidad**: no debe salir ningún dato a un servidor que no sea Discord.

**De quién nos protegemos**

- De contenido malicioso dentro de un archivo archivado (HTML con `<script>`,
  SVG con eventos, enlaces `file://`).
- De un renderer comprometido (XSS en contenido renderizado) que intente escalar
  a Node o al disco.
- De nosotros mismos: un bug de validación de rutas que permita `..`.

**Fuera de alcance**

- Un atacante con acceso físico a la sesión de Windows del usuario: puede leer el
  token igual que la app.
- Discord Inc. o el propio cliente oficial.
- Malware ya presente en la máquina.

---

## Controles implementados

### 1. Aislamiento del renderer

| Opción | Valor | Motivo |
|---|---|---|
| `nodeIntegration` | `false` | El renderer no tiene `require`. |
| `contextIsolation` | `true` | El preload corre en un mundo aislado. |
| `sandbox` | `true` | El preload no tiene Node, solo `contextBridge` + `ipcRenderer`. |
| `webSecurity` | `true` | Sin excepciones de same-origin. |
| `spellcheck` | `false` | Evita servicios de diccionario externos. |

El preload expone **una sola superficie**: `window.api`, tipada en
`src/shared/api.ts`. No hay `ipcRenderer` accesible desde la página.

### 2. Archivos locales: protocolo `archive://`

No se usa `file://` ni se desactiva `webSecurity`. El main registra un esquema
privilegiado propio:

```
archive://local/<ruta absoluta codificada>
```

El handler:

1. Decodifica la ruta tras `archive://local/`.
2. Comprueba `await isInsideRealAsync(outputDirectory, ruta)` (`src/main/path-guard.ts`),
   que resuelve los enlaces simbólicos mediante `fs.promises.realpath` (cacheando el
   `realpath` de la carpeta raíz con TTL acotado) y rechaza `..`, rutas absolutas ajenas,
   prefijos engañosos (`C:/archivo-secreto` cuando la raíz es `C:/archivo`) y symlinks
   que apunten fuera de la carpeta de salida devolviendo **HTTP 403**.
3. Comprueba con `fs.promises.stat` que el recurso exista y sea un archivo regular (404
   en caso contrario).
4. Sirve el contenido con `net.fetch(pathToFileURL(...).href)`.
5. Añade una **CSP estricta** a la respuesta:
   `default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' archive:`.

`archive:read-file` (lectura asíncrona mediante `fs.promises.open` con tope de 4 MB)
valida igualmente con `await isInsideRealAsync(outputDirectory, ruta)`, mientras que
`archive:scan-directory` valida con `isInsideReal` y omite explícitamente
`entry.isSymbolicLink()`. `folder:open` y `folder:reveal` validan que el destino
coincida con la raíz de salida o pase `isInsideReal(outputDirectory, ruta)` (y la app
nunca invoca `shell.openPath` de forma automática al finalizar descargas: las abre en el
visor integrado).

Los tests de `src/main/path-guard.test.ts` fijan el comportamiento de `isInside`,
`isInsideReal`, `isInsideRealAsync` y `clearRealpathCache`.

### 3. Contenido archivado

- **HTML**: se muestra en `<iframe sandbox="">` (sin scripts ni same-origin) con
  `referrerPolicy="no-referrer"` y la CSP de `archive://`. El HTML exportado por Estrato
  funciona además **sin JavaScript**: el cambio de tema es un checkbox con selector CSS.
- **Markdown**: `react-markdown` con `remark-gfm` y `rehype-raw` **no** ejecuta scripts
  (la CSP de producción bloquea scripts inline/externos); las rutas relativas de medios
  se reescriben a `archive://`.
- **JSON**: se analiza con `JSON.parse` estándar sobre texto local (límite de lectura de
  4 MB en `archive:read-file`), sin `eval` ni inyección dinámica; la **Vista tarjetas**
  (`extractJsonThreadMessages`) proyecta campos de texto como nodos React escapados.
- **CSV**: `JsonExporter.exportCsv` (`src/core/export/json-exporter.ts`) neutraliza prefijos
  peligrosos (`=`, `+`, `@`, `\t` y `-` no numérico) mediante `sanitizeCsvFormula` con
  comillas RFC 4180 y BOM UTF-8; la copia CSV del historial en `DownloadsView.tsx` y el
  botón **Copiar vista filtrada** en `ArchiveViewer.tsx` (`formatCsvRows`) escapan
  campos según RFC 4180. El visor tabular integrado procesa el CSV en memoria como texto
  plano sin ejecutar fórmulas ni HTML.
- **Activos SVG e invariantes Electron auditados**: `scripts/verify-release.mjs`
  ejecuta `validateElectronSecurityConfig` sobre `src/main/index.ts` (exigiendo
  `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` y `webSecurity: true`,
  y bloqueando configuraciones inseguras) y `validateSvgContent` sobre
  `resources/logo-mark.svg` y `resources/logo-banner.svg` en cada ejecución de
  `npm run verify:release` y en CI/CD, rechazando cualquier etiqueta `<script>`,
  atributos de evento `on*=`, URI `javascript:` o referencias `http://` / `https://`
  ajenas a los namespaces estándar XML (`http://www.w3.org/2000/svg`,
  `http://www.w3.org/1999/xlink`, `http://www.w3.org/XML/1998/namespace`).

### 4. CSP de la ventana (producción)

En builds empaquetados, `session.defaultSession.webRequest.onHeadersReceived`
inyecta:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net archive:;
font-src 'self' data:;
media-src 'self' archive: https://cdn.discordapp.com https://media.discordapp.net;
connect-src 'self' https://discord.com;
frame-src archive:;
object-src 'none';
base-uri 'none'
```

En desarrollo se omite porque Vite necesita scripts inline y el websocket de HMR.

> La versión anterior cargaba tipografías desde `fonts.googleapis.com`. Se eliminó:
> era una petición externa en una app que se presenta como local.

### 5. Navegación y permisos

- `setWindowOpenHandler` → **deniega** toda ventana nueva.
- `will-navigate` → bloquea cualquier navegación fuera de la propia app.
- `will-attach-webview` → bloqueado.
- `setPermissionRequestHandler` / `setPermissionCheckHandler` → **deniegan** cámara,
  micrófono, geolocalización, portapapeles, notificaciones web, etc.
- `setAppUserModelId` para que las notificaciones nativas se agrupen correctamente.
- Los enlaces del visor en vivo y de los embeds no navegan el renderer: se pasan a
  `app:open-external`, que solo admite destinos permitidos en lista blanca (apartado 9).

### 6. Token

- Se guarda cifrado con `safeStorage` (DPAPI en Windows) en `data/preferences.json`
  con el prefijo `dpapi:`. Si el sistema no ofrece cifrado, se usa `plain:` y así
  queda registrado en el archivo (no se finge que está cifrado).
- El renderer **nunca** recibe el token: se eliminó el canal `auth:get-token`.
- Se valida contra `https://discord.com/api/v10/users/@me` antes de aceptarlo.
- Si el token caduca, la app lo borra en lugar de reintentar en bucle.

### 7. Detección automática de sesión

Es la función más invasiva del producto, así que conviene ser explícito:

- Solo lee `Local State` y `Local Storage/leveldb` de Discord y de perfiles de
  navegador conocidos.
- Descifra la clave con **DPAPI del usuario actual** (no hay elevación ni bypass).
- No escribe nada en esas carpetas; los archivos bloqueados se copian a un temporal
  que se borra inmediatamente.
- No envía el token a ningún sitio salvo `discord.com` para validarlo.
- Si encuentra cifrado `v20` (App-Bound Encryption), **no intenta romperlo**: lo
  reporta como no soportado.

### 8. IPC endurecido

- `settings:save-all` aplica una **whitelist** de claves; el renderer no puede
  escribir `encryptedToken` ni claves arbitrarias.
- `cache:clear` se rechaza si hay descargas activas.
- No existe ningún canal que acepte una ruta y devuelva contenido fuera del
  directorio de salida.
- `app:get-stats`, `app:get-perf-stats`, `app:optimize-memory` y
  `cache:verify-integrity` no aceptan rutas del renderer: el proceso principal consulta
  únicamente `estrato.db`, el estado en memoria y la carpeta `outputDir()` configurada.

### 9. Lectura en vivo, búsqueda y enlaces

**El visor en vivo solo lee.** `discord:get-message-page` termina en
`GET /channels/{id}/messages`. No escribe en disco, no encola descargas y no toca la
caché: lo único que persiste es lo que ya estaba archivado.

**La búsqueda no acepta rutas.** `archive:search` recibe solo la consulta y el límite;
la raíz la fija el main (`outputDir()`), nunca el renderer. Recorre `.md`, `.txt`,
`.html`, `.htm`, `.json`, `.csv`, `.log`, `.xml`, `.yml`, `.yaml`, `.sql`, `.css`,
`.js`, `.ts`, `.py`, `.sh`, `.ini` y `.toml` (incluyendo archivos de texto, código y
datos dentro de `assets/`), omite `entry.isSymbolicLink()` y los directorios ocultos
(`.`), y corta a 4 000 archivos, profundidad 12 y 2 MB por archivo (máximo 8
coincidencias por archivo). Los resultados incluyen la ruta absoluta del archivo para que
la interfaz pueda abrirlo en el visor integrado (`archive:read-file` / `archive://`) o
pedir `folder:reveal`, ambos validados contra `outputDir()`.

**Los enlaces externos van por lista blanca.** `app:open-external` valida cada URL con
`new URL(url)` en `src/main/index.ts` y solo abre el esquema `discord:` o URLs `https:`
cuyo `hostname` pertenezca exactamente al conjunto `hostsPermitidos`:

```
discord://…
https://discord.com/…
https://discordapp.com/…
https://ptb.discord.com/…
https://canary.discord.com/…
https://www.youtube.com/…
https://youtube.com/…
https://youtu.be/…
https://vimeo.com/…
https://player.vimeo.com/…
```

YouTube y Vimeo se incluyen porque sus reproductores embebidos rechazan el origen
`file://` de Electron y deben abrirse en el navegador del sistema. Al validar el
`hostname` exacto de `new URL(url)`, un host como `https://discord.com.evil.tld`, un
esquema `http://` sin TLS o un `javascript:` quedan bloqueados (`false`).

---

## Riesgos residuales

| Riesgo | Estado | Comentario |
|---|---|---|
| El token está en memoria del proceso main | Aceptado | Necesario para firmar peticiones. |
| `safeStorage` sin cifrado disponible | Mitigado | Se marca `plain:` y se avisa en la UI. |
| Un adjunto descargado puede ser malware | Aceptado | No se ejecuta nada; se abre con la app del sistema bajo decisión del usuario. |
| Rate limiting agresivo puede parecer un bloqueo | Aceptado | Preferible a que Discord banee la cuenta. |
| `rehype-raw` permite HTML en Markdown | Mitigado | No ejecuta scripts; la CSP bloquea recursos externos. |
| Un enlace simbólico dentro del archivo puede apuntar fuera | Mitigado | `isInsideReal` e `isInsideRealAsync` resuelven `realpath` en `archive://`, lectura y carpetas (devolviendo `403` si escapa de la raíz); escaneo y búsqueda omiten `isSymbolicLink()`. |

---

## Buenas prácticas para contribuir

1. **Nunca** añadas un canal IPC que acepte una ruta sin validarla con `isInside`,
   `isInsideReal` o `isInsideRealAsync` (`src/main/path-guard.ts`).
2. **Nunca** desactives `webSecurity`, `sandbox` o `contextIsolation` "temporalmente".
3. Si necesitas mostrar contenido externo o HTML archivado, hazlo en un `<iframe sandbox="">`.
4. No añadas recursos remotos (fuentes, scripts, CDN) al renderer.
5. Cualquier cambio en `path-guard.ts` requiere actualizar `src/main/path-guard.test.ts`.
6. No amplíes `hostsPermitidos` en `app:open-external` sin una razón documentada:
   es la única vía por la que la app abre destinos externos.
7. Los comentarios y los textos de interfaz van **en español**.

---

## Reportar un problema

Consulta la política completa de reporte responsable en [SECURITY.md](../SECURITY.md) o
usa la plantilla [bug_report.md](../.github/ISSUE_TEMPLATE/bug_report.md) indicando versión,
sistema operativo, pasos para reproducir e impacto. **Nunca** adjuntes tokens reales,
`data/preferences.json`, `data/estrato.db` ni exportaciones privadas.
