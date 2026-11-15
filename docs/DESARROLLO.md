# Desarrollo

Guía para trabajar en el proyecto sin romper lo que ya funciona.

---

## Puesta en marcha

```bash
npm install
npm run dev
```

Si `npm install` falla con `NODE_MODULE_VERSION mismatch` al arrancar, el rebuild
nativo no se ejecutó:

```bash
npx electron-builder install-app-deps
```

### Trampa del entorno

Si tu terminal exporta `ELECTRON_RUN_AS_NODE=1`, `electron.exe` arranca como Node
puro: `require('electron')` devuelve una cadena y el proceso principal muere con
`Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`.
No es un bug del proyecto. Arranca así:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .
```

---

## Mapa del código

```
src/
├── main/            proceso principal de Electron
│   ├── index.ts     ventana, protocolo archive://, IPC, tray, CSP, rendimiento
│   └── path-guard.ts  validación canónica de rutas (+ isInsideReal/Async + tests)
├── preload/         puente tipado; implementa AppApi
├── shared/api.ts    contrato IPC único (lo usan preload y renderer)
├── core/
│   ├── discord/     cliente REST, rate limiter, parser, caché LRU, detección de sesión
│   ├── storage/     SQLite WAL, migraciones, caché, integridad, prefs cifradas
│   ├── download/    cola con prioridades, deduplicación, assets, progreso, cancelación
│   └── export/      Markdown, HTML, JSON, CSV, PDF, EPUB, índice, carpetas
└── renderer/
    ├── App.tsx      armazón: titlebar + riel de 6 destinos + capas + triple tema
    ├── components/
    │   ├── DashboardView.tsx    panel de métricas y rendimiento en vivo
    │   ├── LiveThreadView.tsx   visor de hilo en vivo (cajón, solo GET + filtros)
    │   ├── ChannelChatView.tsx  visor de canal en vivo (+ filtros y transcripción)
    │   ├── CommandPalette.tsx   paleta de comandos (Ctrl+K)
    │   ├── ShortcutsSheet.tsx   hoja de atajos (Ctrl+/)
    │   ├── SearchOverlay.tsx    búsqueda global en el archivo (Ctrl+F + ext:)
    │   ├── ArchiveViewer.tsx    visor todo-en-uno + galería multimedia
    │   ├── archive/             Colecciones, VisorDocumento, csvViewerUtils
    │   ├── message/             MessageStream, discordMarkdown, MediaLightbox, chatErrorUtils
    │   ├── …                    DownloadsView, SettingsView, AboutView, PostList
    │   └── explore/             explorador de servidores y canales
    ├── stores/      Zustand: auth, browser, download, ui
    └── assets/styles/  tokens.css · base.css · components.css
