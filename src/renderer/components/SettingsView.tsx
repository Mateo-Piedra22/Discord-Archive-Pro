import { useCallback, useEffect, useState } from 'react'
import { LogOut, Minus, Moon, Plus, RotateCw, Sun, Trash2, Undo2 } from 'lucide-react'
import { useDownloadStore } from '../stores/downloadStore'
import { useBrowserStore } from '../stores/browserStore'
import { useAuthStore } from '../stores/authStore'
import { showToast } from './Toast'
import type { DbStats, RateLimiterStats } from '../../shared/api'

type Seccion = 'general' | 'export' | 'advanced' | 'system'

const SECCIONES: { id: Seccion; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'export', label: 'Exportación' },
  { id: 'advanced', label: 'Avanzado' },
  { id: 'system', label: 'Sistema' }
]

const FORMATOS: { id: string; label: string; ext: string }[] = [
  { id: 'markdown', label: 'Markdown', ext: '.md' },
  { id: 'html', label: 'HTML', ext: '.html' },
  { id: 'json', label: 'JSON', ext: '.json' },
  { id: 'pdf', label: 'PDF', ext: '.pdf' },
  { id: 'epub', label: 'EPUB', ext: '.epub' }
]

const CONTENIDO: { key: string; label: string; hint: string }[] = [
  { key: 'text', label: 'Texto', hint: 'Cuerpo de los mensajes' },
  { key: 'images', label: 'Imágenes', hint: 'Fotos y capturas adjuntas' },
  { key: 'videos', label: 'Videos', hint: 'Clips adjuntos' },
  { key: 'files', label: 'Archivos', hint: 'PDF, ZIP y otros adjuntos' },
  { key: 'embeds', label: 'Embeds', hint: 'Previews de enlaces' },
  { key: 'replies', label: 'Respuestas', hint: 'Mensajes citados y enlazados' },
  { key: 'metadata', label: 'Metadatos', hint: 'IDs, reacciones y ediciones' },
  { key: 'customEmojis', label: 'Emojis del servidor', hint: 'Emojis personalizados' },
  { key: 'stickers', label: 'Stickers', hint: 'Stickers de Discord' },
  { key: 'avatars', label: 'Avatares', hint: 'Fotos de perfil de los autores' }
]

const ESTRUCTURAS: { id: 'single' | 'separate' | 'both'; label: string; hint: string }[] = [
  { id: 'single', label: 'Hilo unificado', hint: 'Un archivo por hilo, en orden cronológico' },
  { id: 'separate', label: 'Un archivo por mensaje', hint: 'Un archivo por cada mensaje del hilo' },
  { id: 'both', label: 'Ambos', hint: 'Genera las dos variantes de cada hilo' }
]

const FECHAS: { value: 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'YYYYMMDD'; label: string; example: string }[] = [
  { value: 'YYYY-MM-DD', label: 'ISO', example: '2026-11-11' },
  { value: 'DD-MM-YYYY', label: 'Europeo', example: '11-11-2026' },
  { value: 'YYYYMMDD', label: 'Compacto', example: '20261111' }
]

const TEMA_KEY = 'ui_theme'

const MIN_ZOOM_FACTOR = 0.8
const MAX_ZOOM_FACTOR = 2
const ZOOM_STEP = 0.1

function clampZoomFactor(value: number): number {
  if (!Number.isFinite(value)) return 1
  const rounded = Math.round(value * 10) / 10
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, rounded))
}

function readInitialZoomFactor(): number {
  const saved = localStorage.getItem('ui_zoom_factor')
  if (saved !== null && Number.isFinite(Number(saved))) return clampZoomFactor(Number(saved))

  // Migración del formato antiguo (delta relativo, -1 … 2).
  const legacy = localStorage.getItem('ui_zoom')
  if (legacy !== null && Number.isFinite(Number(legacy))) {
    const factor = clampZoomFactor(1 + Number(legacy))
    localStorage.setItem('ui_zoom_factor', String(factor))
    localStorage.removeItem('ui_zoom')
    return factor
  }

  return 1
}

