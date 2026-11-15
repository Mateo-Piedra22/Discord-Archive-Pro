# Historial de cambios

Todas las versiones relevantes. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

---

## [2.5.0] — 2026-11-14

Flujo autónomo 100 % in-app de principio a fin: apertura automática en el visor integrado al
terminar la cola de descargas (sin abrir nunca ventanas externas del sistema por su cuenta),
notificaciones interactivas, modo **Explorador de archivos** raíz para inspeccionar cualquier
carpeta o archivo descargado, visor de código ampliado (>25 lenguajes), indexación de búsqueda
extendida a `assets/` y auditoría estática de invariantes de seguridad Electron.

### Añadido

- **Apertura automática dentro del visor integrado y toasts accionables (`downloadStore.ts`, `main/index.ts`, `Toast.tsx`)**:
  - Al completarse la cola de descargas (`!state.isDownloading`), si la preferencia **Abrir en el
    visor integrado al terminar** (`autoOpenFolder`) está activa, `downloadStore.ts` abre
    automáticamente la descarga en `ArchiveViewer` mediante `uiStore.abrirArchivo(task.downloadPath || state.outputDir)`
    y muestra un aviso de confirmación sin invocar nunca `shell.openPath` en el proceso principal.
  - Si la apertura automática está desactivada, lanza una notificación toast interactiva (`5 000 ms`)
    con el botón de acción **Abrir en visor** (`ToastAction` y `.toast__action` en `Toast.tsx`).
- **Modo «Explorador de archivos» raíz, visor de código ampliado, vista dual SVG y ficha binaria (`ArchiveViewer.tsx`)**:
  - Conmutador en la raíz de **Archivo** entre **Colecciones (N)** y **Explorador de archivos**
    (`modoRaiz: 'colecciones' | 'explorador'`) con árbol completo de `outputDir`, buscador, divisor
    redimensionable y previsualización directa de cualquier archivo descargado aunque no forme parte
    de una colección detectada.
  - Visor de código (`VistaCodigo`) ampliado a más de 25 extensiones (`py`, `sh`, `bash`, `bat`,
    `ps1`, `c`, `cpp`, `h`, `rs`, `go`, `java`, `kt`, `cs`, `php`, `rb`, `lua`, `ini`, `toml`,
    `conf`, `jsx`, `tsx`, `scss`, `less`, `svg`, además de `json`, `js`, `ts`, `css`, `html`, `xml`,
    `yaml`, `sql`, `csv`, `log`, `txt`), con barra `.visor__json-meta`, filtro de líneas en vivo,
    contador, conmutador **Ajustar línea** (`wrapLongLines`) y copia rápida.
  - Previsualización dual para archivos `.svg` (**Vista imagen** / **Código SVG**) y ficha técnica
    integrada (`.visor__binario-ficha`) para archivos binarios con nombre, formato, tamaño legible y
    exacto en bytes, ruta completa y botón **Copiar ruta**.
- **Puentes directos en toda la interfaz y nuevos atajos (`uiStore.ts`, `DashboardView.tsx`, `ChannelChatView.tsx`, `DownloadsView.tsx`, `CommandPalette.tsx`, `ShortcutsSheet.tsx`, `SettingsView.tsx`)**:
  - `DashboardView`: clic sobre cualquier fila de *«Servidores con más peso»* filtra directamente el
    archivo por ese servidor (`uiStore.abrirArchivoServidor`), buscador instantáneo en *«Actividad
    reciente»* y títulos de hilo clicables que abren su copia local en el visor integrado.
  - `ChannelChatView`: consulta `cache:check-post` al abrir o archivar un canal de texto y muestra la
    insignia **En archivo** junto al botón **Abrir en visor** en la cabecera.
  - `DownloadsView`: botón **Abrir última en visor** en la cabecera de la cola cuando existen tareas
    completadas con ruta local.
  - `CommandPalette` (`Ctrl+K`): nuevo grupo **Archivo reciente** poblado desde el historial de
    descargas completadas para abrir cualquier exportación reciente sin usar el ratón.
  - `ShortcutsSheet` (`Ctrl+/`): buscador instantáneo (*«Filtrar atajos…»*) y registro de los nuevos
    atajos de pestaña dentro de una colección (`Alt + 1 / 2 / 3` para alternar entre *Documento*,
    *Galería* y *Archivos*).
  - `SettingsView`: actualización de `autoOpenFolder` a **Abrir en el visor integrado al terminar** y
    botón directo **Ver en visor** junto a la carpeta de salida en *Almacenamiento*.
