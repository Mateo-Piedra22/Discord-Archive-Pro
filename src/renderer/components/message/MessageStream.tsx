// ============================================================
// Flujo de mensajes de un canal o hilo, con la calidad del cliente
// nativo: GIFs y vídeos en marcha, imágenes ampliables y embeds
// resueltos. No gestiona scroll: el contenedor que lo monta scrollea.
// ============================================================

import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  MessagesSquare,
  Paperclip,
  Play,
  Sparkles
} from 'lucide-react'
import { MessageType } from '../../../core/discord/types'
import type {
  DiscordAttachment,
  DiscordEmbed,
  DiscordMessage,
  DiscordReaction
} from '../../../core/discord/types'
import {
  manejarEnlaceExterno,
  renderizarMarkdown
} from './discordMarkdown'
import MediaLightbox from './MediaLightbox'
import type { ElementoLightbox } from './MediaLightbox'

export interface MessageStreamProps {
  mensajes: DiscordMessage[]
  cargando?: boolean
  onAbrirHilo?: (threadId: string, nombre: string) => void
  onAbrirEnDiscord?: (mensaje: DiscordMessage) => void
}

type TipoMedia = 'imagen' | 'video'

interface MediaAmpliado {
  url: string
  tipo: TipoMedia
  indiceInicial?: number
}

/** Ventana de agrupación de mensajes consecutivos del mismo autor. */
const VENTANA_AGRUPACION_MS = 5 * 60 * 1000

const EXTENSIONES_IMAGEN = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']
const EXTENSIONES_VIDEO = ['mp4', 'webm', 'mov', 'm4v', 'mkv']
const EXTENSIONES_AUDIO = ['mp3', 'ogg', 'oga', 'wav', 'm4a', 'flac']
const RE_VIDEO_DIRECTO = /\.(mp4|webm|ogg|mov)(\?|#|$)/i
const RE_PROVEEDOR_VIDEO = /youtube(-nocookie)?\.com|youtu\.be|vimeo\.com/i

function urlImagenDeEmbed(embed: DiscordEmbed): string | null {
  if (embed.type === 'gifv' || embed.type === 'video') {
    const url = embed.video?.url ?? ''
    if (RE_VIDEO_DIRECTO.test(url) || RE_PROVEEDOR_VIDEO.test(url)) return null
    return embed.thumbnail?.url ?? null
  }
  return embed.image?.url ?? null
}

function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.')
  return punto > 0 ? nombre.slice(punto + 1).toLowerCase() : ''
}

/**
 * Un GIF es una imagen animada: se reproduce solo en `<img>`. El vídeo se
 * reserva para los contenedores reales (mp4/webm), que es lo que Discord
 * entrega cuando se elige un GIF del selector.
 */
function esImagen(adjunto: DiscordAttachment): boolean {
  if (adjunto.content_type) return adjunto.content_type.startsWith('image/')
  return EXTENSIONES_IMAGEN.includes(extensionDe(adjunto.filename))
}

function esVideo(adjunto: DiscordAttachment): boolean {
  if (adjunto.content_type) return adjunto.content_type.startsWith('video/')
  return EXTENSIONES_VIDEO.includes(extensionDe(adjunto.filename))
}

function esAudio(adjunto: DiscordAttachment): boolean {
  if (adjunto.content_type) return adjunto.content_type.startsWith('audio/')
  return EXTENSIONES_AUDIO.includes(extensionDe(adjunto.filename))
}

function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function horaDe(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '--:--'
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`
}

/** Clave de día en hora local, para separar bloques por fecha. */
function claveDia(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return 'invalido'
  return `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`
}

function etiquetaDia(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return 'Fecha desconocida'

  const hoy = new Date()
  if (claveDia(iso) === claveDia(hoy.toISOString())) return 'Hoy'

  const ayer = new Date(hoy)
  ayer.setDate(hoy.getDate() - 1)
  if (claveDia(iso) === claveDia(ayer.toISOString())) return 'Ayer'

  return fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function nombreDeAutor(mensaje: DiscordMessage): string {
  return mensaje.author.global_name || mensaje.author.username || 'Desconocido'
}

/**
 * Discord entrega los eventos del canal (ingresos, mejoras, fijados) con
 * `content` vacío. Se traducen a una frase para que no queden filas mudas.
 */
function textoDeEvento(mensaje: DiscordMessage): string | null {
  switch (mensaje.type) {
    case MessageType.USER_JOIN:
      return 'se unió al servidor'
    case MessageType.CHANNEL_PINNED_MESSAGE:
      return 'fijó un mensaje en este canal'
    case MessageType.CHANNEL_NAME_CHANGE:
      return 'cambió el nombre del canal'
    case MessageType.CHANNEL_ICON_CHANGE:
      return 'cambió el icono del canal'
    case MessageType.CALL:
      return 'inició una llamada'
    case MessageType.GUILD_INVITE_REMINDER:
      return 'recordatorio de invitación'
    default:
      // 8–11 son los cuatro niveles de mejora del servidor (boosts).
      if (mensaje.type >= 8 && mensaje.type <= 11) return 'mejoró el servidor'
      return null
  }
}

function urlAvatar(mensaje: DiscordMessage): string | null {
  const { id, avatar } = mensaje.author
  if (!avatar) return null
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64`
}

