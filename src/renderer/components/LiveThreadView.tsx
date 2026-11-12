// Visor de hilo en vivo: lee una publicación sin descargarla.
// El renderizado de mensajes vive en `message/MessageStream`, compartido con
// el chat de canal, para que GIF, vídeo, embeds y reacciones se comporten
// igual en toda la app.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronUp, Download, ExternalLink, MessageSquare, X } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import { useDownloadStore } from '../stores/downloadStore'
import { showToast } from './Toast'
import MessageStream from './message/MessageStream'
import type { DiscordMessage } from '../../core/discord/types'

const TAMANO_PAGINA = 50

/**
 * Traduce el error del IPC a algo que el usuario pueda accionar. El main
 * envuelve el `DiscordApiError` en el mensaje del IPC, así que buscamos el
 * código o la frase en el texto.
 */
function mensajeDeError(err: unknown): string {
  const texto = err instanceof Error ? err.message : String(err)
  if (/rate limited|429/i.test(texto)) {
    return 'Discord limitó las peticiones. Espera unos segundos y reinténtalo.'
  }
  if (/403|access denied/i.test(texto)) {
    return 'Esta cuenta no tiene permiso para leer este hilo.'
  }
  if (/401|unauthorized/i.test(texto)) {
    return 'La sesión ya no es válida. Vuelve a conectar tu cuenta en Ajustes.'
  }
  if (/404|unknown (channel|message)/i.test(texto)) {
    return 'Este hilo ya no existe o fue borrado.'
  }
  return 'No se pudo cargar el hilo. Revisa la conexión e inténtalo de nuevo.'
}

/** true si el error es un límite de peticiones (merece un reintento). */
function esLimite(err: unknown): boolean {
  const texto = err instanceof Error ? err.message : String(err)
  return /rate limited|429/i.test(texto)
}

export default function LiveThreadView() {
  const hilo = useUiStore((s) => s.hilo)
  const cerrarHilo = useUiStore((s) => s.cerrarHilo)
  const startDownload = useDownloadStore((s) => s.startDownload)

  const [mensajes, setMensajes] = useState<DiscordMessage[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [descargando, setDescargando] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** Posición previa al prepend, para no saltar de sitio. */
  const prependRef = useRef<{ alto: number; arriba: number } | null>(null)
  /** Tras la primera carga, bajamos al mensaje más reciente. */
  const irAlFondoRef = useRef(false)

  const threadId = hilo?.threadId ?? null

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
        if (esLimite(err) && intento === 0) {
          setError('Discord limitó las peticiones. Reintentando…')
          await new Promise((r) => setTimeout(r, 2500))
          setError(null)
          continue
        }
        setMensajes([])
        setHayMas(false)
        setError(mensajeDeError(err))
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
    prependRef.current = null
    void cargarInicial(threadId)
  }, [threadId, cargarInicial])

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
      showToast(mensajeDeError(err), 'error')
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

      <div className="chat__scroll" ref={scrollRef}>
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
              mensajes={mensajes}
              onAbrirEnDiscord={(mensaje) =>
                void window.api.app.openExternal(
                  `https://discord.com/channels/@me/${hilo.threadId}/${mensaje.id}`
                )
              }
            />
          </>
        )}
      </div>
    </aside>
  )
}
