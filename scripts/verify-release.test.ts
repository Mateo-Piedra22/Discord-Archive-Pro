import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  computeSha256Sums,
  runReleaseAudit,
  validateElectronSecurityConfig,
  validateIcoBuffer,
  validatePackageManifest,
  validatePngBuffer,
  validateSvgContent
} from './verify-release.mjs'

/** Construye un manifiesto mínimo válido de Estrato para las pruebas. */
function makeValidManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: 'estrato',
    version: '2.5.0',
    description: 'Estrato — Archivo vivo de comunidades de Discord en disco local',
    main: './out/main/index.js',
    scripts: {
      dev: 'electron-vite dev',
      build: 'electron-vite build',
      typecheck: 'tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit',
      test: 'vitest run',
      icon: 'node scripts/generate-icon.js',
      package: 'npm run build && electron-builder --win portable',
      'package:installer': 'npm run build && electron-builder --win nsis --publish never',
      'verify:release': 'node scripts/verify-release.mjs'
    },
    build: {
      appId: 'com.estrato.app',
      productName: 'Estrato',
      copyright: 'Copyright © 2026 Estrato',
      asar: true,
      win: {
        target: 'portable',
        icon: 'resources/icon.ico'
      },
      nsis: {
        oneClick: false
      },
      extraResources: [{ from: 'resources/fonts', to: 'fonts' }]
    },
    ...overrides
  }
}

/** Construye un buffer PNG sintético mínimo válido con cabecera e IHDR de 13 bytes. */
function makePngBuffer(options: {
  width?: number
  height?: number
  bitDepth?: number
  colorType?: number
  chunkType?: string
  chunkLength?: number
} = {}): Buffer {
  const {
    width = 512,
    height = 512,
    bitDepth = 8,
    colorType = 6,
    chunkType = 'IHDR',
    chunkLength = 13
  } = options

  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(chunkLength, 8)
  buf.write(chunkType, 12, 4, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  buf[24] = bitDepth
  buf[25] = colorType
  return buf
}

/** Construye un buffer ICO sintético válido con entradas cuadradas y cargas útiles alineadas. */
function makeIcoBuffer(sizes: number[], payloadSize = 16): Buffer {
  const count = sizes.length
  const dirEnd = 6 + count * 16
  const totalSize = dirEnd + count * payloadSize
  const buf = Buffer.alloc(totalSize)

  buf.writeUInt16LE(0, 0)
  buf.writeUInt16LE(1, 2)
  buf.writeUInt16LE(count, 4)

  let offset = dirEnd
  sizes.forEach((size, index) => {
    const base = 6 + index * 16
    const byteSize = size >= 256 ? 0 : size
    buf[base] = byteSize
    buf[base + 1] = byteSize
    buf.writeUInt16LE(1, base + 4)
    buf.writeUInt16LE(32, base + 6)
    buf.writeUInt32LE(payloadSize, base + 8)
    buf.writeUInt32LE(offset, base + 12)
    offset += payloadSize
  })

  return buf
}

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-verify-release-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('validatePackageManifest', () => {
  it('acepta un manifiesto completo y válido de Estrato', () => {
    const res = validatePackageManifest(makeValidManifest())
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([])
  })

  it('rechaza entradas que no son objetos JSON válidos', () => {
    for (const invalid of [null, undefined, 'estrato', 42, []]) {
      const res = validatePackageManifest(invalid)
      expect(res.ok).toBe(false)
      expect(res.errors.length).toBeGreaterThan(0)
    }
  })

  it('detecta nombre incorrecto, punto de entrada erróneo y SemVer inválida', () => {
    const badVersions = ['2.3', 'v2.3.0', '2.3.0 beta', 'invalida', '']
    for (const version of badVersions) {
      const res = validatePackageManifest(
        makeValidManifest({ name: 'otro-paquete', version, main: './dist/index.js' })
      )
      expect(res.ok).toBe(false)
      expect(res.errors.some((e) => e.includes('name'))).toBe(true)
      expect(res.errors.some((e) => e.includes('SemVer'))).toBe(true)
      expect(res.errors.some((e) => e.includes('main'))).toBe(true)
    }
  })

  it('acepta sufijos SemVer estándar como prelanzamiento', () => {
    const res = validatePackageManifest(makeValidManifest({ version: '2.3.0-rc.1' }))
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
  })

  it('exige todos los scripts esenciales y campos críticos de build', () => {
    const base = makeValidManifest()
    const scriptsSinVerify = { ...base.scripts } as Record<string, string>
    delete scriptsSinVerify['verify:release']
    delete scriptsSinVerify.icon

    const res = validatePackageManifest({
      ...base,
      scripts: scriptsSinVerify,
      build: {
        appId: '',
        productName: '',
        win: {},
        extraResources: []
      }
    })

    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('verify:release'))).toBe(true)
    expect(res.errors.some((e) => e.includes('"icon"'))).toBe(true)
    expect(res.errors.some((e) => e.includes('build.appId'))).toBe(true)
    expect(res.errors.some((e) => e.includes('build.productName'))).toBe(true)
    expect(res.errors.some((e) => e.includes('build.win.icon'))).toBe(true)
    expect(res.errors.some((e) => e.includes('build.extraResources'))).toBe(true)
  })

  it('emite advertencias sin invalidar cuando faltan campos recomendados opcionales', () => {
    const base = makeValidManifest()
    const scripts = { ...base.scripts } as Record<string, string>
    delete scripts['package:installer']

    const res = validatePackageManifest({
      ...base,
      description: '',
      scripts,
      build: {
        appId: 'com.estrato.app',
        productName: 'Estrato',
        win: { target: 'portable', icon: 'resources/icon.ico' },
        extraResources: [{ from: 'resources/fonts', to: 'fonts' }]
      }
    })

    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
    expect(res.warnings.length).toBeGreaterThanOrEqual(4)
  })
})

