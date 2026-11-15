import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderOpen,
  Inbox,
  Pause,
  Play,
  RotateCw,
  Search,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { useDownloadStore } from '../stores/downloadStore'
import { useUiStore } from '../stores/uiStore'
import type { DownloadHistoryRecord, DownloadStatus, DownloadTask } from '../../core/discord/types'
import { showToast } from './Toast'

const PAGE_SIZE = 25
const HISTORY_FILTER_FETCH_LIMIT = 500

type StatusFilter = 'all' | 'active' | 'error' | 'done'

const FILTER_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'active', label: 'Activas' },
  { id: 'error', label: 'Errores' },
  { id: 'done', label: 'Completadas' }
]

const STATUS: Record<DownloadStatus, { label: string; badge: string }> = {
  queued: { label: 'En cola', badge: 'badge' },
  downloading: { label: 'Descargando', badge: 'badge badge--accent' },
  done: { label: 'Completado', badge: 'badge badge--ok' },
  error: { label: 'Error', badge: 'badge badge--err' },
  cancelled: { label: 'Cancelado', badge: 'badge' },
  paused: { label: 'Pausado', badge: 'badge badge--warn' }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 KB/s'
  if (bytesPerSec < 1024 * 1024) {
    const kb = bytesPerSec / 1024
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB/s`
  }
  const mb = bytesPerSec / (1024 * 1024)
  return `${mb.toFixed(1)} MB/s`
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  if (total < 60) return `${total}s`
  const min = Math.floor(total / 60)
  const rest = total % 60
  return `${min}m ${String(rest).padStart(2, '0')}s`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function percentOf(task: DownloadTask): number {
  const { assetsDownloaded, assetsTotal } = task.progress
  if (!assetsTotal || assetsTotal <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((assetsDownloaded / assetsTotal) * 100)))
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') {
    return status === 'downloading' || status === 'queued' || status === 'paused'
  }
  if (filter === 'error') return status === 'error'
  return status === 'done'
}

function matchesSearchQuery(fields: (string | null | undefined)[], query: string): boolean {
  const needle = normalizeText(query.trim())
  if (!needle) return true
  return fields.some((field) => field && normalizeText(field).includes(needle))
}

const HISTORY_CSV_HEADER =
  'id,thread_name,guild_name,channel_name,status,files_count,total_bytes,completed_at,download_path'

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildHistoryCsv(rows: DownloadHistoryRecord[]): string {
  const lines = [HISTORY_CSV_HEADER]
  for (const row of rows) {
    lines.push(
      [
        escapeCsvField(row.id),
        escapeCsvField(row.thread_name),
        escapeCsvField(row.guild_name),
        escapeCsvField(row.channel_name),
        escapeCsvField(row.status),
        escapeCsvField(row.files_count),
        escapeCsvField(row.total_bytes),
        escapeCsvField(row.completed_at),
        escapeCsvField(row.download_path)
      ].join(',')
    )
  }
  return lines.join('\r\n')
}

function FilterToolbar({
  statusFilter,
  onStatusChange,
  searchQuery,
  onSearchChange,
  counts
}: {
  statusFilter: StatusFilter
  onStatusChange: (next: StatusFilter) => void
  searchQuery: string
  onSearchChange: (next: string) => void
  counts?: Record<StatusFilter, number>
}) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            className={`chip${statusFilter === opt.id ? ' chip--active' : ''}`}
            onClick={() => onStatusChange(opt.id)}
          >
            {opt.label}
            {counts && <span className="mono">{counts[opt.id]}</span>}
          </button>
        ))}
      </div>

      <div className="search" style={{ flex: 1, minWidth: 220 }}>
        <Search size={14} strokeWidth={1.8} className="search__icon" />
        <input
          className="input input--search"
          placeholder="Buscar por nombre, servidor o canal"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  )
}

/** Acción disponible según el estado de la tarea. */
function TaskAction({ task }: { task: DownloadTask }) {
  const cancelTask = useDownloadStore((s) => s.cancelTask)
  const retryTask = useDownloadStore((s) => s.retryTask)
  const removeTask = useDownloadStore((s) => s.removeTask)

  if (task.status === 'error') {
    return (
      <div className="row" style={{ gap: 'var(--sp-1)' }}>
        <button
          className="btn btn--ghost btn--sm btn--icon"
          title="Reintentar"
          onClick={() => retryTask(task.id)}
        >
          <RotateCw size={14} strokeWidth={1.8} />
        </button>
        <button
          className="btn btn--ghost btn--sm btn--icon"
          title="Quitar de la lista"
          onClick={() => void removeTask(task.id)}
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    )
  }

  if (task.status === 'done' || task.status === 'cancelled') {
    if (task.status === 'done' && task.downloadPath) {
      return (
        <div className="row" style={{ gap: 'var(--sp-1)' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            title="Abrir en el visor integrado"
            aria-label="Abrir en el visor integrado"
            onClick={() => useUiStore.getState().abrirArchivo(task.downloadPath!)}
          >
            <BookOpen size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            title="Quitar de la lista"
            onClick={() => void removeTask(task.id)}
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        </div>
      )
    }

    return (
      <button
        type="button"
        className="btn btn--ghost btn--sm btn--icon"
        title="Quitar de la lista"
        onClick={() => void removeTask(task.id)}
      >
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    )
  }

  return (
    <button
      className="btn btn--ghost btn--sm btn--icon"
      title="Cancelar descarga"
      onClick={() => cancelTask(task.id)}
    >
      <X size={14} strokeWidth={1.8} />
    </button>
  )
}

function TaskRow({ task }: { task: DownloadTask }) {
  const status = STATUS[task.status]
  const percent = percentOf(task)
  const enCurso = task.status === 'downloading'
  const phase = task.progress.phase
  const fetching = enCurso && phase === 'fetching'
  const exporting = enCurso && phase === 'exporting'
  const indeterminate = fetching || exporting

  return (
    <div className="col">
      <div className="list__row">
        <span className="list__name truncate">{task.threadName || task.threadId}</span>
        <span className="list__meta truncate">
          {task.guildName} · {task.channelName}
        </span>
        <span className="spacer" />
        {task.priority > 0 && (
          <span className="badge mono">Prioridad {task.priority}</span>
        )}
        <span className={status.badge}>{status.label}</span>
        <TaskAction task={task} />
      </div>

      {enCurso && (
        <div className="progress">
          <div
            className={`progress__fill${indeterminate ? ' progress__fill--indeterminate' : ''}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {enCurso && (
        <div className="listmeta">
          {phase === 'fetching' ? (
            <span className="dim">Obteniendo mensajes del hilo…</span>
          ) : phase === 'exporting' ? (
            <span className="dim">Generando exportación…</span>
          ) : (
            <>
              <span className="mono">
                {task.progress.assetsDownloaded}/{task.progress.assetsTotal}
              </span>
              <span className="dim">archivos</span>
              <span className="dim">·</span>
              <span className="mono">{formatBytes(task.progress.speed)}/s</span>
              <span className="dim">·</span>
              <span className="mono">ETA {formatEta(task.progress.eta)}</span>
              <span className="dim">·</span>
              <span className="mono">{percent}%</span>
              {phase === 'downloading_assets' && task.progress.currentFile && (
                <>
                  <span className="dim">·</span>
                  <span
                    className="dim mono truncate"
                    style={{ flex: '1 1 0', minWidth: 0 }}
                    title={task.progress.currentFile}
                  >
                    {task.progress.currentFile}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      )}

      {task.status === 'error' && task.errorMessage && (
        <div className="listmeta dim truncate">{task.errorMessage}</div>
      )}
    </div>
  )
}

function HistoryTable() {
  const fetchHistory = useDownloadStore((s) => s.fetchHistory)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<DownloadHistoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const hasFilter = statusFilter !== 'all' || searchQuery.trim().length > 0

  useEffect(() => {
    let active = true
    setLoading(true)
    const limit = hasFilter ? HISTORY_FILTER_FETCH_LIMIT : PAGE_SIZE
    const offset = hasFilter ? 0 : page * PAGE_SIZE
    void fetchHistory(limit, offset).then((data) => {
      if (!active) return
      setRows(data)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [fetchHistory, page, hasFilter])

  const handleStatusChange = useCallback((next: StatusFilter) => {
    setStatusFilter(next)
    setPage(0)
  }, [])

  const handleSearchChange = useCallback((next: string) => {
    setSearchQuery(next)
    setPage(0)
  }, [])

  const filteredRows = useMemo(() => {
    if (!hasFilter) return rows
    return rows.filter(
      (row) =>
        matchesStatusFilter(row.status, statusFilter) &&
        matchesSearchQuery(
          [row.thread_name, row.thread_id, row.guild_name, row.channel_name],
          searchQuery
        )
    )
  }, [rows, hasFilter, statusFilter, searchQuery])

  const visibleRows = hasFilter
    ? filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    : filteredRows

  const haySiguiente = hasFilter
    ? (page + 1) * PAGE_SIZE < filteredRows.length
    : rows.length >= PAGE_SIZE

  const copiarCsv = useCallback(async () => {
    if (filteredRows.length === 0) return
    try {
      await navigator.clipboard.writeText(buildHistoryCsv(filteredRows))
      showToast(
        `CSV copiado (${filteredRows.length} ${filteredRows.length === 1 ? 'registro' : 'registros'})`,
        'success'
      )
    } catch {
      showToast('No se pudo copiar el CSV al portapapeles', 'error')
    }
  }, [filteredRows])

  return (
    <>
      <FilterToolbar
        statusFilter={statusFilter}
        onStatusChange={handleStatusChange}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
      />

      {!loading && visibleRows.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">
            <Inbox size={18} strokeWidth={1.8} />
          </div>
          <div className="empty__title">{hasFilter ? 'Sin resultados' : 'Sin historial'}</div>
          <div className="empty__text">
            {hasFilter
              ? 'Ningún registro coincide con el filtro o la búsqueda actual.'
              : 'Aquí aparecerán los archivos ya exportados, con su tamaño, fecha y ubicación.'}
          </div>
          {hasFilter && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setStatusFilter('all')
                setSearchQuery('')
                setPage(0)
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="col">
          <div className="listmeta">
            <span>Página {page + 1}</span>
            <span className="dim">·</span>
            <span>{filteredRows.length} registros</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              title="Copiar historial filtrado en formato CSV"
              disabled={loading || filteredRows.length === 0}
              onClick={() => void copiarCsv()}
            >
              <Copy size={14} strokeWidth={1.8} />
              Copiar CSV
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              title="Página anterior"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              title="Página siguiente"
              disabled={!haySiguiente}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={14} strokeWidth={1.8} />
            </button>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Hilo</th>
                <th>Servidor / Canal</th>
                <th>Estado</th>
                <th>Archivos</th>
                <th>Tamaño</th>
                <th>Fecha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const estado = (row.status as DownloadStatus) || 'done'
                const meta = STATUS[estado] ?? STATUS.done
                return (
                  <tr key={row.id}>
                    <td className="truncate">
                      {row.download_path ? (
                        <button
                          type="button"
                          className="list__name truncate"
                          style={{ textAlign: 'left', maxWidth: '100%' }}
                          title="Abrir en el visor integrado"
                          onClick={() => useUiStore.getState().abrirArchivo(row.download_path as string)}
                        >
                          {row.thread_name || row.thread_id}
                        </button>
                      ) : (
                        row.thread_name || row.thread_id
                      )}
                    </td>
                    <td className="truncate muted">
                      {row.guild_name || '—'} · {row.channel_name || '—'}
                    </td>
                    <td>
                      <span className={meta.badge}>{meta.label}</span>
                    </td>
                    <td className="mono">{row.files_count}</td>
                    <td className="mono">{formatBytes(row.total_bytes)}</td>
                    <td className="mono dim">{formatDate(row.completed_at || row.started_at)}</td>
                    <td>
                      {row.download_path && (
                        <div className="row" style={{ gap: 'var(--sp-1)' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm btn--icon"
                            title="Abrir en el visor integrado"
                            aria-label="Abrir en el visor integrado"
                            onClick={() => {
                              useUiStore.getState().abrirArchivo(row.download_path as string)
                            }}
                          >
                            <BookOpen size={14} strokeWidth={1.8} />
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm btn--icon"
                            title="Abrir carpeta"
                            aria-label="Abrir carpeta"
                            onClick={() => {
                              void window.api.settings.openFolder(row.download_path as string)
                            }}
                          >
                            <FolderOpen size={14} strokeWidth={1.8} />
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm btn--icon"
                            title="Mostrar en explorador"
                            aria-label="Mostrar en explorador"
                            onClick={() => {
                              void window.api.settings.revealFolder(row.download_path as string)
                            }}
                          >
                            <ExternalLink size={14} strokeWidth={1.8} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default function DownloadsView() {
  const queue = useDownloadStore((s) => s.queue)
  const isDownloading = useDownloadStore((s) => s.isDownloading)
  const outputDir = useDownloadStore((s) => s.outputDir)
  const pauseAll = useDownloadStore((s) => s.pauseAll)
  const resumeAll = useDownloadStore((s) => s.resumeAll)
  const cancelAll = useDownloadStore((s) => s.cancelAll)
  const clearCompleted = useDownloadStore((s) => s.clearCompleted)
  const retryAllFailed = useDownloadStore((s) => s.retryAllFailed)
  const openOutputFolder = useDownloadStore((s) => s.openOutputFolder)

  const [vista, setVista] = useState<'cola' | 'historial'>('cola')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const stats = useMemo(() => {
    let activas = 0
    let descargando = 0
    let enCola = 0
    let enMarcha = 0
    let pausadas = 0
    let completadas = 0
    let errores = 0
    let terminadas = 0
    let velocidadTotal = 0
    let bytesDescargados = 0
    let bytesTotales = 0

    for (const task of queue) {
      if (task.status === 'downloading') {
        descargando += 1
        enMarcha += 1
        activas += 1
        velocidadTotal += task.progress.speed || 0
        bytesDescargados += task.progress.bytesDownloaded || 0
        bytesTotales += task.progress.bytesTotal || 0
      } else if (task.status === 'queued') {
        enCola += 1
        enMarcha += 1
        activas += 1
        bytesDescargados += task.progress.bytesDownloaded || 0
        bytesTotales += task.progress.bytesTotal || 0
      } else if (task.status === 'paused') {
        pausadas += 1
        activas += 1
      } else {
        terminadas += 1
        if (task.status === 'done') completadas += 1
        else if (task.status === 'error') errores += 1
      }
    }

    return {
      activas,
      descargando,
      enCola,
      enMarcha,
      pausadas,
      completadas,
      errores,
      terminadas,
      velocidadTotal,
      bytesDescargados,
      bytesTotales
    }
  }, [queue])

  const filterCounts = useMemo<Record<StatusFilter, number>>(
    () => ({
      all: queue.length,
      active: stats.activas,
      error: stats.errores,
      done: stats.completadas
    }),
    [queue.length, stats.activas, stats.errores, stats.completadas]
  )

  const filteredQueue = useMemo(() => {
    return queue.filter(
      (task) =>
        matchesStatusFilter(task.status, statusFilter) &&
        matchesSearchQuery(
          [task.threadName, task.threadId, task.guildName, task.channelName],
          searchQuery
        )
    )
  }, [queue, statusFilter, searchQuery])

  const hasColaFilter = statusFilter !== 'all' || searchQuery.trim().length > 0

  const ultimaCompletadaConRuta = useMemo(() => {
    for (let i = queue.length - 1; i >= 0; i--) {
      const task = queue[i]
      if (task.status === 'done' && task.downloadPath) return task
    }
    return null
  }, [queue])

  const volumenEnCurso =
    stats.bytesTotales > 0 && stats.bytesTotales >= stats.bytesDescargados
      ? `${formatBytes(stats.bytesDescargados)} / ${formatBytes(stats.bytesTotales)}`
      : formatBytes(stats.bytesDescargados)

  const abrirCarpeta = useCallback(() => openOutputFolder(), [openOutputFolder])

  return (
    <>
      <header className="workspace__header">
        <div className="workspace__titles">
          <div className="workspace__title">Cola</div>
          <div className="workspace__subtitle">
            {stats.activas} {stats.activas === 1 ? 'activa' : 'activas'} · {stats.completadas} completadas
          </div>
        </div>

        <div className="workspace__actions">
          {ultimaCompletadaConRuta?.downloadPath && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              title={`Abrir en el visor integrado: ${ultimaCompletadaConRuta.threadName || ultimaCompletadaConRuta.threadId}`}
              onClick={() => useUiStore.getState().abrirArchivo(ultimaCompletadaConRuta.downloadPath!)}
            >
              <BookOpen size={14} strokeWidth={1.8} />
              Abrir última en visor
            </button>
          )}
          {isDownloading ? (
            <button
              className="btn btn--ghost btn--sm"
              onClick={pauseAll}
              disabled={stats.enMarcha === 0}
            >
              <Pause size={14} strokeWidth={1.8} />
              Pausar
            </button>
          ) : (
            <button
              className="btn btn--ghost btn--sm"
              onClick={resumeAll}
              disabled={stats.pausadas === 0}
            >
              <Play size={14} strokeWidth={1.8} />
              Reanudar
            </button>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={cancelAll}
            disabled={stats.activas === 0}
          >
            <Square size={14} strokeWidth={1.8} />
            Detener todo
          </button>
          {stats.errores > 0 && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => void retryAllFailed()}
            >
              <RotateCw size={14} strokeWidth={1.8} />
              Reintentar fallidas ({stats.errores})
            </button>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={clearCompleted}
            disabled={stats.terminadas === 0}
          >
            <Trash2 size={14} strokeWidth={1.8} />
            Limpiar completadas
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={abrirCarpeta}
            disabled={!outputDir}
          >
            <FolderOpen size={14} strokeWidth={1.8} />
            Abrir carpeta
          </button>
        </div>
      </header>

      <div className="workspace__body">
        <div className="view-pad">
          <div className="section">
            <div className="row">
              <button
                className={`chip${vista === 'cola' ? ' chip--active' : ''}`}
                onClick={() => setVista('cola')}
              >
                Cola
              </button>
              <button
                className={`chip${vista === 'historial' ? ' chip--active' : ''}`}
                onClick={() => setVista('historial')}
              >
                Historial
              </button>
            </div>

            {stats.enMarcha > 0 && (
              <div
                className="card"
                style={{ padding: 'var(--sp-2) var(--sp-3)' }}
                aria-label="Rendimiento de descargas en vivo"
              >
                <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                  <div className="row" style={{ gap: 'var(--sp-2)' }}>
                    <Activity size={14} strokeWidth={1.8} className="muted" />
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {formatSpeed(stats.velocidadTotal)}
                    </span>
                  </div>

                  <span className="dim">·</span>

                  <span className="badge badge--accent mono">
                    {stats.descargando} {stats.descargando === 1 ? 'activa' : 'activas'}
                  </span>
                  <span className="badge mono">{stats.enCola} en espera</span>
                  <span className={`badge mono${stats.errores > 0 ? ' badge--err' : ''}`}>
                    {stats.errores} {stats.errores === 1 ? 'error' : 'errores'}
                  </span>

                  <span className="spacer" />

                  <span className="list__meta mono">Volumen: {volumenEnCurso}</span>
                </div>
              </div>
            )}

            {vista === 'cola' ? (
              <>
                <FilterToolbar
                  statusFilter={statusFilter}
                  onStatusChange={setStatusFilter}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  counts={filterCounts}
                />

                {queue.length === 0 ? (
                  <div className="empty">
                    <div className="empty__icon">
                      <Inbox size={18} strokeWidth={1.8} />
                    </div>
                    <div className="empty__title">No hay descargas</div>
                    <div className="empty__text">
                      Abre un canal en Explorar, selecciona los hilos y usa «Archivar» para
                      encolarlos. El progreso y los errores aparecerán aquí.
                    </div>
                  </div>
                ) : filteredQueue.length === 0 ? (
                  <div className="empty">
                    <div className="empty__icon">
                      <Search size={18} strokeWidth={1.8} />
                    </div>
                    <div className="empty__title">Sin resultados</div>
                    <div className="empty__text">
                      Ninguna tarea coincide con el filtro o la búsqueda actual.
                    </div>
                    {hasColaFilter && (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setStatusFilter('all')
                          setSearchQuery('')
                        }}
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="list">
                    {filteredQueue.map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <HistoryTable />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