- **Búsqueda global ampliada a `assets/` y lectura asíncrona (`src/main/index.ts`)**:
  - `searchArchive` (`Ctrl+F`) amplía `EXTENSIONES_BUSCABLES` (`.md`, `.txt`, `.html`, `.htm`,
    `.json`, `.csv`, `.log`, `.xml`, `.yml`, `.yaml`, `.sql`, `.css`, `.js`, `.ts`, `.py`, `.sh`,
    `.ini`, `.toml`) e indexa también los archivos de texto, código y datos descargados dentro de
    `assets/`.
  - `archive:read-file` valida la ruta con `isInsideRealAsync(root, filePath)` y lee de forma 100 %
    asíncrona mediante `fs.promises.open` (`handle.stat()`, `handle.read()`, `finally handle.close()`)
    respetando el tope de 4 MB sin bloquear el hilo principal.
- **Auditoría estática de invariantes de seguridad Electron (`scripts/verify-release.mjs`)**:
  - Nueva función `validateElectronSecurityConfig(mainSourceText)` integrada en `runReleaseAudit` y
    en `.github/workflows/ci.yml` y `.github/workflows/empaquetar.yml`, que verifica explícitamente
    la presencia de `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` y
    `webSecurity: true`, rechazando cualquier configuración insegura.

---

## [2.4.0] — 2026-11-14

Autonomía de lectura e inspección 100 % dentro de la aplicación: controles tipográficos
y buscador interno en documentos, navegación rápida entre colecciones y respuestas,
tarjetas interactivas para JSON, puente directo entre *Explorar* y el *Visor integrado*
y auditoría de seguridad SVG en el pipeline de lanzamiento.

### Añadido

- **Controles de lectura y buscador interno en el visor de documentos (`VisorDocumento.tsx`)**:
  - Barra `.visor__lectura-controles` con buscador en vivo (*«Buscar en el documento…»*),
    contador de coincidencias, resaltado contextual `<mark className="visor__mark">` y
    filtro opcional **Solo bloques coincidentes** para localizar párrafos, listas o
    encabezados al instante.
  - Selector persistente de ancho de columna (**Normal** `78ch`, **Ancho** `110ch`,
    **Completo** `100 %` en `localStorage` bajo `'dap_doc_width'`) y selector de
    tipografía (**Sans**, **Serif** y **Mono** en `'dap_doc_font'`).
- **Navegación entre colecciones y respuestas individuales (`ArchiveViewer.tsx` y `Colecciones.tsx`)**:
  - Controles **Anterior** / **Siguiente** colección (`.visor__nav-coleccion`) con
    indicador `(índice / total)` en la cabecera y atajos de teclado `Alt + ←` y
    `Alt + →`.
  - Detección y ordenación numérica (`localeCompare` con `{ numeric: true }`) de
    archivos `replies/*.md` (`respuestasArchivos`) y selector directo **Respuestas (N)**
    con botones `◀` / `▶` y **Volver al post** sin abandonar la pestaña *Documento*.
- **Modo «Vista tarjetas» en JSON, copia de vista CSV y sincronización de tema EPUB**:
  - Conmutador **Vista tarjetas** / **Código JSON** en `VistaJson` para exportaciones
    `post.json` (`extractJsonThreadMessages` en `csvViewerUtils.ts`), mostrando autor,
    fecha, contenido, adjuntos y reacciones en tarjetas `.visor__json-card` filtrables.
  - Botón **Copiar vista filtrada (N)** en `VistaCsv` (`formatCsvRows` conforme a RFC
    4180) para copiar al portapapeles exactamente las filas filtradas y ordenadas.
  - Sincronización automática del lector `EpubViewer` con el tema activo de la
    aplicación (**Tinta oscura**, **Papel claro** y **Pergamino sepia**) a través de
    `document.documentElement.dataset.theme` y el evento `dap:theme`.
