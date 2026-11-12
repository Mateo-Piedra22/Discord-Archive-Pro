import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Compass,
  Hash,
  Image as ImageIcon,
  LayoutList,
  Megaphone,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Search,
  Users,
  Volume2
} from 'lucide-react'
import { useBrowserStore } from '../../stores/browserStore'
import { useDownloadStore } from '../../stores/downloadStore'
import { filterBrowseChannels } from '../../channelFilters'
import type { ChannelTypeFilters } from '../../channelFilters'
import { isForum, isMessageCapable, type DiscordChannel } from '../../../core/discord/types'

const ICONO = { size: 16, strokeWidth: 1.8 } as const

/** Icono por tipo de canal. Sin colores decorativos: el tipo se lee por forma. */
function ChannelIcon({ type }: { type: number }) {
  switch (type) {
    case 1:
    case 3:
      return <MessageSquare {...ICONO} />
    case 2:
    case 13:
      return <Volume2 {...ICONO} />
    case 5:
      return <Megaphone {...ICONO} />
    case 11:
    case 12:
      return <MessageCircle {...ICONO} />
    case 15:
      return <LayoutList {...ICONO} />
    case 16:
      return <ImageIcon {...ICONO} />
    default:
      return <Hash {...ICONO} />
  }
}

function getChannelName(channel: DiscordChannel): string {
  if (channel.name && channel.name.trim().length > 0) return channel.name
  const recipients = channel.recipients ?? []
  if (recipients.length > 0) {
    return recipients.map((u) => u.global_name || u.username).join(', ')
  }
  return 'Chat privado'
}

const FILTROS: { key: keyof ChannelTypeFilters; label: string; icon: typeof LayoutList }[] = [
  { key: 'forum', label: 'Foro', icon: LayoutList },
  { key: 'media', label: 'Media', icon: ImageIcon },
  { key: 'text', label: 'Texto', icon: MessageSquare },
  { key: 'thread', label: 'Hilos', icon: Hash },
  { key: 'dm', label: 'DMs', icon: Users },
  { key: 'voice', label: 'Voz', icon: Volume2 },
  { key: 'announcement', label: 'Anuncios', icon: Megaphone }
]

const FILTROS_TODOS: ChannelTypeFilters = {
  text: true,
  forum: true,
  voice: true,
  dm: true,
  thread: true,
  announcement: true,
  media: true,
  other: true
}

interface Props {
  onAbrirSelector: () => void
}

/**
 * Barra de canales del servidor activo: buscador, filtros por tipo y lista
 * agrupada por categorías colapsables. Permanece montada al abrir un canal.
 */
