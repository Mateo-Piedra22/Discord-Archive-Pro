import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileDownloader } from './file-downloader'

interface ServerHandle {
  url: (pathname?: string) => string
  close: () => Promise<void>
}

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<ServerHandle> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de pruebas')
  }
  return {
    url: (pathname = '/file') => `http://127.0.0.1:${address.port}${pathname}`,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

describe('FileDownloader', () => {
  let tempDir: string
  let activeServer: ServerHandle | null = null

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'estrato-dl-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    if (activeServer) {
      await activeServer.close()
      activeServer = null
    }
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('descarga en streaming, calcula hash SHA-256, reporta progreso y gestiona nombres preservados', async () => {
    const partA = Buffer.from('primer-bloque-binario-')
    const partB = Buffer.from('segundo-bloque-estrato')
    const full = Buffer.concat([partA, partB])
    const expectedHash = crypto.createHash('sha256').update(full).digest('hex')

    activeServer = await startServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': String(full.length)
      })
      res.write(partA)
      setTimeout(() => res.end(partB), 10)
    })

    const downloader = new FileDownloader(2)
    let reportedBytes = 0
    const res = await downloader.download({
      url: activeServer.url('/foto.png'),
      postDir: tempDir,
      subDir: 'images',
      filename: 'foto.png',
      preserveFilename: false,
      onProgress: (bytes) => {
        reportedBytes += bytes
      }
    })

    expect(res.reused).toBe(false)
    expect(res.size).toBe(full.length)
    expect(res.hash).toBe(expectedHash)
    expect(res.relativePath).toBe(`assets/images/${expectedHash}.png`)
    expect(reportedBytes).toBe(full.length)

    const diskContent = await fs.promises.readFile(res.localPath)
    expect(diskContent.equals(full)).toBe(true)

    const preserved1 = await downloader.download({
      url: activeServer.url('/foto.png'),
      postDir: tempDir,
      subDir: 'files',
      filename: 'mi:archivo?.txt',
      preserveFilename: true
    })
    const preserved2 = await downloader.download({
      url: activeServer.url('/foto.png'),
      postDir: tempDir,
      subDir: 'files',
      filename: 'mi:archivo?.txt',
      preserveFilename: true
    })

    expect(path.basename(preserved1.localPath)).toBe('mi_archivo_.txt')
    expect(path.basename(preserved2.localPath)).toBe('mi_archivo_ (2).txt')
    expect(preserved1.relativePath).toBe('assets/files/mi_archivo_.txt')
  })

  it('reutiliza archivos duplicados por hash y evita fs.promises.access repetidos con caché en memoria', async () => {
    const payload = Buffer.from('contenido-identico-para-deduplicacion')
    const expectedHash = crypto.createHash('sha256').update(payload).digest('hex')

    activeServer = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': String(payload.length) })
      res.end(payload)
    })

    const downloader = new FileDownloader(1)
    const first = await downloader.download({
      url: activeServer.url('/uno.png'),
      postDir: tempDir,
      subDir: 'images',
      filename: 'uno.png',
      preserveFilename: false
    })
    expect(first.reused).toBe(false)

    const targetFile = path.join(tempDir, 'assets', 'images', `${expectedHash}.png`)
    const accessSpy = vi.spyOn(fs.promises, 'access')

    const second = await downloader.download({
      url: activeServer.url('/dos.png'),
      postDir: tempDir,
      subDir: 'images',
      filename: 'dos.png',
      preserveFilename: false
    })

    expect(second.reused).toBe(true)
    expect(second.localPath).toBe(targetFile)
    expect(second.hash).toBe(expectedHash)
    expect(accessSpy).not.toHaveBeenCalledWith(targetFile)

    // Un descargador nuevo consulta disco una vez y luego cachea en memoria.
    const freshDownloader = new FileDownloader(1)
    const third = await freshDownloader.download({
      url: activeServer.url('/tres.png'),
      postDir: tempDir,
      subDir: 'images',
      filename: 'tres.png',
      preserveFilename: false
    })
    expect(third.reused).toBe(true)
    expect(accessSpy).toHaveBeenCalledWith(targetFile)

    accessSpy.mockClear()
    const fourth = await freshDownloader.download({
      url: activeServer.url('/cuatro.png'),
      postDir: tempDir,
      subDir: 'images',
      filename: 'cuatro.png',
      preserveFilename: false
    })
    expect(fourth.reused).toBe(true)
    expect(accessSpy).not.toHaveBeenCalledWith(targetFile)
  })

  it('falla por timeoutMs cuando la lectura queda inactiva pero permite descargas activas lentas', async () => {
    activeServer = await startServer((req, res) => {
      if (req.url === '/stall') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.write('inicio-')
        // No finaliza nunca para disparar timeout de inactividad en reader.read().
        return
      }

      // Descarga activa lenta: 4 bloques cada 40ms (160ms total > timeoutMs=95ms).
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      let step = 0
      const interval = setInterval(() => {
        step++
        res.write(`chunk-${step};`)
        if (step >= 4) {
          clearInterval(interval)
          res.end()
        }
      }, 40)
      res.on('close', () => clearInterval(interval))
    })

    const downloader = new FileDownloader(1)

    await expect(
      downloader.download({
        url: activeServer.url('/stall'),
        postDir: tempDir,
        subDir: 'files',
        filename: 'colgado.bin',
        preserveFilename: false,
        timeoutMs: 80
      })
    ).rejects.toThrow(/timeout|inactividad/i)

    const targetDir = path.join(tempDir, 'assets', 'files')
    const leftovers = await fs.promises.readdir(targetDir)
    expect(leftovers.filter((f) => f.startsWith('.tmp-'))).toHaveLength(0)

    const slowResult = await downloader.download({
      url: activeServer.url('/slow-ok'),
      postDir: tempDir,
      subDir: 'files',
      filename: 'lento.txt',
      preserveFilename: true,
      timeoutMs: 95
    })

    expect(await fs.promises.readFile(slowResult.localPath, 'utf-8')).toBe(
      'chunk-1;chunk-2;chunk-3;chunk-4;'
    )
  })

  it('respeta Retry-After en respuestas HTTP 429 antes de reintentar', async () => {
    let attempts = 0
    activeServer = await startServer((_req, res) => {
      attempts++
      if (attempts === 1) {
        res.writeHead(429, { 'Retry-After': '0.2' })
        res.end('Too Many Requests')
        return
      }
      res.writeHead(200)
      res.end('ok-tras-429')
    })

    const downloader = new FileDownloader(2)
    const started = Date.now()
    const result = await downloader.download({
      url: activeServer.url('/rate-limited'),
      postDir: tempDir,
      subDir: 'files',
      filename: 'data.txt',
      preserveFilename: true
    })
    const elapsed = Date.now() - started

    expect(attempts).toBe(2)
    expect(elapsed).toBeGreaterThanOrEqual(170)
    expect(await fs.promises.readFile(result.localPath, 'utf-8')).toBe('ok-tras-429')
  })

  it('acota la espera de Retry-After a un máximo de 60 segundos', async () => {
    let calls = 0
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return new Response('rate limit', {
          status: 429,
          headers: { 'Retry-After': '120' }
        })
      }
      return new Response('recuperado', { status: 200 })
    })

    const downloader = new FileDownloader(2)
    const sleepSpy = vi
      .spyOn(downloader as unknown as { sleep: (ms: number, signal?: AbortSignal) => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined)

    const res = await downloader.download({
      url: 'https://example.invalid/capped.txt',
      postDir: tempDir,
      subDir: 'files',
      filename: 'capped.txt',
      preserveFilename: true
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(sleepSpy).toHaveBeenCalledTimes(1)
    expect(sleepSpy).toHaveBeenCalledWith(60_000, undefined)
    expect(await fs.promises.readFile(res.localPath, 'utf-8')).toBe('recuperado')
  })

  it('rechaza archivos que superan maxFileSize por Content-Length o durante el streaming sin reintentar', async () => {
    let hits = 0
    activeServer = await startServer((req, res) => {
      hits++
      if (req.url === '/header-large') {
        res.writeHead(200, { 'Content-Length': '500' })
        res.end('x'.repeat(500))
        return
      }
      // Sin Content-Length (chunked): excede durante streaming.
      res.writeHead(200)
      res.write('a'.repeat(80))
      res.end('b'.repeat(80))
    })

    const downloader = new FileDownloader(3)

    await expect(
      downloader.download({
        url: activeServer.url('/header-large'),
        postDir: tempDir,
        subDir: 'files',
        filename: 'grande.bin',
        preserveFilename: false,
        maxFileSize: 100
      })
    ).rejects.toThrow(/límite de tamaño/i)

    expect(hits).toBe(1)

    await expect(
      downloader.download({
        url: activeServer.url('/stream-large'),
        postDir: tempDir,
        subDir: 'files',
        filename: 'grande-stream.bin',
        preserveFilename: false,
        maxFileSize: 100
      })
    ).rejects.toThrow(/límite de tamaño/i)

    expect(hits).toBe(2)

    const leftovers = await fs.promises.readdir(path.join(tempDir, 'assets', 'files'))
    expect(leftovers).toHaveLength(0)
  })

  it('cancela limpiamente mediante AbortSignal antes y durante la descarga', async () => {
    let serverHits = 0
    activeServer = await startServer((_req, res) => {
      serverHits++
      res.writeHead(200)
      res.write('parcial')
      // Mantiene abierto hasta cancelación del cliente.
    })

    const downloader = new FileDownloader(3)

    const preAborted = new AbortController()
    preAborted.abort()
    await expect(
      downloader.download({
        url: activeServer.url('/pre'),
        postDir: tempDir,
        subDir: 'files',
        filename: 'pre.bin',
        preserveFilename: false,
        signal: preAborted.signal
      })
    ).rejects.toThrow('cancelled')
    expect(serverHits).toBe(0)

    const midAbort = new AbortController()
    setTimeout(() => midAbort.abort(), 30)

    await expect(
      downloader.download({
        url: activeServer.url('/mid'),
        postDir: tempDir,
        subDir: 'files',
        filename: 'mid.bin',
        preserveFilename: false,
        signal: midAbort.signal
      })
    ).rejects.toThrow('cancelled')
    expect(serverHits).toBe(1)

    const leftovers = await fs.promises.readdir(path.join(tempDir, 'assets', 'files'))
    expect(leftovers).toHaveLength(0)
  })
})