- **Puente directo Explorar ↔ Visor integrado y propagación de búsqueda (`uiStore.ts`, `PostList.tsx`, `LiveThreadView.tsx`, `SearchOverlay.tsx`)**:
  - Insignia **En archivo**, chip de filtro rápido **En archivo** (`cached`) con
    contador en `PostList` y botón de salto en 1 clic (*«Abrir copia local en el visor
    integrado»*) tanto en cada fila de `PostList` como en la cabecera de
    `LiveThreadView` (*«Abrir en visor»*).
  - `uiStore.abrirArchivo(ruta, consulta?)` propaga automáticamente el término buscado
    desde `SearchOverlay` (`Ctrl+F`, limpiando operadores `ext:`) hacia
    `VisorDocumento`, `VistaCsv` y `VistaJson`.
- **Endurecimiento de auditoría de lanzamiento y plantillas de repositorio (`scripts/verify-release.mjs`)**:
  - Validación estricta de seguridad en activos SVG (`validateSvgContent`: exige
    `<svg`, `</svg>` y `viewBox=`, y bloquea `<script>`, atributos `on*=`,
    `javascript:` y URLs remotas salvo los namespaces XML estándar).
  - Verificación de `SECURITY.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`,
    `.github/workflows/empaquetar.yml` y `.github/ISSUE_TEMPLATE/config.yml` dentro de
    `npm run verify:release`.

---

## [2.3.0] — 2026-11-14

Consolidación integral de **Estrato**: exportación y visor tabular CSV, salto directo
al visor todo-en-uno desde toda la interfaz, lectura en vivo filtrable, diagnóstico de
integridad y memoria, triple tema editorial y cadena de lanzamiento verificada.

### Añadido

- **Exportación CSV e inspector tabular interactivo**:
  - Nuevo formato `csv` en el pipeline de exportación (`JsonExporter.exportCsv` en
    `src/core/export/json-exporter.ts`) que escribe `messages.csv` y `post.csv` con
    BOM UTF-8, saltos `CRLF`, comillas RFC 4180 y neutralización anti-fórmulas
    (`sanitizeCsvFormula`), integrado también en `_INDEX.md` (`index-generator.ts`)
    y en los ajustes de exportación (`SettingsView`).
  - Nuevo componente `VistaCsv` y utilidades puras `csvViewerUtils.ts`
    (`parseCsvTable` hasta 5 000 filas, `filterAndSortCsvRows` y paginación de 100
    filas por página) con búsqueda instantánea, ordenación por columna (`.visor__csv-tabla`)
    y conmutador entre *Tabla* y *Código fuente*.
- **Visor todo-en-uno multi-formato y galería multimedia filtrable**:
  - Barra `.visor__formatos` en `ArchiveViewer` para alternar directamente dentro de
    una colección entre `post.md`, `thread.md`, `index.md`, `post.html`, `post.json`,
    `post.csv`, `messages.csv`, `export.pdf` y `export.epub`.
  - `VistaHtml` con conmutador *Vista HTML* (`<iframe sandbox="" referrerPolicy="no-referrer">`)
    y *Código fuente* con copia rápida.
  - `VistaJson` enriquecido con barra `.visor__json-meta` (`summarizeArchiveJson`:
    mensajes, autores, adjuntos, reacciones, palabras o claves raíz) y filtrado por
    líneas en vivo.
  - Detección automática ampliada en `Colecciones.tsx` (`messages.csv`, `EXT_VIDEO`,
    `EXT_AUDIO`, etiquetas `.coleccion__formatos` en tarjetas) y filtro `.galeria__filtro`
    (*Todos*, *Imágenes*, *Vídeos*, *Audio*) con reproducción inline de vídeo y audio.
- **Salto directo «Abrir en el visor integrado» (`uiStore.abrirArchivo`)**:
  - Acceso directo al visor desde tareas completadas de la *Cola*, filas de *Historial*
    y *Actividad reciente* en *Panel*, además de los resultados de la búsqueda global
    (`Ctrl+F` + chips por extensión `ext:md`, `ext:html`, `ext:json`, `ext:csv`, `ext:txt`).