```

Utilidades y auditorías fuera del bundle:

```
scripts/
├── generate-icon.js        icono de tres estratos (PNG/ICO escritos a mano)
├── verify-release.mjs      auditoría de manifiesto, recursos, docs y dist/SHA256SUMS.txt
├── verify-release.test.ts  tests unitarios del verificador de lanzamiento
├── captura-cdp.mjs         captura una vista concreta por CDP
├── captura-ventana.ps1     captura la ventana con PrintWindow
├── flujo-cdp.mjs           servidor → canal → publicaciones
└── recorrido-cdp.mjs       recorrido completo: login y seis superficies
```

---

## Convenciones

### Idioma

**Todos los comentarios y todos los textos de interfaz van en español.** Sin
excepciones. Los términos técnicos consolidados (debounce, listener, hook, bundle,
IPC, WAL, hash) se quedan como están.

### TypeScript

- `strict` activo en los dos proyectos. Nada de `any` salvo frontera con datos
  externos, y en ese caso se acota inmediatamente.
- Los tipos de la API de Discord viven en `core/discord/types.ts`.
- El contrato IPC se declara **una vez** en `shared/api.ts`.

### Renderer

- Usa las clases del sistema de diseño. El `style` inline se reserva para valores
  dinámicos (porcentajes, rotaciones).
- Cada vista devuelve un fragmento con `.workspace__header` y `.workspace__body`.
- Las vistas se importan con `React.lazy` en `App.tsx`.
- Las suscripciones IPC devuelven `unsub()`: límpialas en el `useEffect`.

### Núcleo

- El núcleo no importa nada de React.
- Nada de `fs` sincrónico en rutas calientes: usa `fs.promises`.
- Cualquier operación larga debe ceder el event loop (`setImmediate`) o ir en un
  worker.

---

## Cómo añadir cosas

### Una vista nueva

1. Crea `src/renderer/components/MiVista.tsx` con `export default`.
2. Devuelve `.workspace__header` + `.workspace__body`.
3. Añádela a `VISTAS` en `App.tsx` (icono de lucide, etiqueta, atajo) y al tipo
   `Vista` de `stores/uiStore.ts`.
4. Impórtala con `lazy(() => import(...))`.
5. Añádela a `ShortcutsSheet` y al grupo «Ir a» de `CommandPalette`: las dos listas
   son estáticas.

### Un formato de exportación

1. Crea `src/core/export/mi-formato.ts` con una función que reciba
   `(thread, messages, outputDir, assetMap)`.
2. Añade el identificador a `ExportFormat` en `types.ts`.
3. Llámalo desde `runExports()` en `download-manager.ts`.
4. Añade el chip en la sección *Exportación* de `SettingsView`.
5. Si genera un archivo nuevo, inclúyelo en la lista de `index-generator.ts`.

### Un canal IPC

1. Declara el método en `AppApi` (`shared/api.ts`).
2. Impleméntalo en `preload/index.ts` (`ipcRenderer.invoke`).
3. Regístralo en `setupIpcHandlers()` del main.
4. Si recibe una ruta, valídala con `isInside`, `isInsideReal` o `isInsideRealAsync` (`src/main/path-guard.ts`).

`tsc` fallará si el preload no cumple el contrato: esa es la red de seguridad.

### Una migración de base de datos

1. Añade un objeto `{ version: N, sql: '...' }` al final de `MIGRATIONS`.
2. El SQL debe ser idempotente (`IF NOT EXISTS`) y terminar con
   `INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', 'N')`.
3. Nunca edites una migración ya publicada: añade una nueva.

---

## Pruebas

```bash
npm test
```

Vitest (`vitest.config.ts`) ejecuta todas las suites bajo `src/**/*.test.ts` y
`scripts/**/*.test.ts` (en `database.test.ts` recurre automáticamente a `node:sqlite`
si el binario nativo de `better-sqlite3` está compilado para la ABI de Electron).

