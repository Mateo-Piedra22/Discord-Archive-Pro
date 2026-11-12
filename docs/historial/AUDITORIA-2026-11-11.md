> Documento histórico. El producto se llamaba «Discord Archive Pro» en el momento de escribirse; hoy es **Estrato**.

# Auditoría completa — Discord Archive Pro

**Fecha:** 2026-11-11
**Alcance:** 12.069 líneas (10.944 TS/TSX + 1.125 CSS), 43 archivos, 7 capas.
**Método:** lectura completa del árbol + ejecución real de `npm install`, `tsc --noEmit` (ambos proyectos), `vitest run` y `electron-vite build`.
**Modo:** auditoría de correctitud + `ponytail-audit` (sobreingeniería). No se aplicó ningún cambio de código.

---

## Veredicto en una línea

El código **compila** y los tipos pasan, pero el producto **no se puede instalar, no se puede empaquetar y no exporta lo que promete**: 6 fallos bloqueantes en cadena, ~40 bugs de correctitud y ~2.000 líneas de maquinaria que no hace nada. El README describe un producto distinto al que existe en `src/`.

| Capa | Estado | Bloqueantes |
|---|---|---|
| 0. Build / deps / packaging | 🔴 Roto | 3 |
| 1. Main process (Electron) | 🟠 Inestable | 4 |
| 2. Preload / IPC | 🟠 Incoherente | 3 |
| 3. Cliente Discord API | 🟠 Parcial | 4 |
| 4. Storage / caché / migraciones | 🔴 Roto | 3 |
| 5. Motor de descarga | 🔴 Roto | 7 |
| 6. Pipeline de export | 🔴 Roto | 8 |
| 7. Renderer (React) | 🟠 Parcial | 6 |

---

## CAPA 0 — Build, dependencias y empaquetado

### B1 🔴 `npm install` falla en un clon limpio (verificado)
```
npm error Could not resolve dependency:
npm error peer react@"^17.0.0 || ^16.3.0 || ^15.5.4" from react-json-view@1.21.3
```
`package.json:31` declara `react-json-view@^1.21.3` (abandonado desde 2021, peer React ≤17) junto a `react@^19`. **Ningún usuario puede instalar el proyecto** sin `--legacy-peer-deps` o `--force`. Consecuencia en cadena: el `postinstall` (`electron-builder install-app-deps`) nunca corre, así que `better-sqlite3` y `sharp` **nunca se reconstruyen contra el ABI de Electron** → al abrir la app: `NODE_MODULE_VERSION mismatch` y crash inmediato. Este es el motivo #1 de "no anda".
**Arreglo:** eliminar `react-json-view` (ver P3) o fijar React 18. Añadir `"engines"` y un lockfile coherente.

### B2 🔴 El empaquetado no puede completarse
`package.json:62` → `"icon": "resources/icon.ico"`, pero `resources/` solo contiene `icon.png`, `fonts/` y `screenshots/`. **No existe ningún `.ico`.** `electron-builder` aborta con "icon path does not exist".

### B3 🔴 La app empaquetada revienta al arrancar
`src/main/index.ts:277`
```ts
const localesPath = path.join(app.getAppPath(), 'locales')   // → app.asar/locales
if (!fs.existsSync(localesPath)) fs.mkdirSync(localesPath, { recursive: true })
```
`files: ["out/**/*", "resources/**/*"]` **excluye `locales/`** del paquete, y `app.getAppPath()` apunta dentro del `.asar`, que es de solo lectura. `mkdirSync` lanza, la promesa de `app.whenReady()` queda rechazada y **nunca se ejecutan `setupBackgroundCron()` ni la autodetección de token**. La ventana aparece, pero medio arranque no ocurrió.

### B4 🟠 Scripts documentados que no existen
README (líneas 204, 329) documenta `npm run dist` y `npm run lint`. En `package.json` no hay ninguno de los dos (`package` es el que empaqueta). No hay ESLint, Prettier ni CI.

### B5 🟠 Discrepancia de versiones documentada vs real
README: Electron 36 / React 18. Real: Electron `^34`, React `^19`. Los badges del README mienten.

---

## CAPA 1 — Main process

