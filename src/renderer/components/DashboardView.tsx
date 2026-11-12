import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Compass,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Server,
  TriangleAlert
} from 'lucide-react'
import type { ArchiveStats } from '../../shared/api'
import { useDownloadStore } from '../stores/downloadStore'
import { useUiStore } from '../stores/uiStore'

/** Estados de la cola que cuentan como trabajo pendiente. */
const EN_COLA = new Set(['downloading', 'queued', 'paused'])

/** Tonos posibles de un badge de estado. */
type Tono = 'badge--ok' | 'badge--err' | 'badge--warn' | null

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

export default function DashboardView() {
  const outputDir = useDownloadStore((s) => s.outputDir)
  const openOutputFolder = useDownloadStore((s) => s.openOutputFolder)
  const queue = useDownloadStore((s) => s.queue)
  const setVista = useUiStore((s) => s.setVista)

  const [stats, setStats] = useState<ArchiveStats | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)

  // Descarta respuestas viejas si se piden métricas varias veces seguidas.
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    const id = ++peticion.current
    setCargando(true)
    try {
      const datos = await window.api.app.getStats()
      if (peticion.current !== id) return
      setStats(datos)
      setError(false)
    } catch (err) {
      if (peticion.current !== id) return
      console.error('No se pudieron cargar las métricas del archivo:', err)
      setError(true)
    } finally {
      if (peticion.current === id) setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar, outputDir])

  const enCola = useMemo(() => queue.filter((t) => EN_COLA.has(t.status)).length, [queue])

  const servidores = useMemo(() => {
    if (!stats) return []
    return [...stats.servers].sort((a, b) => b.bytes - a.bytes).slice(0, 8)
  }, [stats])

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
                    <div className="grid">
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
                          <div className="grid" key={servidor.name}>
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
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="section">
                  <div className="section__title">Actividad reciente</div>

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
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Hilo</th>
                          <th>Estado</th>
                          <th>Tamaño</th>
                          <th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats?.recent ?? []).map((fila, indice) => {
                          const estado = describirEstado(fila.status)
                          return (
                            <tr key={`${fila.threadName}-${indice}`}>
                              <td className="truncate">{fila.threadName || 'Sin título'}</td>
                              <td>
                                <span className={estado.tono ? `badge ${estado.tono}` : 'badge'}>
                                  {estado.etiqueta}
                                </span>
                              </td>
                              <td className="mono">{formatearBytes(fila.bytes)}</td>
                              <td className="mono dim">{formatearFecha(fila.completedAt)}</td>
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
