# Arquitectura

Documento de referencia para quien mantenga **Estrato**. Describe las capas, los
contratos entre ellas y las decisiones que no son obvias leyendo el código.

---

## Vista general

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderer (React 19 + Zustand)                                  │
│  Armazón: titlebar + riel de 6 destinos + área de trabajo       │
│  Vistas y capas superpuestas con React.lazy                     │
└───────────────▲─────────────────────────────────────────────────┘
                │  window.api  (contextBridge, contrato tipado)
┌───────────────┴─────────────────────────────────────────────────┐
│  Preload (sandbox, sin Node)                                    │
│  envuelve ipcRenderer.invoke / send / on → unsub()               │
└───────────────▲─────────────────────────────────────────────────┘
                │  canales IPC
┌───────────────┴─────────────────────────────────────────────────┐
│  Main (Electron)                                                │
│  ventana · protocolo archive:// · CSP · permisos · tray          │
│                                                                 │
│  core/discord   → API REST, rate limiter, parser, detección      │
│  core/storage   → SQLite (WAL), migraciones, caché, prefs        │
│  core/download  → cola, assets, progreso, cancelación            │
│  core/export    → MD, HTML, JSON, PDF, EPUB, índice, carpetas    │
└─────────────────────────────────────────────────────────────────┘
```

La regla es simple: **el renderer no sabe nada de Node** y el núcleo no sabe nada de
React. Todo lo que cruza la frontera está declarado una sola vez en `src/shared/api.ts`.

---

## Contrato IPC

`src/shared/api.ts` exporta la interfaz `AppApi`. El preload la implementa
(`const api: AppApi = {...}`) y el renderer la consume (`window.api: AppApi`).

Consecuencias:

- Si el preload no cumple la interfaz, **no compila**. No hay deriva posible entre
  lo que el renderer cree que existe y lo que existe de verdad.
- `env.d.ts` ya no duplica tipos: solo declara `Window.api`.
- Todas las suscripciones devuelven `Unsubscribe`, así que React puede limpiarlas.

Canales disponibles (prefijo → responsabilidad):

| Prefijo | Contenido |
|---|---|
| `auth:` | validar, guardar y borrar el token |
| `discord:` | guilds, canales, hilos, mensajes (páginas y completo), iconos |
| `cache:` | estado de un hilo, posts cacheados, purga |
| `download:` | cola, historial, pausa, cancelación, reintento |
| `settings:` | preferencias, estadísticas, selector de carpeta |
| `token:` | detección automática de sesión |
| `archive:` | árbol, lectura y búsqueda de archivos **dentro** del directorio de salida |
| `app:` | métricas agregadas del archivo, apertura de enlaces externos |
| `window:` | minimizar, maximizar, zoom, estado, reinicio de posición |

`app:open-external` no es un `shell.openExternal` genérico: solo acepta destinos de
Discord (ver *Seguridad*). `discord:get-message-page` existe para leer un hilo sin
descargarlo; `discord:get-thread-messages` sigue siendo el camino de la descarga
completa.

---

## Flujo de una descarga

```
PostList → download.start(threads, guild, channel, opciones, selección)
   │
   ▼
DownloadManager.addToQueue()
   ├─ db.addToQueue()            (deduplica si el hilo ya está pendiente)
   └─ processQueue()             (hasta `concurrency` tareas)
          │
          ▼
     processTask()
       1. getChannel()                        → metadatos reales del hilo
       2. CacheManager.isUpToDate()           → si no cambió y existe, termina
       3. getAllThreadMessages()              → paginación completa
       4. buildThread()                       → pseudo-hilo si es canal de texto
       5. createPostDirectory()               → reutiliza la carpeta si ya existía
       6. planAssets() + downloadAssets()     → dedup por hash, AbortSignal
       7. runExports()                        → MD/HTML/JSON/PDF/EPUB
       8. recordPostSync()                    → caché + hashes
       9. scheduleIndex()                     → _INDEX.md una vez por lote
      10. recordDownloadHistory()             → auditoría
```

### Decisiones que importan

**El `assetMap` usa rutas relativas POSIX sin `./`.**
`assets/images/foto.png`. Desde `replies/` se prefija `../`. Nunca rutas absolutas:
rompen el archivo al mover la carpeta y filtran la estructura de disco del usuario.

**La deduplicación es por contenido y por post.**
Se calcula SHA-256 durante el streaming. Si ese hash ya existe en la carpeta del post,
se reutiliza el archivo. No se reutilizan archivos de otros posts a propósito: eso
obligaría a rutas absolutas.

**Cancelar aborta de verdad.**
Cada tarea tiene un `AbortController`. El `.then()` comprueba `task.status` antes de
marcar `done`, porque una promesa resuelta no significa éxito.

**El delta sync es una comprobación, no una reescritura incremental.**
Si `last_message_id` y `message_count` coinciden y el directorio existe, no se toca
nada. Si algo cambió, se vuelve a descargar el hilo completo: reescribir un Markdown
por append es frágil y produce archivos inconsistentes.

**El índice se genera una vez por lote.**
Se acumulan los directorios pendientes y un temporizador de 1,5 s los procesa juntos.
Antes se regeneraba por tarea (O(n²) de lecturas y escrituras concurrentes).

---

## Flujo de lectura sin descarga

```
PostList («Leer el hilo») → uiStore.abrirHilo({ threadId, nombre, canal, servidor })
   │
   ▼