### B6 🔴 `webSecurity: false` + preload con lectura arbitraria de disco
`src/main/index.ts:125` desactiva la seguridad web "para ver archivos locales". Combinado con:
- `sandbox: false` (`:124`),
- IPC `archive:read-file` / `archive:read-binary-file` que aceptan **cualquier ruta absoluta** (`:708`, `:719`),
- `ArchiveViewer` renderizando HTML de terceros en un `<iframe sandbox="allow-same-origin allow-scripts allow-popups">` (`ArchiveViewer.tsx:561`),

cualquier HTML archivado con `<script>` puede leer `preferences.json` (token cifrado), `C:\Users\...` y exfiltrarlo. No hay CSP en `index.html`. Es una cadena de RCE local→exfiltración completa.
**Arreglo:** `webSecurity: true`, registrar un `protocol.handle('archive', ...)` para servir solo el directorio de salida, y quitar `allow-scripts` del iframe.

### B7 🔴 El cron de fondo martilla la API y miente
`src/main/index.ts:252-273`
- Cada 4 h pide 10 mensajes de **50 posts** (≈50 llamadas, ~25 s al ritmo del limitador) **aunque no haya cambios**.
- `newFiles++` cuenta *respuestas no vacías*, no posts nuevos → siempre >0 → notificación cada 4 h.
- `i18next.t('cron_body', 'texto ${newFiles}')`: la clave **existe** en `locales/es.json` con `{{count}}`, así que el segundo argumento se ignora y el usuario ve literalmente **"Se encontraron novedades en {{count}} posts."**
- `cron.schedule` nunca se detiene en `will-quit`.

### B8 🟠 `auth:auto-connected` se emite antes de que exista el renderer
`src/main/index.ts:70` hace `webContents.send(...)` inmediatamente después de `createMainWindow()`, con `show:false` y `loadURL` aún en vuelo. El mensaje se pierde siempre. Además `onAutoConnected` **no está suscrito en ningún sitio** (solo aparece en `preload:15` y `env.d.ts:9`): código muerto que simula una feature.

### B9 🟠 Zoom: tres escalas distintas para el mismo número
- `SettingsView.tsx:40-45`: clamp `-1 … 2`, guarda en `localStorage`.
- `SettingsView.tsx:250`: muestra `(1 + zoomLevel) * 100` → con `-1` muestra **"0%"**.
- `main/index.ts:611`: `setZoomLevel(level)` — en Electron `1` = 180 %, `2` = 300 %.
- `App.tsx:34`: restaura el valor crudo.

Resultado: la UI dice 0 % cuando está al 90 %, y 300 % cuando dice 300 %. Nada coincide.

### B10 🟠 Escaneo de archivos sincrónico y recursivo en el hilo principal
`src/main/index.ts:666-706`: `readdirSync` + `statSync` recursivo hasta 20 niveles, sin límite de entradas, ejecutado en el proceso main. En una carpeta de archivo con miles de ficheros congela la app entera (incluido el titlebar).

### B11 🟡 `alwaysOnTop` por defecto `true` en prefs pero la ventana se crea con `false`
`encrypted-store.ts:104` vs `index.ts:115`. El checkbox del tray siempre arranca desmarcado y la preferencia no se aplica.

### B12 🟡 Ventana guardada fuera de pantalla
`data/preferences.json` tiene `windowBounds: { x: -8, y: -8, width: 1936, height: 1096 }`. No hay validación contra los límites de los monitores; en multi-monitor desconectado la app abre invisible.

---

## CAPA 2 — Preload / IPC

### B13 🔴 El preload expone un canal que no existe
`preload/index.ts:92` → `settings.getOutputDir()` invoca `'settings:get-output-dir'`, que **no está registrado** en `setupIpcHandlers()`. Cualquier llamada rechaza con "No handler registered". Hoy nadie lo llama, pero es una mina.

### B14 🟠 Contrato IPC duplicado y desincronizado en 3 sitios
El mismo canal se describe tres veces, de tres formas distintas:
1. `preload/index.ts` (real),
2. `renderer/env.d.ts` (tipos a mano, `any` por todas partes),
3. `core/discord/types.ts:366-405` → `interface IpcChannels` que declara canales **que no existen** (`download:pause`, `export:get-options`, `cache:get-outdated`…). Nadie la usa. 40 líneas de documentación falsa.

