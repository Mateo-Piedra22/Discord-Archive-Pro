// ============================================================
// Auditoría de manifiesto, recursos y artefactos de lanzamiento
// Uso:
//   node scripts/verify-release.mjs
//   node scripts/verify-release.mjs --dist
// ============================================================

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Cabecera mágica estándar de todo archivo PNG (8 bytes). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Scripts mínimos que debe exponer package.json para compilar, probar y empaquetar. */
const ESSENTIAL_SCRIPTS = ['dev', 'build', 'typecheck', 'test', 'icon', 'package', 'verify:release']

/** Documentación obligatoria que debe acompañar cada lanzamiento. */
const REQUIRED_DOCS = [
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/ARQUITECTURA.md',
  'docs/SEGURIDAD.md',
  'docs/DISENO.md',
  'docs/DESARROLLO.md'
]

/** Recursos vectoriales SVG que deben superar la auditoría estructural y de seguridad. */
const REQUIRED_SVGS = ['resources/logo-mark.svg', 'resources/logo-banner.svg']

/** Archivos mínimos de automatización CI/CD y plantillas de GitHub que deben estar presentes. */
const REQUIRED_GITHUB_FILES = [
  '.github/workflows/ci.yml',
  '.github/workflows/empaquetar.yml',
  '.github/ISSUE_TEMPLATE/config.yml'
]

/** Namespaces XML estándar permitidos en atributos xmlns de recursos SVG locales. */
const ALLOWED_SVG_NAMESPACES = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace'
])

/** Tamaño mínimo esperado (en bytes) para la fuente tipográfica embebida en PDF. */
const MIN_FONT_BYTES = 50 * 1024

/** Expresión regular SemVer (X.Y.Z con sufijo opcional de prelanzamiento o metadatos). */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Convierte un Buffer o Uint8Array a Buffer sin copiar innecesariamente, o devuelve null.
 * @param {unknown} input
 * @returns {Buffer | null}
 */
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  }
  return null
}

/**
 * Comprueba si un valor es una cadena de texto no vacía tras recortar espacios.
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Valida la estructura esencial del manifiesto `package.json` de Estrato.
 * @param {unknown} pkg
 * @returns {{ ok: boolean; errors: string[]; warnings: string[] }}
 */
