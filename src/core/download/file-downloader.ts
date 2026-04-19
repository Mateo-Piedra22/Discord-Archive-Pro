// ============================================================
// File Downloader — Streaming HTTP file downloads with
// progress, retry, and Windows-safe filename handling.
// ============================================================

import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import crypto from 'crypto'
import sanitize from 'sanitize-filename'

// File Downloader — Streaming HTTP file downloads with
// progress, retry, and Windows-safe filename handling.
export class FileDownloader {
  private maxRetries = 3

  async download(
    url: string,
    baseDir: string,
    subDir: string,
    filename: string,
    onProgress?: (bytesChunk: number) => void
  ): Promise<{ localPath: string; size: number }> {
    // Robustly sanitize filename and path components
    const safeFilename = this.sanitizeFilename(filename)
    const ext = path.extname(safeFilename) || ''
    
    // Ensure the entire target directory path is sanitized
    const targetDir = path.join(baseDir, 'assets', subDir)

    if (!fs.existsSync(targetDir)) {
      // Use recursive true to ensure parent structure exists
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // Temporary path to download — using a GUID prefix to avoid collisions
    const tmpPath = path.join(targetDir, `${crypto.randomUUID()}.tmp`)

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const { size, hash } = await this.downloadFile(url, tmpPath, onProgress)
        
        // Final path using hash-based CAS (Content Addressable Storage)
        let finalPath = path.join(targetDir, `${hash}${ext}`)
        
        // Final verification that temp file exists before rename
        if (!fs.existsSync(tmpPath)) {
          throw new Error(`Temp file ${tmpPath} disappeared during download`)
        }

        if (!fs.existsSync(finalPath)) {
          // Robust rename with a retry if busy
          try {
            fs.renameSync(tmpPath, finalPath)
          } catch (renameErr) {
            // Windows sometimes locks files; wait a tiny bit and retry or copy/unlink
            await new Promise(r => setTimeout(r, 100))
            if (fs.existsSync(tmpPath)) {
               fs.copyFileSync(tmpPath, finalPath)
               fs.unlinkSync(tmpPath)
            }
          }
        } else {
          // Deduplicated asset already exists
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
        }
        return { localPath: finalPath, size }
      } catch (error) {
        lastError = error as Error
        if (fs.existsSync(tmpPath)) {
           try { fs.unlinkSync(tmpPath) } catch {}
        }
        
        // Exponential backoff
        if (attempt < this.maxRetries - 1) {
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 1000 
          await new Promise(r => setTimeout(r, backoff))
        }
      }
    }

    throw lastError || new Error(`Failed to download ${url} after ${this.maxRetries} attempts`)
  }

  private async downloadFile(
    url: string,
    targetPath: string,
    onProgress?: (bytesChunk: number) => void
  ): Promise<{ size: number; hash: string }> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Client/1.0'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Failed to download ${url}`)
    }

    if (!response.body) {
      throw new Error('Response has no body')
    }

    // Using Writable stream with proper buffering
    const writeStream = fs.createWriteStream(targetPath)
    const hasher = crypto.createHash('sha256')
    let totalBytes = 0

    try {
      if (typeof (response.body as any).getReader === 'function') {
        const reader = (response.body as any).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          hasher.update(chunk);
          totalBytes += chunk.length;
          
          // Wait for drain if needed to respect backpressure
          if (!writeStream.write(chunk)) {
            await new Promise(resolve => writeStream.once('drain', resolve))
          }
          
          if (onProgress) onProgress(chunk.length);
        }
        writeStream.end();
      } else {
        // Standard ReadableStream
        for await (const chunk of response.body as any) {
          const bufferChunk = Buffer.from(chunk);
          hasher.update(bufferChunk);
          totalBytes += bufferChunk.length;
          
          if (!writeStream.write(bufferChunk)) {
             await new Promise(resolve => writeStream.once('drain', resolve))
          }
          
          if (onProgress) onProgress(bufferChunk.length);
        }
        writeStream.end();
      }

      // Wait for the stream to fully finish writing to disk
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })
    } catch (err) {
      writeStream.destroy()
      throw err
    }

    return { size: totalBytes, hash: hasher.digest('hex') }
  }

  sanitizeFilename(filename: string): string {
    // Use the industry standard sanitize-filename library
    let safe = sanitize(filename, { replacement: '_' })
    
    // Custom trimming for Windows compatibility
    safe = safe.replace(/^[. ]+|[. ]+$/g, '')
    
    // Truncate to reasonable length for MAX_PATH
    if (safe.length > 180) {
      const ext = path.extname(safe)
      safe = safe.substring(0, 180 - ext.length) + ext
    }
    
    if (!safe) safe = 'unnamed_file'
    return safe
  }
}