### B15 🟠 `auth:get-token` devuelve el token en claro al renderer
`index.ts:330`. No se usa, pero deja el secreto a un `window.api.auth.getToken()` de distancia de cualquier XSS.

### B16 🟡 `settings:save-all` escribe claves arbitrarias sin validación
`index.ts:651-659`: `Object.keys(preferences).forEach(k => s.set(k as any, ...))`. Solo excluye `encryptedToken`. Cualquier clave inventada (`dateFormat`) se persiste pero **nunca se devuelve** en `getAllPreferences()` → ajuste fantasma (ver B33).

---

## CAPA 3 — Cliente Discord API

### B17 🔴 El limitador por ruta está muerto por un error de clave
```ts
// rate-limiter.ts:188-189
const bucketKey = bucket || route          // guarda con el HASH de Discord
this.routeBuckets.set(bucketKey, {...})

// rate-limiter.ts:105
const routeBucket = this.routeBuckets.get(request.route)   // busca por la ruta
```
Cuando Discord manda `x-ratelimit-bucket` (siempre), el mapa se indexa por hash y se consulta por nombre → **nunca hay match**. Todo el control de límites por endpoint es código muerto; solo funciona el throttle global de 2 req/s.

### B18 🔴 Los canales de voz se tratan como foros
`api-client.ts:189`: solo se exceptúan los tipos `[0,1,3,5]`. Un canal de voz (2), categoría (4) o stage (13) cae en `searchForumThreads()` → Discord devuelve 400/403 y el usuario ve un error genérico. `ExploreView` muestra canales de voz por defecto (`channelFilters.ts:47`), así que es un clic normal.

### B19 🔴 `channel_id` de los canales de texto se guarda como el ID de la **categoría**
`api-client.ts:195` construye el pseudo-thread con `parent_id: channel.parent_id` (la categoría). Luego `CacheManager.recordPostSync` escribe `channel_id: thread.parent_id` (`cache-manager.ts:226`). Consecuencia: `db.getCachedPostsByChannel(channelId)` devuelve **vacío** → el `_INDEX.md` de cualquier canal de texto sale sin filas y los posts nunca aparecen como "ya archivados".

### B20 🟠 Los reintentos ignoran el `retry_after` de Discord en errores no-429
`api-client.ts:420-432`: backoff ciego `2^attempt`. Los 429 los maneja el limitador, pero un 500 con `Retry-After` se reintenta antes de tiempo.

### B21 🟡 `getUserAvatarUrl` calcula el avatar por defecto mal
`api-client.ts:368`: `parseInt(userId) % 5` sobre un snowflake de 19 dígitos pierde precisión (fuera de `Number.MAX_SAFE_INTEGER`). Discord usa `(id >> 22) % 6`.

### B22 🟡 `downloadAttachment()` (api-client) no se usa
20 líneas que duplican la lógica de `FileDownloader` y pasan por el limitador. Nadie la llama.

### B23 🟡 Detección de token: `execSync` de PowerShell en el hilo principal
`token-detector.ts:200`: `powershell -EncodedCommand` **sincrónico**, timeout 15 s, por cada instalación de Discord **y cada navegador**. Escanea Chrome, Edge, Brave, Opera y Opera GX. Con 3 perfiles presentes, la UI se congela decenas de segundos al pulsar "Detectar sesiones". Además el regex `^[A-Za-z0-9+/=]+` sobre datos LevelDB binarios sobre-captura y genera candidatos basura.

---

## CAPA 4 — Storage, caché y migraciones

### B24 🔴 La migración v2 crea un índice FTS5 que no puede funcionar
`migrations.ts:109-134`
```sql
CREATE VIRTUAL TABLE search_index USING fts5(
  thread_id, message_id, author, content,
  content='cached_messages', content_rowid='rowid')
```
`cached_messages` **no tiene** columnas `author` ni `content` (tiene `author_id` y `content_hash`). Una tabla FTS5 con `content=` externo exige que las columnas existan en la tabla origen: cualquier `MATCH` falla. Peor: los triggers insertan `new.content_hash` en la columna `content` — se indexarían **hashes**, no texto. Y no hay ninguna función de búsqueda en toda la app: es 30 líneas de esquema roto para una feature inexistente.