function readTheme(): 'dark' | 'light' {
  return localStorage.getItem(TEMA_KEY) === 'light' ? 'light' : 'dark'
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

function numero(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value.toLocaleString('es-AR')
}

export default function SettingsView() {
  const outputDir = useDownloadStore((s) => s.outputDir)
  const exportFormats = useDownloadStore((s) => s.exportFormats)
  const contentSelection = useDownloadStore((s) => s.contentSelection)
  const threadMode = useDownloadStore((s) => s.threadMode)
  const includeToc = useDownloadStore((s) => s.includeToc)
  const maxConcurrent = useDownloadStore((s) => s.maxConcurrent)
  const maxFileSize = useDownloadStore((s) => s.maxFileSize)
  const autoOpenFolder = useDownloadStore((s) => s.autoOpenFolder)
  const preserveFilenames = useDownloadStore((s) => s.preserveFilenames)
  const minimizeToTray = useDownloadStore((s) => s.minimizeToTray)
  const strictChannelFiltering = useDownloadStore((s) => s.strictChannelFiltering)
  const dateFormat = useDownloadStore((s) => s.dateFormat)
  const syncMode = useDownloadStore((s) => s.syncMode)

  const setExportFormats = useDownloadStore((s) => s.setExportFormats)
  const setContentSelection = useDownloadStore((s) => s.setContentSelection)
  const setThreadMode = useDownloadStore((s) => s.setThreadMode)
  const setIncludeToc = useDownloadStore((s) => s.setIncludeToc)
  const setMaxConcurrent = useDownloadStore((s) => s.setMaxConcurrent)
  const setMaxFileSize = useDownloadStore((s) => s.setMaxFileSize)
  const setDateFormat = useDownloadStore((s) => s.setDateFormat)
  const setSyncMode = useDownloadStore((s) => s.setSyncMode)
  const setAutoOpenFolder = useDownloadStore((s) => s.setAutoOpenFolder)
  const setPreserveFilenames = useDownloadStore((s) => s.setPreserveFilenames)
  const setMinimizeToTray = useDownloadStore((s) => s.setMinimizeToTray)
  const setStrictChannelFiltering = useDownloadStore((s) => s.setStrictChannelFiltering)
  const pickDirectory = useDownloadStore((s) => s.pickDirectory)

  const showStandardChannels = useBrowserStore((s) => s.showStandardChannels)
  const setShowStandardChannels = useBrowserStore((s) => s.setShowStandardChannels)

  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const [seccion, setSeccion] = useState<Seccion>('general')
  const [zoomFactor, setZoomFactor] = useState<number>(readInitialZoomFactor)
  const [tema, setTema] = useState<'dark' | 'light'>(readTheme)
  const [siempreVisible, setSiempreVisible] = useState(false)
  const [dbStats, setDbStats] = useState<DbStats | null>(null)
  const [rateStats, setRateStats] = useState<RateLimiterStats | null>(null)
  const [purgeError, setPurgeError] = useState<string | null>(null)
  const [purging, setPurging] = useState(false)

  // Estado real de la ventana: el interruptor debe reflejar lo que dice el main.
  useEffect(() => {
    void window.api.window.getState().then((estado) => setSiempreVisible(estado.alwaysOnTop))
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const [db, rate] = await Promise.all([
        window.api.settings.getDbStats(),
        window.api.settings.getRateLimiterStats()
      ])
      setDbStats(db)
      setRateStats(rate)
    } catch (error) {
      console.error('No se pudieron leer las estadísticas:', error)
    }
  }, [])

  useEffect(() => {
    if (seccion !== 'system') return
    void loadStats()
    // No consultamos la BD con la ventana oculta o minimizada.
    const timer = setInterval(() => {
      if (!document.hidden) void loadStats()
    }, 5000)
    return () => clearInterval(timer)
  }, [seccion, loadStats])

  const handleZoom = (value: number) => {
    const next = clampZoomFactor(value)
    setZoomFactor(next)
    localStorage.setItem('ui_zoom_factor', String(next))
    window.api.window.setZoom(next)
  }

  const alternarTema = () => {
    const next = tema === 'dark' ? 'light' : 'dark'
    setTema(next)
    localStorage.setItem(TEMA_KEY, next)
    document.documentElement.dataset.theme = next
  }

  const restablecerVentana = async () => {
    try {
      const result = await window.api.window.resetState()
      showToast(
        result.success ? 'Ventana restablecida' : 'No se pudo restablecer la ventana',
        result.success ? 'success' : 'error'
      )
    } catch {
      showToast('No se pudo restablecer la ventana', 'error')
    }
  }

  const toggleFormato = (id: string) => {
    if (exportFormats.includes(id)) {
      if (exportFormats.length > 1) setExportFormats(exportFormats.filter((f) => f !== id))
      return
    }
    setExportFormats([...exportFormats, id])
  }

  const purgarCache = async () => {
    if (!confirm('¿Borrar la caché local de metadatos? Los archivos exportados no se tocan.')) {
      return
    }
    setPurging(true)
    setPurgeError(null)
    try {
      const result = await window.api.cache.clear()
      if (result.success) {
        showToast('Caché purgada', 'success')
        void loadStats()
      } else {
        setPurgeError(result.error || 'El backend no devolvió detalle del fallo.')
      }
    } catch (error) {
      setPurgeError(error instanceof Error ? error.message : String(error))
    } finally {
      setPurging(false)
    }
  }

  return (
    <>
      <header className="workspace__header">
        <div className="workspace__titles">
          <div className="workspace__title">Ajustes</div>
          <div className="workspace__subtitle">Preferencias de archivado, exportación y sistema</div>
        </div>
      </header>

      <div className="workspace__body">
        <div className="view-pad">
          <div className="section">
            <div className="row">
              {SECCIONES.map((item) => (
                <button
                  key={item.id}
                  className={`chip${seccion === item.id ? ' chip--active' : ''}`}
                  onClick={() => setSeccion(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {seccion === 'general' && (
              <div className="section">
                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Almacenamiento</span>
                  </div>

                  <div className="setting-row" onClick={() => void pickDirectory()}>
                    <div>
                      <div className="setting-row__label">Carpeta de descargas</div>
                      <div className="setting-row__hint mono truncate">
                        {outputDir || 'Sin definir'}
                      </div>
                    </div>
                    <span className="btn btn--sm">Cambiar</span>
                  </div>
                </div>

                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Interfaz</span>
                  </div>

                  <div className="setting-row">
                    <div>
                      <div className="setting-row__label">Escala de interfaz</div>
                      <div className="setting-row__hint">Tamaño del texto y de los controles.</div>
                    </div>
                    <div className="stepper">
                      <button
                        className="stepper__btn"
                        title="Reducir"
                        disabled={zoomFactor <= MIN_ZOOM_FACTOR}
                        onClick={() => handleZoom(zoomFactor - ZOOM_STEP)}
                      >
                        <Minus size={14} strokeWidth={1.8} />
                      </button>
                      <span className="stepper__value">{Math.round(zoomFactor * 100)}%</span>
                      <button
                        className="stepper__btn"
                        title="Aumentar"
                        disabled={zoomFactor >= MAX_ZOOM_FACTOR}
                        onClick={() => handleZoom(zoomFactor + ZOOM_STEP)}
                      >
                        <Plus size={14} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div>
                      <div className="setting-row__label">Tema</div>
                      <div className="setting-row__hint">
                        {tema === 'dark' ? 'Tinta oscura' : 'Papel claro'}
                      </div>
                    </div>
                    <button className="btn btn--sm" onClick={alternarTema}>
                      {tema === 'dark' ? (
                        <Sun size={14} strokeWidth={1.8} />
                      ) : (
                        <Moon size={14} strokeWidth={1.8} />
                      )}
                      {tema === 'dark' ? 'Claro' : 'Oscuro'}
                    </button>
                  </div>

                  <div className="setting-row" onClick={() => setMinimizeToTray(!minimizeToTray)}>
                    <div>
                      <div className="setting-row__label">Minimizar a la bandeja</div>
                      <div className="setting-row__hint">
                        Al cerrar, la ventana se oculta en lugar de salir.
                      </div>
                    </div>
                    <span className={`switch${minimizeToTray ? ' switch--on' : ''}`} />
                  </div>

                  <div
                    className="setting-row"
                    onClick={() => {
                      const siguiente = !siempreVisible
                      setSiempreVisible(siguiente)
                      window.api.window.setAlwaysOnTop(siguiente)
                    }}
                  >
                    <div>
                      <div className="setting-row__label">Mantener sobre otras ventanas</div>
                      <div className="setting-row__hint">
                        La ventana queda siempre en primer plano. Desactivado por defecto.
                      </div>
                    </div>
                    <span className={`switch${siempreVisible ? ' switch--on' : ''}`} />
                  </div>

                  <div className="setting-row">
                    <div>
                      <div className="setting-row__label">Restablecer ventana</div>
                      <div className="setting-row__hint">
                        Devuelve la ventana a un tamaño y posición usables.
                      </div>
                    </div>
                    <button className="btn btn--sm" onClick={() => void restablecerVentana()}>
                      <Undo2 size={14} strokeWidth={1.8} />
                      Restablecer
                    </button>
                  </div>
                </div>

                {user && (
                  <div className="card">
                    <div className="card__header">
                      <span className="card__title">Cuenta</span>
                    </div>
                    <div className="setting-row">
                      <div className="row">
                        <span className="badge badge--accent">
                          {(user.global_name || user.username).charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <div className="setting-row__label">
                            {user.global_name || user.username}
                          </div>
                          <div className="setting-row__hint mono">@{user.username}</div>
                        </div>
                      </div>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => {
                          logout()
                          showToast('Sesión cerrada', 'info')
                        }}
                      >
                        <LogOut size={14} strokeWidth={1.8} />
                        Cerrar sesión
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {seccion === 'export' && (
              <div className="section">
                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Formatos de salida</span>
                  </div>
                  <div className="card__body">
                    <div className="row">
                      {FORMATOS.map((formato) => (
                        <button
                          key={formato.id}
                          className={`chip${exportFormats.includes(formato.id) ? ' chip--active' : ''}`}
                          onClick={() => toggleFormato(formato.id)}
                          title={formato.ext}
                        >
                          {formato.label}
                        </button>
                      ))}
                    </div>
                    <div className="field__hint">
                      Se genera al menos un formato. Cada uno añade su propio archivo al exportar.
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Contenido a incluir</span>
                  </div>
                  {CONTENIDO.map((item) => {
                    const activo = Boolean(contentSelection[item.key as keyof typeof contentSelection])
                    return (
                      <div
                        key={item.key}
                        className="setting-row"
                        onClick={() => setContentSelection(item.key, !activo)}
                      >
                        <div>
                          <div className="setting-row__label">{item.label}</div>
                          <div className="setting-row__hint">{item.hint}</div>
                        </div>
                        <span className={`switch${activo ? ' switch--on' : ''}`} />
                      </div>
                    )
                  })}
                </div>

                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Estructura de hilos</span>
                  </div>
                  {ESTRUCTURAS.map((item) => {
                    const activo = threadMode === item.id
                    return (
                      <div
                        key={item.id}
                        className="setting-row"
                        onClick={() => setThreadMode(item.id)}
                      >
                        <div>
                          <div className="setting-row__label">{item.label}</div>
                          <div className="setting-row__hint">{item.hint}</div>
                        </div>
                        {activo && <span className="badge badge--accent">Activo</span>}
                      </div>
                    )
                  })}
                </div>

                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Nombres y límites</span>
                  </div>
                  <div className="card__body">
                    <div className="field">
                      <label className="field__label" htmlFor="ajuste-fecha">
                        Formato de fecha
                      </label>
                      <select
                        id="ajuste-fecha"
                        className="select"
                        value={dateFormat}
                        onChange={(e) => setDateFormat(e.target.value)}
                      >
                        {FECHAS.map((fecha) => (
                          <option key={fecha.value} value={fecha.value}>
                            {fecha.label} — {fecha.example}
                          </option>
                        ))}
                      </select>
                      <span className="field__hint">
                        Se usa en los nombres de archivo generados al exportar.
                      </span>
                    </div>

                    <div className="field">
                      <label className="field__label" htmlFor="ajuste-tamano">
                        Tamaño máximo por archivo (MB)
                      </label>
                      <input
                        id="ajuste-tamano"
                        className="input mono"
                        type="number"
                        min={0}
                        step={10}
                        value={maxFileSize}
                        onChange={(e) =>
                          setMaxFileSize(Math.max(0, Math.round(Number(e.target.value) || 0)))
                        }
                      />
                      <span className="field__hint">
                        Los adjuntos más grandes se omiten. 0 significa sin límite.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {seccion === 'advanced' && (
              <div className="section">
                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Rendimiento</span>
                  </div>
                  <div className="setting-row">
                    <div>
                      <div className="setting-row__label">Descargas simultáneas</div>
                      <div className="setting-row__hint">
                        Hilos que se procesan a la vez. Valores altos aumentan el riesgo de
                        limitación por parte de Discord.
                      </div>
                    </div>
                    <div className="stepper">
                      <button
                        className="stepper__btn"
                        title="Reducir"
                        disabled={maxConcurrent <= 1}
                        onClick={() => setMaxConcurrent(maxConcurrent - 1)}
                      >
                        <Minus size={14} strokeWidth={1.8} />
                      </button>
                      <span className="stepper__value">{maxConcurrent}</span>
                      <button
                        className="stepper__btn"
                        title="Aumentar"
                        disabled={maxConcurrent >= 10}
                        onClick={() => setMaxConcurrent(maxConcurrent + 1)}
                      >
                        <Plus size={14} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Proceso de archivado</span>
                  </div>

                  <div
                    className="setting-row"
                    onClick={() => setPreserveFilenames(!preserveFilenames)}
                  >
                    <div>
                      <div className="setting-row__label">Preservar nombres originales</div>
                      <div className="setting-row__hint">
                        Los adjuntos conservan el nombre con el que se subieron.
                      </div>
                    </div>
                    <span className={`switch${preserveFilenames ? ' switch--on' : ''}`} />
                  </div>

                  <div
                    className="setting-row"
                    onClick={() => setSyncMode(syncMode === 'force' ? 'quick' : 'force')}
                  >
                    <div>
                      <div className="setting-row__label">Reexportar siempre (forzar)</div>
                      <div className="setting-row__hint">
                        Ignora la caché y vuelve a generar los archivos aunque no haya cambios.
                      </div>
                    </div>
                    <span className={`switch${syncMode === 'force' ? ' switch--on' : ''}`} />
                  </div>

                  <div
                    className="setting-row"
                    onClick={() => setStrictChannelFiltering(!strictChannelFiltering)}
                  >
                    <div>
                      <div className="setting-row__label">Privacidad estricta de canales</div>
                      <div className="setting-row__hint">
                        Oculta los canales restringidos o sin permiso de lectura.
                      </div>
                    </div>
                    <span className={`switch${strictChannelFiltering ? ' switch--on' : ''}`} />
                  </div>

                  <div
                    className="setting-row"
                    onClick={() => setAutoOpenFolder(!autoOpenFolder)}
                  >
                    <div>
                      <div className="setting-row__label">Abrir carpeta al terminar</div>
                      <div className="setting-row__hint">
                        Abre el explorador en la carpeta de salida al completar la cola.
                      </div>
                    </div>
                    <span className={`switch${autoOpenFolder ? ' switch--on' : ''}`} />
                  </div>

                  <div className="setting-row" onClick={() => setIncludeToc(!includeToc)}>
                    <div>
                      <div className="setting-row__label">Generar índice</div>
                      <div className="setting-row__hint">
                        Escribe un índice con los hilos y sus archivos en cada carpeta.
                      </div>
                    </div>
                    <span className={`switch${includeToc ? ' switch--on' : ''}`} />
                  </div>

                  <div
                    className="setting-row"
                    onClick={() => setShowStandardChannels(!showStandardChannels)}
                  >
                    <div>
                      <div className="setting-row__label">
                        Explorar canales estándar
                        <span className="badge badge--warn">Experimental</span>
                      </div>
                      <div className="setting-row__hint">
                        Habilita canales de texto y mensajes directos en el explorador.
                      </div>
                    </div>
                    <span className={`switch${showStandardChannels ? ' switch--on' : ''}`} />
                  </div>
                </div>
              </div>
            )}

            {seccion === 'system' && (
              <div className="section">
                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Base de datos local</span>
                    <span className="spacer" />
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      title="Actualizar"
                      onClick={() => void loadStats()}
                    >
                      <RotateCw size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="muted">Posts en caché</td>
                        <td className="mono">{numero(dbStats?.totalPosts)}</td>
                      </tr>
                      <tr>
                        <td className="muted">Mensajes indexados</td>
                        <td className="mono">{numero(dbStats?.totalMessages)}</td>
                      </tr>
                      <tr>
                        <td className="muted">Archivos registrados</td>
                        <td className="mono">{numero(dbStats?.totalFiles)}</td>
                      </tr>
                      <tr>
                        <td className="muted">Tamaño total</td>
                        <td className="mono">{dbStats ? formatBytes(dbStats.totalSize) : '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Limitador de peticiones</span>
                    <span className="spacer" />
                    <span className={`badge ${rateStats ? 'badge--ok' : 'badge'}`}>
                      {rateStats ? 'Activo' : 'Sin datos'}
                    </span>
                  </div>
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="muted">Peticiones totales</td>
                        <td className="mono">{numero(rateStats?.totalRequests)}</td>
                      </tr>
                      <tr>
                        <td className="muted">Espera media</td>
                        <td className="mono">
                          {rateStats ? `${Math.round(rateStats.averageWaitMs)} ms` : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td className="muted">Hits de rate limit</td>
                        <td className="mono">{numero(rateStats?.rateLimitHits)}</td>
                      </tr>
                      <tr>
                        <td className="muted">Rutas registradas</td>
                        <td className="mono">
                          {rateStats ? numero(Object.keys(rateStats.routes).length) : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Mantenimiento</span>
                  </div>
                  <div className="card__body">
                    <div className="row">
                      <div className="col">
                        <div className="setting-row__label">Purgar caché de metadatos</div>
                        <div className="setting-row__hint">
                          Borra el índice local de posts y mensajes. Los archivos exportados no se
                          modifican.
                        </div>
                      </div>
                      <span className="spacer" />
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => void purgarCache()}
                        disabled={purging}
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                        {purging ? 'Purgando…' : 'Purgar caché'}
                      </button>
                    </div>
                    {purgeError && <div className="field__hint dim">{purgeError}</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
