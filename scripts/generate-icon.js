// ============================================================
// Genera resources/icon.ico a partir de formas vectoriales.
// Sin dependencias: PNG/ICO/BMP escritos a mano.
// Uso: node scripts/generate-icon.js
// ============================================================

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// ---------- Paleta (marca «Estrato») ----------
const BG_TOP = [26, 29, 34]
const BG_BOTTOM = [13, 15, 18]
const STRATA_TOP = [224, 164, 92]
const STRATA_MID = [201, 135, 63]
const STRATA_LOW = [150, 95, 42]
const STRATA_EDGE = [240, 196, 138]

// ---------- Primitivas (cobertura por muestreo) ----------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function roundRect(x, y, w, h, r) {
  return (px, py) => {
    const cx = px - (x + w / 2)
    const cy = py - (y + h / 2)
    const qx = Math.abs(cx) - (w / 2 - r)
    const qy = Math.abs(cy) - (h / 2 - r)
    const dx = Math.max(qx, 0)
    const dy = Math.max(qy, 0)
    const d = Math.hypot(dx, dy) + Math.min(Math.max(qx, qy), 0) - r
    return d <= 0 ? 1 : 0
  }
}

function ellipse(cx, cy, rx, ry) {
  return (px, py) => (((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1 ? 1 : 0)
}

function polygon(points) {
  return (px, py) => {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]
      const [xj, yj] = points[j]
      const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
      if (intersects) inside = !inside
    }
    return inside ? 1 : 0
  }
}

// ---------- Render ----------
function render(size) {
  const SS = 4 // supersampling
  const px = new Float32Array(size * size * 4)

  // Todas las formas en coordenadas normalizadas (0..1) para poder
  // renderizar cualquier tamaño sin reescalar geometría.
  const shapes = [
    // Estratos: tres capas horizontales que se estrechan hacia abajo.
    // Es la marca de la app: capas de conversación que se conservan.
    { cov: roundRect(0.215, 0.275, 0.57, 0.125, 0.022), color: STRATA_TOP, alpha: 1 },
    { cov: roundRect(0.275, 0.445, 0.45, 0.125, 0.022), color: STRATA_MID, alpha: 1 },
    { cov: roundRect(0.345, 0.615, 0.31, 0.125, 0.022), color: STRATA_LOW, alpha: 1 },
    // Filo superior iluminado: da volumen sin usar degradados.
    { cov: roundRect(0.215, 0.275, 0.57, 0.018, 0.009), color: STRATA_EDGE, alpha: 0.85 },
    { cov: roundRect(0.275, 0.445, 0.45, 0.016, 0.008), color: STRATA_EDGE, alpha: 0.5 },
    { cov: roundRect(0.345, 0.615, 0.31, 0.014, 0.007), color: STRATA_EDGE, alpha: 0.3 }
  ]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size
          const ny = (y + (sy + 0.5) / SS) / size

          // Fondo: cuadrado redondeado con gradiente vertical
          const inBg = roundRect(0, 0, 1, 1, 0.185)(nx, ny)
          let cr = 0
          let cg = 0
          let cb = 0
          let ca = 0

          if (inBg) {
            const t = clamp01(ny)
            cr = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t
            cg = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t
            cb = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t
            ca = 1

            // Borde blurple (anillo)
            // Filo interior tenue: separa la marca del borde del icono.
            const outer = roundRect(0.018, 0.018, 0.964, 0.964, 0.175)(nx, ny)
            const inner = roundRect(0.03, 0.03, 0.94, 0.94, 0.165)(nx, ny)
            if (outer && !inner) {
              cr = 58
              cg = 63
              cb = 72
            }

            for (const sh of shapes) {
              if (sh.cov(nx, ny)) {
                cr = cr + (sh.color[0] - cr) * sh.alpha
                cg = cg + (sh.color[1] - cg) * sh.alpha
                cb = cb + (sh.color[2] - cb) * sh.alpha
              }
            }
          }

          r += cr * ca
          g += cg * ca
          b += cb * ca
          a += ca
        }
      }

      const n = SS * SS
      const outA = a / n
      const i = (y * size + x) * 4
      if (outA > 0) {
        px[i] = r / a
        px[i + 1] = g / a
        px[i + 2] = b / a
        px[i + 3] = outA * 255
      }
    }
  }

  return Buffer.from(px.map((v) => Math.max(0, Math.min(255, Math.round(v)))))
}

// ---------- Encoders ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filtro none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function encodeDib(rgba, size) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // alto duplicado (XOR + AND)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(size * size * 4, 20)

  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4 // bottom-up
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4
      const d = (y * size + x) * 4
      pixels[d] = rgba[s + 2] // B
      pixels[d + 1] = rgba[s + 1] // G
      pixels[d + 2] = rgba[s] // R
      pixels[d + 3] = rgba[s + 3] // A
    }
  }

  const maskRowBytes = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRowBytes * size) // todo 0 = opaco

  return Buffer.concat([header, pixels, mask])
}

function buildIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const entries = []
  let offset = 6 + count * 16
  for (const img of images) {
    const entry = Buffer.alloc(16)
    entry[0] = img.size >= 256 ? 0 : img.size
    entry[1] = img.size >= 256 ? 0 : img.size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(img.data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += img.data.length
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

// ---------- Main ----------
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const outDir = path.join(__dirname, '..', 'resources')

const ico = buildIco(SIZES.map((size) => ({ size, data: encodeDib(render(size), size) })))
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
console.log(`icon.ico  ${(ico.length / 1024).toFixed(1)} KB  (${SIZES.join(', ')})`)

// PNG de alta resolución para Linux/macOS y para el README
const png = encodePng(render(512), 512)
fs.writeFileSync(path.join(outDir, 'icon-512.png'), png)
console.log(`icon-512.png  ${(png.length / 1024).toFixed(1)} KB`)

// `icon.png` es el que usa la ventana y la bandeja del sistema. Antes era un
// JPEG de la marca anterior renombrado: la barra de tareas seguía mostrando
// el logo viejo aunque el .ico ya fuera el nuevo.
fs.writeFileSync(path.join(outDir, 'icon.png'), png)
console.log(`icon.png  ${(png.length / 1024).toFixed(1)} KB`)