/** Color estable derivado del id, para la inicial del avatar. */
function colorDeAvatar(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360
  return `hsl(${hash} 38% 32%)`
}

function inicialDeAutor(mensaje: DiscordMessage): string {
  const nombre = nombreDeAutor(mensaje).trim()
  return nombre ? nombre.charAt(0).toUpperCase() : '?'
}

/** ¿El mensaje continúa el bloque del anterior (mismo autor, menos de 5 min)? */
function continuaBloque(anterior: DiscordMessage | null, actual: DiscordMessage): boolean {
  if (!anterior) return false
  if (anterior.author.id !== actual.author.id) return false
  if (actual.referenced_message) return false
  if (claveDia(anterior.timestamp) !== claveDia(actual.timestamp)) return false

  const previo = new Date(anterior.timestamp).getTime()
  const propio = new Date(actual.timestamp).getTime()
  if (Number.isNaN(previo) || Number.isNaN(propio)) return false

  return propio - previo < VENTANA_AGRUPACION_MS
}

/** Proporción real del archivo, solo cuando Discord la informa. */
function proporcion(media: {
  width?: number | null
  height?: number | null
}): CSSProperties | undefined {
  if (!media.width || !media.height) return undefined
  return { aspectRatio: `${media.width} / ${media.height}` }
}

function colorDeEmbed(embed: DiscordEmbed): string {
  if (typeof embed.color === 'number') return `#${embed.color.toString(16).padStart(6, '0')}`
  return 'var(--accent)'
}

// ------------------------------------------------------------
// Piezas de un mensaje
// ------------------------------------------------------------

function Adjunto({
  adjunto,
  onAmpliar
}: {
  adjunto: DiscordAttachment
  onAmpliar: (url: string, tipo: TipoMedia) => void
}) {
  if (esImagen(adjunto)) {
    return (
      <div className="media">
        <img
          className="media__img"
          src={adjunto.url}
          alt={adjunto.description || adjunto.filename}
          loading="lazy"
          style={proporcion(adjunto)}
          onClick={() => onAmpliar(adjunto.url, 'imagen')}
        />
      </div>
    )
  }

  if (esVideo(adjunto)) {
    return (
      <video
        className="media__video"
        src={adjunto.url}
        controls
        autoPlay
        loop
        muted
        playsInline
        style={proporcion(adjunto)}
      />
    )
  }

  if (esAudio(adjunto)) {
    return <audio className="media__audio" src={adjunto.url} controls />
  }

  return (
    <div className="reaccion">
      <Paperclip size={13} strokeWidth={1.8} />
      <span className="truncate">{adjunto.filename}</span>
      <span className="dim mono">{formatearTamano(adjunto.size)}</span>
    </div>
  )
}

function CamposEmbed({ embed }: { embed: DiscordEmbed }) {
  const campos = embed.fields ?? []
  if (campos.length === 0) return null

  return (
    <div className="embed__campos">
      {campos.map((campo, i) => (
        <div
          key={`campo-${i}`}
          className={campo.inline ? 'embed__campo embed__campo--linea' : 'embed__campo'}
        >
          <div className="embed__campo-nombre">{campo.name}</div>
          <div className="embed__campo-valor">{renderizarMarkdown(campo.value)}</div>
        </div>
      ))}
    </div>
  )
}