| Área | Archivo | Qué verifica |
|---|---|---|
| Discord | `src/core/discord/api-client.test.ts` | Peticiones REST, paginación y errores HTTP |
| Discord | `src/core/discord/lru-cache.test.ts` | Capacidad acotada, evicción y métricas LRU |
| Discord | `src/core/discord/markdown-parser.test.ts` | Menciones, canales, roles y marcas de texto |
| Discord | `src/core/discord/rate-limiter.test.ts` | Cubos por ruta, esperas `retry_after` y pausas globales |
| Discord | `src/core/discord/token-crypto.test.ts` | Extracción base64 completa y descifrado AES-256-GCM |
| Descargas | `src/core/download/deduplicator.test.ts` | Deduplicación SHA-256 por post y limpieza |
| Descargas | `src/core/download/download-manager.test.ts` | Cola, prioridades, cancelación y despacho de exportadores |
| Descargas | `src/core/download/file-downloader.test.ts` | Streaming de adjuntos, reintentos y `AbortSignal` |
| Descargas | `src/core/download/progress-tracker.test.ts` | Velocidad media y porcentajes de progreso |
| Exportación | `src/core/export/epub-generator.test.ts` | Capítulos XHTML escapados, sin scripts ni red |
| Exportación | `src/core/export/folder-builder.test.ts` | Numeración estable, `flat`/`by-date`, nombres reservados Windows |
| Exportación | `src/core/export/html-generator.test.ts` | HTML autocontenido, escape XSS y toggle CSS puro |
| Exportación | `src/core/export/index-generator.test.ts` | Escritura atómica de `_INDEX.md` y enlaces por formato |
| Exportación | `src/core/export/json-exporter.test.ts` | `post.json` y `messages.csv`/`post.csv` con `sanitizeCsvFormula` |
| Exportación | `src/core/export/markdown-generator.test.ts` | Frontmatter YAML, tags por nombre, `replies/` y `threadMode` |
| Exportación | `src/core/export/text-utils.test.ts` | Saneado PDF WinAnsi y corte de líneas |
| Almacenamiento | `src/core/storage/cache-manager.test.ts` | Sincronización delta y detección de archivos en disco |
| Almacenamiento | `src/core/storage/database.test.ts` | Migraciones, prioridad en cola, `optimizeMemory` e integridad |
| Almacenamiento | `src/core/storage/encrypted-store.test.ts` | Escritura atómica, whitelist y prefijos `dpapi:` / `plain:` |
| Seguridad | `src/main/path-guard.test.ts` | Traversal, prefijos engañosos, symlinks con `realpath` y caché |
| Renderer | `src/renderer/channelFilters.test.ts` | Filtros y búsqueda de canales |
| Visor local | `src/renderer/components/archive/Colecciones.test.ts` | Detección de formatos (`MD`–`EPUB`, `CSV`), orden numérico de `replies/*.md` (`respuestasArchivos`) y medios |
| Visor local | `src/renderer/components/archive/csvViewerUtils.test.ts` | Parseo CSV RFC 4180, serialización `formatCsvRows`, tarjetas JSON (`extractJsonThreadMessages`) y resumen JSON |
| Chat en vivo | `src/renderer/components/message/chatErrorUtils.test.ts` | Errores amigables y operadores (`from:`/`de:`, `has:embed`, `has:pinned`) |
| Chat en vivo | `src/renderer/components/message/discordMarkdown.test.ts` | Nodos React seguros para menciones, spoilers, enlaces y código |
| Lanzamiento | `scripts/verify-release.test.ts` | Manifiesto, invariantes Electron (`validateElectronSecurityConfig`), PNG 512, ICO multi-tamaño, seguridad SVG (`validateSvgContent`), fuentes, docs, workflows y `SHA256SUMS.txt` |

No hay tests E2E de interfaz renderizada; para comprobarla visualmente, utiliza los
scripts CDP documentados abajo.

---

## Depurar la interfaz

### Captura sin depender del foco

Arranca con el puerto de depuración y captura por CDP:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe . --remote-debugging-port=9222
node scripts/captura-cdp.mjs ajustes ui-ajustes.png
```

Vistas válidas: `panel`, `explorar`, `cola`, `archivo`, `ajustes`, `legal`.

El script navega con el evento `dap:navigate` (el mismo que usan las vistas), espera
1,2 s y captura. Si necesitas el flujo de exploración completo, `flujo-cdp.mjs` hace
servidor → canal → publicaciones y guarda una sola captura.

### Captura de la ventana

```powershell
powershell -ExecutionPolicy Bypass -File scripts/captura-ventana.ps1 -Proceso electron -Salida ui.png
```

Usa `PrintWindow`, así que funciona aunque la ventana esté detrás de otras.

### Recorrido automático de la interfaz

`scripts/recorrido-cdp.mjs` recorre la app de punta a punta y deja una captura por
superficie. Es la forma rápida de comprobar que un cambio en el armazón no rompió
nada.

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe . --remote-debugging-port=9222
node scripts/recorrido-cdp.mjs 9222
```

