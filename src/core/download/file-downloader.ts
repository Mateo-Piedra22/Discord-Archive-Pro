// ============================================================
// Descargador de archivos — descarga en streaming con hash incremental,
// nombres legibles, deduplicación por contenido y cancelación.
// ============================================================

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sanitize from 'sanitize-filename'

export interface DownloadRequest {
  url: string
  /** Directorio raíz del post (se crea <postDir>/assets/<subDir>). */
  postDir: string
  /** 'images' | 'videos' | 'files' */
  subDir: string
  filename: string
  /** Conservar el nombre original en lugar de <hash><ext>. */
  preserveFilename: boolean
  /** Longitud máxima permitida en bytes (0 = sin límite). */
  maxFileSize?: number
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
}

export interface DownloadResult {
  localPath: string
  /** Ruta relativa POSIX sin './', p.ej. assets/images/foto.png */
  relativePath: string
  size: number
  hash: string
  /** true si el contenido ya existía (deduplicado por hash). */
  reused: boolean
}

export class FileDownloader {
  private maxRetries: number

  constructor(maxRetries = 3) {
    this.maxRetries = maxRetries
  }

  async download(req: DownloadRequest): Promise<DownloadResult> {
    const targetDir = path.join(req.postDir, 'assets', req.subDir)
    fs.mkdirSync(targetDir, { recursive: true })

    const safeName = this.sanitizeFilename(req.filename)
    const ext = path.extname(safeName).toLowerCase()

    const tmpPath = path.join(targetDir, `.tmp-${crypto.randomUUID()}`)

    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (req.signal?.aborted) {
        this.safeUnlink(tmpPath)
        throw new Error('cancelled')
      }

      try {
        const { size, hash } = await this.streamToFile(req, tmpPath)

        if (req.maxFileSize && req.maxFileSize > 0 && size > req.maxFileSize) {
          this.safeUnlink(tmpPath)
          throw new Error(`Excede el límite de tamaño (${size} > ${req.maxFileSize})`)
        }

        // Cache por contenido: si ese hash ya existe, reutilizamos el archivo.
        const contentPath = path.join(targetDir, `${hash}${ext}`)
        if (fs.existsSync(contentPath)) {
          this.safeUnlink(tmpPath)
          return {
            localPath: contentPath,
            relativePath: this.toRelative(req.subDir, contentPath),
            size,
            hash,
            reused: true
          }
        }

        const finalPath = req.preserveFilename
          ? this.uniquePath(targetDir, safeName)
          : contentPath

        this.moveFile(tmpPath, finalPath)

        return {
          localPath: finalPath,
          relativePath: this.toRelative(req.subDir, finalPath),
          size,
          hash,
          reused: false
        }
      } catch (error) {
        lastError = error as Error
        this.safeUnlink(tmpPath)
        if (req.signal?.aborted) throw new Error('cancelled')
        if (attempt < this.maxRetries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000 + Math.random() * 500)
        }
      }
    }

    throw lastError || new Error(`No se pudo descargar ${req.url}`)
  }

  // ----------- Internos -----------

  private async streamToFile(
    req: DownloadRequest,
    targetPath: string
  ): Promise<{ size: number; hash: string }> {
    const response = await fetch(req.url, {
      signal: req.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Client/1.0'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al descargar ${req.url}`)
    }
    if (!response.body) {
      throw new Error('La respuesta no tiene cuerpo')
    }

    const declared = Number(response.headers.get('content-length') || 0)
    if (req.maxFileSize && declared > 0 && declared > req.maxFileSize) {
      throw new Error(`Excede el límite de tamaño (${declared} > ${req.maxFileSize})`)
    }

    const writeStream = fs.createWriteStream(targetPath)
    const hasher = crypto.createHash('sha256')
    let total = 0

    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        if (req.signal?.aborted) throw new Error('cancelled')
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        hasher.update(chunk)
        total += chunk.length
        if (!writeStream.write(chunk)) {
          await new Promise<void>((resolve) => writeStream.once('drain', () => resolve()))
        }
        req.onProgress?.(chunk.length)
      }
      writeStream.end()
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', () => resolve())
        writeStream.on('error', reject)
      })
    } catch (error) {
      writeStream.destroy()
      try { await reader.cancel() } catch { /* ignorar */ }
      throw error
    }

    return { size: total, hash: hasher.digest('hex') }
  }

  private moveFile(from: string, to: string): void {
    try {
      fs.renameSync(from, to)
    } catch {
      // Windows a veces bloquea el rename; copiamos y borramos.
      fs.copyFileSync(from, to)
      this.safeUnlink(from)
    }
  }

  private uniquePath(dir: string, filename: string): string {
    const ext = path.extname(filename)
    const base = path.basename(filename, ext)
    let candidate = path.join(dir, filename)
    let counter = 2
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${base} (${counter})${ext}`)
      counter++
    }
    return candidate
  }

  private toRelative(subDir: string, absolutePath: string): string {
    return path.posix.join('assets', subDir, path.basename(absolutePath))
  }

  private safeUnlink(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch { /* ignorar */ }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  sanitizeFilename(filename: string): string {
    let safe = sanitize(filename, { replacement: '_' })
    safe = safe.replace(/^[. ]+|[. ]+$/g, '')

    if (safe.length > 150) {
      const ext = path.extname(safe)
      safe = safe.substring(0, 150 - ext.length) + ext
    }

    return safe || 'archivo'
  }
}