- **Exploración y filtrado avanzado en vivo**:
  - Filtrado instantáneo en `ChannelChatView` y `LiveThreadView` mediante
    `chatErrorUtils.ts`: operadores `from:` / `de:`, `has:embed`, `has:pinned` y
    `pinned:true`, chips *Adjuntos*, *Enlaces* y *Fijados*, resumen de estadísticas y
    copia de transcripción en Markdown.
  - Filtros rápidos en `PostList` (*Todos*, *Con adjuntos*, *Fijados*, *Archivados*),
    ordenación, agrupación por etiquetas, selección por rango (`Shift + Clic`), inversión
    y copia de lista.
- **Cola con prioridades, historial CSV y salud del sistema**:
  - Prioridad en cola (`priority DESC, created_at ASC`), búsqueda/filtros por estado en
    *Cola*, copia del historial filtrado como CSV (`Copiar CSV`) y reintento en lote.
  - Monitor de rendimiento en vivo (`app:get-perf-stats`: RAM RSS, heap V8, CPU %,
    cachés LRU y tamaños de `estrato.db` / `-wal`) y optimizador manual
    (`app:optimize-memory`: limpia cachés LRU, poda tareas terminadas y ejecuta
    `wal_checkpoint(PASSIVE)` + `shrink_memory`) en *Panel*, *Ajustes → Sistema* y
    paleta `Ctrl+K`.
  - Verificador local de integridad de caché y base de datos (`cache:verify-integrity` /
    `db.verifyAndRepairCache()`).
- **Triple tema editorial e identidad visual offline**:
  - Nuevo tema **Pergamino sepia** (`:root[data-theme='sepia']`) sumado a **Tinta oscura**
    (`dark`) y **Papel claro** (`light`), sincronizados mediante `ui_theme`,
    `meta[name="theme-color"]` y `dap:theme` entre el riel lateral, `SettingsView` y
    `CommandPalette`.
  - Activos vectoriales 100 % offline `resources/logo-mark.svg` (512×512) y
    `resources/logo-banner.svg` (1200×340), y actualización de `ShortcutsSheet`
    (`Ctrl+Shift+S`, doble clic para zoom 100 % / 200 %).
- **Lanzamiento verificable, empaquetado NSIS y documentación**:
  - Script `scripts/verify-release.mjs` (`npm run verify:release` y modo `--dist` con
    generación de `dist/SHA256SUMS.txt`) + suite `scripts/verify-release.test.ts`.
  - Target instalador NSIS en `package.json` (`npm run package:installer`, `asar: true`)
    y flujo `.github/workflows/empaquetar.yml` con selector `portable` / `nsis` / `ambos`
    y publicación automática de Releases en etiquetas `v*`.
  - Nuevas guías [SECURITY.md](SECURITY.md) y [CONTRIBUTING.md](CONTRIBUTING.md),
    plantillas en `.github/` (`ISSUE_TEMPLATE/`, `pull_request_template.md`, `dependabot.yml`)
    y ampliación de la suite unitaria a 26 archivos de prueba en `src/` y `scripts/`.

### Seguridad

- Endurecimiento frente a escapes por enlaces simbólicos en `src/main/path-guard.ts`
  (`isInsideReal` e `isInsideRealAsync` con caché TTL acotada) aplicado en `archive://`
  (HTTP `403`), lectura de archivos (`archive:read-file`), escaneo (`archive:scan-directory`)
  y apertura en el sistema (`folder:open` / `folder:reveal`), omitiendo `isSymbolicLink()`
  en recorridos y búsquedas.
- Actualización de [AboutView.tsx](src/renderer/components/AboutView.tsx) y
  [docs/SEGURIDAD.md](docs/SEGURIDAD.md) para reflejar con precisión la lista blanca
  `hostsPermitidos` de `app:open-external` (Discord + embeds de YouTube y Vimeo),
  las defensas `isInsideRealAsync` / `<iframe sandbox="">` / CSV sin evaluación y los
  controles locales de privacidad.

---

## [2.2.0] — 2026-11-11

Reescritura de la navegación y del archivo: menos clics, contexto permanente y
previsualización real de lo descargado.

### Añadido

- **Tres paneles persistentes en Explorar**: riel de servidores (72 px, con scroll
  propio), barra de canales (256 px, con buscador, filtros y categorías) y contenido.
  Al abrir un canal **la barra de canales no desaparece**.