Qué hace, en orden:

1. Si no encuentra `.rail` (sesión sin conectar), llama a `tokenDetector.detect()`,
   guarda el primer token con `auth.setToken` y recarga la página.
2. Navega a `panel` y captura `ui-panel.png`.
3. Entra en `explorar`, abre el primer servidor y el primer canal navegable, y
   captura `ui-explorar.png`.
4. Pulsa «Leer el hilo sin descargarlo» y captura el cajón en `ui-hilo.png`.
5. Abre la paleta con `Ctrl+K` y captura `ui-paleta.png`.
6. Abre la búsqueda con `Ctrl+F`, escribe `BlackMarket` y captura `ui-busqueda.png`.

Detalles que conviene saber:

- Habla CDP por WebSocket (`/json` → `webSocketDebuggerUrl`), sin Puppeteer ni
  Playwright: el script no añade dependencias.
- Las esperas son fijas (0,3–4 s). No espera por selector, así que en una máquina
  lenta puede capturar esqueletos o una vista a medio montar. Si pasa, sube el
  `esperar()` del paso correspondiente.
- Las capturas se escriben en la raíz del proyecto, con el nombre que fija el script.
- El paso 6 asume que el archivo local contiene «BlackMarket»; si no, la captura sale
  con el estado «Sin coincidencias», que también es un caso válido.

---

## Empaquetado, verificación y automatización (`.github/`)

### Scripts locales

```bash
npm run verify:release     # Audita package.json, invariantes Electron (validateElectronSecurityConfig), iconos PNG/ICO/SVG (validateSvgContent), Roboto-Regular.ttf, docs y .github/
npm run package            # Compila y genera dist/Estrato.exe (portable) + dist/win-unpacked/
npm run package:installer  # Compila y genera dist/Estrato-Setup-<version>.exe (instalador NSIS)
node scripts/verify-release.mjs --dist  # Verifica artefactos .exe y genera dist/SHA256SUMS.txt
```

Detalles importantes del empaquetado:

- `resources/icon.ico`, `resources/icon.png` y `resources/icon-512.png` son obligatorios; se regeneran con `npm run icon`. Los activos vectoriales `resources/logo-mark.svg` y `resources/logo-banner.svg` son auditados por `validateSvgContent` y la configuración de seguridad del `BrowserWindow` en `src/main/index.ts` es auditada por `validateElectronSecurityConfig` en `scripts/verify-release.mjs`.
- La configuración `build.asar: true` empaqueta el código JS en ASAR y desempaqueta los binarios nativos (`**/*.node`: `better-sqlite3`, `sharp`) con `asarUnpack`.
- Las fuentes (`resources/fonts/Roboto-Regular.ttf`) se copian con `extraResources` a `<app>/resources/fonts/`, ruta que resuelve `PdfGenerator.fontPath()`.
- En el ejecutable portable, `getDataDir()` (`src/core/storage/paths.ts`) usa `PORTABLE_EXECUTABLE_DIR/data` para que la base y preferencias sobrevivan fuera de la extracción temporal; en la instalación NSIS (`oneClick: false`, permite elegir carpeta de destino) usa `<carpeta del ejecutable>/data`.

### Flujos y plantillas en `.github/`

