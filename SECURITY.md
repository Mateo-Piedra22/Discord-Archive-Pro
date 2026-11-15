# Política de seguridad

Estrato es una aplicación de escritorio **100 % local y sin telemetría** para archivar comunidades de Discord en tu propio disco. No existe servidor central, servicio en la nube ni recopilación de analíticas: todas las credenciales, índices y documentos viven únicamente en el equipo del usuario.

---

## Versiones con soporte

| Serie de versión | Estado | Cobertura |
|---|---|---|
| `2.5.x` | Soporte activo | Parches de seguridad, endurecimiento IPC/Electron, auditoría estática Electron (`validateElectronSecurityConfig`) y SVG (`validateSvgContent`) y correcciones críticas |
| `< 2.5.0` | Sin soporte | Se recomienda actualizar a la última publicación de `2.5.x` |

---

## Reporte responsable de vulnerabilidades

Si detectas una vulnerabilidad de seguridad (por ejemplo: escape de rutas en `archive://`, elusión de `path-guard.ts`, exposición accidental del token, ejecución de scripts en HTML/Markdown/CSV/SVG o bypass de CSP), sigue estas pautas:

1. **No publiques un exploit reproducible en un incidente abierto** si pone en riesgo a otros usuarios; prioriza una comunicación privada a través del canal privado del repositorio del proyecto (Security Advisory cuando esté disponible) o abre un informe en [la plantilla de error](.github/ISSUE_TEMPLATE/bug_report.md) (o desde el selector configurado en [.github/ISSUE_TEMPLATE/config.yml](.github/ISSUE_TEMPLATE/config.yml)) marcando desde el primer párrafo que se trata de un fallo de seguridad y omitiendo cualquier payload destructivo público hasta coordinar la corrección.
2. **Describe con precisión**:
   - Versión exacta de Estrato (p. ej. `2.5.0`) y modalidad (`Estrato.exe` portátil, instalador NSIS o `npm run dev`).
   - Superficie afectada (`main`, `preload`, protocolo `archive://`, `core`, `renderer` o empaquetado).
   - Pasos mínimos para reproducir el problema con datos ficticios y el impacto observado frente al esperado.
3. **Regla estricta — qué NO debes adjuntar nunca**:
   - **Nunca adjuntes tokens reales de Discord**, cabeceras `Authorization`, volcados de LevelDB ni el campo `encryptedToken` de `data/preferences.json`.
   - **Nunca adjuntes** bases de datos `data/estrato.db`, registros personales ni exportaciones de conversaciones privadas o comunidades cerradas.
   - Si sospechas que tu token personal de Discord se ha expuesto, **cambia tu contraseña o revoca tus sesiones en Discord de inmediato** y cierra sesión en Estrato (el canal `auth:clear` borra el token almacenado en `data/preferences.json`).

---

## Resumen de controles técnicos verificables

La arquitectura técnica y el modelo de amenazas completo se detallan en [docs/SEGURIDAD.md](docs/SEGURIDAD.md). En la versión `2.5.0`, las principales salvaguardas implementadas en el código son:

### 1. Aislamiento del proceso de interfaz (`Electron` + `preload`)

- **`BrowserWindow` endurecido y auditado estáticamente** en [src/main/index.ts](src/main/index.ts): `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` y `webSecurity: true`, verificados en cada ejecución de `npm run verify:release` mediante `validateElectronSecurityConfig`.
- **Puente tipado único**: el renderer no accede a Node ni al sistema de archivos; únicamente consume el objeto `window.api` definido en [src/shared/api.ts](src/shared/api.ts) y expuesto mediante `contextBridge` en [src/preload/index.ts](src/preload/index.ts).
- **Navegación, ventanas emergentes y permisos bloqueados**: se rechazan `setWindowOpenHandler`, navegaciones externas (`will-navigate`), `<webview>` (`will-attach-webview`) y cualquier permiso del navegador (cámara, micrófono, geolocalización, notificaciones o portapapeles). Al completarse las descargas, Estrato nunca invoca `shell.openPath` por su cuenta: abre la colección directamente dentro del visor integrado.

### 2. Confinamiento de rutas y defensa frente a enlaces simbólicos