LiveThreadView (cajón lateral, React.lazy)
   └─ discord.getMessagePage(threadId, before?, 50)
        └─ DiscordClient.getMessagePage()
             └─ getThreadMessages() → GET /channels/{id}/messages?limit=50[&before=]
```

Este camino es **independiente de la descarga**: no toca la cola, ni la caché, ni el
directorio de salida. Solo pide páginas y las pinta.

- Discord devuelve los mensajes del más reciente al más antiguo. `getMessagePage()`
  los invierte para que la vista los pinte en orden cronológico y marca `hasMore`
  cuando la página viene llena.
- «Cargar anteriores» usa el id del mensaje más antiguo como cursor `before` y hace
  *prepend* conservando la posición del scroll: se mide `scrollHeight` antes de la
  petición y se corrige `scrollTop` en un `useLayoutEffect`.
- La agrupación de mensajes (mismo autor, menos de 5 min, mismo día) y el Markdown
  mínimo de Discord (negrita, cursiva, código, tachado, spoiler, enlaces y
  menciones) son lógica de la vista, no del núcleo.
- Los enlaces del contenido no navegan el renderer: se delegan en
  `app.openExternal`, que solo abre destinos de Discord.
- «Descargar» desde el cajón no abre un camino paralelo: encola el hilo con
  `download.start` usando un pseudo-hilo (tipo 15), igual que haría `PostList`.

---

## Almacenamiento

SQLite con `better-sqlite3` (síncrono, WAL) en **`estrato.db`**. Ubicación:

- desarrollo: `<raíz del proyecto>/data/`
- empaquetado: `data/` junto al `.exe` real (`PORTABLE_EXECUTABLE_DIR` si existe,
  porque el target portable descomprime en una carpeta temporal).

> El archivo se llamaba `foro-downloader.db`. Al arrancar, si `estrato.db` no existe
> y sí el antiguo, se renombra junto con sus `-wal` y `-shm`. Si el renombrado falla
> se arranca con una base vacía: se pierde la caché, no las exportaciones, que son
> archivos.

Tablas: `cached_posts`, `cached_messages`, `cached_files`, `cached_users`,
`download_queue`, `download_history`, `_meta`.

### Migraciones

`src/core/storage/migrations.ts` es una lista ordenada. Cada migración se aplica en
una transacción y escribe `_meta.schema_version`. Si una falla, no queda esquema a
medias.

> v4 elimina la tabla FTS5 que creaba v2. Estaba rota (declaraba columnas que no
> existían en la tabla de origen e indexaba hashes en lugar de texto) y ninguna
> función la usaba.

### Purga de caché

`clearAllCache()` hace `DELETE` de las tablas de caché y `VACUUM`. **No borra el
archivo `.db`**: hacerlo en caliente dejaba conexiones colgadas y corrompía la cola.

---

## Exportadores

| Formato | Archivo | Notas |
|---|---|---|
| Markdown | `markdown-generator.ts` | frontmatter YAML, tags por nombre, `threadMode` |
| HTML | `html-generator.ts` | CSS embebido, tema sin JavaScript |
| JSON | `json-exporter.ts` | `post.json` estructurado |
| PDF | `pdf-generator.ts` | A4 paginado, cede el event loop cada 20 mensajes |
| EPUB | `epub-generator.ts` | XHTML escapado, sin dependencia de red |
| Índice | `index-generator.ts` | escritura atómica (`.tmp` + rename) |
| Carpetas | `folder-builder.ts` | `by-server`, `flat`, `by-date` |

El PDF usa `resources/fonts/Roboto-Regular.ttf`. En producción se copia a
`<app>/resources/fonts/` mediante `extraResources`, que es exactamente la ruta que
resuelve `PdfGenerator.fontPath()`. Si la fuente no aparece, cae a Helvetica y
sustituye los caracteres no ASCII por `?` (Helvetica solo cubre WinAnsi).

---

## Rate limiting

`RateLimiter` mantiene una cola serial con un ritmo global conservador (~2 req/s) y
respeta los cubos por ruta que devuelve Discord:

- `x-ratelimit-bucket` identifica el cubo; se guarda `ruta → id de cubo → cubo`.
- En 429 se lee `retry_after` del cuerpo, se aplica un margen de 1 s y, si es global,
  se bloquea toda la cola.
- Los assets van directos a la CDN (sin cabeceras de rate limit de la API).

El ritmo es deliberadamente lento: es preferible tardar a que Discord bloquee la
cuenta.

---

## Detección de sesión

`core/discord/token-detector.ts` recorre las instalaciones de Discord y los perfiles
de navegador. La criptografía está aislada en `token-crypto.ts` **con tests**, porque
ahí vivía el bug que dejaba la detección en 0 candidatos: el base64 se recortaba a
múltiplos de 4 y se perdían los últimos bytes, así que el tag GCM no validaba.

Cada fuente produce un `DetectionDiagnostic` con un mensaje en español para que la
interfaz pueda explicar *por qué* no encontró nada, en lugar de fallar en silencio.

---

## Renderer

- **Estado**: cuatro stores de Zustand (`auth`, `browser`, `download`, `ui`). Sin
  Redux.
- **Carga diferida**: las vistas y las cuatro capas superpuestas se importan con
  `React.lazy`; el bundle inicial solo trae el armazón.
- **Diseño**: un único sistema de tokens en `assets/styles/tokens.css`. Las vistas
  usan clases de `components.css`; el estilo inline se reserva para valores
  dinámicos (porcentajes, anchos).
- **Tema**: `data-theme` en `<html>`, persistido en `localStorage`.
- **Atajos**: `Ctrl+1..6` cambia de vista, `Ctrl+K` abre la paleta, `Ctrl+F` la
  búsqueda, `Ctrl+/` los atajos, `Esc` cierra la capa superior y `Ctrl+Shift+M`
  compacta.

### Mapa de vistas

| Vista | Componente | Qué hace |
|---|---|---|
| Panel | `DashboardView` | Métricas del archivo (`app:get-stats`): publicaciones, mensajes, archivos, tamaño, peso por servidor y actividad reciente |
| Explorar | `explore/ExploreView` → `PostList` | Servidores y canales; con canal elegido, la lista de publicaciones |
| Cola | `DownloadsView` | Cola, progreso, historial y controles |
| Archivo | `ArchiveViewer` | Árbol del directorio de salida y visor de archivos |
| Ajustes | `SettingsView` | Preferencias, exportación y caché |
| Legal | `AboutView` | Licencia, avisos y versión |

### Capas superpuestas

No son vistas: se montan encima del área de trabajo y no cambian `vista`.

| Capa | Componente | Se abre con |
|---|---|---|
| Visor en vivo | `LiveThreadView` | Botón «Leer el hilo sin descargarlo» de `PostList` |
| Paleta de comandos | `CommandPalette` | `Ctrl+K` o el botón de la barra de título |
| Hoja de atajos | `ShortcutsSheet` | `Ctrl+/` |
| Búsqueda global | `SearchOverlay` | `Ctrl+F` o «Buscar» en el pie del riel |

`App.tsx` las renderiza condicionalmente dentro de un `Suspense` aparte, así que su
código no entra en el bundle inicial.

### Estado de interfaz (`uiStore`)

`stores/uiStore.ts` es el único store que no habla con el núcleo:

- `vista`: destino activo del riel (`panel`, `explorar`, `cola`, `archivo`,
  `ajustes`, `legal`). Arranca en `explorar`.
- `hilo`: hilo abierto en el visor en vivo, con nombre, canal y servidor.
- `paletaAbierta`, `atajosAbiertos`, `busquedaAbierta`: una bandera por capa.

Reglas que evitan estados raros:

- `setVista()` cierra el hilo abierto: cambiar de destino no deja un cajón huérfano.
- `Esc` se resuelve en cascada en `App.tsx` (paleta → búsqueda → atajos → hilo →
  canal seleccionado). La hoja de atajos y el visor también escuchan `Esc` mientras
  están montados, porque pueden tener el foco.
- La navegación programática desde una vista usa el evento `dap:navigate`
  (`CustomEvent<string>`), no props ni contexto. Las capturas por CDP se apoyan en
  él.

---

## Por qué no hay más capas

Se eliminaron deliberadamente:

- `interface IpcChannels`: duplicaba el contrato y describía canales inexistentes.
- `i18next` + `locales/`: traducía dos cadenas y escribía dentro del `.asar`.
- `node-cron`: hacía 50 peticiones cada 4 h para contar respuestas.
- Búsqueda FTS5: esquema roto. La búsqueda actual recorre los archivos ya exportados
  sin índice; para el tamaño de un archivo local, alcanza.
- `react-json-view`, `pdfjs-dist`, `dompurify`: dependencias sin uso real.

Cada capa que existe tiene un motivo escrito en este documento. Si añades una,
escribe el suyo.
