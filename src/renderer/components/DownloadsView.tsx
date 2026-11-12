import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Inbox,
  Pause,
  Play,
  RotateCw,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { useDownloadStore } from '../stores/downloadStore'
import type { DownloadHistoryRecord, DownloadStatus, DownloadTask } from '../../core/discord/types'

const PAGE_SIZE = 25

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

/** Acción disponible según el estado de la tarea. */
function TaskAction({ task }: { task: DownloadTask }) {
  const cancelTask = useDownloadStore((s) => s.cancelTask)
  const retryTask = useDownloadStore((s) => s.retryTask)
  const clearCompleted = useDownloadStore((s) => s.clearCompleted)

  if (task.status === 'error') {
    return (
      <button
        className="btn btn--ghost btn--sm btn--icon"
        title="Reintentar"
        onClick={() => retryTask(task.id)}
      >
        <RotateCw size={14} strokeWidth={1.8} />
      </button>
    )
  }

  if (task.status === 'done' || task.status === 'cancelled') {
    return (
      <button
        className="btn btn--ghost btn--sm btn--icon"
        title="Quitar de la lista"
        onClick={clearCompleted}
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
  const fetching = enCurso && task.progress.phase === 'fetching'

  return (
    <div className="col">
      <div className="list__row">
        <span className="list__name truncate">{task.threadName || task.threadId}</span>
        <span className="list__meta truncate">
          {task.guildName} · {task.channelName}
        </span>
        <span className="spacer" />
        <span className={status.badge}>{status.label}</span>
        <TaskAction task={task} />
      </div>

      {enCurso && (
        <div className="progress">
          <div
            className={`progress__fill${fetching ? ' progress__fill--indeterminate' : ''}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {enCurso && (
        <div className="listmeta">
          {fetching ? (
            <span className="dim">Obteniendo mensajes del hilo…</span>
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

  useEffect(() => {
    let active = true
    setLoading(true)
    void fetchHistory(PAGE_SIZE, page * PAGE_SIZE).then((data) => {
      if (!active) return
      setRows(data)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [fetchHistory, page])

  const haySiguiente = rows.length >= PAGE_SIZE

  if (!loading && rows.length === 0) {
    return (
      <div className="empty">
        <div className="empty__icon">
          <Inbox size={18} strokeWidth={1.8} />
        </div>
        <div className="empty__title">Sin historial</div>
        <div className="empty__text">
          Aquí aparecerán los archivos ya exportados, con su tamaño, fecha y ubicación.
        </div>
      </div>
    )
  }

  return (
    <div className="col">
      <div className="listmeta">
        <span>Página {page + 1}</span>
        <span className="dim">·</span>
        <span>{rows.length} registros</span>
        <span className="spacer" />
        <button
          className="btn btn--ghost btn--sm btn--icon"
          title="Página anterior"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft size={14} strokeWidth={1.8} />
        </button>
        <button
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
          {rows.map((row) => {
            const estado = (row.status as DownloadStatus) || 'done'
            const meta = STATUS[estado] ?? STATUS.done
            return (
              <tr key={row.id}>
                <td className="truncate">{row.thread_name || row.thread_id}</td>
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
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      title="Abrir carpeta"
                      onClick={() => {
                        void window.api.settings.openFolder(row.download_path as string)
                      }}
                    >
                      <FolderOpen size={14} strokeWidth={1.8} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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
  const openOutputFolder = useDownloadStore((s) => s.openOutputFolder)

  const [vista, setVista] = useState<'cola' | 'historial'>('cola')

  const stats = useMemo(() => {
    let activas = 0
    let enMarcha = 0
    let pausadas = 0
    let completadas = 0
    let terminadas = 0

    for (const task of queue) {
      if (task.status === 'downloading' || task.status === 'queued') {
        enMarcha += 1
        activas += 1
      } else if (task.status === 'paused') {
        pausadas += 1
        activas += 1
      } else {
        terminadas += 1
        if (task.status === 'done') completadas += 1
      }
    }

    return { activas, enMarcha, pausadas, completadas, terminadas }
  }, [queue])

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

            {vista === 'cola' ? (
              queue.length === 0 ? (
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
              ) : (
                <div className="list">
                  {queue.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </div>
              )
            ) : (
              <HistoryTable />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
