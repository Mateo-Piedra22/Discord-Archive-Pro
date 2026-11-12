import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  Download,
  ExternalLink,
  FolderOpen,
  MessageSquare,
  RefreshCw
} from 'lucide-react'
import type { DiscordMessage } from '../../core/discord/types'
import { useBrowserStore } from '../stores/browserStore'
import { useDownloadStore } from '../stores/downloadStore'
import { useUiStore } from '../stores/uiStore'
import { showToast } from './Toast'
import MessageStream from './message/MessageStream'

/** Mensajes por página al leer un canal en vivo. */
const TAMANO_PAGINA = 50

/** Distancia al borde superior que dispara la carga de la página anterior. */
const UMBRAL_CARGA_PX = 120

/** Distancia al fondo a partir de la cual aparece el botón «Ir al final». */
const UMBRAL_SALTO_PX = 400

/**
 * Traduce el error del IPC a algo accionable. El main envuelve el
 * `DiscordApiError` en el mensaje, así que buscamos el código o la frase.
 */
function mensajeDeError(err: unknown): string {
  const texto = err instanceof Error ? err.message : String(err)
  if (/rate limited|429/i.test(texto)) {
    return 'Discord limitó las peticiones. Espera unos segundos y reinténtalo.'
  }
  if (/403|access denied/i.test(texto)) {
    return 'Esta cuenta no tiene permiso para leer este canal.'
  }
  if (/401|unauthorized/i.test(texto)) {
    return 'La sesión ya no es válida. Vuelve a conectar tu cuenta en Ajustes.'
  }
  if (/404|unknown (channel|message)/i.test(texto)) {
    return 'Este canal ya no existe o fue borrado.'
  }
  return 'No se pudo cargar el canal. Revisa la conexión e inténtalo de nuevo.'
}

/** true si el error es un límite de peticiones (merece un reintento). */
function esLimite(err: unknown): boolean {
  const texto = err instanceof Error ? err.message : String(err)
  return /rate limited|429/i.test(texto)
}

/**
 * Conversación de un canal de texto. Se monta con el canal ya seleccionado y
 * muestra los mensajes directamente: sin lista intermedia ni segundo clic.
 */