- **Selector de servidores** en rejilla, con buscador, `Esc` para cerrar y
  `Ctrl+Shift+S` como atajo.
- **Restauración de contexto**: al volver a Explorar se recupera el último servidor y
  se ofrece «Últimos canales» en el estado vacío.
- **Archivo por colecciones**: las carpetas con `post.md`, `thread.md` o `index.md` se
  detectan solas y se muestran como tarjetas con portada, fecha, mensajes, imágenes y
  peso. Dentro de cada colección: documento, galería y árbol de archivos.
- **Visor de documento tipográfico**: 78 caracteres de medida, tablas reales, figuras
  con pie, imágenes acotadas y metadatos plegables.
- **La búsqueda global abre dentro de la app**: el resultado entra en el visor de la
  colección correspondiente en vez de lanzar el programa del sistema.
- **Sistema de movimiento** (`motion.css`): brillo en skeletons, entrada de vistas,
  listas escalonadas, micro-interacciones de iconos, degradado animado del acento,
  pulso del indicador de conexión y salida animada. Todo respeta
  `prefers-reduced-motion`.

### Corregido

- **Filas mudas en canales de eventos**: los mensajes de sistema (ingreso, mejora,
  fijado) llegaban sin contenido y se pintaban como una fila vacía. Ahora se traducen a
  «se unió al servidor», «mejoró el servidor», etc.
- **Scroll global**: solo scrollea la región de contenido; cabeceras, riel y barra de
  canales quedan fijos.
- **Imágenes del documento** sin límite de alto: una captura vertical ocupaba tres
  pantallas. Ahora se acotan a 420 px y se amplían al hacer clic.
- **Emoji en nombres de canal**: la pila tipográfica no incluía fuente de emoji.
- La flecha de las tarjetas de colección flotaba suelta a la izquierda.

---

## [2.1.0] — 2026-11-11

La app deja de obligar a pasar por una lista intermedia para leer un canal, y el
contenido multimedia se comporta como en Discord.

### Añadido

- **Chat de canal directo**: al pulsar un canal de texto se abre la conversación
  completa, sin la pantalla intermedia de «Canal completo · 1 mensaje».
- **Motor de mensajes compartido** (`components/message/MessageStream`): un solo
  renderizador para el chat de canal y el visor de hilos, con agrupación por autor,
  separadores de día, menciones, emojis personalizados, spoilers y código.
- **GIF y vídeo en reproducción**: los adjuntos de vídeo y los embeds `gifv` se
  reproducen en bucle dentro del mensaje.
- **Visor de imágenes** (`MediaLightbox`): zoom con rueda y botones, copiar enlace y
  cierre con `Esc` sin salir del canal.
- **Vista previa de vídeos externos**: YouTube y Vimeo se muestran como tarjeta con
  miniatura e insignia de reproducción y se abren en el navegador, porque su política
  de incrustación rechaza el origen `file://`.
- **Scroll infinito** en el chat de canal, con conservación de la posición al cargar
  mensajes anteriores y botón «Ir al final».
- **Legal y privacidad rehecha**: siete secciones navegables (resumen, licencia de uso,
  licencias de terceros con 17 componentes reales, privacidad, permisos y seguridad,
  términos de Discord, contacto) y `LICENSE` propietaria en la raíz.

### Corregido

- `Esc` cerraba el visor de imágenes **y además** salía del canal; ahora la capa que
  tiene el foco consume la tecla.
- La CSP bloqueaba los vídeos del CDN de Discord (`media-src` no los incluía).
- Los embeds de YouTube se metían en un `<video>` y solo mostraban un hueco negro.
- La versión visible se congela tras un rebranding: ahora se inyecta desde
  `package.json`.

---

## [2.0.0] — 2026-11-11

Rebranding completo y ampliación del producto. La app pasa a llamarse **Estrato** y
deja de ser un descargador para convertirse en un archivo que se puede **leer, buscar
y explorar sin salir de la aplicación**.

### Añadido

- **Marca nueva**: Estrato («archivo vivo de comunidades»), icono de estratos
  apilados, paleta de tinta cálida con un solo acento cobre y tipografía editorial.
- **Panel**: métricas del archivo (publicaciones, mensajes, archivos, tamaño),
  servidores con más peso con barras proporcionales y actividad reciente.
