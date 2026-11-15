// ============================================================
// Guard de rutas — impide que el renderer lea fuera del
// directorio de salida mediante `..`, rutas absolutas o
// enlaces simbólicos.
// ============================================================

import path from 'path'
import fs from 'fs'

/** true si `target` está estrictamente dentro de `dir`. */
export function isInside(dir: string, target: string): boolean {
  if (!dir || !target) return false
  const root = path.resolve(dir)
  const resolved = path.resolve(target)
  const rel = path.relative(root, resolved)
  if (rel.length === 0) return false
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false
  return true
}

/**
 * Igual que `isInside`, pero además resuelve enlaces simbólicos para
 * que un symlink dentro del directorio no escape de él.
 */
export function isInsideReal(dir: string, target: string): boolean {
  if (!isInside(dir, target)) return false
  try {
    const realRoot = fs.realpathSync(dir)
    const realTarget = fs.realpathSync(target)
    return isInside(realRoot, realTarget)
  } catch {
    return false
  }
}

const REALPATH_CACHE_MAX = 64
const REALPATH_CACHE_TTL_MS = 10_000
const realpathCache = new Map<string, { real: string; expiresAt: number }>()

/** Limpia la caché en memoria de rutas raíz resueltas. */
export function clearRealpathCache(): void {
  realpathCache.clear()
}

/**
 * Variante asíncrona de `isInsideReal` que no bloquea el event loop
 * y cachea brevemente la resolución de `dir`.
 */
export async function isInsideRealAsync(dir: string, target: string): Promise<boolean> {
  if (!isInside(dir, target)) return false
  try {
    const now = Date.now()
    const key = path.resolve(dir)
    const cached = realpathCache.get(key)
    let realRoot: string

    if (cached && cached.expiresAt > now) {
      realRoot = cached.real
    } else {
      if (cached) realpathCache.delete(key)
      realRoot = await fs.promises.realpath(dir)
      if (realpathCache.size >= REALPATH_CACHE_MAX) {
        for (const [k, entry] of realpathCache) {
          if (entry.expiresAt <= now) realpathCache.delete(k)
        }
        if (realpathCache.size >= REALPATH_CACHE_MAX) {
          realpathCache.clear()
        }
      }
      realpathCache.set(key, {
        real: realRoot,
        expiresAt: Date.now() + REALPATH_CACHE_TTL_MS
      })
    }

    const realTarget = await fs.promises.realpath(target)
    return isInside(realRoot, realTarget)
  } catch {
    return false
  }
}
