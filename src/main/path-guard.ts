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