- **Visor de hilo en vivo**: lee cualquier publicación con formato Discord —avatares,
  agrupación por autor, separadores de día, adjuntos, embeds, reacciones, stickers y
  spoilers— **sin descargarla**. Incluye «Descargar» y «Abrir en Discord».
- **Paleta de comandos** (`Ctrl+K`): navegación, servidores y acciones con teclado.
- **Hoja de atajos** (`Ctrl+/`).
- **Búsqueda global** (`Ctrl+F`): recorre los archivos del archivo local y salta a la
  línea exacta, con extracto y coincidencia resaltada.
- **Riel de seis destinos** con atajos `Ctrl+1..6`.
- **Enlaces externos seguros**: `app:open-external` solo acepta dominios de Discord.
- **Recorrido automático de la interfaz** por CDP (`scripts/recorrido-cdp.mjs`) para
  revisar y capturar todas las vistas.

### Cambiado

- El armazón pasa a barra de título propia + riel lateral; las vistas se cargan con
  `React.lazy` (bundle inicial ~600 KB).
- Estado de interfaz centralizado en `uiStore` (vista, hilo abierto, capas).
- La base de datos pasa a `estrato.db`; se renombra automáticamente desde
  `foro-downloader.db` sin perder la caché.
- El token solo se invalida con un **401**. Un 429 o un fallo de red ya no cierran la
  sesión.
- Tema claro y oscuro sobre los mismos tokens.

### Corregido

- La rejilla de métricas dejaba la cuarta tarjeta sola en una fila.
- Los servidores sin datos dibujaban una barra mínima engañosa.
- El visor de lista mostraba «Canal completo · 0 mensajes» cuando el conteo no estaba
  disponible.
- El resaltado de la búsqueda era casi invisible sobre fondo oscuro.
- El scrim de las capas superpuestas no aislaba lo suficiente el contenido de fondo.
- **El visor en vivo se rendía ante un límite de peticiones de Discord** y culpaba a la
  conexión. Ahora reintenta una vez, avisa de que está reintentando y distingue 429,
  403, 401 y 404 con mensajes accionables.
- La versión visible estaba escrita a mano y se quedó en 1.2.0 tras el rebranding.
  Ahora Vite la inyecta desde `package.json`.
- `folder:open` y `archive:search` resolvían enlaces simbólicos: un symlink dentro de la
  carpeta de salida podía leer fuera de ella. Ahora se valida la ruta real.
- `app:open-external` rechazaba `https://discord.com` sin barra final y aceptaba
  subdominios con prefijo engañoso. Ahora compara el host exacto.

---

## [1.2.0] — 2026-11-11

Reescritura de la capa de presentación, corrección de la sincronización de sesión y
endurecimiento de seguridad. **Cambia el formato de las preferencias** (migración
automática).

### Corregido

- **La sincronización de sesión no encontraba nada.** El base64 del token se recortaba
  a múltiplos de 4 y se perdían los últimos bytes, así que el tag GCM no validaba.
  Ahora se decodifica completo, con su relleno. Cubierto por 9 tests en
  `token-crypto.test.ts`.
- **La ventana arrancaba siempre encima de todo.** `alwaysOnTop` venía activado por
  defecto en las preferencias antiguas. Se desactiva en la migración y hay un
  interruptor en Ajustes.
- **La ventana aparecía cortada o fuera de pantalla.** Se guardaban límites con `x`
  negativo y se maximizaba a la fuerza al arrancar. Ahora se valida contra el área de
  trabajo, se recuerda el estado maximizado y hay un botón *Restablecer ventana*.
- **No se podía reacomodar la ventana.** Ya no se maximiza al inicio; el doble clic en
  la barra de título maximiza y restaura.
- **El historial de descargas era inalcanzable** cuando la cola estaba vacía.
- **El primer trabajo se guardaba en la carpeta equivocada** porque se leía el estado
  antes de elegir el directorio.
- **Cancelar una descarga la marcaba como completada.**
- **La detección de sesión congelaba la interfaz** varios segundos (PowerShell
  sincrónico). Ahora es asíncrona y prueba `powershell` y `pwsh`.