### B25 🔴 `clearAllCache()` borra el archivo SQLite en caliente
`database.ts:474-490`: `closeDatabase()` → `unlinkSync(db)` → `initDatabase()`. Se invoca desde *Configuración → Purgar caché* **sin comprobar si hay descargas activas**. Si el `DownloadManager` está escribiendo, la siguiente query lanza `The database connection is not open` y las tareas quedan colgadas.

### B26 🟠 La cola persistente es de solo escritura
`download_queue` se llena en cada `addToQueue` (`download-manager.ts:112`), `resetStuckDownloads()` la marca `paused` al arrancar… y **nunca se vuelve a leer**: `getQueueItems()` tiene 1 sola referencia (su definición). Tras reiniciar, la pestaña Descargas está vacía y los registros se acumulan para siempre. `clearCompletedQueue()` también está muerta: `clearCompleted()` borra de memoria, no de SQLite.

### B27 🟠 `upsertCachedFile` relee el archivo entero para hashearlo
`download-manager.ts:342`: `CacheManager.computeFileHash(localPath)` = `fs.readFileSync` + SHA-256 **sincrónico**, justo después de haberlo descargado en streaming (donde ya se calculó el hash y se descartó). Un adjunto de 200 MB bloquea el main ~1 s. El hash ya está disponible en `FileDownloader.downloadFile()` y no se propaga.

### B28 🟡 `preferences.json` se reescribe sincrónicamente en cada píxel de arrastre
`index.ts:144-156` conecta `moved`/`resized` → `setWindowBounds` → `JsonStore.save()` → `writeFileSync` del JSON completo. Arrastrar la ventana = cientos de escrituras a disco.

### B29 🟡 El token puede perderse solo
`encrypted-store.ts:153-178`: si el token se guardó cuando `safeStorage` no estaba disponible (fallback base64), y en el siguiente arranque **sí** está disponible, `decryptString()` falla y `getToken()` devuelve `null`. El usuario tiene que volver a pegar el token sin explicación.

---

## CAPA 5 — Motor de descarga

### B30 🔴 Cancelar una descarga la marca como **completada**
```ts
// download-manager.ts:170-176
this.processTask(nextTask)
  .then(() => {
    nextTask.status = 'done'            // ← pisa 'cancelled'
    db.updateQueueStatus(parseInt(nextTask.id), 'done')
```
`cancelTask()` pone `status='cancelled'` (`:619`), `processTask` solo comprueba la cancelación **dentro del bucle de adjuntos** (`:277`). Si cancelas durante el fetch o durante la exportación, la promesa resuelve normal y el `.then` escribe `done` en memoria **y en la base de datos**. La UI muestra ✅ en una descarga que no generó ni un archivo.

### B31 🔴 El "delta sync" es una mentira: se calcula y se tira
```ts
// download-manager.ts:232-238
const cachedPost = db.getCachedPost(task.threadId)
const afterId = cachedPost?.last_message_id || undefined     // ← nunca se usa
const newMessages = await this.client.getAllThreadMessages(task.threadId, cb)
```
`afterId` es la única variable del archivo declarada y jamás leída. Cada descarga vuelve a pedir **la historia completa** del hilo, aunque no haya cambiado nada. Todo el aparato de `content_hash` / `metadata_hash` / `sync_status` de `CacheManager` se alimenta pero no se consulta: `quickCheck` y `deepCheck` tienen 1 y 0 usos respectivamente.

### B32 🔴 La barra de progreso nunca llega al 100 % y el ETA siempre es `--`
- `assetsTotal` cuenta **todos** los adjuntos (`:268-270`), incluidos los que el filtro de contenido salta con `continue` (`:286-288`) → el contador se queda corto para siempre.
- `bytesTotal` **no se asigna nunca** → `getEta()` calcula `0 - descargado` → devuelve 0 → la UI imprime `ETA: --` (`DownloadsView.tsx:316`).

