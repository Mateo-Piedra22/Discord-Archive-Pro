// ============================================================
// Constructor de carpetas — Crea la estructura de directorios de
// salida organizada, con nombres saneados y gestión de colisiones.
// ============================================================

import fs from 'fs'
import path from 'path'
import sanitize from 'sanitize-filename'
import type { ExportOptions } from '../discord/types'

/** Margen seguro para MAX_PATH de Windows (260 menos el nombre de archivo). */
const MAX_FULL_PATH = 240

export class FolderBuilder {
  private options: ExportOptions

  constructor(options: ExportOptions) {
    this.options = options
  }

  getBaseDir(): string {
    return this.options.outputDir
  }

  getServerDirectory(guildName: string): string {
    const safeName = this.sanitizeDirName(guildName)
    const dir = path.join(this.options.outputDir, safeName)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  getForumDirectory(guildName: string, channelName: string): string {
    // 'flat' y 'by-date' no agrupan por servidor/canal: el "foro" es la raíz
    // (en 'by-date' cada post vive en su propia carpeta YYYY-MM).
    if (this.options.folderStructure === 'flat' || this.options.folderStructure === 'by-date') {
      const root = this.getBaseDir()
      if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
      return root
    }

    const serverDir = this.getServerDirectory(guildName)
    const safeName = this.sanitizeDirName(channelName)
    const dir = path.join(serverDir, safeName)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  createPostDirectory(
    guildName: string,
    channelName: string,
    threadName: string,
    createdAt?: string
  ): string {
    const isoDate = createdAt || new Date().toISOString()
    const parentDir = this.resolvePostParent(guildName, channelName, isoDate)

    const date = this.formatDate(isoDate)
    const title = this.sanitizeDirName(threadName)
    const usesNumber = this.options.namingPattern.includes('{num}')

    // Numeración estable: máximo prefijo numérico existente + 1
    let num = this.nextNumber(parentDir)

    for (let attempt = 0; attempt < 5000; attempt++) {
      let dirName = this.buildDirName(usesNumber ? num : null, date, title, parentDir)

      // Sin {num} el nombre sería idéntico en cada intento: hace falta sufijo.
      if (!usesNumber && attempt > 0) {
        dirName = this.truncateName(`${dirName} (${attempt + 1})`, this.options.maxFilenameLength)
      }

      const postDir = path.join(parentDir, dirName)

      try {
        // Sin `recursive`: falla con EEXIST si otro proceso/descarga ganó la carrera
        fs.mkdirSync(postDir)
        return postDir
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        num++
      }
    }

    throw new Error(`No se pudo crear un directorio único para "${threadName}"`)
  }

  sanitizeDirName(name: string): string {
    // Se usa un saneado robusto para compatibilidad con Windows/POSIX
    let safe = sanitize(name, { replacement: '_' })

    // Windows rechaza especialmente puntos/espacios al inicio o al final y ciertos nombres
    safe = safe.replace(/^[. ]+|[. ]+$/g, '').trim()

    if (safe.length > this.options.maxFilenameLength) {
      safe = safe.substring(0, this.options.maxFilenameLength)
      // Tras truncar puede quedar un punto/espacio final (Windows lo rechaza)
      safe = safe.replace(/[. ]+$/g, '').trim()
    }

    if (!safe) safe = 'unnamed'
    return safe
  }

  // ---------- internos ----------

  /** Carpeta que contendrá las carpetas de posts según `folderStructure`. */
  private resolvePostParent(guildName: string, channelName: string, isoDate: string): string {
    switch (this.options.folderStructure) {
      case 'flat':
        return this.getBaseDir()
      case 'by-date': {
        const dir = path.join(this.getBaseDir(), this.formatMonth(isoDate))
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        return dir
      }
      default:
        return this.getForumDirectory(guildName, channelName)
    }
  }

  /** Mayor prefijo `NNN_` presente + 1. */
  private nextNumber(dir: string): number {
    if (!fs.existsSync(dir)) return 1

    let max = 0
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith('_') || entry.startsWith('.')) continue
      const match = /^(\d{3})_/.exec(entry)
      if (!match) continue
      const value = parseInt(match[1], 10)
      if (value > max) max = value
    }
    return max + 1
  }

  private buildDirName(num: number | null, date: string, title: string, parentDir: string): string {
    const numStr = num === null ? '' : num.toString().padStart(3, '0')

    let name = this.options.namingPattern
      .replace(/\{num\}/g, numStr)
      .replace(/\{date\}/g, date)
      .replace(/\{title\}/g, title)

    name = this.truncateName(name, this.options.maxFilenameLength)

    // Límite del path completo (Windows MAX_PATH)
    const budget = MAX_FULL_PATH - parentDir.length - 1
    if (parentDir.length + 1 + name.length > MAX_FULL_PATH) {
      name = this.truncateName(name, Math.max(16, budget))
    }

    if (!name) name = 'unnamed'
    return name
  }

  private truncateName(name: string, max: number): string {
    let out = name.length > max ? name.substring(0, max) : name
    // Sin separadores ni puntos/espacios colgando (Windows los rechaza)
    out = out.replace(/[\s._-]+$/, '')
    return out.trim()
  }

  private formatDate(isoDate: string): string {
    const d = new Date(isoDate)
    if (Number.isNaN(d.getTime())) return 'unknown-date'

    const y = d.getFullYear().toString()
    const m = (d.getMonth() + 1).toString().padStart(2, '0')
    const day = d.getDate().toString().padStart(2, '0')

    switch (this.options.dateFormat) {
      case 'DD-MM-YYYY':
        return `${day}-${m}-${y}`
      case 'YYYYMMDD':
        return `${y}${m}${day}`
      default:
        return `${y}-${m}-${day}`
    }
  }

  private formatMonth(isoDate: string): string {
    const d = new Date(isoDate)
    if (Number.isNaN(d.getTime())) return 'sin-fecha'
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`
  }

  // Comprueba si la ruta superaría el MAX_PATH de Windows
  static checkPathLength(filePath: string): boolean {
    return filePath.length < 250 // Deja margen
  }
}