- **Los canales de voz y categorías** se trataban como foros y devolvían error.
- **El `channel_id` de los canales de texto se guardaba como el de la categoría**, lo
  que dejaba el índice vacío.
- **El rate limiter por ruta no funcionaba**: guardaba por hash de cubo y buscaba por
  ruta.
- **La paginación se cortaba a los 10.000 mensajes.** El tope ahora es 1.000.000 y el
  corte real lo marca el cursor.
- **El PDF no encontraba la fuente** en el build empaquetado y perdía los acentos.
- **Los enlaces a adjuntos en `replies/` estaban rotos** (faltaba el `../`).
- **El índice y las carpetas usaban numeraciones distintas.**
- **La purga de caché borraba el archivo SQLite en caliente** y podía colgar la cola.
- **La migración FTS5 estaba rota** (columnas inexistentes). Se elimina en la v4.
- **El HTML exportado no cambiaba de tema** (el botón no hacía nada).
- **Los ajustes fantasma**: `imageQuality` se elimina; el resto ahora se aplica de verdad.

### Seguridad

- `webSecurity: true` (antes desactivado) y `sandbox: true`.
- Protocolo propio `archive://` con validación de rutas; se elimina el acceso
  arbitrario a `file://`.
- El HTML archivado se abre con `sandbox=""` y CSP estricta.
- CSP de ventana en producción; se eliminan las fuentes de Google.
- Navegación externa, ventanas emergentes y permisos del sistema bloqueados.
- Se elimina el canal `auth:get-token`: el renderer nunca ve el token.
- `settings:save-all` aplica whitelist de claves.
- `folder:open` y `folder:reveal` validan que la ruta esté dentro de la salida.

### Añadido

- Sistema de diseño propio: tokens, tipografía editorial, un solo acento, tema claro.
- Armazón nuevo: barra de título propia, riel de navegación y atajos `Ctrl+1..5`.
- Carga diferida de vistas: el bundle inicial baja de 3,5 MB a ~590 KB.
- Diagnóstico por fuente en la detección de sesión.
- `Ctrl+Shift+M` compacta la ventana; `Esc` vuelve a la lista de canales.
- Scripts de desarrollo: generación del icono y captura de la interfaz (CDP y ventana).
- Documentación completa en `docs/`.

### Eliminado

- Dependencias sin uso: `react-json-view`, `pdfjs-dist`, `dompurify`, `i18next`,
  `node-cron`, `node-notifier`, `mime-types`, `turndown`, `framer-motion`,
  `canvas-confetti` (24 → 13 de producción).
- `i18next` y `locales/`: traducían dos cadenas y escribían dentro del `.asar`.
- El trabajo programado cada 4 horas que hacía 50 peticiones para contar respuestas.
- La búsqueda FTS5 (esquema roto, sin interfaz).
- 12 funciones de caché sin ningún llamador.
- `interface IpcChannels`, que duplicaba el contrato con canales inexistentes.

### Cambios de comportamiento

- El token se guarda con prefijo `dpapi:`/`plain:`. Si había caducado, la app lo
  limpia y pide uno nuevo.
- Los adjuntos nuevos usan su nombre original (`preserveFilenames` activado).
- La cola se restaura **en pausa** al abrir la app.
- `strictChannelFiltering` viene desactivado en instalaciones nuevas.

---

## [1.1.0] — 2026-11-11

Primera pasada de corrección tras la auditoría: instalación, empaquetado, motor de
descarga y exportadores.

### Corregido

- `npm install` fallaba por un conflicto de peer dependencies de React 19.
- Faltaba `resources/icon.ico`, así que el empaquetado abortaba.
- La app empaquetada moría al arrancar porque escribía dentro del `.asar`.
- El delta sync calculaba el cursor y nunca lo usaba.
- Los adjuntos se guardaban con nombre de hash; ahora conservan el original.
- La deduplicación inyectaba rutas absolutas de Windows en los exports.
- El EPUB no escapaba el contenido.
- El PDF bloqueaba el proceso principal.
- La barra de progreso nunca llegaba al 100 % y el ETA siempre era `--`.

---

## [1.0.0] — 2026-04-19

Versión inicial: descarga de foros, exportación a Markdown/HTML/JSON/PDF/EPUB,
caché SQLite y visor integrado.
