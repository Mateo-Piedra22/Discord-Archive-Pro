import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Compass,
  Cpu,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  TriangleAlert
} from 'lucide-react'
import type { ArchiveStats, ProcessPerfStats } from '../../shared/api'
import { useDownloadStore } from '../stores/downloadStore'
import { useUiStore } from '../stores/uiStore'
import { showToast } from './Toast'

/** Estados de la cola que cuentan como trabajo pendiente. */
const EN_COLA = new Set(['downloading', 'queued', 'paused'])

/** Tonos posibles de un badge de estado. */
type Tono = 'badge--ok' | 'badge--err' | 'badge--warn' | null

type FiltroActividad = 'all' | 'completed' | 'error'

const ESTADOS_COMPLETADOS = new Set(['done', 'completed', 'ok'])
const ESTADOS_ERROR = new Set(['error', 'failed'])

const ESTADOS: Record<string, { etiqueta: string; tono: Tono }> = {
  done: { etiqueta: 'Completado', tono: 'badge--ok' },
  completed: { etiqueta: 'Completado', tono: 'badge--ok' },
  ok: { etiqueta: 'Completado', tono: 'badge--ok' },
  error: { etiqueta: 'Error', tono: 'badge--err' },
  failed: { etiqueta: 'Error', tono: 'badge--err' },
  cancelled: { etiqueta: 'Cancelado', tono: 'badge--warn' },
  paused: { etiqueta: 'Pausado', tono: 'badge--warn' },
  queued: { etiqueta: 'En cola', tono: null },
  downloading: { etiqueta: 'En curso', tono: null }
}

const numero = new Intl.NumberFormat('es-AR')

/** Miles con separador local. */
function formatearNumero(valor: number): string {
  if (!Number.isFinite(valor)) return '0'
  return numero.format(valor)
}

/** Bytes legibles con unidad binaria y decimales solo cuando aportan. */
function formatearBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  const base = 1024
  const indice = Math.min(unidades.length - 1, Math.floor(Math.log(bytes) / Math.log(base)))
  const valor = bytes / Math.pow(base, indice)
  const decimales = indice === 0 ? 0 : valor >= 100 ? 0 : 1
  const texto = valor.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  })
  return `${texto} ${unidades[indice]}`
}

