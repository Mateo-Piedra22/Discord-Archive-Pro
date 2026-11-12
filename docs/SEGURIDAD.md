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

1. Decodifica la ruta.
2. Comprueba `isInside(outputDirectory, ruta)` con `path.relative`
   (rechaza `..`, rutas absolutas ajenas y prefijos engañosos como
   `C:/archivo-secreto` cuando la raíz es `C:/archivo`).
3. Comprueba que exista y sea un archivo.
4. Sirve el contenido con `net.fetch(pathToFileURL(...))`.
5. Añade una **CSP estricta** a la respuesta:
   `default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.

La misma comprobación se aplica a `archive:scan-directory` y `archive:read-file`.
`folder:open` y `folder:reveal` también validan que la ruta esté dentro de la
carpeta de salida.

Los tests de `src/main/path-guard.test.ts` fijan ese comportamiento.

### 3. Contenido archivado

- HTML: se abre en `<iframe sandbox="">` (sin scripts, sin same-origin) y con
  `referrerPolicy="no-referrer"`.
- El HTML exportado por la app funciona **sin JavaScript**: el cambio de tema es un
  checkbox con selector CSS.
- Markdown: `react-markdown` con `rehype-raw` **no** ejecuta scripts; las URLs
  relativas se reescriben a `archive://` y el resto se deja tal cual.
- El visor de JSON no evalúa nada.

### 4. CSP de la ventana (producción)

En builds empaquetados, `session.defaultSession.webRequest.onHeadersReceived`
inyecta:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net archive:;
font-src 'self' data:;
media-src 'self' archive:;
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
  `app.openExternal`, que solo admite destinos de Discord (apartado 9).

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
- `app:get-stats` no recibe parámetros: el main agrega la base y el directorio de
  salida que él mismo conoce.

### 9. Lectura en vivo, búsqueda y enlaces

**El visor en vivo solo lee.** `discord:get-message-page` termina en
`GET /channels/{id}/messages`. No escribe en disco, no encola descargas y no toca la
caché: lo único que persiste es lo que ya estaba archivado.

**La búsqueda no acepta rutas.** `archive:search` recibe solo el término y el
límite; la raíz la pone el main (`outputDir()`), nunca el renderer. Recorre `.md`,
`.txt`, `.html`, `.json` y `.csv`, ignora `assets/` y los directorios ocultos, y
corta a 4 000 archivos y 2 MB por archivo. Los resultados traen la ruta absoluta
solo para que la interfaz pueda pedir `settings.openFolder`, que vuelve a validar
con `isInside`.

**Los enlaces externos van por lista blanca.** `app:open-external` solo abre:

```
discord://…
https://discord.com/…
https://discordapp.com/…
https://ptb.discord.com/…
https://canary.discord.com/…
```

Cualquier otro destino devuelve `false` y no se abre. La comprobación es por prefijo
de cadena **con barra final**, así que `https://discord.com.evil.tld` no pasa.
Tampoco pasa `http://` sin TLS ni un `javascript:`.

---

## Riesgos residuales

| Riesgo | Estado | Comentario |
|---|---|---|
| El token está en memoria del proceso main | Aceptado | Necesario para firmar peticiones. |
| `safeStorage` sin cifrado disponible | Mitigado | Se marca `plain:` y se avisa en la UI. |
| Un adjunto descargado puede ser malware | Aceptado | No se ejecuta nada; se abre con la app del sistema bajo decisión del usuario. |
| Rate limiting agresivo puede parecer un bloqueo | Aceptado | Preferible a que Discord banee la cuenta. |
| `rehype-raw` permite HTML en Markdown | Mitigado | No ejecuta scripts; la CSP bloquea recursos externos. |
| Un enlace simbólico dentro del archivo puede apuntar fuera | Aceptado | `isInside` valida la ruta, no el destino del enlace; el usuario tendría que crearlo él mismo dentro de su carpeta de salida. |

---

## Buenas prácticas para contribuir

1. **Nunca** añadas un canal IPC que acepte una ruta sin validarla con `isInside`.
2. **Nunca** desactives `webSecurity`, `sandbox` o `contextIsolation` "temporalmente".
3. Si necesitas mostrar contenido externo, hazlo en un `<iframe sandbox="">`.
4. No añadas recursos remotos (fuentes, scripts, CDN) al renderer.
5. Cualquier cambio en `path-guard.ts` requiere actualizar sus tests.
6. No amplíes la lista blanca de `app:open-external` sin una razón escrita: es la
   única vía por la que la app abre algo fuera de sí misma.
7. Los comentarios y los textos de interfaz van **en español**.

---

## Reportar un problema

Abre un issue describiendo: versión, sistema operativo, pasos para reproducir y el
impacto. No incluyas tokens reales en el reporte.