- **Validación canónica de rutas** en [src/main/path-guard.ts](src/main/path-guard.ts): `isInside` (léxica), `isInsideReal` (síncrona con `realpath`) e `isInsideRealAsync` (asíncrona con caché TTL acotada del directorio raíz).
- **Protocolo `archive://` y lectura `archive:read-file` confinados**: toda petición en `archive://` y en `archive:read-file` (lectura asíncrona con `fs.promises.open` y tope de 4 MB) pasa por `isInsideRealAsync(outputDir, filePath)`; cualquier intento de path traversal o enlace simbólico que apunte fuera de la carpeta de salida se rechaza (`HTTP 403` o `null`).
- **Escaneo y búsqueda global seguros**: `archive:scan-directory` y `archive:search` omiten enlaces simbólicos (`entry.isSymbolicLink()`) y validan la raíz antes de recorrer o leer archivos (con límites de profundidad, entradas y tamaño).

### 3. Visor local sin ejecución de scripts ni fórmulas

- **HTML archivado aislado**: tanto las cabeceras de respuesta de `archive://` como el componente `<iframe sandbox="">` en el visor integrado bloquean JavaScript activo en archivos `.html`.
- **CSV seguro al exportar y al leer**: `JsonExporter.exportCsv` ([src/core/export/json-exporter.ts](src/core/export/json-exporter.ts)) neutraliza prefijos de inyección de fórmulas (`=`, `+`, `@`, `\t` y `-` no numérico) mediante `sanitizeCsvFormula` con comillas RFC 4180 y BOM UTF-8; la exportación tabular del historial (`DownloadsView.tsx`) aplica comillas RFC 4180, y el visor de tablas CSV procesa el texto en memoria como celdas planas sin evaluación ni HTML dinámico.
- **JSON y Markdown sin `eval`**: el inspector JSON analiza con `JSON.parse` estándar sobre texto local (tope de lectura de 4 MB en `archive:read-file`); la CSP de producción (`script-src 'self'`, `frame-src archive:`, `object-src 'none'`, `base-uri 'none'`) impide scripts inline o remotos en la aplicación.

### 4. Credenciales locales y red restringida

- **Almacenamiento del token**: se guarda en `data/preferences.json` mediante [src/core/storage/encrypted-store.ts](src/core/storage/encrypted-store.ts) con `safeStorage` (DPAPI en Windows bajo prefijo `dpapi:`). Si el sistema no ofrece cifrado OS-level, recurre de forma explícita a `plain:<base64>`.
- **Lista blanca de enlaces externos**: `app:open-external` solo acepta el esquema `discord:` y destinos `https:` hacia `discord.com`, `discordapp.com`, `ptb.discord.com`, `canary.discord.com` y reproductores de vídeo embebidos (`youtube.com`, `www.youtube.com`, `youtu.be`, `vimeo.com`, `player.vimeo.com`).
- **Descargo sobre automatización**: Estrato opera únicamente en modo lectura sobre canales visibles para tu cuenta y aplica control de ritmo (`RateLimiter`), pero el uso de un token de usuario puede contravenir los Términos de Servicio de Discord; la responsabilidad del uso corresponde al usuario.

---

## Verificación de integridad de publicaciones, invariantes Electron y activos SVG

Antes de distribuir o instalar una compilación de Estrato desde las publicaciones oficiales:

- `npm run verify:release` ([scripts/verify-release.mjs](scripts/verify-release.mjs)) audita en cada integración continua que `src/main/index.ts` cumpla `validateElectronSecurityConfig` (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, sin flags inseguros) y que los activos vectoriales (`resources/logo-mark.svg` y `resources/logo-banner.svg`) superen `validateSvgContent` (sin `<script>`, sin manejadores `on*=`, sin `javascript:` ni URLs remotas fuera de los namespaces XML estándar), además de comprobar iconos binarios, fuente PDF, documentación obligatoria y flujos `.github/`.
- El flujo de empaquetado ejecuta `node scripts/verify-release.mjs --dist` para comprobar manifiesto, recursos y generar `dist/SHA256SUMS.txt`.
- En Windows puedes comprobar la huella SHA-256 de `Estrato.exe` o `Estrato-Setup-2.5.0.exe` frente a `SHA256SUMS.txt` con PowerShell:

```powershell
Get-FileHash .\Estrato.exe -Algorithm SHA256
```

---

Para consultar el detalle completo de controles y límites asumidos, visita [docs/SEGURIDAD.md](docs/SEGURIDAD.md). Para guías de contribución y desarrollo, consulta [CONTRIBUTING.md](CONTRIBUTING.md).
