<div align="center">

<img src="resources/icon-512.png" alt="Estrato" width="112" height="112" />

# Estrato

**Archivo vivo de comunidades de Discord.**

Lee, busca y conserva conversaciones enteras en archivos locales que siguen
funcionando dentro de veinte años.

Markdown · HTML · JSON · PDF · EPUB

[![Electron](https://img.shields.io/badge/Electron-34-2b2d31?logo=electron&logoColor=white)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)](#)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003b57?logo=sqlite&logoColor=white)](#)
[![License](https://img.shields.io/badge/Licencia-Propietaria-8a5a2b)](#licencia)

</div>

---

## Qué es

Una herramienta de escritorio para **preservar** comunidades de Discord. Descarga el
historial de un hilo o canal, guarda los adjuntos y genera un archivo que puedes abrir
sin depender de Discord.

No es un cliente ni un bot: usa tu token personal contra la API oficial, solo lee lo
que tú ya puedes leer, y nunca escribe nada en Discord.

> **Aviso.** Usar un token de usuario contra la API puede contravenir los
> [Términos de Servicio de Discord](https://discord.com/terms). Es tu responsabilidad.
> Estrato no está afiliado ni respaldado por Discord Inc.

---

## Lo que puedes hacer sin salir de la app

| | |
|---|---|
| **Leer un hilo al instante** | Pulsa el icono de libro en cualquier publicación y léela con formato Discord —adjuntos, embeds, reacciones, spoilers— sin descargar nada. |
| **Buscar en todo tu archivo** | `Ctrl+F` recorre todos los `.md`, `.html`, `.json` y `.csv` descargados y te lleva a la línea exacta. |
| **Panel de situación** | Cuántas publicaciones, mensajes, archivos y espacio; qué servidores pesan más y qué se archivó últimamente. |
| **Paleta de comandos** | `Ctrl+K` para ir a cualquier vista, servidor o acción sin tocar el ratón. |
| **Visor de archivo** | Árbol de archivos, Markdown renderizado, imágenes con zoom, PDF y lector de EPUB integrados. |
| **Cola con historial** | Progreso por fases, velocidad, ETA, reintentos y registro de todo lo exportado. |

---

## Instalación

```bash
npm install      # instala y recompila better-sqlite3 para Electron
npm run dev      # desarrollo con recarga en caliente
npm run build    # compila main, preload y renderer en out/
npm run package  # genera dist/Estrato.exe (portable)
```

Calidad:

```bash
npm run typecheck   # TypeScript en los dos proyectos
npm run test        # suite de vitest
npm run icon        # regenera resources/icon.ico
```

> `npm install` ejecuta `electron-builder install-app-deps`, que recompila
> `better-sqlite3` contra el ABI de Electron. Sin eso, la app muere al arrancar con
> `NODE_MODULE_VERSION mismatch`.

---

## Primer arranque

**Detección automática.** Pulsa *Detectar sesión*: Estrato lee el almacén del cliente
de Discord, descifra la clave con DPAPI y valida el token contra la API. Verás el
resultado de **cada fuente analizada** (Discord, Chrome, Edge, Brave…) con el motivo
cuando no encuentra nada.

**Token manual.** Discord en el navegador → `F12` → *Application* → *Local Storage* →
`https://discord.com` → clave `token`.

El token se guarda cifrado con el almacén del sistema (`dpapi:` en
`data/preferences.json`). Si el sistema no ofrece cifrado, se marca `plain:` para que
quede claro que no lo está. Un 401 lo invalida; un fallo de red o un 429 **no**.

---

## La interfaz

Un riel con seis destinos y una barra de título propia.

| Vista | Qué hace | Atajo |
|---|---|---|
| **Panel** | Métricas y actividad del archivo | `Ctrl+1` |
| **Explorar** | Riel de servidores + canales + conversación, siempre a la vista | `Ctrl+2` |
| **Cola** | Descargas en curso e historial | `Ctrl+3` |
| **Archivo** | Colecciones detectadas solas, con documento y galería | `Ctrl+4` |
| **Ajustes** | Preferencias y mantenimiento | `Ctrl+5` |
| **Legal** | Licencia, licencias de terceros, privacidad y permisos | `Ctrl+6` |

Explorar es un layout de tres paneles: el riel de servidores y la barra de canales no se
mueven cuando scrolleas la conversación. Pulsar un canal abre el chat al instante, y los
foros muestran su lista de publicaciones en el mismo panel. `Ctrl+Shift+S` abre el
selector de servidores.

En Archivo no hay que navegar carpeta por carpeta: las colecciones se detectan por sus
documentos y se muestran con portada, fecha y peso. La búsqueda global abre el resultado
dentro de la app, en su colección.

Atajos: `Ctrl+K` paleta · `Ctrl+F` búsqueda global · `Ctrl+/` hoja de atajos ·
`Esc` vuelve o cierra · `Ctrl+Shift+M` compacta la ventana · doble clic en la barra
de título maximiza.

---

## Ajustes que cambian el resultado

| Ajuste | Efecto real |
|---|---|
| Formatos | Qué archivos se generan por publicación |
| Estructura de hilos | `single` → `post.md` + `thread.md`; `separate` → `post.md` + `replies/`; `both` → todo |
| Carpetas | `by-server`, `flat` o `by-date` |
| Patrón de nombre | Placeholders `{num}`, `{date}`, `{title}` |
| Formato de fecha | `YYYY-MM-DD`, `DD-MM-YYYY`, `YYYYMMDD` |
| Preservar nombres | Nombre original del adjunto en vez de `<hash>.<ext>` |
| Tamaño máximo | Omite adjuntos mayores (0 = sin límite) |
| Descargas simultáneas | 1–10 |
| Reexportar siempre | Ignora la caché y vuelve a generar |
| Filtros de contenido | Qué assets se descargan y qué secciones entran en el Markdown |

> Los formatos de documento (HTML, PDF, EPUB) siempre incluyen el texto: un PDF sin
> cuerpo no tendría sentido.

---

## Estructura de salida

```
<destino>/
└── Mi Servidor/
    └── general/
        ├── _INDEX.md
        ├── 001_2026-01-02_Cómo empezar/
        │   ├── post.md
        │   ├── thread.md
        │   ├── replies/
        │   │   ├── 001_alice.md
        │   │   └── 002_bob.md
        │   ├── post.html
        │   ├── post.json
        │   ├── export.pdf
        │   ├── export.epub
        │   └── assets/
        │       ├── images/
        │       ├── videos/
        │       └── files/
        └── 002_2026-01-05_Proyecto/
```

Los enlaces son **siempre relativos** (`assets/images/foto.png`, y
`../assets/images/foto.png` desde `replies/`). Mueve la carpeta y sigue funcionando.

---

## Seguridad

Resumen; el detalle está en [docs/SEGURIDAD.md](docs/SEGURIDAD.md).

- `webSecurity`, `sandbox` y `contextIsolation` activos; `nodeIntegration` desactivado.
- Los archivos locales se sirven por un protocolo propio `archive://` que **solo**
  entrega rutas dentro del directorio de salida.
- El HTML archivado se abre en un `<iframe sandbox="">` sin scripts, con CSP estricta.
- El renderer nunca recibe el token.
- Los enlaces externos solo pueden apuntar a Discord.
- Sin telemetría, sin servidor central, sin recursos remotos en la interfaz.

---

## Datos

| Qué | Dónde |
|---|---|
| Base de datos y preferencias | `data/` junto al ejecutable (o junto al `.exe` real en el build portable) |
| Exportaciones | La carpeta que elijas en Ajustes |

Borrar `data/` elimina la caché y la configuración; los archivos exportados no se tocan.

---

## Limitaciones conocidas

- El limitador es conservador (~2 peticiones/s). Un canal de 100.000 mensajes tarda.
- El PDF es de solo texto: incrusta imágenes de adjuntos, no tablas ni emojis a color.
- El EPUB no incrusta imágenes remotas, para seguir siendo legible sin conexión.
- La búsqueda global recorre archivos, no mantiene un índice: en archivos muy grandes
  puede tardar y avisa cuando trunca resultados.
- La detección automática no puede descifrar el cifrado ligado a la aplicación
  (`v20`) de los navegadores modernos; la interfaz lo dice en lugar de fallar en silencio.
- No hay archivado programado; la sincronización es manual.

---

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md) — capas, contratos y decisiones.
- [Seguridad](docs/SEGURIDAD.md) — modelo de amenaza y controles.
- [Diseño](docs/DISENO.md) — sistema de diseño e identidad.
- [Desarrollo](docs/DESARROLLO.md) — convenciones y cómo extender.
- [Cambios](CHANGELOG.md) — historial de versiones.

---

## Licencia

Licencia propietaria: uso personal permitido, redistribución y venta no. El texto
completo está en [`LICENSE`](LICENSE) y resumido dentro de la app, en **Legal y
privacidad**, junto con las licencias de terceros. No afiliada ni respaldada por
Discord Inc.