- **`.github/workflows/ci.yml`**: se ejecuta en `push` y `pull_request` sobre `main` (`ubuntu-latest`, Node 20, `npm ci --ignore-scripts`). Corre `npm run typecheck`, `npm test -- --run`, `npm run build`, `npm run verify:release` y publica resumen con el estado de recursos en `$GITHUB_STEP_SUMMARY`.
- **`.github/workflows/empaquetar.yml`**: en `windows-latest`, mediante `workflow_dispatch` (input `objetivo`: `portable`, `nsis` o `ambos`) o automáticamente al publicar una etiqueta `v*` (construye ambos objetivos). Corre tipos, tests, build, `npm run verify:release`, `electron-builder`, `node scripts/verify-release.mjs --dist`, sube `dist/*.exe` + `dist/SHA256SUMS.txt` y crea/actualiza la Release en GitHub en tags `v*`.
- **Plantillas comunitarias**:
  - `.github/ISSUE_TEMPLATE/config.yml` (`blank_issues_enabled: false` y enlaces directos a `SECURITY.md` y `docs/ARQUITECTURA.md`).
  - `.github/ISSUE_TEMPLATE/bug_report.md` (con aviso explícito contra adjuntar tokens o `estrato.db`).
  - `.github/ISSUE_TEMPLATE/feature_request.md`
  - `.github/pull_request_template.md`
  - `.github/dependabot.yml` (actualizaciones semanales agrupadas `minor`/`patch` para `npm` y `github-actions`).

---

## Antes de abrir un PR

Sigue también la guía completa en [CONTRIBUTING.md](../CONTRIBUTING.md) y la lista de [.github/pull_request_template.md](../.github/pull_request_template.md):

```bash
npm run typecheck
npm test
npm run build
npm run verify:release
```

Y comprueba manualmente:

- La ventana abre centrada y se puede mover, minimizar, maximizar y restaurar.
- Los **tres temas** (`Tinta oscura`, `Papel claro` y `Pergamino sepia`) mantienen contraste, jerarquía y ausencia de colores literales fuera de `tokens.css`.
- `Ctrl+K`, `Ctrl+F`, `Ctrl+/` y `Esc` abren y cierran las capas en el orden esperado, sin dejar foco atrapado.
- No hay textos en inglés en la interfaz ni comentarios en inglés en el código.
- Se preservan todas las invariantes de seguridad (`contextIsolation`, `sandbox`, `path-guard.ts`, cero recursos remotos en la UI).

---

## Lectura de conversaciones y visor en vivo

El renderizado de mensajes vive en un único módulo para que el chat de canal y el
visor de hilos no diverjan:

| Archivo | Responsabilidad |
|---|---|
| `components/message/discordMarkdown.ts` | Markdown de Discord → nodos de React: negrita, cursiva, tachado, código, spoiler, menciones, emoji personalizado y enlaces |
| `components/message/chatErrorUtils.ts` | Normalización de errores y filtrado en vivo con operadores `from:`/`de:`, `has:embed`, `has:pinned`, `pinned:true` |
| `components/message/MessageStream.tsx` | Lista de mensajes: agrupación por autor, separadores de día, adjuntos, embeds, reacciones y acciones al pasar el ratón |
| `components/message/MediaLightbox.tsx` | Visor a pantalla completa con zoom, rotación, navegación por teclado y cierre con `Esc` |
| `components/ChannelChatView.tsx` | Chat de un canal: cabecera, scroll infinito, filtros, copia de transcripción Markdown, «Ir al final» y descarga del canal |
| `components/LiveThreadView.tsx` | Panel lateral para leer una publicación concreta sin descargarla |

Reglas que conviene no romper:

- **Un solo `Esc` por capa.** `App` ignora la tecla si hay un `.lightbox` abierto; si no, cerrar la imagen salía también del canal.
- **Vídeo directo frente a proveedor.** Solo se usa `<video>` con archivos `.mp4`, `.webm`, `.ogg` o `.mov`. YouTube y Vimeo se muestran como tarjeta con miniatura y se abren fuera (`app:open-external` los incluye en `hostsPermitidos`): su política de incrustación rechaza el origen `file://` (error 152/153).
- **CSP con medios.** `media-src` debe incluir `https://cdn.discordapp.com` y `https://media.discordapp.net`, o los GIF se quedan en negro.
- **La animación de `.workspace__body` no usa `transform`.** Un `translateY` convertiría el contenedor en el bloque de referencia de los hijos `position: fixed` y recortaría el visor de imágenes.