describe('validatePngBuffer', () => {
  it('valida correctamente un PNG RGBA de 512x512 y tamaños personalizados', () => {
    const png512 = makePngBuffer({ width: 512, height: 512 })
    expect(validatePngBuffer(png512)).toEqual({ ok: true, width: 512, height: 512 })

    const png256 = makePngBuffer({ width: 256, height: 256 })
    expect(validatePngBuffer(png256, 256)).toEqual({ ok: true, width: 256, height: 256 })
  })

  it('rechaza buffers vacíos, truncados o no binarios', () => {
    expect(validatePngBuffer(Buffer.alloc(0)).ok).toBe(false)
    expect(validatePngBuffer(Buffer.alloc(20)).ok).toBe(false)
    // @ts-expect-error prueba defensiva con entrada inválida en tiempo de ejecución
    expect(validatePngBuffer('no-buffer').ok).toBe(false)
  })

  it('rechaza firma mágica PNG corrupta o chunk inicial distinto de IHDR', () => {
    const badSig = makePngBuffer()
    badSig[0] = 0x00
    const sigRes = validatePngBuffer(badSig)
    expect(sigRes.ok).toBe(false)
    expect(sigRes.error).toContain('Firma mágica')

    const badChunk = makePngBuffer({ chunkType: 'IDAT' })
    const chunkRes = validatePngBuffer(badChunk)
    expect(chunkRes.ok).toBe(false)
    expect(chunkRes.error).toContain('IHDR')
  })

  it('rechaza dimensiones incorrectas, bit depth distinto de 8 y color distinto de RGBA', () => {
    const wrongDims = makePngBuffer({ width: 256, height: 256 })
    const dimRes = validatePngBuffer(wrongDims, 512)
    expect(dimRes.ok).toBe(false)
    expect(dimRes.width).toBe(256)
    expect(dimRes.height).toBe(256)

    const wrongDepth = makePngBuffer({ bitDepth: 16 })
    expect(validatePngBuffer(wrongDepth).ok).toBe(false)

    const wrongColor = makePngBuffer({ colorType: 2 })
    expect(validatePngBuffer(wrongColor).ok).toBe(false)
  })
})