### B33 🟠 La mitad de los ajustes no llegan al motor
| Ajuste (UI) | Persiste | Lo lee el motor |
|---|---|---|
| `preserveFilenames` | sí | **no** (siempre se renombra a hash, B35) |
| `maxFileSize` | sí | **no** (no hay comprobación de tamaño) |
| `dateFormat` | no (`getAllPreferences` no lo devuelve) | no |
| `folderStructure` | sí | **no** (`FolderBuilder` siempre `servidor/canal`) |
| `threadMode` | sí | **no** (`single/separate/both` se ignoran, B38) |
| `imageQuality` | sí | **no** |
| `syncMode` | sí | **no** |
| `contentSelection.text/embeds/metadata/customEmojis/stickers/avatars` | sí | **no** (solo `images`, `videos`, `files`, `replies`) |
| `maxConcurrent` al arrancar | sí | **no** (`concurrency: 2` hardcodeado, `index.ts:464`) |

9 de 10 toggles de "Filtros de contenido" y 6 de 8 ajustes avanzados son decorativos.

### B34 🟠 Pausar no pausa
`pauseAll()` solo pone `paused = true` (`:617`), que únicamente impide **arrancar** tareas nuevas. Las que están corriendo siguen descargando. `resumeAll()` reanuda la cola, pero las tareas "pausadas" nunca se marcaron como tales en la DB.

### B35 🔴 Todos los archivos se guardan con nombre = hash SHA-256
`file-downloader.ts:46`
```ts
let finalPath = path.join(targetDir, `${hash}${ext}`)
```
`sanitizeFilename()` se calcula en `:26` y **se usa solo para sacar la extensión**. El resultado es `assets/images/9f86d081884c7d65….png`. El usuario abre su archivo y no reconoce nada; `preserveFilenames` (activado por defecto) es mentira; y como no hay tabla de mapeo en el `.md`, buscar un archivo concreto es imposible.

### B36 🔴 Un hit de deduplicación inyecta una ruta absoluta de Windows en los exports
`deduplicator.ts:23` devuelve `cached.local_path`, que se guardó **absoluto** (`download-manager.ts:341`). Ese valor va a `assetMap` (`:294`) y de ahí al Markdown/HTML:
```md
![foto.png](C:\Users\mateo\OneDrive\Escritorio\...\assets\images\a1b2.png)
```
Enlace roto al mover la carpeta + filtra el nombre de usuario y la estructura de disco. El resto de rutas del `assetMap` son relativas (`./assets/...`), así que el mismo export mezcla dos convenciones.

### B37 🟠 Sin cancelación real ni `AbortSignal`
`FileDownloader.download()` no acepta señal de aborto. Cancelar una descarga de 500 MB no la detiene: hay que esperar a que termine (o matar la app), y el `.tmp` con UUID aleatorio queda huérfano en `assets/` si el proceso muere.

### B38 🟠 `threadMode` ignorado y rutas relativas rotas en `replies/`
`markdown-generator.ts:229` genera los archivos individuales **siempre** que haya >1 mensaje, sin mirar `threadMode`. Y `:266`:
```ts
if (localPath.startsWith('assets/')) localPath = '../' + localPath
```
Las rutas reales empiezan por `./assets/`, así que la condición **nunca** se cumple y los adjuntos de `replies/001_x.md` apuntan a `./assets/...` (que desde `replies/` no existe). Imágenes rotas en todas las respuestas.

### B39 🟡 Numeración de carpetas por conteo de directorios
`folder-builder.ts:46-50`: `num = existing.length + 1`. Con 2 descargas concurrentes en el mismo foro, ambas leen el mismo `length` → colisión → el sufijo `_2` desordena el archivo. Además ese número **no coincide** con el de `_INDEX.md`, que numera por índice de un `ORDER BY created_at DESC` (`index-generator.ts:61-63`).

---

## CAPA 6 — Pipeline de export

### B40 🔴 El PDF se genera en el hilo principal, mensaje a mensaje
`download-manager.ts:507-555`: un `for` sobre **todos** los mensajes con `drawText` por palabra, más `sharp` por imagen. Un hilo de 50.000 mensajes bloquea Electron durante minutos (sin ventana, sin cancelar, sin progreso). No hay streaming ni worker.