export default function SidebarCanales({ onAbrirSelector }: Props) {
  const {
    channels,
    selectedGuild,
    selectedChannel,
    selectChannel,
    loadingChannels,
    fetchChannels,
    fetchGuilds,
    loadingGuilds,
    channelSearchQuery,
    setChannelSearchQuery,
    channelTypeFilters,
    setChannelTypeFilter,
    setChannelTypeFilters,
    showStandardChannels,
    restrictedChannels
  } = useBrowserStore()
  const { strictChannelFiltering } = useDownloadStore()

  const [plegadas, setPlegadas] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const visibles = useMemo<DiscordChannel[]>(() => {
    if (!selectedGuild) return []
    return filterBrowseChannels(channels, {
      query: channelSearchQuery,
      typeFilters: channelTypeFilters,
      showStandardChannels,
      restrictedChannels,
      strictPrivacy: strictChannelFiltering
    }) as DiscordChannel[]
  }, [
    channels,
    channelSearchQuery,
    channelTypeFilters,
    showStandardChannels,
    selectedGuild,
    restrictedChannels,
    strictChannelFiltering
  ])

  const categorias = useMemo(
    () => channels.filter((c) => c.type === 4).sort((a, b) => (a.position || 0) - (b.position || 0)),
    [channels]
  )

  const grupos = useMemo(() => {
    const lista: { categoria: DiscordChannel | null; canales: DiscordChannel[] }[] = []

    categorias.forEach((categoria) => {
      const hijos = visibles.filter((canal) => canal.parent_id === categoria.id)
      if (hijos.length > 0) lista.push({ categoria, canales: hijos })
    })

    const sueltos = visibles.filter(
      (canal) =>
        canal.type !== 4 &&
        (!canal.parent_id || !categorias.some((c) => c.id === canal.parent_id))
    )
    if (sueltos.length > 0) lista.push({ categoria: null, canales: sueltos })

    return lista
  }, [categorias, visibles])

  const alternarGrupo = (clave: string) => {
    setPlegadas((previas) => {
      const siguiente = new Set(previas)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }

  /** Flechas arriba/abajo mueven el foco entre las filas visibles. */
  const alTeclear = (evento: ReactKeyboardEvent<HTMLDivElement>) => {
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return
    const filas = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>('[data-fila-canal]') ?? []
    )
    if (filas.length === 0) return

    evento.preventDefault()
    const actual = filas.indexOf(document.activeElement as HTMLElement)
    const siguiente =
      evento.key === 'ArrowDown'
        ? Math.min(actual + 1, filas.length - 1)
        : Math.max(actual - 1, 0)
    filas[siguiente]?.focus()
  }

  const limpiarFiltros = () => {
    setChannelSearchQuery('')
    setChannelTypeFilters(FILTROS_TODOS)
  }

  const sinCanales = !loadingChannels && visibles.length === 0

  return (
    <aside className="canales" aria-label="Canales del servidor">
      <div className="canales__head">
        <div className="col truncate">
          <strong className="truncate">{selectedGuild?.name ?? 'Canales'}</strong>
          <span className="muted truncate">
            {selectedGuild
              ? typeof selectedGuild.approximate_member_count === 'number'
                ? `${selectedGuild.approximate_member_count.toLocaleString('es')} miembros`
                : `${visibles.length} canales`
              : 'Ningún servidor activo'}
          </span>
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={onAbrirSelector}
          title="Cambiar de servidor (Ctrl+Shift+S)"
          aria-label="Cambiar de servidor"
        >
          <Compass size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => {
            if (selectedGuild) void fetchChannels(selectedGuild.id)
          }}
          disabled={!selectedGuild || loadingChannels}
          title="Recargar canales"
          aria-label="Recargar canales"
        >
          <RefreshCw
            size={16}
            strokeWidth={1.8}
            className={loadingChannels ? 'girar' : undefined}
          />
        </button>
      </div>

      <div className="canales__buscar">
        <div className="search">
          <Search size={14} strokeWidth={1.8} className="search__icon" />
          <input
            className="input"
            placeholder="Buscar canal"
            value={channelSearchQuery}
            onChange={(e) => setChannelSearchQuery(e.target.value)}
            aria-label="Buscar canal"
          />
        </div>
        <div className="row">
          {FILTROS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`chip${channelTypeFilters[key] ? ' chip--activo' : ''}`}
              onClick={() => setChannelTypeFilter(key, !channelTypeFilters[key])}
              aria-pressed={channelTypeFilters[key]}
            >
              <Icon size={13} strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="canales__scroll" ref={scrollRef} onKeyDown={alTeclear}>
        {!selectedGuild && !loadingGuilds ? (
          <div className="empty">
            <div className="empty__icon">
              <Compass size={20} strokeWidth={1.8} />
            </div>
            <div className="empty__title">Sin servidores</div>
            <div className="empty__text">
              No se encontró ningún servidor en esta cuenta.
            </div>
            <button type="button" className="btn btn--sm" onClick={() => void fetchGuilds()}>
              Actualizar
            </button>
          </div>
        ) : loadingChannels ? (
          <div className="col">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="skeleton skeleton--row" />
            ))}
          </div>
        ) : sinCanales ? (
          <div className="empty">
            <div className="empty__icon">
              <Compass size={20} strokeWidth={1.8} />
            </div>
            <div className="empty__title">Sin canales</div>
            <div className="empty__text">
              Ningún canal coincide con la búsqueda o los filtros activos.
            </div>
            <button type="button" className="btn btn--sm" onClick={limpiarFiltros}>
              Limpiar filtros
            </button>
          </div>
        ) : (
          grupos.map((grupo, indice) => {
            const clave = grupo.categoria?.id ?? `sin-categoria-${indice}`
            const plegada = plegadas.has(clave)

            return (
              <section key={clave} className="canales__grupo">
                <button
                  type="button"
                  className="canales__grupo-titulo"
                  onClick={() => alternarGrupo(clave)}
                  aria-expanded={!plegada}
                >
                  {plegada ? (
                    <ChevronRight size={14} strokeWidth={1.8} />
                  ) : (
                    <ChevronDown size={14} strokeWidth={1.8} />
                  )}
                  <span className="truncate">{grupo.categoria?.name ?? 'Canales'}</span>
                  <div className="spacer" />
                  <span className="mono dim">{grupo.canales.length}</span>
                </button>

                {!plegada &&
                  grupo.canales.map((canal) => {
                    const activo = selectedChannel?.id === canal.id
                    const seleccionable = isMessageCapable(canal.type) || isForum(canal.type)
                    const etiquetas = canal.available_tags?.length ?? 0

                    return (
                      <div
                        key={canal.id}
                        className={`canales__fila${activo ? ' canales__fila--activo' : ''}`}
                        data-fila-canal
                        role="button"
                        tabIndex={0}
                        aria-current={activo ? 'true' : undefined}
                        aria-disabled={!seleccionable}
                        title={seleccionable ? getChannelName(canal) : 'Este canal no contiene mensajes'}
                        onClick={seleccionable ? () => selectChannel(canal) : undefined}
                        onKeyDown={(e) => {
                          if (!seleccionable) return
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            selectChannel(canal)
                          }
                        }}
                        style={seleccionable ? undefined : { opacity: 0.45, cursor: 'not-allowed' }}
                      >
                        <span className="canales__icono">
                          <ChannelIcon type={canal.type} />
                        </span>
                        <span className="canales__nombre truncate">{getChannelName(canal)}</span>
                        {etiquetas > 0 && <span className="canales__meta">{etiquetas} etiq.</span>}
                      </div>
                    )
                  })}
              </section>
            )
          })
        )}
      </div>
    </aside>
  )
}
