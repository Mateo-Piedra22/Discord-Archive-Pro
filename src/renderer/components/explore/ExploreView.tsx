import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Compass, Hash, Search, RefreshCw, Users, Star,
  MessageSquare, LayoutList, Image as ImageIcon, Volume2,
  Megaphone, MessageCircle
} from 'lucide-react'
import { useBrowserStore } from '../../stores/browserStore'
import { useDownloadStore } from '../../stores/downloadStore'
import { filterBrowseChannels } from '../../channelFilters'
import type { ChannelTypeFilters } from '../../channelFilters'
import {
  isForum, isMessageCapable,
  type DiscordChannel, type DiscordGuild
} from '../../../core/discord/types'

const ICON = { size: 15, strokeWidth: 1.8 } as const

/** Icono por tipo de canal. Sin colores decorativos: el tipo se lee por forma. */
function ChannelIcon({ type }: { type: number }) {
  switch (type) {
    case 0:
      return <Hash {...ICON} />
    case 1:
    case 3:
      return <MessageSquare {...ICON} />
    case 2:
    case 13:
      return <Volume2 {...ICON} />
    case 5:
      return <Megaphone {...ICON} />
    case 11:
    case 12:
      return <MessageCircle {...ICON} />
    case 15:
      return <LayoutList {...ICON} />
    case 16:
      return <ImageIcon {...ICON} />
    default:
      return <Hash {...ICON} />
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

const AVATAR_BOX: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 'var(--r-sm)',
  overflow: 'hidden',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--surface-3)',
  color: 'var(--fg-2)'
}

