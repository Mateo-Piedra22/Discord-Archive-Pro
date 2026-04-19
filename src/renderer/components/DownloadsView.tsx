import React, { useMemo, useState, useEffect } from 'react'
import {
  DownloadCloud,
  ExternalLink,
  Pause,
  Play,
  Trash2,
  RefreshCw,
  XOctagon,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight
} from 'lucide-react'
import { useDownloadStore } from '../stores/downloadStore'

/**
 * Encapsula la lógica de formateo de bytes de forma centralizada.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`
}

/**
 * DownloadsView - Rediseño Premium 2026
 * Implementa una interfaz con glassmorphism, micro-animaciones y gestión avanzada.
 */
export default function DownloadsView() {
  // Local UI state: allow switching between the live queue and the persisted history.
  // We intentionally default to the live queue to avoid changing UX for existing users.
  const [showHistory, setShowHistory] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyRows, setHistoryRows] = useState<any[]>([])
  const pageSize = 25
  const {
    queue, pauseAll, resumeAll, cancelTask, cancelAll, retryTask,
    clearCompleted, isDownloading, openOutputFolder, outputDir
  } = useDownloadStore()

  // Estadísticas memorizadas para evitar re-calculos innecesarios
  const stats = useMemo(() => {
    const total = queue.length
    if (total === 0) return null

    return {
      done: queue.filter(t => t.status === 'done').length,
      errors: queue.filter(t => t.status === 'error').length,
      active: queue.filter(t => t.status === 'downloading' || t.status === 'queued').length,
      totalBytes: queue.reduce((s, t) => s + (t.progress?.bytesDownloaded || 0), 0),
      progressPercent: total > 0 ? (queue.filter(t => t.status === 'done').length / total) * 100 : 0
    }
  }, [queue])

  // Effect: load history only when user opens the History view. This keeps
  // the default behavior identical and avoids extra IPC calls.
  useEffect(() => {
    let mounted = true
    async function load() {
      if (!showHistory) return
      try {
        // use the store helper which calls the preload IPC
        const rows = await (useDownloadStore.getState() as any).fetchHistory(pageSize, historyPage * pageSize)
        if (mounted) setHistoryRows(rows || [])
      } catch (e) {
        console.error('Failed to load download history:', e)
        if (mounted) setHistoryRows([])
      }
    }
    load()
    return () => { mounted = false }
  }, [showHistory, historyPage])

  if (queue.length === 0) {
    return (
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', background: 'radial-gradient(circle at center, rgba(110, 142, 251, 0.05) 0%, transparent 70%)' }}>
        <div className="empty" style={{ textAlign: 'center' }}>
          <div style={{ position: 'relative', width: 220, height: 220, marginBottom: 20 }}>
             <DownloadAnimation />
          </div>
          <h3 style={{ color: 'var(--text-0)', marginBottom: 8, fontSize: '1.4rem', fontWeight: 800 }}>Cola de descargas vacía</h3>
          <div className="empty__text" style={{ fontSize: 'var(--font-sm)', color: 'var(--text-3)', maxWidth: 300, lineHeight: 1.6 }}>
            Explora canales y selecciona mensajes para archivarlos en tu biblioteca local.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="downloads-view" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Header Toolbar con Efecto Blur Premium */}
      <div className="toolbar" style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(10, 10, 26, 0.4)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        padding: '12px 16px',
        marginBottom: 10
      }}>
        <div className="toolbar__status">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={`status-dot ${isDownloading ? 'status-dot--pulse' : ''}`} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isDownloading ? 'var(--green)' : 'var(--text-3)'
            }} />
            <span style={{ fontSize: 'var(--font-sm)', fontWeight: 700, color: 'var(--text-1)' }}>
              {stats?.done}/{queue.length} <span style={{ opacity: 0.5, fontWeight: 400 }}>Archivados</span>
            </span>
            {/*
              Nota: Evitamos usar la aserción non-null (`!`) **después** de optional chaining
              (por ejemplo `stats?.errors!`) porque algunos parsers/babel-configs usados por Vite
              fallan al parsear `?.` seguido de `!` en archivos TSX. En lugar de eso usamos
              nullish coalescing para proporcionar valores por defecto seguros. Esto mantiene
              compatibilidad hacia atrás y evita reescrituras invasivas.
            */}
            {(stats?.errors ?? 0) > 0 && (
              <span className="pill pill--error" style={{ fontSize: 10, padding: '2px 8px' }}>
                {stats?.errors} Fallos
              </span>
            )}
            {(stats?.totalBytes ?? 0) > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                [{formatBytes(stats?.totalBytes ?? 0)}]
              </span>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* New: history toggle — non-destructive, defaults to queue view */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
          <button
            className={`btn btn--ghost btn--xs ${showHistory ? 'is-active' : ''}`}
            onClick={() => { setShowHistory(s => !s); setHistoryPage(0) }}
            title="Mostrar Historial de Descargas"
            style={{ borderRadius: 8, background: showHistory ? 'rgba(255,255,255,0.05)' : 'transparent' }}
          >
            Historial
          </button>
        </div>

        <div className="toolbar__actions" style={{ display: 'flex', gap: 6 }}>
          {isDownloading ? (
            <button className="btn btn--ghost btn--xs" onClick={pauseAll} title="Pausar todas">
              <Pause size={14} /> Pausar
            </button>
          ) : (
            (stats?.active ?? 0) > 0 && (
              <button className="btn btn--accent btn--xs" onClick={resumeAll} title="Reanudar todas">
                <Play size={14} /> Reanudar
              </button>
            )
          )}
          <button className="btn btn--ghost btn--xs" onClick={cancelAll} title="Cancelar pendientes">
            <XOctagon size={14} /> Detener
          </button>
          <button className="btn btn--ghost btn--xs" onClick={clearCompleted} title="Limpiar lista">
            <Trash2 size={14} /> Limpiar
          </button>
          {outputDir && (
            <button className="btn btn--ghost btn--xs" onClick={openOutputFolder} title="Abrir carpeta">
              <ExternalLink size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Global Progress Line (Top Bar) */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 3,
        background: 'rgba(255,255,255,0.05)', zIndex: 100
      }}>
        <div style={{
          height: '100%',
          width: `${stats?.progressPercent}%`,
          background: 'var(--accent)',
          boxShadow: '0 0 10px var(--accent)',
          transition: 'width 0.5s cubic-bezier(0.1, 0.7, 0.1, 1)'
        }} />
      </div>

      {/* Lista de Tareas con Scroll Optimizado */}
      <div className="dl-container" style={{ padding: '0 12px 20px' }}>
        {showHistory ? (
          // History view: paginated, simple and read-only. Does not change
          // existing queue objects; purely a renderer of audit rows.
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                Mostrando historial — página {historyPage + 1}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn--ghost btn--xs" onClick={() => setHistoryPage(p => Math.max(0, p - 1))}>
                  Anterior
                </button>
                <button className="btn btn--ghost btn--xs" onClick={() => setHistoryPage(p => p + 1)}>
                  Siguiente
                </button>
              </div>
            </div>
            {historyRows.length === 0 ? (
              <div style={{ color: 'var(--text-3)', padding: 12 }}>No hay registros en esta página.</div>
            ) : (
              historyRows.map((r: any) => (
                <div key={r.id} style={{ padding: 10, marginBottom: 8, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700 }}>{r.thread_name || r.thread_id}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{r.status}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>{r.guild_name} › {r.channel_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>Archivos: {r.files_count} — Tamaño: {r.total_bytes} bytes</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>Completado: {r.completed_at}</div>
                  {r.download_path && (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn btn--ghost btn--xs" onClick={() => window.api.settings.openFolder(r.download_path)}>
                        Abrir carpeta
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          queue.map((task) => (
            <div
              key={task.id}
              className={`dl-card dl-card--${task.status}`}
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: `1px solid ${task.status === 'downloading' ? 'var(--accent-dim)' : 'rgba(255, 255, 255, 0.05)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '12px',
                marginBottom: 10,
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Indicador de estado visual sutil */}
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                background: task.status === 'done' ? 'var(--green)' :
                  task.status === 'error' ? 'var(--red)' :
                    task.status === 'downloading' ? 'var(--accent)' : 'transparent'
              }} />

              <div className="dl-card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="dl-card__title" style={{
                    fontWeight: 600, fontSize: 'var(--font-sm)',
                    color: 'var(--text-0)', marginBottom: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {task.threadName}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{task.guildName}</span>
                    <ArrowRight size={8} />
                    <span>{task.channelName}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {task.status === 'done' && <CheckCircle2 size={14} color="var(--green)" />}
                  {task.status === 'error' && <AlertCircle size={14} color="var(--red)" />}
                  {task.status === 'queued' && <Clock size={14} color="var(--text-3)" />}

                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.05em', color: `var(--status-${task.status})`
                  }}>
                    {task.status}
                  </span>

                  {/* Individual Action */}
                  <button
                    className="btn btn--ghost btn--icon btn--xs"
                    onClick={() => cancelTask(task.id)}
                    style={{ opacity: 0.4 }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Area de Progreso y Logs para descargando */}
              {task.status === 'downloading' && task.progress && (
                <div className="dl-card__body" style={{ animation: 'slideDown 0.2s ease-out' }}>
                  <div className="dl-card__log" style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--text-2)',
                    marginBottom: 8,
                    border: '1px solid rgba(255,255,255,0.03)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: 'var(--accent)' }}>[{task.progress.phase}]</span>
                      <span style={{ color: 'var(--green)' }}>{formatBytes(task.progress.speed)}/s</span>
                    </div>
                    <div style={{ color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      &gt; {task.progress.currentFile || 'Cargando...'}
                    </div>
                  </div>

                  <div className="progress-group">
                    <div className="progress-info" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 4, color: 'var(--text-3)' }}>
                      <span>Archivos: {task.progress.assetsDownloaded}/{task.progress.assetsTotal}</span>
                      <span>ETA: {task.progress.eta > 0 ? `${task.progress.eta}s` : '--'}</span>
                    </div>
                    <div className="progress-bar" style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
                      <div className="progress-bar__fill" style={{
                        width: task.progress.assetsTotal > 0 ? `${(task.progress.assetsDownloaded / task.progress.assetsTotal) * 100}%` : '5%',
                        height: '100%',
                        background: 'linear-gradient(90deg, var(--accent), var(--accent-text))',
                        borderRadius: 3,
                        boxShadow: '0 0 8px var(--accent-dim)',
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Area de Error */}
              {task.status === 'error' && (
                <div className="dl-card__error" style={{
                  marginTop: 8, padding: '8px', background: 'rgba(212, 87, 87, 0.1)',
                  border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10
                }}>
                  <span style={{ fontSize: 10, color: 'var(--text-1)', flex: 1 }}>{task.errorMessage}</span>
                  <button className="btn btn--ghost btn--xs" onClick={() => retryTask(task.id)}>
                    <RefreshCw size={12} /> Reintentar
                  </button>
                </div>
              )}
            </div>
            /*
              Jerarquía de Cierres:
              1. ) -> Cierra el retorno implícito de la función flecha del .map()
              2. ) -> Cierra el paréntesis de ejecución del método .map()
              3. ) -> Cierra el bloque de la rama 'else' del operador ternario principal
              4. } -> Cierra la expresión embebida de JSX {showHistory ? ... : ...}
            */
          )))}
      </div>
    </div>
  )
}

function DownloadAnimation() {
  return (
    <div className="dl-anim" style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        position: 'absolute', width: '120%', height: '120%',
        background: 'radial-gradient(circle, var(--accent) 0%, transparent 60%)',
        opacity: 0.1, filter: 'blur(30px)', animation: 'dlGlow 4s infinite alternate ease-in-out'
      }} />
      <svg width="120" height="120" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path className="dl-arrow" d="M12 3V16M12 16L7 11M12 16L17 11" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path className="dl-base" d="M20 21H4" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
        <circle cx="12" cy="12" r="9" stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 4" opacity="0.2" />
      </svg>
      <style>{`
        @keyframes dlGlow { 0% { opacity: 0.1; transform: scale(0.9); } 100% { opacity: 0.2; transform: scale(1.1); } }
        .dl-arrow { animation: dlArrow 2s infinite ease-in-out; }
        @keyframes dlArrow { 
          0%, 100% { transform: translateY(-3px); opacity: 0.4; } 
          50% { transform: translateY(3px); opacity: 1; } 
        }
        .dl-base { animation: dlBase 2s infinite ease-in-out; }
        @keyframes dlBase { 0%, 100% { transform: scaleX(0.8); } 50% { transform: scaleX(1.1); } }
      `}</style>
    </div>
  )
}
