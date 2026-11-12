// ============================================================
// Rutas de datos portables.
// En el target "portable" de electron-builder, process.execPath vive
// en una carpeta temporal que se borra al cerrar: hay que usar
// PORTABLE_EXECUTABLE_DIR para que los datos sobrevivan.
// ============================================================

import { app } from 'electron'
import path from 'path'

export function getDataDir(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'data')
  }
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) {
    return path.join(portableDir, 'data')
  }
  return path.join(path.dirname(process.execPath), 'data')
}