function GuildRow({ guild, active, onClick }: { guild: DiscordGuild; active: boolean; onClick: () => void }) {
  const isDM = guild.id === '@me'
  return (
    <div
      className={`list__row${active ? ' list__row--active' : ''}`}
      onClick={onClick}
    >
      <div style={AVATAR_BOX}>
        {isDM ? (
          <MessageSquare size={14} strokeWidth={1.8} />
        ) : guild.icon ? (
          <img
            src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>
            {(guild.name || '?').charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <span className="list__name truncate">{guild.name}</span>
      <div className="spacer" />
      {typeof guild.approximate_member_count === 'number' && (
        <span className="list__meta">{guild.approximate_member_count.toLocaleString('es')}</span>
      )}
    </div>
  )
}

function ChannelRow({
  channel,
  active,
  onSelect
}: {
  channel: DiscordChannel
  active: boolean
  onSelect: () => void
}) {
  const selectable = isMessageCapable(channel.type) || isForum(channel.type)
  const heavy = isMessageCapable(channel.type)
  const tagCount = channel.available_tags?.length ?? 0

  return (
    <div
      className={`list__row${active ? ' list__row--active' : ''}`}
      onClick={selectable ? onSelect : undefined}
      aria-disabled={!selectable}
      title={selectable ? undefined : 'Este canal no contiene mensajes'}
      style={selectable ? undefined : { opacity: 0.45, cursor: 'not-allowed' }}
    >
      <span className="muted" style={{ display: 'flex' }}>
        <ChannelIcon type={channel.type} />
      </span>
      <span className="list__name truncate">{getChannelName(channel)}</span>
      <div className="spacer" />
      {heavy && <span className="badge badge--warn">Pesado</span>}
      {tagCount > 0 && <span className="list__meta">{tagCount} tags</span>}
    </div>
  )
}

const FILTERS: { key: keyof ChannelTypeFilters; label: string; icon: typeof LayoutList }[] = [
  { key: 'forum', label: 'Foro', icon: LayoutList },
  { key: 'media', label: 'Media', icon: ImageIcon },
  { key: 'text', label: 'Texto', icon: MessageSquare },
  { key: 'thread', label: 'Hilos', icon: Hash },
  { key: 'dm', label: 'DMs', icon: Users },
  { key: 'voice', label: 'Voz', icon: Volume2 },
  { key: 'announcement', label: 'Anuncios', icon: Megaphone }
]

export default function ExploreView() {
  const {
    guilds, selectedGuild, selectGuild, loadingGuilds, fetchGuilds,
    channels, selectedChannel, selectChannel, loadingChannels,
    channelSearchQuery, setChannelSearchQuery,
    channelTypeFilters, setChannelTypeFilter,
    showStandardChannels, restrictedChannels
  } = useBrowserStore()
  const { strictChannelFiltering } = useDownloadStore()

  const [search, setSearch] = useState('')

  const filteredServers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return guilds
    return guilds.filter((g) => g.name.toLowerCase().includes(q))
  }, [guilds, search])

  const dmGuild = filteredServers.find((g) => g.id === '@me')
  const servers = filteredServers.filter((g) => g.id !== '@me')

  const displayedChannels = useMemo<DiscordChannel[]>(() => {
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

  const categories = useMemo(
    () => channels.filter((c) => c.type === 4).sort((a, b) => (a.position || 0) - (b.position || 0)),
    [channels]
  )

  const groupedChannels = useMemo(() => {
    const groups: { category: DiscordChannel | null; channels: DiscordChannel[] }[] = []

    categories.forEach((cat) => {
      const children = displayedChannels.filter((chan) => chan.parent_id === cat.id)
      if (children.length > 0) groups.push({ category: cat, channels: children })
    })

    const orphans = displayedChannels.filter(
      (chan) => chan.type !== 4 && (!chan.parent_id || !categories.some((c) => c.id === chan.parent_id))
    )
    if (orphans.length > 0) groups.push({ category: null, channels: orphans })

    return groups
  }, [categories, displayedChannels])

  // Un solo fetch inicial por montaje; el ref evita el doble efecto de StrictMode.
  const didFetchGuilds = useRef(false)
  useEffect(() => {
    if (didFetchGuilds.current) return
    if (guilds.length === 0 && !loadingGuilds) {
      didFetchGuilds.current = true
      void fetchGuilds()
    }
  }, [guilds.length, loadingGuilds, fetchGuilds])

  const members = selectedGuild?.approximate_member_count
  const tier = selectedGuild?.premium_tier ?? 0

  return (
    <>
      <header className="workspace__header">
        <div className="workspace__titles">
          <div className="workspace__title">Explorar</div>
          <div className="workspace__subtitle">
            {selectedGuild ? selectedGuild.name : 'Selecciona un servidor para ver sus canales'}
          </div>
        </div>
        <div className="workspace__actions">
          <button
            className="btn btn--ghost btn--icon"
            onClick={() => void fetchGuilds()}
            disabled={loadingGuilds}
            title="Actualizar servidores"
          >
            <RefreshCw size={15} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <div className="workspace__body workspace__body--flush">
        <div className="split">
          <aside className="split__side" style={{ width: 272 }}>
            <div style={{ padding: 'var(--sp-3)' }}>
              <div className="search">
                <Search size={14} strokeWidth={1.8} className="search__icon" />
                <input
                  className="input input--search"
                  placeholder="Buscar servidor"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="split__body">
              {loadingGuilds ? (
                <div className="list">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="skeleton skeleton--row" />
                  ))}
                </div>
              ) : (
                <div className="list">
                  {servers.map((g) => (
                    <GuildRow
                      key={g.id}
                      guild={g}
                      active={selectedGuild?.id === g.id}
                      onClick={() => selectGuild(g)}
                    />
                  ))}

                  {dmGuild && (
                    <>
                      <hr className="divider" />
                      <div className="listmeta">Mensajes directos</div>
                      <GuildRow
                        guild={dmGuild}
                        active={selectedGuild?.id === dmGuild.id}
                        onClick={() => selectGuild(dmGuild)}
                      />
                    </>
                  )}

                  {filteredServers.length === 0 && (
                    <div className="listmeta">Sin resultados</div>
                  )}
                </div>
              )}
            </div>
          </aside>

          <div className="split__main">
            {selectedGuild ? (
              <>
                <div className="split__head">
                  <div className="col" style={{ minWidth: 0, gap: 1 }}>
                    <div className="workspace__title truncate">{selectedGuild.name}</div>
                    <div className="row muted" style={{ fontSize: 'var(--text-xs)' }}>
                      <Users size={12} strokeWidth={1.8} />
                      <span>{typeof members === 'number' ? members.toLocaleString('es') : '—'} miembros</span>
                      {tier > 0 && (
                        <>
                          <span className="dim">·</span>
                          <Star size={12} strokeWidth={1.8} />
                          <span>Nivel {tier}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="spacer" />
                  <div className="search" style={{ width: 240 }}>
                    <Search size={14} strokeWidth={1.8} className="search__icon" />
                    <input
                      className="input input--search"
                      placeholder="Filtrar canales"
                      value={channelSearchQuery}
                      onChange={(e) => setChannelSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                <div className="split__head" style={{ flexWrap: 'wrap' }}>
                  {FILTERS.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      className={`chip${channelTypeFilters[key] ? ' chip--active' : ''}`}
                      onClick={() => setChannelTypeFilter(key, !channelTypeFilters[key])}
                    >
                      <Icon size={13} strokeWidth={1.8} />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="split__body">
                  {loadingChannels ? (
                    <div className="list">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className="skeleton skeleton--row" />
                      ))}
                    </div>
                  ) : displayedChannels.length === 0 ? (
                    <div className="empty">
                      <div className="empty__icon">
                        <Compass size={20} strokeWidth={1.8} />
                      </div>
                      <div className="empty__title">Sin canales</div>
                      <div className="empty__text">
                        Ningún canal coincide con la búsqueda o los filtros activos.
                      </div>
                    </div>
                  ) : (
                    groupedChannels.map((group, index) => (
                      <section key={group.category?.id ?? `sin-categoria-${index}`}>
                        <div className="listmeta">
                          <span className="truncate">
                            {group.category?.name ?? 'Canales'}
                          </span>
                          <div className="spacer" />
                          <span className="mono">{group.channels.length}</span>
                        </div>
                        <div className="list">
                          {group.channels.map((channel) => (
                            <ChannelRow
                              key={channel.id}
                              channel={channel}
                              active={selectedChannel?.id === channel.id}
                              onSelect={() => selectChannel(channel)}
                            />
                          ))}
                        </div>
                      </section>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="empty">
                <div className="empty__icon">
                  <Compass size={20} strokeWidth={1.8} />
                </div>
                <div className="empty__title">Explorar servidores</div>
                <div className="empty__text">
                  Selecciona un servidor de la izquierda para ver sus canales y elegir qué descargar.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