function TarjetaEmbed({
  embed,
  onAmpliar
}: {
  embed: DiscordEmbed
  onAmpliar: (url: string, tipo: TipoMedia) => void
}) {
  const color = colorDeEmbed(embed)

  // GIF y vídeo: el mp4 se reproduce en línea, sin salir de la app.
  if (embed.type === 'gifv' || embed.type === 'video') {
    const url = embed.video?.url ?? ''

    // Solo los archivos directos se pueden reproducir con <video>. Discord
    // entrega YouTube como `type: video` con una URL de su reproductor:
    // meterla en <video> daba error 4 y un hueco negro.
    const esArchivoDirecto = RE_VIDEO_DIRECTO.test(url)

    if (esArchivoDirecto) {
      return (
        <video
          className="embed__media"
          src={url}
          poster={embed.thumbnail?.url}
          autoPlay
          loop
          muted
          playsInline
          style={embed.video ? proporcion(embed.video) : undefined}
        />
      )
    }

    // Proveedores con reproductor propio (YouTube, Vimeo): su política de
    // incrustación rechaza las peticiones que llegan desde `file://`, así que
    // se ofrece una vista previa honesta con el vídeo original a un clic.
    if (RE_PROVEEDOR_VIDEO.test(url)) {
      return (
        <button
          className="embed__proveedor-video"
          onClick={() => void window.api.app.openExternal(url)}
          title="Ver el vídeo en el navegador"
        >
          {embed.thumbnail?.url && (
            <img
              className="embed__media"
              src={embed.thumbnail.url}
              alt={embed.title || 'Vídeo'}
              loading="lazy"
            />
          )}
          <span className="media__play">
            <Play size={18} strokeWidth={1.8} fill="currentColor" />
          </span>
        </button>
      )
    }

    if (embed.thumbnail?.url) {
      return (
        <img
          className="embed__media"
          src={embed.thumbnail.url}
          alt={embed.title || 'Vista previa'}
          loading="lazy"
          style={proporcion(embed.thumbnail)}
          onClick={() => onAmpliar(embed.thumbnail!.url, 'imagen')}
        />
      )
    }
    return null
  }

  if (embed.type === 'image') {
    if (!embed.image?.url) return null
    return (
      <img
        className="embed__media"
        src={embed.image.url}
        alt={embed.title || 'Imagen'}
        loading="lazy"
        style={proporcion(embed.image)}
        onClick={() => onAmpliar(embed.image!.url, 'imagen')}
      />
    )
  }

  const vacio = !embed.title && !embed.description && !embed.fields?.length && !embed.image?.url
  if (vacio) return null

  return (
    <div className="embed">
      <div className="embed__barra" style={{ background: color }} />
      <div className="embed__cuerpo">
        {embed.provider?.name && <div className="embed__proveedor">{embed.provider.name}</div>}

        {embed.author && (
          <div className="embed__autor">
            {embed.author.icon_url && (
              <img
                src={embed.author.icon_url}
                alt=""
                width={16}
                height={16}
                loading="lazy"
                className="embed__autor-icono"
              />
            )}
            {embed.author.url ? (
              <a href={embed.author.url} rel="noreferrer" onClick={manejarEnlaceExterno}>
                {embed.author.name}
              </a>
            ) : (
              <span>{embed.author.name}</span>
            )}
          </div>
        )}

        {embed.title &&
          (embed.url ? (
            <a className="embed__titulo" href={embed.url} rel="noreferrer" onClick={manejarEnlaceExterno}>
              {embed.title}
            </a>
          ) : (
            <div className="embed__titulo">{embed.title}</div>
          ))}

        {embed.description && (
          <div className="embed__descripcion">{renderizarMarkdown(embed.description)}</div>
        )}

        {embed.image?.url && (
          <img
            className="embed__imagen"
            src={embed.image.url}
            alt={embed.title || 'Imagen'}
            loading="lazy"
            style={proporcion(embed.image)}
            onClick={() => onAmpliar(embed.image!.url, 'imagen')}
          />
        )}

        <CamposEmbed embed={embed} />

        {embed.footer && (
          <div className="embed__pie">
            {embed.footer.icon_url && (
              <img src={embed.footer.icon_url} alt="" width={14} height={14} loading="lazy" />
            )}
            <span className="truncate">{embed.footer.text}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Reacciones({ reacciones }: { reacciones: DiscordReaction[] }) {
  if (reacciones.length === 0) return null

  return (
    <div className="msg__reacciones">
      {reacciones.map((reaccion, i) => (
        <div key={`${reaccion.emoji.id ?? reaccion.emoji.name ?? 'emoji'}-${i}`} className="reaccion">
          {reaccion.emoji.id ? (
            <img
              src={`https://cdn.discordapp.com/emojis/${reaccion.emoji.id}.${
                reaccion.emoji.animated ? 'gif' : 'png'
              }`}
              alt={reaccion.emoji.name ?? ''}
              width={14}
              height={14}
              loading="lazy"
            />
          ) : (
            <span>{reaccion.emoji.name}</span>
          )}
          <span className="mono">{reaccion.count}</span>
        </div>
      ))}
    </div>
  )
}

interface PropsMensaje {
  mensaje: DiscordMessage
  agrupado: boolean
  onAmpliar: (url: string, tipo: TipoMedia) => void
  onAbrirEnDiscord?: (mensaje: DiscordMessage) => void
  onAbrirHilo?: (threadId: string, nombre: string) => void
}

/** Acciones que solo aparecen al pasar el ratón o al enfocar el mensaje. */
function Acciones({
  mensaje,
  onAbrirEnDiscord,
  onAbrirHilo
}: {
  mensaje: DiscordMessage
  onAbrirEnDiscord?: (mensaje: DiscordMessage) => void
  onAbrirHilo?: (threadId: string, nombre: string) => void
}) {
  const [copiado, setCopiado] = useState(false)

  const copiarTexto = useCallback(() => {
    if (!mensaje.content) return
    void navigator.clipboard
      .writeText(mensaje.content)
      .then(() => setCopiado(true))
      .catch(() => undefined)
    window.setTimeout(() => setCopiado(false), 1400)
  }, [mensaje.content])

  const esInicioDeHilo = mensaje.type === MessageType.THREAD_STARTER_MESSAGE

  return (
    <div className="msg__acciones">
      <button
        className="btn btn--ghost btn--icon btn--sm"
        onClick={copiarTexto}
        title="Copiar texto"
        aria-label="Copiar texto"
        disabled={!mensaje.content}
      >
        {copiado ? <Check size={14} strokeWidth={1.8} /> : <Copy size={14} strokeWidth={1.8} />}
      </button>

      {onAbrirEnDiscord && (
        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => onAbrirEnDiscord(mensaje)}
          title="Abrir en Discord"
          aria-label="Abrir en Discord"
        >
          <ExternalLink size={14} strokeWidth={1.8} />
        </button>
      )}

      {onAbrirHilo && esInicioDeHilo && (
        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => onAbrirHilo(mensaje.channel_id, mensaje.content.slice(0, 60) || 'Hilo')}
          title="Abrir hilo"
          aria-label="Abrir hilo"
        >
          <MessagesSquare size={14} strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}

const Mensaje = memo(function Mensaje({
  mensaje,
  agrupado,
  onAmpliar,
  onAbrirEnDiscord,
  onAbrirHilo
}: PropsMensaje) {
  // El mapa resuelve `<@id>` con el nombre visible de cada mención del mensaje.
  const menciones = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const usuario of mensaje.mentions ?? []) {
      mapa.set(usuario.id, usuario.global_name || usuario.username)
    }
    return mapa
  }, [mensaje.mentions])

  const respuesta = mensaje.referenced_message
  const avatar = urlAvatar(mensaje)
  const adjuntos = mensaje.attachments ?? []
  const embeds = mensaje.embeds ?? []

  // Discord entrega los eventos (ingresos, boosts, fijados) sin `content`.
  // Sin este texto quedaban filas vacías con solo el avatar y el nombre.
  const evento = textoDeEvento(mensaje)
  const vacio = !mensaje.content && adjuntos.length === 0 && embeds.length === 0 && !evento

  return (
    <div id={`msg-${mensaje.id}`} className={agrupado ? 'msg msg--agrupado' : 'msg'}>
      {agrupado ? (
        <div />
      ) : avatar ? (
        <img className="msg__avatar" src={avatar} alt={nombreDeAutor(mensaje)} loading="lazy" />
      ) : (
        <div className="msg__avatar" style={{ background: colorDeAvatar(mensaje.author.id) }}>
          {inicialDeAutor(mensaje)}
        </div>
      )}

      <div className="col">
        {!agrupado && (
          <div className="msg__linea">
            <span className="msg__autor">{nombreDeAutor(mensaje)}</span>
            <span className="msg__hora">{horaDe(mensaje.timestamp)}</span>
            {mensaje.edited_timestamp && <span className="msg__hora">(editado)</span>}
          </div>
        )}

        {respuesta && (
          <button
            type="button"
            className="msg__respuesta"
            style={{ textAlign: 'left', maxWidth: '100%' }}
            onClick={() =>
              document
                .getElementById(`msg-${respuesta.id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            title={
              respuesta.content
                ? `Ir al mensaje de ${nombreDeAutor(respuesta)}: ${respuesta.content}`
                : `Ir al mensaje de ${nombreDeAutor(respuesta)}`
            }
          >
            ↳ @{nombreDeAutor(respuesta)}
            {respuesta.content
              ? ` — ${respuesta.content.slice(0, 72)}${respuesta.content.length > 72 ? '…' : ''}`
              : ''}
          </button>
        )}

        {evento ? (
          <div className="msg__evento">
            <Sparkles size={12} strokeWidth={1.8} />
            <span>{evento}</span>
          </div>
        ) : mensaje.content ? (
          <div className="msg__texto">{renderizarMarkdown(mensaje.content, { menciones })}</div>
        ) : vacio ? (
          <div className="msg__evento dim">
            <Paperclip size={12} strokeWidth={1.8} />
            <span>Mensaje sin contenido</span>
          </div>
        ) : null}

        {adjuntos.length > 0 && (
          <div className="msg__adjuntos">
            {adjuntos.map((adjunto) => (
              <Adjunto key={adjunto.id} adjunto={adjunto} onAmpliar={onAmpliar} />
            ))}
          </div>
        )}

        {embeds.map((embed, i) => (
          <TarjetaEmbed key={`${mensaje.id}-embed-${i}`} embed={embed} onAmpliar={onAmpliar} />
        ))}

        <Reacciones reacciones={mensaje.reactions ?? []} />
      </div>

      <Acciones mensaje={mensaje} onAbrirEnDiscord={onAbrirEnDiscord} onAbrirHilo={onAbrirHilo} />
    </div>
  )
})

// ------------------------------------------------------------
// Flujo
// ------------------------------------------------------------

export default function MessageStream({
  mensajes,
  cargando = false,
  onAbrirHilo,
  onAbrirEnDiscord
}: MessageStreamProps) {
  const [ampliado, setAmpliado] = useState<MediaAmpliado | null>(null)

  const galeriaMensajes = useMemo<ElementoLightbox[]>(() => {
    const items: ElementoLightbox[] = []
    const vistos = new Set<string>()
    const agregar = (url: string, nombre?: string) => {
      if (!url || vistos.has(url)) return
      vistos.add(url)
      items.push({ url, tipo: 'imagen', nombre: nombre || undefined })
    }

    for (const mensaje of mensajes) {
      for (const adjunto of mensaje.attachments ?? []) {
        if (esImagen(adjunto)) agregar(adjunto.url, adjunto.filename)
      }
      for (const embed of mensaje.embeds ?? []) {
        const url = urlImagenDeEmbed(embed)
        if (url) agregar(url, embed.title)
      }
    }

    return items
  }, [mensajes])

  const ampliar = useCallback(
    (url: string, tipo: TipoMedia) => {
      if (tipo === 'imagen') {
        const indice = galeriaMensajes.findIndex((item) => item.url === url)
        setAmpliado({
          url,
          tipo,
          indiceInicial: indice >= 0 ? indice : undefined
        })
        return
      }
      setAmpliado({ url, tipo })
    },
    [galeriaMensajes]
  )

  const cerrarVisor = useCallback(() => setAmpliado(null), [])

  if (cargando) {
    return (
      <div className="hilo">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="msg">
            <div className="skeleton msg__avatar" />
            <div className="skeleton skeleton--row" />
          </div>
        ))}
      </div>
    )
  }

  if (mensajes.length === 0) {
    return (
      <div className="empty">
        <div className="empty__title">Sin mensajes</div>
      </div>
    )
  }

  return (
    <>
      <div className="hilo">
        {mensajes.map((mensaje, i) => {
          const anterior = i > 0 ? mensajes[i - 1] : null
          const nuevoDia = !anterior || claveDia(anterior.timestamp) !== claveDia(mensaje.timestamp)
          const agrupado = !nuevoDia && continuaBloque(anterior, mensaje)

          return (
            <Fragment key={mensaje.id}>
              {nuevoDia && <div className="separador-dia">{etiquetaDia(mensaje.timestamp)}</div>}
              <Mensaje
                mensaje={mensaje}
                agrupado={agrupado}
                onAmpliar={ampliar}
                onAbrirEnDiscord={onAbrirEnDiscord}
                onAbrirHilo={onAbrirHilo}
              />
            </Fragment>
          )
        })}
      </div>

      {ampliado && (
        <MediaLightbox
          url={ampliado.url}
          tipo={ampliado.tipo}
          items={
            ampliado.tipo === 'imagen' && ampliado.indiceInicial !== undefined
              ? galeriaMensajes
              : undefined
          }
          indiceInicial={ampliado.indiceInicial}
          onClose={cerrarVisor}
        />
      )}
    </>
  )
}