describe('validateIcoBuffer', () => {
  it('valida un ICO con 7 tamaños incluyendo 256px codificado como 0', () => {
    const ico = makeIcoBuffer([16, 24, 32, 48, 64, 128, 256])
    const res = validateIcoBuffer(ico, 5)
    expect(res).toEqual({
      ok: true,
      count: 7,
      sizes: [16, 24, 32, 48, 64, 128, 256]
    })
  })

  it('rechaza buffers pequeños o con cabecera ICO inválida', () => {
    expect(validateIcoBuffer(Buffer.alloc(4)).ok).toBe(false)

    const badReserved = makeIcoBuffer([16, 24, 32, 48, 64])
    badReserved.writeUInt16LE(99, 0)
    expect(validateIcoBuffer(badReserved).ok).toBe(false)

    const badType = makeIcoBuffer([16, 24, 32, 48, 64])
    badType.writeUInt16LE(2, 2)
    expect(validateIcoBuffer(badType).ok).toBe(false)
  })

  it('rechaza un ICO con menos entradas de las requeridas', () => {
    const ico = makeIcoBuffer([16, 32, 48])
    const res = validateIcoBuffer(ico, 5)
    expect(res.ok).toBe(false)
    expect(res.count).toBe(3)
  })

  it('rechaza tablas truncadas, solapamientos y offsets que desbordan el buffer', () => {
    const truncated = makeIcoBuffer([16, 24, 32, 48, 64]).subarray(0, 40)
    expect(validateIcoBuffer(truncated, 5).ok).toBe(false)

    const overlap = makeIcoBuffer([16, 24, 32, 48, 64])
    overlap.writeUInt32LE(10, 6 + 12)
    expect(validateIcoBuffer(overlap, 5).ok).toBe(false)

    const overflow = makeIcoBuffer([16, 24, 32, 48, 64])
    overflow.writeUInt32LE(999999, 6 + 12)
    expect(validateIcoBuffer(overflow, 5).ok).toBe(false)

    const zeroLen = makeIcoBuffer([16, 24, 32, 48, 64])
    zeroLen.writeUInt32LE(0, 6 + 8)
    expect(validateIcoBuffer(zeroLen, 5).ok).toBe(false)
  })
})

describe('validateSvgContent', () => {
  const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512"><rect width="512" height="512" fill="#1a1d22"/></svg>`

  it('acepta un SVG bien formado con namespaces estándar', () => {
    expect(validateSvgContent(validSvg)).toEqual({ ok: true })
    const withXmlNs = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xml="http://www.w3.org/XML/1998/namespace" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>`
    expect(validateSvgContent(withXmlNs)).toEqual({ ok: true })
  })

  it('rechaza cadenas vacías o entradas que no sean string', () => {
    expect(validateSvgContent('').ok).toBe(false)
    expect(validateSvgContent('   ').ok).toBe(false)
    expect(validateSvgContent(null).ok).toBe(false)
    expect(validateSvgContent(undefined).ok).toBe(false)
    expect(validateSvgContent(123).ok).toBe(false)
  })

  it('exige etiquetas <svg>, </svg> y el atributo viewBox=', () => {
    expect(validateSvgContent('<div>no es svg</div>').ok).toBe(false)
    expect(validateSvgContent('<svg viewBox="0 0 10 10"><rect/>').ok).toBe(false)
    expect(validateSvgContent('<svg width="10" height="10"></svg>').ok).toBe(false)
  })

  it('rechaza etiquetas <script>, eventos inline on*= y esquemas javascript:', () => {
    const withScript = `<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>`
    expect(validateSvgContent(withScript).ok).toBe(false)

    const withOnload = `<svg viewBox="0 0 10 10" onload="alert(1)"></svg>`
    expect(validateSvgContent(withOnload).ok).toBe(false)

    const withOnerror = `<svg viewBox="0 0 10 10"><image onerror=" fetch('x') "/></svg>`
    expect(validateSvgContent(withOnerror).ok).toBe(false)

    const withOnclick = `<svg viewBox="0 0 10 10"><rect onclick="evil()"/></svg>`
    expect(validateSvgContent(withOnclick).ok).toBe(false)

    const withJavascriptUri = `<svg viewBox="0 0 10 10"><a href="javascript:alert(1)">x</a></svg>`
    expect(validateSvgContent(withJavascriptUri).ok).toBe(false)
  })

  it('rechaza URLs remotas http:// o https:// fuera de los namespaces XML estándar', () => {
    const withHttps = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://cdn.example.com/logo.png"/></svg>`
    expect(validateSvgContent(withHttps).ok).toBe(false)

    const withHttp = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="http://evil.local/icon.svg#id"/></svg>`
    expect(validateSvgContent(withHttp).ok).toBe(false)

    const withSpoofedNs = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="http://www.w3.org/2000/svg/ tracker.png"/></svg>`
    expect(validateSvgContent(withSpoofedNs).ok).toBe(false)
  })
})

