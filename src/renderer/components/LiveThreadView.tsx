// Visor de hilo en vivo: lee una publicación sin descargarla.
// El renderizado de mensajes vive en `message/MessageStream`, compartido con
// el chat de canal, para que GIF, vídeo, embeds y reacciones se comporten
// igual en toda la app.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FolderCheck,
  Link2,
  MessageSquare,
  Paperclip,
  Pin,
  Search,
  X
} from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import { useDownloadStore } from '../stores/downloadStore'
import { showToast } from './Toast'
import MessageStream from './message/MessageStream'
import {
  esErrorLimiteDiscord,
  filtrarMensajesEnVivo,
  formatearTranscripcionMarkdown,
  mensajeDeErrorDiscord,
  resumirEstadisticasChat
} from './message/chatErrorUtils'
import type { DiscordMessage } from '../../core/discord/types'

const TAMANO_PAGINA = 50

/** Distancia al fondo a partir de la cual aparece el botón «Ir al final». */
const UMBRAL_SALTO_PX = 400

export default function LiveThreadView() {
  const hilo = useUiStore((s) => s.hilo)
  const cerrarHilo = useUiStore((s) => s.cerrarHilo)
  const abrirArchivo = useUiStore((s) => s.abrirArchivo)
  const startDownload = useDownloadStore((s) => s.startDownload)

  const [mensajes, setMensajes] = useState<DiscordMessage[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [descargando, setDescargando] = useState(false)
  const [lejosDelFondo, setLejosDelFondo] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [soloAdjuntos, setSoloAdjuntos] = useState(false)
  const [soloEnlaces, setSoloEnlaces] = useState(false)
  const [soloFijados, setSoloFijados] = useState(false)
  const [downloadPath, setDownloadPath] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** Posición previa al prepend, para no saltar de sitio. */
  const prependRef = useRef<{ alto: number; arriba: number } | null>(null)
  /** Tras la primera carga, bajamos al mensaje más reciente. */
  const irAlFondoRef = useRef(false)

  const threadId = hilo?.threadId ?? null

  const hayFiltroActivo =
    consulta.trim().length > 0 || soloAdjuntos || soloEnlaces || soloFijados
  const estadisticas = useMemo(() => resumirEstadisticasChat(mensajes), [mensajes])
  const mensajesFiltrados = useMemo(
    () =>
      filtrarMensajesEnVivo(mensajes, {
        consulta,
        soloAdjuntos,
        soloEnlaces,
        soloFijados
      }),
    [mensajes, consulta, soloAdjuntos, soloEnlaces, soloFijados]
  )

  const limpiarFiltros = useCallback(() => {
    setConsulta('')
    setSoloAdjuntos(false)
    setSoloEnlaces(false)
    setSoloFijados(false)
  }, [])

  const copiarTranscripcion = useCallback(async () => {
    if (!hilo || mensajesFiltrados.length === 0) return
    const markdown = formatearTranscripcionMarkdown(hilo.nombre, mensajesFiltrados)
    try {
      await navigator.clipboard.writeText(markdown)
      showToast(
        `Transcripción copiada (${mensajesFiltrados.length} ${mensajesFiltrados.length === 1 ? 'mensaje' : 'mensajes'})`,
        'success'
      )
    } catch (err) {
      console.error('No se pudo copiar la transcripción:', err)
      showToast('No se pudo copiar la transcripción al portapapeles.', 'error')
    }
  }, [hilo, mensajesFiltrados])

  const cargarInicial = useCallback(async (id: string) => {
    setCargando(true)
    setError(null)

    // Un límite de peticiones de Discord es transitorio: se reintenta una vez
    // antes de rendirse, avisando de lo que está pasando.
    for (let intento = 0; intento < 2; intento++) {
      try {
        const pagina = await window.api.discord.getMessagePage(id, undefined, TAMANO_PAGINA)
        setMensajes(pagina.messages)
        setHayMas(pagina.hasMore)
        irAlFondoRef.current = true
        setCargando(false)
        return
      } catch (err) {
        console.error('No se pudo cargar el hilo:', err)
        if (esErrorLimiteDiscord(err) && intento === 0) {
          setError('Discord limitó las peticiones. Reintentando…')
          await new Promise((r) => setTimeout(r, 2500))
          setError(null)
          continue
        }
        setMensajes([])
        setHayMas(false)
        setError(mensajeDeErrorDiscord(err, 'hilo'))
        setCargando(false)
        return
      }
    }
  }, [])

  // Carga al montar y cada vez que cambia el hilo abierto.
  useEffect(() => {
    if (!threadId) return
    setMensajes([])
    setHayMas(false)
    setError(null)
    setLejosDelFondo(false)
    setConsulta('')
    setSoloAdjuntos(false)
    setSoloEnlaces(false)
    setSoloFijados(false)
    prependRef.current = null
    void cargarInicial(threadId)
  }, [threadId, cargarInicial])

  // Consulta si el hilo ya está descargado en la caché local.
  useEffect(() => {
    if (!threadId) {
      setDownloadPath(null)
      return
    }
    let cancelado = false
    setDownloadPath(null)
    void window.api.cache
      .checkPost(threadId)
      .then((res) => {
        if (cancelado) return
        if (res && typeof res === 'object') {
          const item = res as { download_path?: unknown; downloadPath?: unknown }
          const ruta =
            typeof item.download_path === 'string' && item.download_path
              ? item.download_path
              : typeof item.downloadPath === 'string' && item.downloadPath
                ? item.downloadPath
                : null
          setDownloadPath(ruta)
        } else {
          setDownloadPath(null)
        }
      })
      .catch(() => {
        if (!cancelado) setDownloadPath(null)
      })
    return () => {
      cancelado = true
    }
  }, [threadId])

  // Cerrar con Esc (es un panel, no un modal: no cierra con clic en el fondo).
  useEffect(() => {
    if (!threadId) return
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') cerrarHilo()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [threadId, cerrarHilo])

  // Reposiciona el scroll tras prepend o baja al fondo en la primera carga.
  useLayoutEffect(() => {
    const contenedor = scrollRef.current
    if (!contenedor) return

    if (prependRef.current) {
      const { alto, arriba } = prependRef.current
      contenedor.scrollTop = contenedor.scrollHeight - alto + arriba
      prependRef.current = null
      return
    }
    if (irAlFondoRef.current) {
      contenedor.scrollTop = contenedor.scrollHeight
      irAlFondoRef.current = false
    }
  }, [mensajes])

  // Recalcula la visibilidad de «Ir al final» cuando el filtro cambia la altura del listado.
  useEffect(() => {
    const contenedor = scrollRef.current
    if (!contenedor) return
    const distanciaFondo =
      contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight
    setLejosDelFondo(distanciaFondo > UMBRAL_SALTO_PX)
  }, [mensajesFiltrados])

  const alDesplazar = useCallback(() => {
    const contenedor = scrollRef.current
    if (!contenedor) return

    const distanciaFondo =
      contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight
    setLejosDelFondo(distanciaFondo > UMBRAL_SALTO_PX)
  }, [])

  const irAlFinal = useCallback(() => {
    const contenedor = scrollRef.current
    if (!contenedor) return
    contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: 'smooth' })
    setLejosDelFondo(false)
  }, [])

  const cargarAnteriores = useCallback(async () => {
    if (!threadId || cargandoAnteriores || mensajes.length === 0) return

    const contenedor = scrollRef.current
    prependRef.current = contenedor
      ? { alto: contenedor.scrollHeight, arriba: contenedor.scrollTop }
      : null

    setCargandoAnteriores(true)
    try {
      const masAntiguo = mensajes[0].id
      const pagina = await window.api.discord.getMessagePage(threadId, masAntiguo, TAMANO_PAGINA)
      setMensajes((previos) => {
        const vistos = new Set(previos.map((m) => m.id))
        const nuevos = pagina.messages.filter((m) => !vistos.has(m.id))
        return [...nuevos, ...previos]
      })
      setHayMas(pagina.hasMore)
    } catch (err) {
      console.error('No se pudieron cargar mensajes anteriores:', err)
      prependRef.current = null
      showToast(mensajeDeErrorDiscord(err, 'hilo'), 'error')
    } finally {
      setCargandoAnteriores(false)
    }
  }, [threadId, cargandoAnteriores, mensajes])

  const descargar = useCallback(async () => {
    if (!hilo || descargando) return
    setDescargando(true)
    try {
      const ok = await startDownload(
        [
          {
            thread: {
              id: hilo.threadId,
              name: hilo.nombre,
              guild_id: '',
              parent_id: '',
              type: 15,
              last_message_id: null,
              message_count: 0,
              member_count: 0,
              total_message_sent: 0,
              applied_tags: [],
              thread_metadata: {
                archived: false,
                auto_archive_duration: 0,
                archive_timestamp: '',
                locked: false
              },
              created_timestamp: new Date().toISOString()
            },
            tags: []
          }
        ],
        hilo.servidor,
        hilo.canal
      )
      if (ok) showToast('Hilo añadido a la cola de descarga', 'success')
    } finally {
      setDescargando(false)
    }
  }, [hilo, descargando, startDownload])

  const abrirEnDiscord = useCallback(() => {
    if (!hilo) return
    void window.api.app.openExternal(`https://discord.com/channels/@me/${hilo.threadId}`)
  }, [hilo])

  if (!hilo) return null

  return (
    <aside className="cajon" aria-label={`Hilo ${hilo.nombre}`}>
      <header className="workspace__header">
        <div className="workspace__titles">
          <div className="workspace__title truncate">{hilo.nombre}</div>
          <div className="workspace__subtitle truncate">
            {hilo.servidor} · {hilo.canal}
          </div>
        </div>

        <div className="workspace__actions">
          {downloadPath && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => abrirArchivo(downloadPath)}
              title="Abrir copia local en el visor integrado"
            >
              <FolderCheck size={14} strokeWidth={1.8} />
              Abrir en visor
            </button>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void descargar()}
            disabled={descargando}
          >
            <Download size={14} strokeWidth={1.8} />
            Descargar
          </button>
          <button className="btn btn--ghost btn--sm" onClick={abrirEnDiscord}>
            <ExternalLink size={14} strokeWidth={1.8} />
            Abrir en Discord
          </button>
          <button className="btn btn--ghost btn--icon" onClick={cerrarHilo} title="Cerrar hilo">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {!cargando && !error && mensajes.length > 0 && (
        <div
          className="row"
          style={{
            flexWrap: 'wrap',
            padding: 'var(--sp-2) var(--sp-6)',
            borderBottom: '1px solid var(--line-soft)',
            background: 'var(--surface-0)',
            flexShrink: 0
          }}
        >
          <div className="search" style={{ flex: '1 1 180px', minWidth: 140 }}>
            <Search size={14} strokeWidth={1.8} className="search__icon" />
            <input
              className="input input--search"
              type="search"
              placeholder="Filtrar texto, archivo o de:usuario…"
              aria-label="Filtrar mensajes"
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && (consulta.length > 0 || hayFiltroActivo)) {
                  e.preventDefault()
                  e.stopPropagation()
                  if (consulta.length > 0) {
                    setConsulta('')
                  } else {
                    limpiarFiltros()
                  }
                }
              }}
              style={{ height: 28, fontSize: 'var(--text-sm)' }}
            />
          </div>

          <button
            type="button"
            className={`chip${soloAdjuntos ? ' chip--active' : ''}`}
            onClick={() => setSoloAdjuntos((v) => !v)}
            aria-pressed={soloAdjuntos}
          >
            <Paperclip size={12} strokeWidth={1.8} />
            Adjuntos
          </button>

          <button
            type="button"
            className={`chip${soloEnlaces ? ' chip--active' : ''}`}
            onClick={() => setSoloEnlaces((v) => !v)}
            aria-pressed={soloEnlaces}
          >
            <Link2 size={12} strokeWidth={1.8} />
            Enlaces
          </button>

          <button
            type="button"
            className={`chip${soloFijados ? ' chip--active' : ''}`}
            onClick={() => setSoloFijados((v) => !v)}
            aria-pressed={soloFijados}
          >
            <Pin size={12} strokeWidth={1.8} />
            Fijados
            {estadisticas.fijados > 0 && (
              <span className="mono">{estadisticas.fijados}</span>
            )}
          </button>

          <span
            className="muted"
            style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}
            title={`${estadisticas.total} mensajes · ${estadisticas.enlaces} con enlaces · ${estadisticas.fijados} fijados`}
          >
            {estadisticas.autores} autores · {estadisticas.adjuntos} adjuntos
          </span>

          {hayFiltroActivo && (
            <span className="muted mono" style={{ fontSize: 'var(--text-xs)' }}>
              {mensajesFiltrados.length} / {mensajes.length}
            </span>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copiarTranscripcion()}
            disabled={mensajesFiltrados.length === 0}
            title="Copiar transcripción en Markdown"
          >
            <Copy size={13} strokeWidth={1.8} />
            Copiar transcripción
          </button>
        </div>
      )}

      <div className="chat__scroll" ref={scrollRef} onScroll={alDesplazar}>
        {cargando ? (
          <div className="col">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton skeleton--row" />
            ))}
          </div>
        ) : error ? (
          <div className="empty">
            <div className="empty__icon">
              <AlertTriangle size={18} strokeWidth={1.8} />
            </div>
            <div className="empty__title">No se pudo abrir el hilo</div>
            <div className="empty__text">{error}</div>
            <button className="btn btn--primary btn--sm" onClick={() => void cargarInicial(hilo.threadId)}>
              Reintentar
            </button>
          </div>
        ) : mensajes.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">
              <MessageSquare size={18} strokeWidth={1.8} />
            </div>
            <div className="empty__title">Hilo sin mensajes</div>
            <div className="empty__text">
              Este hilo todavía no tiene mensajes o no hay permiso para leerlos.
            </div>
          </div>
        ) : mensajesFiltrados.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">
              <Search size={18} strokeWidth={1.8} />
            </div>
            <div className="empty__title">Sin coincidencias</div>
            <div className="empty__text">
              Ningún mensaje cargado coincide con los filtros activos.
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={limpiarFiltros}>
              Limpiar filtros
            </button>
          </div>
        ) : (
          <>
            {hayMas && (
              <div className="row" style={{ justifyContent: 'center', paddingBottom: 'var(--sp-3)' }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => void cargarAnteriores()}
                  disabled={cargandoAnteriores}
                >
                  <ChevronUp size={14} strokeWidth={1.8} />
                  {cargandoAnteriores ? 'Cargando…' : 'Cargar anteriores'}
                </button>
              </div>
            )}

            <MessageStream
              mensajes={mensajesFiltrados}
              onAbrirEnDiscord={(mensaje) =>
                void window.api.app.openExternal(
                  `https://discord.com/channels/@me/${hilo.threadId}/${mensaje.id}`
                )
              }
            />
          </>
        )}
      </div>

      {lejosDelFondo && !cargando && !error && mensajesFiltrados.length > 0 && (
        <button className="chat__salto btn btn--sm" onClick={irAlFinal}>
          <ArrowDown size={14} strokeWidth={1.8} />
          Ir al final
        </button>
      )}
    </aside>
  )
}