export default function ChannelChatView() {
  const canal = useBrowserStore((s) => s.selectedChannel)
  const servidor = useBrowserStore((s) => s.selectedGuild)
  const abrirHilo = useUiStore((s) => s.abrirHilo)
  const startDownload = useDownloadStore((s) => s.startDownload)
  const pickDirectory = useDownloadStore((s) => s.pickDirectory)
  const openOutputFolder = useDownloadStore((s) => s.openOutputFolder)
  const outputDir = useDownloadStore((s) => s.outputDir)

  const [mensajes, setMensajes] = useState<DiscordMessage[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archivando, setArchivando] = useState(false)
  const [lejosDelFondo, setLejosDelFondo] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** Altura y posición previas al prepend, para no saltar de sitio. */
  const prependRef = useRef<{ alto: number; arriba: number } | null>(null)
  /** Tras la primera carga, bajamos al mensaje más reciente. */
  const irAlFondoRef = useRef(false)

  const canalId = canal?.id ?? null

  const cargarInicial = useCallback(async (id: string) => {
    setCargando(true)
    setError(null)

    // Un límite de peticiones es transitorio: se reintenta una vez antes de
    // rendirse, avisando de lo que está pasando.
    for (let intento = 0; intento < 2; intento++) {
      try {
        const pagina = await window.api.discord.getMessagePage(id, undefined, TAMANO_PAGINA)
        setMensajes(pagina.messages)
        setHayMas(pagina.hasMore)
        irAlFondoRef.current = true
        setCargando(false)
        return
      } catch (err) {
        console.error('No se pudo cargar el canal:', err)
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

  // Al cambiar de canal se reinicia todo el estado de lectura.
  useEffect(() => {
    if (!canalId) return
    setMensajes([])
    setHayMas(false)
    setError(null)
    setLejosDelFondo(false)
    prependRef.current = null
    void cargarInicial(canalId)
  }, [canalId, cargarInicial])

  // Reposiciona el scroll tras prepend o baja al fondo en la primera carga.
  useLayoutEffect(() => {
    const contenedor = scrollRef.current
    if (!contenedor) return

    const previo = prependRef.current
    if (previo) {
      contenedor.scrollTop = previo.arriba + (contenedor.scrollHeight - previo.alto)
      prependRef.current = null
      return
    }

    if (irAlFondoRef.current) {
      contenedor.scrollTop = contenedor.scrollHeight
      irAlFondoRef.current = false
    }
  }, [mensajes])

  const cargarAnteriores = useCallback(async () => {
    if (!canalId || cargando || cargandoAnteriores || !hayMas || mensajes.length === 0) return

    const contenedor = scrollRef.current
    prependRef.current = contenedor
      ? { alto: contenedor.scrollHeight, arriba: contenedor.scrollTop }
      : null

    setCargandoAnteriores(true)
    try {
      const masAntiguo = mensajes[0].id
      const pagina = await window.api.discord.getMessagePage(canalId, masAntiguo, TAMANO_PAGINA)
      setMensajes((previos) => {
        // Sin duplicados: el mismo mensaje puede venir en dos páginas.
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
  }, [canalId, cargando, cargandoAnteriores, hayMas, mensajes])

  /** Scroll infinito hacia arriba y visibilidad del botón «Ir al final». */
  const alDesplazar = useCallback(() => {
    const contenedor = scrollRef.current
    if (!contenedor) return

    const distanciaFondo =
      contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight
    setLejosDelFondo(distanciaFondo > UMBRAL_SALTO_PX)

    if (contenedor.scrollTop < UMBRAL_CARGA_PX) void cargarAnteriores()
  }, [cargarAnteriores])

  const irAlFinal = useCallback(() => {
    const contenedor = scrollRef.current
    if (!contenedor) return
    contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: 'smooth' })
    setLejosDelFondo(false)
  }, [])

  const archivar = useCallback(async () => {
    if (!canal || archivando) return
    setArchivando(true)
    try {
      // Sin carpeta de salida no hay descarga posible: la pedimos antes.
      if (!useDownloadStore.getState().outputDir) {
        await pickDirectory()
        if (!useDownloadStore.getState().outputDir) return
      }

      const ahora = new Date().toISOString()
      const ok = await startDownload(
        [
          {
            // El gestor de descargas trabaja con «hilos»: un canal se describe
            // con la misma forma para archivar la conversación completa.
            thread: {
              id: canal.id,
              guild_id: canal.guild_id ?? servidor?.id ?? '',
              parent_id: '',
              owner_id: '',
              name: canal.name ?? 'canal',
              type: canal.type,
              last_message_id: canal.last_message_id ?? null,
              message_count: canal.message_count ?? 0,
              member_count: 0,
              total_message_sent: canal.total_message_sent ?? 0,
              applied_tags: [],
              thread_metadata: {
                archived: false,
                auto_archive_duration: 0,
                archive_timestamp: ahora,
                locked: false
              },
              created_timestamp: ahora
            },
            tags: []
          }
        ],
        servidor?.name ?? '',
        canal.name ?? ''
      )
      if (ok) showToast('Canal añadido a la cola de descarga', 'success')
    } finally {
      setArchivando(false)
    }
  }, [canal, servidor, archivando, pickDirectory, startDownload])

  const abrirEnDiscord = useCallback(() => {
    if (!canal) return
    const guildId = canal.guild_id ?? servidor?.id ?? '@me'
    void window.api.app.openExternal(
      `https://discord.com/channels/${guildId}/${canal.id}`
    )
  }, [canal, servidor])

  const abrirMensajeEnDiscord = useCallback(
    (mensaje: DiscordMessage) => {
      if (!canal) return
      const guildId = canal.guild_id ?? servidor?.id ?? '@me'
      void window.api.app.openExternal(
        `https://discord.com/channels/${guildId}/${canal.id}/${mensaje.id}`
      )
    },
    [canal, servidor]
  )

  const abrirHiloDelMensaje = useCallback(
    (threadId: string, nombre: string) => {
      if (!canal) return
      abrirHilo({
        threadId,
        nombre,
        canal: canal.name ?? 'canal',
        servidor: servidor?.name ?? ''
      })
    },
    [canal, servidor, abrirHilo]
  )

  if (!canal) return null

  const miembros = servidor?.approximate_member_count
  const subtitulo =
    canal.topic?.trim() ||
    [servidor?.name, miembros ? `${miembros.toLocaleString('es-ES')} miembros` : null]
      .filter(Boolean)
      .join(' · ')

  // El banner superior solo aparece cuando hay algo que decir.
  const textoBanner = cargandoAnteriores
    ? 'Cargando mensajes anteriores…'
    : hayMas
      ? null
      : 'No hay más mensajes'

  return (
    <>
      <header className="workspace__header">
        <div className="workspace__titles">
          <div className="workspace__title truncate">#{canal.name ?? 'canal'}</div>
          <div className="workspace__subtitle truncate">{subtitulo}</div>
        </div>

        <div className="workspace__actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void cargarInicial(canal.id)}
            disabled={cargando}
          >
            <RefreshCw size={14} strokeWidth={1.8} className={cargando ? 'girar' : undefined} />
            Actualizar
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void archivar()}
            disabled={archivando}
          >
            <Download size={14} strokeWidth={1.8} />
            {archivando ? 'Archivando…' : 'Archivar'}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={abrirEnDiscord}>
            <ExternalLink size={14} strokeWidth={1.8} />
            Abrir en Discord
          </button>
          {outputDir && (
            <button
              className="btn btn--ghost btn--icon"
              onClick={openOutputFolder}
              title="Abrir carpeta de descargas"
              aria-label="Abrir carpeta de descargas"
            >
              <FolderOpen size={16} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </header>

      <div className="workspace__body">
        <div className="chat__scroll" ref={scrollRef} onScroll={alDesplazar}>
          {cargando ? (
            <div className="col">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton skeleton--row" />
              ))}
            </div>
          ) : error ? (
            <div className="empty">
              <div className="empty__icon">
                <AlertTriangle size={18} strokeWidth={1.8} />
              </div>
              <div className="empty__title">No se pudo abrir el canal</div>
              <div className="empty__text">{error}</div>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => void cargarInicial(canal.id)}
              >
                Reintentar
              </button>
            </div>
          ) : mensajes.length === 0 ? (
            <div className="empty">
              <div className="empty__icon">
                <MessageSquare size={18} strokeWidth={1.8} />
              </div>
              <div className="empty__title">Este canal no tiene mensajes</div>
              <div className="empty__text">
                Todavía no hay nada escrito aquí, o tu cuenta no puede leer el historial.
              </div>
            </div>
          ) : (
            <>
              {textoBanner && (
                <div className="chat__banner muted">{textoBanner}</div>
              )}
              <MessageStream
                mensajes={mensajes}
                onAbrirHilo={abrirHiloDelMensaje}
                onAbrirEnDiscord={abrirMensajeEnDiscord}
              />
            </>
          )}
        </div>

        {lejosDelFondo && !cargando && !error && (
          <button className="chat__salto btn btn--sm" onClick={irAlFinal}>
            <ArrowDown size={14} strokeWidth={1.8} />
            Ir al final
          </button>
        )}
      </div>
    </>
  )
}