describe('validateElectronSecurityConfig', () => {
  const validMainSource = `
    mainWindow = new BrowserWindow({
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })
  `

  it('acepta una configuración segura con las 4 invariantes obligatorias y espacios variados alrededor de :', () => {
    expect(validateElectronSecurityConfig(validMainSource)).toEqual({
      ok: true,
      errors: []
    })

    const spacedSource = `
      webPreferences: {
        nodeIntegration : false,
        contextIsolation  :  true,
        sandbox:true,
        webSecurity :true
      }
    `
    expect(validateElectronSecurityConfig(spacedSource)).toEqual({
      ok: true,
      errors: []
    })
  })

  it('rechaza cadenas vacías o entradas que no sean string', () => {
    for (const invalid of ['', '   ', null, undefined, 42, {}, []]) {
      const res = validateElectronSecurityConfig(invalid)
      expect(res.ok).toBe(false)
      expect(res.errors.length).toBeGreaterThan(0)
    }
  })

  it('detecta la ausencia de cualquiera de las configuraciones obligatorias', () => {
    const missingSandbox = `
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      }
    `
    const res = validateElectronSecurityConfig(missingSandbox)
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('sandbox: true'))).toBe(true)

    const emptyPrefs = 'new BrowserWindow({ webPreferences: {} })'
    const resAll = validateElectronSecurityConfig(emptyPrefs)
    expect(resAll.ok).toBe(false)
    expect(resAll.errors).toHaveLength(4)
  })

  it('rechaza de forma estricta patrones inseguros prohibidos incluso si existen los válidos', () => {
    const forbiddenCases = [
      'nodeIntegration: true',
      'contextIsolation: false',
      'sandbox: false',
      'webSecurity: false',
      'allowRunningInsecureContent: true'
    ]

    for (const pattern of forbiddenCases) {
      const res = validateElectronSecurityConfig(`${validMainSource}\n// otro bloque: { ${pattern} }`)
      expect(res.ok).toBe(false)
      expect(res.errors.some((e) => e.includes(pattern))).toBe(true)
    }
  })
})

describe('computeSha256Sums', () => {
  it('calcula hashes SHA-256 deterministas y ordenados alfabéticamente por nombre', () => {
    const dir = createTempDir()
    const fileZ = path.join(dir, 'z-instalador.exe')
    const fileA = path.join(dir, 'a-portable.exe')
    const fileM = path.join(dir, 'm-vacio.bin')

    fs.writeFileSync(fileZ, 'contenido-z-estrato', 'utf8')
    fs.writeFileSync(fileA, 'contenido-a-estrato', 'utf8')
    fs.writeFileSync(fileM, Buffer.alloc(0))

    const expectedHash = (content: string | Buffer) =>
      crypto.createHash('sha256').update(content).digest('hex')

    const lines = computeSha256Sums([fileZ, fileM, fileA])
    expect(lines).toEqual([
      `${expectedHash('contenido-a-estrato')}  a-portable.exe`,
      `${expectedHash(Buffer.alloc(0))}  m-vacio.bin`,
      `${expectedHash('contenido-z-estrato')}  z-instalador.exe`
    ])
  })

  it('devuelve un arreglo vacío cuando no recibe archivos', () => {
    expect(computeSha256Sums([])).toEqual([])
  })
})