export function validatePackageManifest(pkg) {
  const errors = []
  const warnings = []

  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return {
      ok: false,
      errors: ['El manifiesto package.json debe ser un objeto JSON válido.'],
      warnings
    }
  }

  if (pkg.name !== 'estrato') {
    errors.push(`Se esperaba "name": "estrato", pero se encontró ${JSON.stringify(pkg.name)}.`)
  }

  if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
    errors.push(`La versión ${JSON.stringify(pkg.version)} no cumple el formato SemVer (X.Y.Z).`)
  }

  if (pkg.main !== './out/main/index.js') {
    errors.push(`El campo "main" debe apuntar a "./out/main/index.js", pero es ${JSON.stringify(pkg.main)}.`)
  }

  if (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) {
    errors.push('Falta el bloque "scripts" en package.json.')
  } else {
    for (const scriptName of ESSENTIAL_SCRIPTS) {
      if (!isNonEmptyString(pkg.scripts[scriptName])) {
        errors.push(`Falta el script obligatorio "${scriptName}" en package.json.`)
      }
    }
    if (!isNonEmptyString(pkg.scripts['package:installer'])) {
      warnings.push('No se encontró el script recomendado "package:installer".')
    }
  }

  if (!pkg.build || typeof pkg.build !== 'object' || Array.isArray(pkg.build)) {
    errors.push('Falta el bloque "build" de electron-builder en package.json.')
  } else {
    if (!isNonEmptyString(pkg.build.appId)) {
      errors.push('Falta "build.appId" en package.json.')
    }
    if (!isNonEmptyString(pkg.build.productName)) {
      errors.push('Falta "build.productName" en package.json.')
    }
    if (!pkg.build.win || typeof pkg.build.win !== 'object' || !isNonEmptyString(pkg.build.win.icon)) {
      errors.push('Falta "build.win.icon" en package.json.')
    }
    if (!Array.isArray(pkg.build.extraResources) || pkg.build.extraResources.length === 0) {
      errors.push('El campo "build.extraResources" debe incluir al menos un recurso adicional.')
    }
    if (pkg.build.asar !== true) {
      warnings.push('Se recomienda habilitar "build.asar": true en package.json.')
    }
    if (!pkg.build.nsis || typeof pkg.build.nsis !== 'object') {
      warnings.push('No se encontró la configuración "build.nsis" para el instalador de Windows.')
    }
    if (!isNonEmptyString(pkg.build.copyright)) {
      warnings.push('Se recomienda definir "build.copyright" en package.json.')
    }
  }

  if (!isNonEmptyString(pkg.description)) {
    warnings.push('El campo "description" está vacío en package.json.')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Valida la cabecera, el chunk IHDR, dimensiones, profundidad y tipo de color de un buffer PNG.
 * @param {Buffer | Uint8Array} buf
 * @param {number} [expectedSize=512]
 * @returns {{ ok: boolean; width?: number; height?: number; error?: string }}
 */
export function validatePngBuffer(buf, expectedSize = 512) {
  const data = toBuffer(buf)
  if (!data) {
    return { ok: false, error: 'La entrada proporcionada no es un Buffer válido.' }
  }

  // Cabecera PNG (8) + longitud IHDR (4) + tipo IHDR (4) + datos IHDR (13) + CRC (4) = 33 bytes
  if (data.length < 33) {
    return { ok: false, error: `Archivo PNG demasiado pequeño (${data.length} bytes; mínimo 33).` }
  }

  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, error: 'Firma mágica PNG inválida (no coincide con 89 50 4e 47 0d 0a 1a 0a).' }
  }

  const ihdrLen = data.readUInt32BE(8)
  const ihdrType = data.toString('ascii', 12, 16)
  if (ihdrType !== 'IHDR' || ihdrLen !== 13) {
    return {
      ok: false,
      error: `Primer chunk PNG inválido: se esperaba "IHDR" de 13 bytes y se recibió "${ihdrType}" (${ihdrLen} bytes).`
    }
  }

  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  const bitDepth = data[24]
  const colorType = data[25]

  if (width === 0 || height === 0) {
    return { ok: false, width, height, error: `Dimensiones PNG inválidas (${width}x${height}).` }
  }

  if (typeof expectedSize === 'number' && (width !== expectedSize || height !== expectedSize)) {
    return {
      ok: false,
      width,
      height,
      error: `Dimensiones PNG inesperadas: se esperaba ${expectedSize}x${expectedSize} y es ${width}x${height}.`
    }
  }

  if (bitDepth !== 8) {
    return {
      ok: false,
      width,
      height,
      error: `Profundidad de bits PNG inesperada: se esperaba 8 y es ${bitDepth}.`
    }
  }

  if (colorType !== 6) {
    return {
      ok: false,
      width,
      height,
      error: `Tipo de color PNG inesperado: se esperaba 6 (RGBA) y es ${colorType}.`
    }
  }

  return { ok: true, width, height }
}

/**
 * Valida la cabecera ICO, el número mínimo de entradas y los límites de tabla/offsets.
 * @param {Buffer | Uint8Array} buf
 * @param {number} [minEntries=5]
 * @returns {{ ok: boolean; count?: number; sizes?: number[]; error?: string }}
 */
export function validateIcoBuffer(buf, minEntries = 5) {
  const data = toBuffer(buf)
  if (!data) {
    return { ok: false, error: 'La entrada proporcionada no es un Buffer válido.' }
  }

  if (data.length < 6) {
    return { ok: false, error: `Archivo ICO demasiado pequeño (${data.length} bytes; mínimo 6).` }
  }

  const reserved = data.readUInt16LE(0)
  const type = data.readUInt16LE(2)
  const count = data.readUInt16LE(4)

  if (reserved !== 0) {
    return { ok: false, error: `Campo reservado ICO inválido: se esperaba 0 y es ${reserved}.` }
  }

  if (type !== 1) {
    return { ok: false, error: `Tipo de recurso ICO inválido: se esperaba 1 (icono) y es ${type}.` }
  }

  if (count === 0 || count < minEntries) {
    return {
      ok: false,
      count,
      error: `El archivo ICO contiene ${count} imágenes y se requieren al menos ${Math.max(1, minEntries)}.`
    }
  }

  const dirEnd = 6 + count * 16
  if (dirEnd > data.length) {
    return {
      ok: false,
      count,
      error: `Tabla de directorios ICO truncada: requiere ${dirEnd} bytes y el archivo tiene ${data.length}.`
    }
  }

  const sizes = []
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16
    const rawW = data[base]
    const size = rawW === 0 ? 256 : rawW
    const bytesInRes = data.readUInt32LE(base + 8)
    const imageOffset = data.readUInt32LE(base + 12)

    if (bytesInRes === 0) {
      return {
        ok: false,
        count,
        sizes,
        error: `La entrada ICO #${i} (${size}px) declara un tamaño de datos de 0 bytes.`
      }
    }

    if (imageOffset < dirEnd) {
      return {
        ok: false,
        count,
        sizes,
        error: `El offset de la entrada ICO #${i} (${imageOffset}) se solapa con la tabla de directorios (${dirEnd}).`
      }
    }

    if (imageOffset + bytesInRes > data.length) {
      return {
        ok: false,
        count,
        sizes,
        error: `La entrada ICO #${i} desborda el archivo (${imageOffset + bytesInRes} > ${data.length}).`
      }
    }

    sizes.push(size)
  }

  return { ok: true, count, sizes }
}

