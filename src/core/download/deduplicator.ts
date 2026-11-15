// ============================================================
// Deduplicador — evita volver a descargar el mismo adjunto.
// IMPORTANTE: solo deduplica dentro del MISMO post. Reutilizar un
// archivo de otro post obligaría a rutas absolutas en los exports
// (enlaces rotos al mover la carpeta y fuga de rutas del usuario).
// ============================================================

import fs from 'fs'
import path from 'path'
import { getCachedFile } from '../storage/database'

export const MAX_SESSION_ENTRIES = 5000

export class Deduplicator {
  static readonly MAX_SESSION_ENTRIES = MAX_SESSION_ENTRIES
  private session = new Map<string, string>() // fileId -> ruta relativa

  /**
   * Devuelve la ruta relativa (assets/...) si el archivo ya existe
   * dentro de este post, o null si hay que descargarlo.
   */
  check(fileId: string, postDir: string): string | null {
    const sessionHit = this.session.get(fileId)
    if (sessionHit && this.existsInPost(postDir, sessionHit)) return sessionHit

    const cached = getCachedFile(fileId)
    if (!cached || !cached.still_valid) return null
    if (!fs.existsSync(cached.local_path)) return null

    const posix = this.resolveInPost(postDir, cached.local_path)
    if (!posix) return null

    this.remember(fileId, posix)
    return posix
  }

  /**
   * Versión asíncrona de `check`: valida la existencia en disco con
   * `fs.promises.access` para no bloquear el event loop.
   */
  async checkAsync(fileId: string, postDir: string): Promise<string | null> {
    const sessionHit = this.session.get(fileId)
    if (sessionHit && (await this.existsInPostAsync(postDir, sessionHit))) {
      return sessionHit
    }

    const cached = getCachedFile(fileId)
    if (!cached || !cached.still_valid) return null
    if (!(await this.fileExistsAsync(cached.local_path))) return null

    const posix = this.resolveInPost(postDir, cached.local_path)
    if (!posix) return null

    this.remember(fileId, posix)
    return posix
  }

  record(fileId: string, relativePath: string): void {
    this.remember(fileId, relativePath)
  }

  clear(): void {
    this.session.clear()
  }

  private resolveInPost(postDir: string, localPath: string): string | null {
    // Solo vale si el archivo vive dentro de este post.
    const relative = path.relative(postDir, localPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    return relative.split(path.sep).join('/')
  }

  private remember(fileId: string, relativePath: string): void {
    if (this.session.has(fileId)) {
      this.session.delete(fileId)
    }
    while (this.session.size >= Deduplicator.MAX_SESSION_ENTRIES) {
      const oldestKey = this.session.keys().next().value
      if (oldestKey === undefined) break
      this.session.delete(oldestKey)
    }
    this.session.set(fileId, relativePath)
  }

  private existsInPost(postDir: string, relativePath: string): boolean {
    return fs.existsSync(path.join(postDir, relativePath.split('/').join(path.sep)))
  }

  private async existsInPostAsync(postDir: string, relativePath: string): Promise<boolean> {
    return this.fileExistsAsync(path.join(postDir, relativePath.split('/').join(path.sep)))
  }

  private async fileExistsAsync(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