### B41 🔴 En la app empaquetada el PDF pierde todos los acentos
`download-manager.ts:416` busca la fuente en `process.resourcesPath/fonts/Roboto-Regular.ttf`, pero `package.json:74-79` copia `resources/` **dentro de** `resources/`, es decir a `<app>/resources/resources/fonts/`. La ruta no existe → `isCustomFontLoaded = false` → Helvetica → `cleanText()` convierte todo lo no-ASCII en `?` (`:445`). Un archivo de Discord en español sale lleno de `?`. Y si el mensaje contiene `📎` (que el propio código escribe en `:488`), `drawText` con Helvetica lanza `WinAnsi cannot encode` → el `catch` externo se traga el error → **el PDF no se crea y el usuario no se entera**.

### B42 🟠 El HTML exportado promete "self-contained" y no lo es
`html-generator.ts:245` enlaza avatares a `https://cdn.discordapp.com/...`; `markdown-parser.ts:188,271,290` hace lo mismo con emojis, reacciones y stickers. Sin internet, el archivo se ve sin caras ni emojis. Los stickers y emojis personalizados **nunca se descargan** (`assetMap` no los contempla).

### B43 🟠 El botón de tema del HTML exportado no hace nada
`html-generator.ts:193` alterna `body.classList('light')`, pero los colores claros solo existen dentro de `@media (prefers-color-scheme: light)` (`:189`). Si tu SO está en oscuro, el botón es decorativo.

### B44 🟠 Conversión de Markdown a HTML por regex después de escapar
`html-generator.ts:248-255`: `*texto*` → `<em>` se aplica sobre el contenido ya escapado, así que cualquier `*` (viñetas, multiplicaciones, `**` anidados) se convierte en cursivas. No hay soporte de listas, encabezados, enlaces, bloques de código ni citas. El `.html` "fiel a Discord" es en realidad texto plano con negritas.

### B45 🟠 El EPUB inyecta el contenido sin escapar
`download-manager.ts:568`: `` `<p><b>${m.author.username}</b>: ${m.content}</p>` `` — sin `escapeHtml`. Un mensaje con `<script>` o simplemente `<` rompe el XHTML y el lector rechaza el libro. Además se ignora todo el Markdown ya parseado.

### B46 🟠 `_INDEX.md` se reescribe desde N tareas concurrentes
`download-manager.ts:574-577`: cada tarea terminada regenera el índice leyendo la tabla completa (`getCachedPostsByChannel`) y escribiendo el mismo archivo. O(n²) de lecturas y *last-writer-wins* sobre el archivo. Si el formato elegido no incluye Markdown, el índice enlaza a `post.md` inexistentes.

### B47 🟡 Los tags del frontmatter son IDs numéricos
`markdown-generator.ts:41`: `tags: ["1234567890"]` porque `thread.applied_tags` son IDs. Los nombres ya están disponibles en `post.tags`, pero `download-manager` los descarta al encolar (`:111` solo usa `thread`).

### B48 🟡 `formatDate` pierde la hora
`markdown-generator.ts:327`: `toLocaleDateString('es-ES', { hour, minute })` — `toLocaleDateString` **ignora** `hour`/`minute`. Todas las fechas del Markdown salen sin hora aunque el código lo pida.

### B49 🟡 El JSON se llama `metadata.json`, no `post.json`
`json-exporter.ts:89`. El README (línea 273) y la estructura documentada dicen `post.json`. Cualquier script del usuario que siga la documentación falla.

---

## CAPA 7 — Renderer

### B50 🔴 El historial de descargas es inalcanzable
`DownloadsView.tsx:76`
```tsx
if (queue.length === 0) { return <EmptyState/> }
```
El botón **Historial** está en la toolbar (`:136`), que se renderiza *después* de ese `return`. Y la cola arranca vacía en cada sesión (B26). Conclusión: la única forma de ver el historial es tener descargas activas en ese mismo momento. Feature muerta en la práctica.

### B51 🟠 El texto de estado de cada descarga es invisible
`DownloadsView.tsx:275`: `color: \`var(--status-${task.status})\``. Las variables `--status-done`, `--status-error`, `--status-queued`, `--status-downloading` **no existen** en `variables.css` (verificado). `color` queda inválido → hereda; en varios estados el texto desaparece sobre el fondo.

### B52 🟠 La primera descarga se guarda en la carpeta equivocada
`downloadStore.ts:112-133`
```ts
const state = get()                     // outputDir = ''
if (!state.outputDir) { await get().pickDirectory(); if (!get().outputDir) return }
const exportOptions = { outputDir: state.outputDir, ... }   // ← sigue ''
```
`state` es una foto anterior al `pickDirectory()`. Si el usuario elige carpeta en ese diálogo, el motor recibe `outputDir: ''` y `FolderBuilder` escribe en `process.cwd()` (la carpeta de la app). El archivo aparece "en ningún sitio".