/**
 * Valida la estructura básica y seguridad estática de un recurso vectorial SVG.
 * Rechaza scripts, manejadores de eventos inline, esquemas javascript: y URLs remotas.
 * @param {unknown} svgText
 * @returns {{ ok: boolean; error?: string }}
 */
export function validateSvgContent(svgText) {
  if (typeof svgText !== 'string' || svgText.trim().length === 0) {
    return { ok: false, error: 'El contenido SVG debe ser una cadena de texto no vacía.' }
  }

  if (!/<svg\b/i.test(svgText)) {
    return { ok: false, error: 'El SVG no contiene la etiqueta de apertura <svg>.' }
  }

  if (!/<\/svg\s*>/i.test(svgText)) {
    return { ok: false, error: 'El SVG no contiene la etiqueta de cierre </svg>.' }
  }

  if (!/\bviewBox\s*=/i.test(svgText)) {
    return { ok: false, error: 'El SVG debe declarar el atributo obligatorio viewBox=.' }
  }

  if (/<\s*script\b/i.test(svgText)) {
    return { ok: false, error: 'El SVG contiene una etiqueta <script> prohibida.' }
  }

  if (/\bon\w+\s*=/i.test(svgText)) {
    return { ok: false, error: 'El SVG contiene atributos de eventos inline prohibidos (on*=).' }
  }

  if (/javascript\s*:/i.test(svgText)) {
    return { ok: false, error: 'El SVG contiene una referencia javascript: prohibida.' }
  }

  const urlMatches = svgText.match(/https?:\/\/[^\s"'<>)]*/gi) || []
  for (const rawUrl of urlMatches) {
    if (!ALLOWED_SVG_NAMESPACES.has(rawUrl)) {
      return {
        ok: false,
        error: `El SVG contiene una URL remota no permitida (${rawUrl}).`
      }
    }
  }

  return { ok: true }
}

/**
 * Valida las invariantes de seguridad de Electron en el proceso principal (`src/main/index.ts`).
 * Exige explícitamente `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` y `webSecurity: true`,
 * y rechaza de forma estricta configuraciones inseguras prohibidas.
 * @param {unknown} mainSourceText
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function validateElectronSecurityConfig(mainSourceText) {
  if (typeof mainSourceText !== 'string' || mainSourceText.trim().length === 0) {
    return {
      ok: false,
      errors: ['El código fuente de src/main/index.ts debe ser una cadena de texto no vacía.']
    }
  }

  const errors = []

  const requiredConfigs = [
    { label: 'nodeIntegration: false', re: /\bnodeIntegration\s*:\s*false\b/ },
    { label: 'contextIsolation: true', re: /\bcontextIsolation\s*:\s*true\b/ },
    { label: 'sandbox: true', re: /\bsandbox\s*:\s*true\b/ },
    { label: 'webSecurity: true', re: /\bwebSecurity\s*:\s*true\b/ }
  ]

  for (const req of requiredConfigs) {
    if (!req.re.test(mainSourceText)) {
      errors.push(`Falta la configuración de seguridad obligatoria "${req.label}".`)
    }
  }

  const forbiddenConfigs = [
    { label: 'nodeIntegration: true', re: /\bnodeIntegration\s*:\s*true\b/ },
    { label: 'contextIsolation: false', re: /\bcontextIsolation\s*:\s*false\b/ },
    { label: 'sandbox: false', re: /\bsandbox\s*:\s*false\b/ },
    { label: 'webSecurity: false', re: /\bwebSecurity\s*:\s*false\b/ },
    { label: 'allowRunningInsecureContent: true', re: /\ballowRunningInsecureContent\s*:\s*true\b/ }
  ]

  for (const forbidden of forbiddenConfigs) {
    if (forbidden.re.test(mainSourceText)) {
      errors.push(`Se detectó el patrón inseguro prohibido "${forbidden.label}".`)
    }
  }

  return {
    ok: errors.length === 0,
    errors
  }
}

/**
 * Calcula el resumen SHA-256 de un archivo leyendo por bloques para no saturar RAM.
 * @param {string} filePath
 * @returns {string}
 */
function hashFileSha256Sync(filePath) {
  const hash = crypto.createHash('sha256')
  const chunkSize = 1024 * 1024
  const buffer = Buffer.allocUnsafe(chunkSize)
  const fd = fs.openSync(filePath, 'r')
  try {
    let bytesRead = 0
    while ((bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

/**
 * Calcula líneas formateadas `<sha256>  <basename>` ordenadas alfabéticamente por nombre de archivo.
 * @param {string[]} filePaths
 * @returns {string[]}
 */
export function computeSha256Sums(filePaths) {
  if (!Array.isArray(filePaths)) {
    throw new TypeError('computeSha256Sums espera un arreglo de rutas de archivos.')
  }

  const entries = filePaths.map((filePath) => ({
    name: path.basename(filePath),
    hash: hashFileSha256Sync(filePath)
  }))

  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return entries.map((entry) => `${entry.hash}  ${entry.name}`)
}

/**
 * Ejecuta la auditoría completa del repositorio y opcionalmente de los artefactos en `dist/`.
 * @param {{ rootDir?: string; includeDist?: boolean }} [options]
 * @returns {{ ok: boolean; checks: string[]; warnings: string[]; errors: string[]; sums: string[] }}
 */
export function runReleaseAudit(options = {}) {
  const rootDir = options.rootDir
    ? path.resolve(options.rootDir)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const includeDist = Boolean(options.includeDist)

  const checks = []
  const warnings = []
  const errors = []
  let sums = []

  // 1. Manifiesto package.json
  const pkgPath = path.join(rootDir, 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const manifestResult = validatePackageManifest(pkg)
    warnings.push(...manifestResult.warnings)
    if (manifestResult.ok) {
      checks.push(`package.json válido (${pkg.build.productName} v${pkg.version})`)
    } else {
      errors.push(...manifestResult.errors)
    }
  } catch (err) {
    errors.push(`No se pudo leer o parsear package.json: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. Iconos PNG (512x512) e ICO (mínimo 5 tamaños)
  for (const relIcon of ['resources/icon.png', 'resources/icon-512.png']) {
    const iconPath = path.join(rootDir, relIcon)
    if (!fs.existsSync(iconPath)) {
      errors.push(`Falta el archivo obligatorio ${relIcon}.`)
      continue
    }
    const pngRes = validatePngBuffer(fs.readFileSync(iconPath), 512)
    if (pngRes.ok) {
      checks.push(`${relIcon} válido (${pngRes.width}x${pngRes.height} RGBA 8-bit)`)
    } else {
      errors.push(`${relIcon}: ${pngRes.error}`)
    }
  }

  const icoRel = 'resources/icon.ico'
  const icoPath = path.join(rootDir, icoRel)
  if (!fs.existsSync(icoPath)) {
    errors.push(`Falta el archivo obligatorio ${icoRel}.`)
  } else {
    const icoRes = validateIcoBuffer(fs.readFileSync(icoPath), 5)
    if (icoRes.ok) {
      checks.push(`${icoRel} válido (${icoRes.count} tamaños: ${icoRes.sizes?.join(', ')})`)
    } else {
      errors.push(`${icoRel}: ${icoRes.error}`)
    }
  }

  // 3. Fuente tipográfica para exportación PDF
  const fontRel = 'resources/fonts/Roboto-Regular.ttf'
  const fontPath = path.join(rootDir, fontRel)
  if (!fs.existsSync(fontPath)) {
    errors.push(`Falta la fuente tipográfica obligatoria ${fontRel}.`)
  } else {
    const stat = fs.statSync(fontPath)
    if (!stat.isFile() || stat.size <= MIN_FONT_BYTES) {
      errors.push(
        `${fontRel} debe superar ${Math.round(MIN_FONT_BYTES / 1024)} KB (tamaño actual: ${stat.size} bytes).`
      )
    } else {
      checks.push(`${fontRel} válida (${(stat.size / 1024).toFixed(1)} KB)`)
    }
  }

  // 4. Recursos vectoriales SVG (isotipo y banner)
  for (const svgRel of REQUIRED_SVGS) {
    const svgPath = path.join(rootDir, svgRel)
    if (!fs.existsSync(svgPath)) {
      errors.push(`Falta el recurso SVG obligatorio ${svgRel}.`)
      continue
    }
    const svgRes = validateSvgContent(fs.readFileSync(svgPath, 'utf8'))
    if (svgRes.ok) {
      checks.push(`${svgRel} válido y seguro`)
    } else {
      errors.push(`${svgRel}: ${svgRes.error}`)
    }
  }

  // 5. Documentación clave
  for (const docRel of REQUIRED_DOCS) {
    const docPath = path.join(rootDir, docRel)
    if (!fs.existsSync(docPath)) {
      errors.push(`Falta el documento obligatorio ${docRel}.`)
      continue
    }
    const stat = fs.statSync(docPath)
    if (!stat.isFile() || stat.size === 0) {
      errors.push(`El documento ${docRel} está vacío o no es un archivo regular.`)
    } else {
      checks.push(`${docRel} presente (${stat.size} bytes)`)
    }
  }

  // 6. Flujos CI/CD y plantillas de GitHub
  for (const ghRel of REQUIRED_GITHUB_FILES) {
    const ghPath = path.join(rootDir, ghRel)
    if (!fs.existsSync(ghPath)) {
      errors.push(`Falta el archivo de configuración GitHub obligatorio ${ghRel}.`)
      continue
    }
    const stat = fs.statSync(ghPath)
    if (!stat.isFile() || stat.size === 0) {
      errors.push(`El archivo ${ghRel} está vacío o no es un archivo regular.`)
    } else {
      checks.push(`${ghRel} presente (${stat.size} bytes)`)
    }
  }

  // 7. Invariantes de seguridad de Electron en el proceso principal
  const mainRel = 'src/main/index.ts'
  const mainPath = path.join(rootDir, mainRel)
  if (!fs.existsSync(mainPath)) {
    errors.push(`Falta el archivo principal obligatorio ${mainRel}.`)
  } else {
    const secRes = validateElectronSecurityConfig(fs.readFileSync(mainPath, 'utf8'))
    if (secRes.ok) {
      checks.push(
        `${mainRel} cumple invariantes de seguridad Electron (nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true)`
      )
    } else {
      for (const secErr of secRes.errors) {
        errors.push(`${mainRel}: ${secErr}`)
      }
    }
  }

  // 8. Artefactos compilados en dist/ y generación de SHA256SUMS.txt
  if (includeDist) {
    const distDir = path.join(rootDir, 'dist')
    if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
      errors.push('No existe el directorio dist/ para auditar artefactos empaquetados (--dist).')
    } else {
      const exeFiles = fs
        .readdirSync(distDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
        .map((entry) => path.join(distDir, entry.name))

      if (exeFiles.length === 0) {
        errors.push('No se encontró ningún ejecutable .exe dentro de dist/.')
      } else {
        sums = computeSha256Sums(exeFiles)
        const sumsPath = path.join(distDir, 'SHA256SUMS.txt')
        fs.writeFileSync(sumsPath, `${sums.join('\n')}\n`, 'utf8')
        checks.push(`dist/SHA256SUMS.txt generado para ${exeFiles.length} artefacto(s) .exe`)
      }
    }
  }

  return {
    ok: errors.length === 0,
    checks,
    warnings,
    errors,
    sums
  }
}

/**
 * Determina si el módulo se está ejecutando directamente desde Node CLI sin interferir con imports en tests.
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) return false
  try {
    const entryUrl = pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href
    const selfUrl = pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href
    return entryUrl === selfUrl
  } catch {
    return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  }
}

if (isDirectExecution()) {
  const args = process.argv.slice(2)
  const includeDist = args.includes('--dist')
  const result = runReleaseAudit({ includeDist })

  console.log('=== Verificación de lanzamiento de Estrato ===')
  for (const okMsg of result.checks) {
    console.log(`[OK] ${okMsg}`)
  }
  for (const warnMsg of result.warnings) {
    console.warn(`[AVISO] ${warnMsg}`)
  }
  if (result.sums.length > 0) {
    console.log('Checksums SHA-256:')
    for (const line of result.sums) {
      console.log(`  ${line}`)
    }
  }
  for (const errMsg of result.errors) {
    console.error(`[ERROR] ${errMsg}`)
  }

  if (!result.ok) {
    console.error(`\nAuditoría fallida con ${result.errors.length} error(es).`)
    process.exit(1)
  }

  console.log(`\nAuditoría completada con éxito (${result.checks.length} comprobaciones en verde).`)
}