describe('runReleaseAudit con --dist en directorio temporal', () => {
  function populateValidRepoFixture(root: string) {
    fs.mkdirSync(path.join(root, 'resources', 'fonts'), { recursive: true })
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
    fs.mkdirSync(path.join(root, '.github', 'ISSUE_TEMPLATE'), { recursive: true })
    fs.mkdirSync(path.join(root, 'src', 'main'), { recursive: true })
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })

    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(makeValidManifest(), null, 2))
    const png = makePngBuffer({ width: 512, height: 512 })
    fs.writeFileSync(path.join(root, 'resources', 'icon.png'), png)
    fs.writeFileSync(path.join(root, 'resources', 'icon-512.png'), png)
    fs.writeFileSync(path.join(root, 'resources', 'icon.ico'), makeIcoBuffer([16, 24, 32, 48, 64, 128, 256]))
    fs.writeFileSync(path.join(root, 'resources', 'fonts', 'Roboto-Regular.ttf'), Buffer.alloc(60 * 1024, 1))

    const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512"/></svg>'
    fs.writeFileSync(path.join(root, 'resources', 'logo-mark.svg'), safeSvg)
    fs.writeFileSync(path.join(root, 'resources', 'logo-banner.svg'), safeSvg)

    for (const doc of [
      'README.md',
      'CHANGELOG.md',
      'SECURITY.md',
      'CONTRIBUTING.md',
      'docs/ARQUITECTURA.md',
      'docs/SEGURIDAD.md',
      'docs/DISENO.md',
      'docs/DESARROLLO.md'
    ]) {
      fs.writeFileSync(path.join(root, doc), `# ${doc}\n`)
    }

    for (const ghFile of [
      '.github/workflows/ci.yml',
      '.github/workflows/empaquetar.yml',
      '.github/ISSUE_TEMPLATE/config.yml'
    ]) {
      fs.writeFileSync(path.join(root, ghFile), `# ${ghFile}\n`)
    }

    fs.writeFileSync(
      path.join(root, 'src', 'main', 'index.ts'),
      `new BrowserWindow({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } })\n`
    )
  }

  it('genera dist/SHA256SUMS.txt cuando existen artefactos .exe válidos', () => {
    const root = createTempDir()
    populateValidRepoFixture(root)

    fs.writeFileSync(path.join(root, 'dist', 'Estrato.exe'), 'binario-portable')
    fs.writeFileSync(path.join(root, 'dist', 'Estrato-Setup-2.5.0.exe'), 'binario-nsis')

    const audit = runReleaseAudit({ rootDir: root, includeDist: true })
    expect(audit.ok).toBe(true)
    expect(audit.errors).toEqual([])
    expect(audit.sums).toHaveLength(2)
    expect(audit.sums[0]).toMatch(/^[a-f0-9]{64}  Estrato-Setup-2\.5\.0\.exe$/)
    expect(audit.sums[1]).toMatch(/^[a-f0-9]{64}  Estrato\.exe$/)

    const written = fs.readFileSync(path.join(root, 'dist', 'SHA256SUMS.txt'), 'utf8')
    expect(written).toBe(`${audit.sums.join('\n')}\n`)
  })

  it('detecta SVGs inseguros o plantillas de GitHub faltantes en la auditoría', () => {
    const root = createTempDir()
    populateValidRepoFixture(root)

    fs.writeFileSync(
      path.join(root, 'resources', 'logo-banner.svg'),
      '<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>'
    )
    fs.rmSync(path.join(root, '.github', 'ISSUE_TEMPLATE', 'config.yml'))
    fs.rmSync(path.join(root, 'SECURITY.md'))

    const audit = runReleaseAudit({ rootDir: root })
    expect(audit.ok).toBe(false)
    expect(audit.errors.some((e) => e.includes('resources/logo-banner.svg'))).toBe(true)
    expect(audit.errors.some((e) => e.includes('.github/ISSUE_TEMPLATE/config.yml'))).toBe(true)
    expect(audit.errors.some((e) => e.includes('SECURITY.md'))).toBe(true)
  })

  it('rechaza en la auditoría cuando src/main/index.ts omite sandbox: true o incluye nodeIntegration: true', () => {
    const root = createTempDir()
    populateValidRepoFixture(root)

    fs.writeFileSync(
      path.join(root, 'src', 'main', 'index.ts'),
      `new BrowserWindow({ webPreferences: { nodeIntegration: true, contextIsolation: true, webSecurity: true } })\n`
    )

    const audit = runReleaseAudit({ rootDir: root })
    expect(audit.ok).toBe(false)
    expect(audit.errors.some((e) => e.includes('src/main/index.ts') && e.includes('sandbox: true'))).toBe(true)
    expect(audit.errors.some((e) => e.includes('src/main/index.ts') && e.includes('nodeIntegration: true'))).toBe(true)
  })
})