### B53 🟠 Listeners IPC duplicados en desarrollo
`main.tsx:7` envuelve todo en `React.StrictMode`, y `App.tsx:31` llama `initListeners()` sin cleanup. En dev cada evento (`queue-updated`, `task-progress`…) se procesa dos veces, y `onForumPostsProgress` acumula suscripciones. `initListeners` no devuelve función de desuscripción.

### B54 🟠 Fugas de `file://` sin escapar
`ArchiveViewer.tsx:309, 535, 621, 649, 675`: `file://${path}` sin `encodeURI`. Con rutas que contengan espacios (por ejemplo `…\Discord Archive Pro\…` o el `outputDirectory` real `…\Descargas GUIAS`) el `<img>`, el `<iframe>` del PDF y el del HTML **no cargan**. Es el bug clásico de "las imágenes no se ven".

### B55 🟠 El visor de PDF/EPUB depende de un CDN
`ArchiveViewer.tsx:20` configura el worker de `pdfjs-dist` contra `cdnjs.cloudflare.com`… y **`pdfjsLib` no se usa en ningún sitio** (`PdfViewer` usa un `<iframe>`). Dependencia de 5 MB + petición externa + versión del CDN (3.11) distinta de la instalada (5.x), todo para nada.

### B56 🟡 El visor de JSON se rompe con archivos grandes
`index.ts:713` trunca la lectura a 100.000 caracteres. `JsonViewer` intenta `JSON.parse` de un JSON truncado → falla → cae al resaltador de sintaxis. Un `metadata.json` de un hilo largo nunca se ve como árbol.

### B57 🟡 `HtmlPreview` ignora su propio prop
`ArchiveViewer.tsx:532`: `function HtmlPreview({ path }: { content: string; path: string })` — recibe `content` y no lo usa. Se carga el archivo por `file://` en lugar de inyectar el contenido ya leído.

### B58 🟡 Filtros de canal que ocultan cosas sin avisar
`channelFilters.ts:123-135`: con `strictChannelFiltering` (activo por defecto) se ocultan canales cuyo nombre contenga `ticket-`, `log-`, `admin`, `staff`, `bot-`, `mod-`, `test`, `audit-`. Un `#testing-ground` o un `#mod-log` simplemente no aparecen y el usuario cree que la app no los detecta.

### B59 🟡 `useMemo` con dependencias incompletas
`ExploreView.tsx:97-106`: `displayedChannels` no depende de `restrictedChannels` ni de `strictChannelFiltering`. Al marcar un canal como restringido (403), la lista **no se actualiza** hasta cambiar de servidor.

### B60 🟡 "Seleccionar todos" miente
`PostList.tsx:479-485`: la etiqueta muestra `"N seleccionados"` pero el `onClick` **siempre selecciona todos**, nunca deselecciona (la condición para deseleccionar compara contra `filtered.length`).

### B61 🟡 `showToast` antes del montaje se pierde en silencio
`Toast.tsx:37`: si `globalAddToast` es `null` (stores, llamadas tempranas), el aviso desaparece sin rastro. Los errores de `startDownload` (`downloadStore.ts:144`) caen aquí.

---

## Over-engineering (`ponytail-audit`)

Formato: `<tag> qué cortar. reemplazo. [ruta]`