/** Fecha relativa en español, con fecha corta para lo antiguo. */
function formatearFecha(valor: string | null): string {
  if (!valor) return '—'
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return '—'

  const minutos = Math.floor((Date.now() - fecha.getTime()) / 60000)
  if (minutos < 1) return 'ahora'
  if (minutos < 60) return `hace ${minutos} min`

  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`

  const dias = Math.floor(horas / 24)
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`

  return fecha.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Traduce el estado guardado en la base a etiqueta y tono. */
function describirEstado(status: string): { etiqueta: string; tono: Tono } {
  const clave = (status || '').toLowerCase()
  return ESTADOS[clave] ?? { etiqueta: status || 'Sin estado', tono: null }
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export default function DashboardView() {
  const outputDir = useDownloadStore((s) => s.outputDir)
  const openOutputFolder = useDownloadStore((s) => s.openOutputFolder)
  const queue = useDownloadStore((s) => s.queue)
  const setVista = useUiStore((s) => s.setVista)
  const setBusqueda = useUiStore((s) => s.setBusqueda)

  const [stats, setStats] = useState<ArchiveStats | null>(null)
  const [perfStats, setPerfStats] = useState<ProcessPerfStats | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [optimizando, setOptimizando] = useState(false)
  const [filtroActividad, setFiltroActividad] = useState<FiltroActividad>('all')
  const [busquedaActividad, setBusquedaActividad] = useState('')

  // Descarta respuestas viejas si se piden métricas varias veces seguidas.
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    const id = ++peticion.current
    setCargando(true)
    try {
      const [datos, perf] = await Promise.all([
        window.api.app.getStats(),
        window.api.app.getPerfStats().catch(() => null)
      ])
      if (peticion.current !== id) return
      setStats(datos)
      if (perf) setPerfStats(perf)
      setError(false)
    } catch (err) {
      if (peticion.current !== id) return
      console.error('No se pudieron cargar las métricas del archivo:', err)
      setError(true)
    } finally {
      if (peticion.current === id) setCargando(false)
    }
  }, [])

  const optimizarRam = useCallback(async () => {
    if (optimizando) return
    setOptimizando(true)
    try {
      const res = await window.api.app.optimizeMemory()
      const ahorroHeap = Math.max(0, res.heapBeforeBytes - res.heapAfterBytes)
      const ahorroWal = Math.max(0, res.walBeforeBytes - res.walAfterBytes)
      const partes = [`${res.cachesCleared} entradas liberadas`]
      if (ahorroHeap > 0) partes.push(`Heap −${formatearBytes(ahorroHeap)}`)
      if (ahorroWal > 0) partes.push(`WAL −${formatearBytes(ahorroWal)}`)
      showToast(`RAM optimizada: ${partes.join(' · ')}`, 'success')
      await cargar()
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'No se pudo optimizar la memoria',
        'error'
      )
    } finally {
      setOptimizando(false)
    }
  }, [cargar, optimizando])

  useEffect(() => {
    void cargar()
  }, [cargar, outputDir])

  const enCola = useMemo(() => queue.filter((t) => EN_COLA.has(t.status)).length, [queue])

  const servidores = useMemo(() => {
    if (!stats) return []
    return [...stats.servers].sort((a, b) => b.bytes - a.bytes).slice(0, 8)
  }, [stats])

  const resumenActividad = useMemo(() => {
    const lista = stats?.recent ?? []
    let completados = 0
    let errores = 0
    for (const fila of lista) {
      const clave = (fila.status || '').toLowerCase()
      if (ESTADOS_COMPLETADOS.has(clave)) completados++
      else if (ESTADOS_ERROR.has(clave)) errores++
    }
    return { total: lista.length, completados, errores }
  }, [stats])

  const actividadFiltrada = useMemo(() => {
    const lista = stats?.recent ?? []
    const consulta = normalizar(busquedaActividad.trim())
    return lista.filter((fila) => {
      if (filtroActividad !== 'all') {
        const objetivo = filtroActividad === 'completed' ? ESTADOS_COMPLETADOS : ESTADOS_ERROR
        if (!objetivo.has((fila.status || '').toLowerCase())) return false
      }
      if (consulta) {
        const nombre = normalizar(fila.threadName || '')
        if (!nombre.includes(consulta)) return false
      }
      return true
    })
  }, [stats, filtroActividad, busquedaActividad])

  const maximo = servidores.reduce((tope, servidor) => Math.max(tope, servidor.bytes), 0)
  const cargandoInicial = cargando && !stats

  return (
    <>
      <header className="workspace__header">
        <div className="workspace__titles">
          <div className="workspace__title">Panel</div>
          <div className="workspace__subtitle" title={outputDir || undefined}>
            {outputDir || 'Sin carpeta configurada'}
          </div>
        </div>

        <div className="workspace__actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setBusqueda(true)}
            disabled={!outputDir}
            title="Buscar en el archivo local (Ctrl+F)"
          >
            <Search size={14} strokeWidth={1.8} />
            Buscar
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void cargar()}
            disabled={cargando}
          >
            <RefreshCw size={14} strokeWidth={1.8} />
            Actualizar
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={openOutputFolder}
            disabled={!outputDir}
          >
            <FolderOpen size={14} strokeWidth={1.8} />
            Abrir carpeta
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setVista('explorar')}>
            <Compass size={14} strokeWidth={1.8} />
            Explorar
          </button>
        </div>
      </header>

      <div className="workspace__body">
        <div className="view-pad">
          <div className="grid">
            {perfStats && (
              <div className="card">
                <div className="card__body row" style={{ flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                  <span className="row dim" style={{ gap: 6, fontSize: 'var(--text-xs)' }}>
                    <Cpu size={14} strokeWidth={1.8} />
                    Estado del motor
                  </span>
                  <span className="badge mono">RAM {formatearBytes(perfStats.rssBytes)}</span>
                  <span className="badge mono">Heap {formatearBytes(perfStats.heapUsedBytes)}</span>
                  <span className="badge mono">CPU {perfStats.cpuPercent.toFixed(1)} %</span>
                  <span className="badge mono">
                    LRU {formatearNumero(perfStats.caches.usersSize + perfStats.caches.channelsSize)}
                  </span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void optimizarRam()}
                    disabled={optimizando}
                  >
                    <Sparkles size={14} strokeWidth={1.8} />
                    {optimizando ? 'Optimizando…' : 'Optimizar RAM'}
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setVista('ajustes')}>
                    Sistema
                    <ArrowRight size={14} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            )}

            {enCola > 0 && (
              <div className="card">
                <div className="card__body row">
                  <span className="badge badge--accent">{enCola} en cola</span>
                  <span className="muted">Las descargas siguen en segundo plano.</span>
                  <span className="spacer" />
                  <button className="btn btn--ghost btn--sm" onClick={() => setVista('cola')}>
                    Ver cola
                    <ArrowRight size={14} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            )}

            {!outputDir ? (
              <div className="empty">
                <div className="empty__icon">
                  <FolderPlus size={18} strokeWidth={1.8} />
                </div>
                <div className="empty__title">Aún no hay archivo</div>
                <div className="empty__text">
                  Elige una carpeta de destino en Ajustes para empezar a guardar publicaciones,
                  mensajes y archivos en local.
                </div>
                <button className="btn btn--primary btn--sm" onClick={() => setVista('ajustes')}>
                  Ir a Ajustes
                </button>
              </div>
            ) : error && !stats ? (
              <div className="empty">
                <div className="empty__icon">
                  <TriangleAlert size={18} strokeWidth={1.8} />
                </div>
                <div className="empty__title">No se pudieron leer las métricas</div>
                <div className="empty__text">
                  Revisa que la carpeta siga accesible y vuelve a intentarlo.
                </div>
                <button className="btn btn--ghost btn--sm" onClick={() => void cargar()}>
                  <RefreshCw size={14} strokeWidth={1.8} />
                  Reintentar
                </button>
              </div>
            ) : (
              <>
                {cargandoInicial ? (
                  <div className="grid grid--metricas">
                    <div className="skeleton skeleton--card" />
                    <div className="skeleton skeleton--card" />
                    <div className="skeleton skeleton--card" />
                    <div className="skeleton skeleton--card" />
                  </div>
                ) : (
                  <div className="grid grid--metricas">
                    <div className="metrica">
                      <div className="metrica__valor">{formatearNumero(stats?.posts ?? 0)}</div>
                      <div className="metrica__etiqueta">Publicaciones</div>
                    </div>
                    <div className="metrica">
                      <div className="metrica__valor">{formatearNumero(stats?.messages ?? 0)}</div>
                      <div className="metrica__etiqueta">Mensajes</div>
                    </div>
                    <div className="metrica">
                      <div className="metrica__valor">{formatearNumero(stats?.files ?? 0)}</div>
                      <div className="metrica__etiqueta">Archivos</div>
                    </div>
                    <div className="metrica">
                      <div className="metrica__valor">{formatearBytes(stats?.bytes ?? 0)}</div>
                      <div className="metrica__etiqueta">Tamaño total</div>
                    </div>
                  </div>
                )}

                <div className="section">
                  <div className="section__title">Servidores con más peso</div>

                  {cargandoInicial ? (
                    <div className="grid">
                      <div className="skeleton skeleton--row" />
                      <div className="skeleton skeleton--row" />
                      <div className="skeleton skeleton--row" />
                    </div>
                  ) : servidores.length === 0 ? (
                    <div className="empty">
                      <div className="empty__icon">
                        <Server size={18} strokeWidth={1.8} />
                      </div>
                      <div className="empty__title">Sin servidores todavía</div>
                      <div className="empty__text">
                        Cuando archives un canal, aquí verás qué servidores ocupan más espacio.
                      </div>
                    </div>
                  ) : (
                    <div className="list">
                      {servidores.map((servidor) => {
                        // Sin datos no se dibuja barra; con datos, mínimo 2 % para
                        // que un servidor pequeño siga siendo visible.
                        const ancho =
                          servidor.bytes <= 0
                            ? 0
                            : maximo > 0
                              ? Math.max(
                                  2,
                                  Math.min(100, Math.round((servidor.bytes / maximo) * 100))
                                )
                              : 2
                        return (
                          <button
                            key={servidor.name}
                            type="button"
                            className="list__row"
                            style={{
                              width: '100%',
                              flexDirection: 'column',
                              alignItems: 'stretch',
                              gap: 'var(--sp-2)',
                              textAlign: 'left'
                            }}
                            onClick={() => useUiStore.getState().abrirArchivoServidor(servidor.name)}
                            title={`Ver ${servidor.name} en Archivo`}
                          >
                            <div className="row">
                              <span className="truncate">{servidor.name}</span>
                              <span className="spacer" />
                              <span className="mono dim">
                                {formatearNumero(servidor.posts)} pub.
                              </span>
                              <span className="mono">{formatearBytes(servidor.bytes)}</span>
                            </div>
                            <div className="barra-horizontal">
                              <div
                                className="barra-horizontal__parte"
                                style={{ width: `${ancho}%`, background: 'var(--accent)' }}
                              />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="section">
                  <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                    <div className="section__title">Actividad reciente</div>
                    <div className="spacer" />
                    {(stats?.recent.length ?? 0) > 0 && (
                      <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                        <div className="search" style={{ minWidth: 180 }}>
                          <Search size={13} strokeWidth={1.8} className="search__icon" />
                          <input
                            className="input input--search"
                            type="search"
                            placeholder="Filtrar actividad…"
                            aria-label="Filtrar actividad reciente"
                            value={busquedaActividad}
                            onChange={(e) => setBusquedaActividad(e.target.value)}
                            style={{ height: 28, fontSize: 'var(--text-xs)' }}
                          />
                        </div>
                        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                          {(
                            [
                              { id: 'all', label: 'Todos', count: resumenActividad.total },
                              { id: 'completed', label: 'Completados', count: resumenActividad.completados },
                              { id: 'error', label: 'Errores', count: resumenActividad.errores }
                            ] as const
                          ).map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`chip${filtroActividad === item.id ? ' chip--active' : ''}`}
                              onClick={() => setFiltroActividad(item.id)}
                              aria-pressed={filtroActividad === item.id}
                            >
                              {item.label} <span className="mono">{item.count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {cargandoInicial ? (
                    <div className="grid">
                      <div className="skeleton skeleton--row" />
                      <div className="skeleton skeleton--row" />
                      <div className="skeleton skeleton--row" />
                    </div>
                  ) : (stats?.recent.length ?? 0) === 0 ? (
                    <div className="empty">
                      <div className="empty__icon">
                        <FolderOpen size={18} strokeWidth={1.8} />
                      </div>
                      <div className="empty__title">Sin actividad reciente</div>
                      <div className="empty__text">
                        Las últimas exportaciones aparecerán aquí con su estado y tamaño.
                      </div>
                    </div>
                  ) : actividadFiltrada.length === 0 ? (
                    <div className="empty">
                      <div className="empty__icon">
                        <FolderOpen size={18} strokeWidth={1.8} />
                      </div>
                      <div className="empty__title">Sin resultados para este filtro</div>
                      <div className="empty__text">
                        No hay exportaciones recientes en este estado.
                      </div>
                    </div>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Hilo</th>
                          <th>Estado</th>
                          <th>Tamaño</th>
                          <th>Fecha</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {actividadFiltrada.map((fila, indice) => {
                          const estado = describirEstado(fila.status)
                          return (
                            <tr key={`${fila.threadName}-${indice}`}>
                              <td className="truncate">
                                {fila.downloadPath ? (
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm truncate"
                                    style={{ maxWidth: '100%', padding: '2px 6px', justifyContent: 'flex-start' }}
                                    onClick={() => useUiStore.getState().abrirArchivo(fila.downloadPath!)}
                                    title="Abrir en el visor integrado"
                                  >
                                    <span className="truncate">{fila.threadName || 'Sin título'}</span>
                                  </button>
                                ) : (
                                  fila.threadName || 'Sin título'
                                )}
                              </td>
                              <td>
                                <span className={estado.tono ? `badge ${estado.tono}` : 'badge'}>
                                  {estado.etiqueta}
                                </span>
                              </td>
                              <td className="mono">{formatearBytes(fila.bytes)}</td>
                              <td className="mono dim">{formatearFecha(fila.completedAt)}</td>
                              <td>
                                {fila.downloadPath && (
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm btn--icon"
                                    title="Abrir en el visor integrado"
                                    aria-label="Abrir en el visor integrado"
                                    onClick={() => useUiStore.getState().abrirArchivo(fila.downloadPath!)}
                                  >
                                    <BookOpen size={14} strokeWidth={1.8} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
