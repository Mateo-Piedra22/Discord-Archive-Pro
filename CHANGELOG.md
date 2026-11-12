# Historial de cambios

Todas las versiones relevantes. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

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
