# Guía de contribución

¡Gracias por tu interés en mejorar **Estrato**! Este documento resume cómo preparar el entorno local, las reglas técnicas que protegen la calidad y la seguridad del proyecto, y la lista de comprobación previa a cualquier Pull Request.

Para entrar en detalle técnico, apóyate en [docs/DESARROLLO.md](docs/DESARROLLO.md), [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md), [docs/DISENO.md](docs/DISENO.md) y [docs/SEGURIDAD.md](docs/SEGURIDAD.md).

---

## 1. Preparación del entorno

### Requisitos recomendados

- **Sistema operativo:** Windows 10/11 (para ejecutar Electron completo, `better-sqlite3`, DPAPI en `safeStorage` y empaquetado portátil/instalador; la suite TypeScript, Vitest y `verify:release` también corren en Linux CI).
- **Node.js:** v22 LTS (con soporte `node:sqlite` para pruebas; misma versión usada en CI en `.github/workflows/ci.yml`) y `npm`.

### Instalación y arranque

```bash
npm install
npm run dev
```

Si al arrancar aparece un error de versión binaria (`NODE_MODULE_VERSION mismatch`) en `better-sqlite3` o `sharp`, recompila los módulos nativos para Electron:

```bash
npx electron-builder install-app-deps
```

### Aviso obligatorio sobre `ELECTRON_RUN_AS_NODE`

Algunas terminales integradas de editores o shells exportan `ELECTRON_RUN_AS_NODE=1`. Con esa variable activa, `electron.exe` arranca como Node puro, `require('electron')` devuelve una cadena y el proceso principal falla con `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`.

Para arrancar Electron limpio en caso de error:

```bash
# Bash / Git Bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .
```

```powershell
# PowerShell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
.\node_modules\electron\dist\electron.exe .
```

---

## 2. Convenciones estrictas del proyecto

### Idioma

- **Todo en español.** Comentarios de código, nombres de vistas visibles, textos de interfaz, mensajes de error, documentación y plantillas deben estar en español impecable. Solo permanecen en su forma técnica estándar términos consolidados (`IPC`, `WAL`, `CSP`, `BOM`, `debounce`, `listener`, `hash`, `thread`, etc.).

### Contrato único e invariants de Electron / IPC

1. **Contrato único en `src/shared/api.ts`**: todo canal nuevo o modificado entre renderer y main se declara en `AppApi` (`src/shared/api.ts`), se implementa con `ipcRenderer.invoke` en `src/preload/index.ts` y se registra en `setupIpcHandlers()` en `src/main/index.ts`.
2. **Aislamiento intacto y auditado**: nunca desactives `contextIsolation`, ni actives `nodeIntegration`, ni retires `sandbox: true` o `webSecurity: true` del `BrowserWindow` (`validateElectronSecurityConfig` en `scripts/verify-release.mjs` lo verifica de forma automática).
3. **Validación obligatoria de rutas**: cualquier canal IPC o manejador que reciba una ruta del usuario o del archivo debe validarla contra la carpeta de salida usando `isInside`, `isInsideReal` o `isInsideRealAsync` (`src/main/path-guard.ts`), y las operaciones de escaneo deben ignorar enlaces simbólicos.
4. **Limpieza de suscripciones**: las escuchas IPC declaradas en `window.api` devuelven una función `unsub()`; límpialas siempre en el retorno de `useEffect`.
5. **Núcleo desacoplado y asíncrono**: los módulos bajo `src/core/` no pueden importar React ni bloquear rutas calientes con E/S síncrona excesiva o bucles largos sin ceder al event loop (`setImmediate`).
6. **Cero recursos remotos en la UI, flujo autónomo in-app y activos SVG auditados**: ninguna fuente web ni librería externa desde CDN, y ninguna llamada automática a `shell.openPath` al finalizar descargas (la apertura se realiza dentro del visor integrado). La tipografía de PDF (`resources/fonts/Roboto-Regular.ttf`) y los iconos viven en local, y cualquier SVG bajo `resources/` debe cumplir la validación de seguridad `validateSvgContent` en `scripts/verify-release.mjs` (sin `<script>`, sin atributos `on*=`, sin `javascript:` y sin URLs remotas).

### Sistema de diseño y tres temas editoriales

- Usa exclusivamente los tokens de [src/renderer/assets/styles/tokens.css](src/renderer/assets/styles/tokens.css) y las clases definidas en [src/renderer/assets/styles/base.css](src/renderer/assets/styles/base.css) y [src/renderer/assets/styles/components.css](src/renderer/assets/styles/components.css).
- **Prohibido introducir colores hexadecimales, radios o espaciados literales** en nuevos estilos cuando exista un token equivalente; los estilos inline se reservan para valores dinámicos calculados en tiempo de ejecución (anchos porcentuales, escalado, rotaciones).
- Cualquier ajuste visual en componentes o en el visor integrado debe verse nítido y legible en los **tres temas** de Estrato:
  - **Tinta oscura** (`dark`)
  - **Papel claro** (`light`)
  - **Pergamino sepia** (`sepia`)
- Consulta las reglas visuales detalladas en [docs/DISENO.md](docs/DISENO.md).

### Pruebas y verificaciones

- Toda lógica pura nueva o corregida (parsers, filtros, exportadores, validadores de rutas o scripts de verificación) debe incorporar su suite unitaria `*.test.ts` junto al módulo (cubiertas por `vitest.config.ts` en `src/**/*.test.ts` y `scripts/**/*.test.ts`).
- Para migraciones SQLite en `src/core/storage/migrations.ts`, añade siempre una nueva entrada incremental e idempotente; nunca edites migraciones ya publicadas.

---

## 3. Lista de verificación antes de abrir un Pull Request

Antes de enviar tu Pull Request (siguiendo [.github/pull_request_template.md](.github/pull_request_template.md)), ejecuta localmente:

```bash
npm run typecheck
npm test
npm run build
npm run verify:release
```

Y comprueba manualmente los puntos clave:

- [ ] `npm run typecheck`, `npm test`, `npm run build` y `npm run verify:release` terminan con código `0`.
- [ ] Si modificaste la UI o el visor integrado, verificaste los tres temas (`Tinta oscura`, `Papel claro`, `Pergamino sepia`, incluida su sincronización con el lector EPUB), el modo `Explorador de archivos` raíz y los atajos (`Ctrl+K`, `Ctrl+F`, `Ctrl+/`, `Ctrl+1..6`, `Alt+←` / `Alt+→`, `Alt+1/2/3`, `Esc`).
- [ ] Todos los textos visibles y comentarios de código están en español.
- [ ] Si reportas un bug o propones una mejora, utiliza las plantillas de [.github/ISSUE_TEMPLATE/bug_report.md](.github/ISSUE_TEMPLATE/bug_report.md) y [.github/ISSUE_TEMPLATE/feature_request.md](.github/ISSUE_TEMPLATE/feature_request.md) (configuradas en [.github/ISSUE_TEMPLATE/config.yml](.github/ISSUE_TEMPLATE/config.yml)), sin adjuntar jamás tokens ni datos personales.
- [ ] Revisa [SECURITY.md](SECURITY.md) si tu cambio afecta a protocolo `archive://`, rutas, activos SVG, descargas, exportadores o `BrowserWindow`.
