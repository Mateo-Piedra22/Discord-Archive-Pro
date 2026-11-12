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
│   ├── index.ts     ventana, protocolo archive://, IPC, tray, CSP
│   └── path-guard.ts  validación de rutas (+ tests)
├── preload/         puente tipado; implementa AppApi
├── shared/api.ts    contrato IPC único (lo usan preload y renderer)
├── core/
│   ├── discord/     cliente REST, rate limiter, parser, detección de sesión
│   ├── storage/     SQLite, migraciones, caché, preferencias cifradas
│   ├── download/    cola, assets, progreso, cancelación
│   └── export/      Markdown, HTML, JSON, PDF, EPUB, índice, carpetas
└── renderer/
    ├── App.tsx      armazón: titlebar + riel de 6 destinos + capas
    ├── components/
    │   ├── DashboardView.tsx    panel de métricas (app:get-stats)
    │   ├── LiveThreadView.tsx   visor de hilo en vivo (cajón, solo GET)
    │   ├── CommandPalette.tsx   paleta de comandos (Ctrl+K)
    │   ├── ShortcutsSheet.tsx   hoja de atajos (Ctrl+/)
    │   ├── SearchOverlay.tsx    búsqueda en el archivo (Ctrl+F)
    │   ├── …                    PostList, ArchiveViewer, SettingsView, AboutView
    │   └── explore/             explorador de servidores y canales
    ├── stores/      Zustand: auth, browser, download, ui
    └── assets/styles/  tokens.css · base.css · components.css
```

Utilidades fuera del bundle:

```
scripts/
├── generate-icon.js     icono de tres estratos (PNG/ICO escritos a mano)
├── captura-cdp.mjs      captura una vista concreta por CDP
├── captura-ventana.ps1  captura la ventana con PrintWindow
├── flujo-cdp.mjs        servidor → canal → publicaciones
└── recorrido-cdp.mjs    recorrido completo: login y seis superficies
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
4. Si recibe una ruta, valídala con `isInside(outputDir, ruta)`.

`tsc` fallará si el preload no cumple el contrato: esa es la red de seguridad.

### Una migración de base de datos

1. Añade un objeto `{ version: N, sql: '...' }` al final de `MIGRATIONS`.
2. El SQL debe ser idempotente (`IF NOT EXISTS`) y terminar con
   `INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', 'N')`.
3. Nunca edites una migración ya publicada: añade una nueva.

---

## Pruebas

```bash
npm run test
```

Cubren la lógica pura, que es donde se esconden los bugs caros:

| Archivo | Qué fija |
|---|---|
| `token-crypto.test.ts` | El bug que dejaba la detección en 0 candidatos |
| `path-guard.test.ts` | Traversal, prefijos engañosos, rutas absolutas |
| `folder-builder.test.ts` | Numeración estable, `flat`/`by-date`, colisiones |
| `markdown-generator.test.ts` | Tags por nombre, rutas `../` en `replies/`, `threadMode` |
| `text-utils.test.ts` | Saneado de PDF, corte de líneas |
| `channelFilters.test.ts` | Filtros de canal |

No hay tests de interfaz. Para revisarla visualmente, ver abajo.

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

## Empaquetado

```bash
npm run package
```

Genera `dist/Estrato.exe` (portable) y `dist/win-unpacked/`.

Detalles que importan:

- `resources/icon.ico` es obligatorio. Se regenera con `npm run icon`.
- Las fuentes se copian con `extraResources` a `<app>/resources/fonts/`, que es la
  ruta que resuelve `PdfGenerator.fontPath()`.
- Los módulos nativos (`better-sqlite3`, `sharp`) se descomprimen del asar
  automáticamente; si añades otro, comprueba `asarUnpack`.
- El build portable descomprime en una carpeta temporal: los datos se guardan en
  `PORTABLE_EXECUTABLE_DIR`.

---

## Antes de abrir un PR

```bash
npm run typecheck
npm run test
npm run build
```

Y comprueba a mano:

- La ventana abre centrada y se puede mover, minimizar, maximizar y restaurar.
- El tema claro y el oscuro se ven bien.
- `Ctrl+K`, `Ctrl+F`, `Ctrl+/` y `Esc` abren y cierran las capas en el orden
  esperado, sin dejar foco atrapado.
- No hay textos en inglés en la interfaz.
- No hay comentarios en inglés en el código.

---

## Lectura de conversaciones (2.1.0)

El renderizado de mensajes vive en un único módulo para que el chat de canal y el
visor de hilos no diverjan:

| Archivo | Responsabilidad |
|---|---|
| `components/message/discordMarkdown.ts` | Markdown de Discord → nodos de React: negrita, cursiva, tachado, código, spoiler, menciones, emoji personalizado y enlaces |
| `components/message/MessageStream.tsx` | Lista de mensajes: agrupación por autor, separadores de día, adjuntos, embeds, reacciones y acciones al pasar el ratón |
| `components/message/MediaLightbox.tsx` | Visor de imágenes con zoom, copiar enlace y cierre con `Esc` |
| `components/ChannelChatView.tsx` | Chat de un canal: cabecera, scroll infinito, «Ir al final» y descarga del canal |
| `components/LiveThreadView.tsx` | Panel lateral para leer una publicación concreta sin descargarla |

Reglas que conviene no romper:

- **Un solo `Esc` por capa.** `App` ignora la tecla si hay un `.lightbox` abierto; si no,
  cerrar la imagen salía también del canal.
- **Vídeo directo frente a proveedor.** Solo se usa `<video>` con archivos `.mp4`,
  `.webm`, `.ogg` o `.mov`. YouTube y Vimeo se muestran como tarjeta con miniatura y se
  abren fuera: su política de incrustación rechaza el origen `file://` (error 152/153).
- **CSP con medios.** `media-src` debe incluir `https://cdn.discordapp.com` y
  `https://media.discordapp.net`, o los GIF se quedan en negro.
- **La animación de `.workspace__body` no usa `transform`.** Un `translateY` convertiría
  el contenedor en el bloque de referencia de los hijos `position: fixed` y recortaría
  el visor de imágenes.
