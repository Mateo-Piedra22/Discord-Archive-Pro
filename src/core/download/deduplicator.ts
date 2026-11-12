// ============================================================
// Deduplicador — evita volver a descargar el mismo adjunto.
// IMPORTANTE: solo deduplica dentro del MISMO post. Reutilizar un
// archivo de otro post obligaría a rutas absolutas en los exports
// (enlaces rotos al mover la carpeta y fuga de rutas del usuario).
// ============================================================

import fs from 'fs'
import path from 'path'
import { getCachedFile } from '../storage/database'

export class Deduplicator {
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

    // Solo vale si el archivo vive dentro de este post.
    const relative = path.relative(postDir, cached.local_path)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null

    const posix = relative.split(path.sep).join('/')
    this.session.set(fileId, posix)
    return posix
  }

  record(fileId: string, relativePath: string): void {
    this.session.set(fileId, relativePath)
  }

  clear(): void {
    this.session.clear()
  }

  private existsInPost(postDir: string, relativePath: string): boolean {
    return fs.existsSync(path.join(postDir, relativePath.split('/').join(path.sep)))
  }
}