```
delete: react-json-view + su visor (48 líneas + 1 dep rota). <pre>{JSON.stringify}</pre> con resaltado. [ArchiveViewer.tsx:17,567-617, package.json:31]
delete: pdfjs-dist import + worker CDN (5 líneas, 1 dep, 1 petición externa). Nada: no se usa. [ArchiveViewer.tsx:10,20]
delete: dompurify + @types/dompurify (1 línea, 2 deps). Nada: no se usa. [ArchiveViewer.tsx:8]
delete: i18next + setupI18n + locales/ + 2 handlers IPC (~70 líneas, 1 dep). Traducir 2 strings no necesita un motor. [main/index.ts:275-312]
delete: node-cron + el job de fondo (~25 líneas, 1 dep). Si se quiere sync, que sea manual o con un flag. [main/index.ts:252-273]
delete: node-notifier, mime-types, turndown (3 deps, 0 imports).
delete: 12 funciones de DB/caché sin un solo llamador (~140 líneas): deepCheck, getOutdatedPosts, deleteMessagesForThread, getCachedFileByHash, getFilesForMessage, clearCompletedQueue, verifyLocalFile, markOutdated, markDeleted, isPostCached, getQueueItems, getCachedMessage. [storage/*.ts]
delete: interface IpcChannels completa (40 líneas). Tipar desde `typeof api` del preload. [discord/types.ts:366-405]
delete: DownloadAnimation duplicado en App.tsx (28 líneas). Ya existe en DownloadsView. [App.tsx:104-131]
delete: 20 getters/setters de preferencias sin uso (~80 líneas). Un `get(key)/set(key)` genérico ya existe. [encrypted-store.ts:212-234]
delete: downloadAttachment, getGuildRoles, getForumChannels, getArchivedThreads, getActiveCount, limiter.clearQueue expuestos sin uso (~70 líneas). [api-client.ts]
yagni: contentSelection con 10 flags donde 4 hacen algo. Colapsar a {imagenes, videos, archivos, respuestas}. [types.ts:305]
yagni: ExportOptions con 11 campos donde 5 hacen algo. Quitar folderStructure, imageQuality, maxFilenameLength, includeAvatars/Stickers/Emojis. [types.ts:289]
yagni: RateLimiter de 270 líneas para un throttle global de 2 req/s. 40 líneas con un timestamp de "próximo slot". [rate-limiter.ts]
yagni: JsonStore de 90 líneas que reimplementa electron-store en 60. [encrypted-store.ts:52-89]
shrink: 4 copias de formatSize (markdown, html, index, download-manager) → 1 util. (~24 líneas)
shrink: 3 copias del bloque CSS de animación DL + keyframes duplicados en <style>. Mover a animations.css. (~60 líneas)
shrink: 340 líneas de CSS inline en un template string → archivo .css + fs.readFile. [html-generator.ts]
shrink: html-generator messageToHtml: escape+regex → 1 pasada con un parser mínimo. (~30 líneas)
native: setZoomLevel manual + localStorage → `webFrame.setZoomFactor` con clamp 0.9–2.0. (3 líneas menos, y correcto)
native: `webContents.send` de progreso por chunk → `event.sender.send` con throttle de 100 ms (menos IPC, no más).
```

**net: -1.930 líneas, -6 deps posible.**

---

## Orden de arreglo recomendado

1. **Desbloquear la instalación** (B1): quitar `react-json-view`. Sin esto no hay nada más.
2. **Desbloquear el arranque empaquetado** (B2, B3): generar `icon.ico`; `locales/` → `resources/locales` con `process.resourcesPath`, o eliminar i18n entero.
3. **Cancelar ≠ completar** (B30) y **delta sync real** (B31): dos cambios de ~10 líneas que arreglan la percepción de "no funciona".
4. **Nombres de archivo** (B35) y **rutas relativas** (B36, B38): sin esto el archivo exportado no es usable.
5. **`channel_id` = categoría** (B19) + índice (B46): el `_INDEX.md` vuelve a tener contenido.
6. **PDF** (B40, B41): ruta de fuente y worker; si no, desactivar la opción hasta reescribirla.
7. **Seguridad** (B6): `webSecurity: true` + protocolo propio + iframe sin scripts.
8. **UI**: historial (B50), variables `--status-*` (B51), `outputDir` (B52), `encodeURI` en `file://` (B54).
9. **Limpieza ponytail**: borrar lo muerto, luego los ajustes fantasma (B33).

---

## Lo que sí está bien

- `tsc --noEmit` pasa en los dos proyectos sin errores ni `any` descontrolado en el core.
- `electron-vite build` produce los 3 bundles correctamente.
- `ApiClient.request()` tiene un manejo de 401/403/404/5xx correcto y tipado.
- La separación `core/` (sin Electron salvo `database`/`download-manager`) es la adecuada para testear; el problema es que solo hay 2 tests.
- El diseño visual del renderer es coherente y consistente (paleta, radios, tipografía).
