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
  /** Tiempo máximo de inactividad por lectura en ms (por defecto 30000). */
  timeoutMs?: number
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

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RETRY_AFTER_MS = 60_000
const MAX_CACHE_DIRS = 200

class DownloadHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number
  ) {
    super(message)
  }
}

class NonRetryableError extends Error {}

export class FileDownloader {
  private maxRetries: number
  private verifiedFilesCache = new Map<string, Set<string>>()

  constructor(maxRetries = 3) {
    this.maxRetries = maxRetries
  }

  async download(req: DownloadRequest): Promise<DownloadResult> {
    const targetDir = path.join(req.postDir, 'assets', req.subDir)
    await fs.promises.mkdir(targetDir, { recursive: true })

    const safeName = this.sanitizeFilename(req.filename)
    const ext = path.extname(safeName).toLowerCase()

    const tmpPath = path.join(targetDir, `.tmp-${crypto.randomUUID()}`)

    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (req.signal?.aborted) {
        await this.safeUnlink(tmpPath)
        throw new Error('cancelled')
      }

      try {
        const { size, hash } = await this.streamToFile(req, tmpPath)

        if (req.maxFileSize && req.maxFileSize > 0 && size > req.maxFileSize) {
          await this.safeUnlink(tmpPath)
          throw new NonRetryableError(`Excede el límite de tamaño (${size} > ${req.maxFileSize})`)
        }

        // Cache por contenido: si ese hash ya existe, reutilizamos el archivo.
        const fileKey = `${hash}${ext}`
        const contentPath = path.join(targetDir, fileKey)
        const alreadyExists =
          this.hasCachedFile(targetDir, fileKey) || (await this.fileExists(contentPath))

        if (alreadyExists) {
          this.cacheVerifiedFile(targetDir, fileKey)
          await this.safeUnlink(tmpPath)
          return {
            localPath: contentPath,
            relativePath: this.toRelative(req.subDir, contentPath),
            size,
            hash,
            reused: true
          }
        }

        const finalPath = req.preserveFilename
          ? await this.uniquePath(targetDir, safeName)
          : contentPath

        await this.moveFile(tmpPath, finalPath)
        if (!req.preserveFilename) {
          this.cacheVerifiedFile(targetDir, fileKey)
        }

        return {
          localPath: finalPath,
          relativePath: this.toRelative(req.subDir, finalPath),
          size,
          hash,
          reused: false
        }
      } catch (error) {
        lastError = error as Error
        await this.safeUnlink(tmpPath)
        if (req.signal?.aborted || lastError.message === 'cancelled') {
          throw new Error('cancelled')
        }
        if (error instanceof NonRetryableError) {
          throw error
        }
        if (attempt < this.maxRetries - 1) {
          const delayMs =
            error instanceof DownloadHttpError && error.status === 429 && error.retryAfterMs !== undefined
              ? error.retryAfterMs
              : Math.pow(2, attempt) * 1000 + Math.random() * 500
          await this.sleep(delayMs, req.signal)
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
    const timeoutMs = req.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : req.timeoutMs
    const fetchController = new AbortController()
    let headerTimedOut = false
    let headerTimer: ReturnType<typeof setTimeout> | undefined

    const onCallerAbort = (): void => {
      fetchController.abort()
    }
    if (req.signal) {
      if (req.signal.aborted) throw new Error('cancelled')
      req.signal.addEventListener('abort', onCallerAbort, { once: true })
    }

    try {
      if (timeoutMs > 0) {
        headerTimer = setTimeout(() => {
          headerTimedOut = true
          fetchController.abort()
        }, timeoutMs)
      }

      let response: Response
      try {
        response = await fetch(req.url, {
          signal: fetchController.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Client/1.0'
          }
        })
      } catch (error) {
        if (req.signal?.aborted) throw new Error('cancelled')
        if (headerTimedOut) {
          throw new Error(`Timeout de descarga tras ${timeoutMs}ms sin respuesta de ${req.url}`)
        }
        throw error
      } finally {
        if (headerTimer !== undefined) clearTimeout(headerTimer)
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        const retryAfterMs =
          response.status === 429
            ? this.parseRetryAfterMs(response.headers.get('retry-after'))
            : undefined
        throw new DownloadHttpError(
          `HTTP ${response.status} al descargar ${req.url}`,
          response.status,
          retryAfterMs
        )
      }
      if (!response.body) {
        throw new Error('La respuesta no tiene cuerpo')
      }

      const declared = Number(response.headers.get('content-length') || 0)
      if (req.maxFileSize && declared > 0 && declared > req.maxFileSize) {
        await response.body.cancel().catch(() => undefined)
        throw new NonRetryableError(`Excede el límite de tamaño (${declared} > ${req.maxFileSize})`)
      }

      const writeStream = fs.createWriteStream(targetPath)
      let streamError: Error | null = null
      const onStreamError = (err: Error): void => {
        streamError = err
      }
      writeStream.on('error', onStreamError)

      const hasher = crypto.createHash('sha256')
      let total = 0

      const reader = (response.body as ReadableStream<Uint8Array>).getReader()
      try {
        while (true) {
          if (req.signal?.aborted) throw new Error('cancelled')
          const { done, value } = await this.readWithTimeout(reader, timeoutMs, req.signal)
          if (done) break

          const chunk = Buffer.from(value)
          total += chunk.length
          if (req.maxFileSize && req.maxFileSize > 0 && total > req.maxFileSize) {
            throw new NonRetryableError(`Excede el límite de tamaño (${total} > ${req.maxFileSize})`)
          }

          hasher.update(chunk)
          if (!writeStream.write(chunk)) {
            await this.waitForDrain(writeStream)
          }
          if (streamError) throw streamError
          req.onProgress?.(chunk.length)
        }

        writeStream.end()
        await new Promise<void>((resolve, reject) => {
          if (streamError) {
            reject(streamError)
            return
          }
          const onFinish = (): void => {
            writeStream.off('error', onFinishError)
            resolve()
          }
          const onFinishError = (err: Error): void => {
            writeStream.off('finish', onFinish)
            reject(err)
          }
          writeStream.once('finish', onFinish)
          writeStream.once('error', onFinishError)
        })
      } catch (error) {
        await this.destroyWriteStream(writeStream)
        try {
          await reader.cancel()
        } catch {
          /* ignorar */
        }
        throw error
      } finally {
        writeStream.off('error', onStreamError)
      }

      return { size: total, hash: hasher.digest('hex') }
    } finally {
      if (req.signal) {
        req.signal.removeEventListener('abort', onCallerAbort)
      }
    }
  }

  private async readWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
    if (signal?.aborted) throw new Error('cancelled')

    const readPromise = reader.read()
    readPromise.catch(() => undefined)

    const racers: Array<
      Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>>
    > = [readPromise]
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined

    if (timeoutMs > 0) {
      racers.push(
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Timeout de inactividad tras ${timeoutMs}ms sin recibir datos`))
          }, timeoutMs)
        })
      )
    }

    if (signal) {
      racers.push(
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('cancelled'))
          signal.addEventListener('abort', onAbort, { once: true })
        })
      )
    }

    try {
      return await Promise.race(racers)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    }
  }

  private waitForDrain(writeStream: fs.WriteStream): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onDrain = (): void => {
        cleanup()
        resolve()
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }
      const cleanup = (): void => {
        writeStream.off('drain', onDrain)
        writeStream.off('error', onError)
      }
      writeStream.once('drain', onDrain)
      writeStream.once('error', onError)
    })
  }

  private destroyWriteStream(writeStream: fs.WriteStream): Promise<void> {
    return new Promise((resolve) => {
      if (writeStream.closed) {
        resolve()
        return
      }
      const done = (): void => {
        writeStream.off('close', done)
        writeStream.off('error', done)
        resolve()
      }
      writeStream.once('close', done)
      writeStream.once('error', done)
      writeStream.destroy()
    })
  }

  private parseRetryAfterMs(header: string | null): number | undefined {
    if (!header) return undefined
    const trimmed = header.trim()
    if (!trimmed) return undefined
    const seconds = Number(trimmed)
    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(0, seconds * 1000), MAX_RETRY_AFTER_MS)
    }
    const targetMs = Date.parse(trimmed)
    if (!Number.isNaN(targetMs)) {
      return Math.min(Math.max(0, targetMs - Date.now()), MAX_RETRY_AFTER_MS)
    }
    return undefined
  }

  private hasCachedFile(targetDir: string, filename: string): boolean {
    const files = this.verifiedFilesCache.get(targetDir)
    if (!files) return false
    this.verifiedFilesCache.delete(targetDir)
    this.verifiedFilesCache.set(targetDir, files)
    return files.has(filename)
  }

  private cacheVerifiedFile(targetDir: string, filename: string): void {
    let files = this.verifiedFilesCache.get(targetDir)
    if (files) {
      this.verifiedFilesCache.delete(targetDir)
      this.verifiedFilesCache.set(targetDir, files)
      files.add(filename)
      return
    }
    if (this.verifiedFilesCache.size >= MAX_CACHE_DIRS) {
      const oldest = this.verifiedFilesCache.keys().next().value
      if (oldest !== undefined) {
        this.verifiedFilesCache.delete(oldest)
      }
    }
    files = new Set<string>([filename])
    this.verifiedFilesCache.set(targetDir, files)
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async moveFile(from: string, to: string): Promise<void> {
    try {
      await fs.promises.rename(from, to)
    } catch {
      // Windows a veces bloquea el rename; copiamos y borramos.
      await fs.promises.copyFile(from, to)
      await this.safeUnlink(from)
    }
  }

  private async uniquePath(dir: string, filename: string): Promise<string> {
    const ext = path.extname(filename)
    const base = path.basename(filename, ext)
    let candidate = path.join(dir, filename)
    let counter = 2
    while (await this.fileExists(candidate)) {
      candidate = path.join(dir, `${base} (${counter})${ext}`)
      counter++
    }
    return candidate
  }

  private toRelative(subDir: string, absolutePath: string): string {
    return path.posix.join('assets', subDir, path.basename(absolutePath))
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath)
    } catch {
      /* ignorar */
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    if (signal?.aborted) return Promise.reject(new Error('cancelled'))
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new Error('cancelled'))
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
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
