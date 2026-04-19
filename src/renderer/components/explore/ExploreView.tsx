import React, { useState, useEffect, useMemo } from 'react'
import { 
  Compass, Server, Hash, Search, RefreshCw, 
  ChevronRight, Globe, Users, Star, Shield,
  MessageSquare, LayoutList, Image as ImageIcon,
  Zap, Volume2, Info, X, ZapOff, Filter,
  MessageCircle, Settings, Layers
} from 'lucide-react'
import { useBrowserStore } from '../../stores/browserStore'
import { useDownloadStore } from '../../stores/downloadStore'
import { filterBrowseChannels } from '../../channelFilters'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function boostColor(tier: number): string {
  if (tier >= 3) return '#f47fff'
  if (tier >= 2) return '#c97fe8'
  if (tier >= 1) return '#9b59b6'
  return 'var(--text-3)'
}

const CHANNEL_TYPES: Record<number, { icon: (s: number) => React.ReactNode; label: string; color: string; isHeavy: boolean }> = {
  0:  { icon: s => <MessageSquare size={s} />, label: 'Texto',         color: 'var(--text-2)',  isHeavy: true  },
  1:  { icon: s => <Search size={s} />,         label: 'DM',            color: '#b9bbbe',        isHeavy: true  },
  2:  { icon: s => <Volume2 size={s} />,        label: 'Voz',           color: '#57f287',        isHeavy: false },
  3:  { icon: s => <Users size={s} />,          label: 'Grupo DM',      color: '#b9bbbe',        isHeavy: true  },
  5:  { icon: s => <ZapOff size={s} />,         label: 'Anuncios',      color: '#faa61a',        isHeavy: true  },
  11: { icon: s => <Hash size={s} />,           label: 'Hilo',          color: 'var(--accent)',  isHeavy: true  },
  12: { icon: s => <Hash size={s} />,           label: 'Hilo Privado',  color: '#eb459e',        isHeavy: true  },
  15: { icon: s => <LayoutList size={s} />,     label: 'Foro',          color: 'var(--accent)',  isHeavy: false },
  16: { icon: s => <ImageIcon size={s} />,      label: 'Media',         color: '#eb459e',        isHeavy: false },
}

function getDMName(channel: any): string {
  if (channel.name) return channel.name
  if (channel.recipients?.length > 0) {
    return channel.recipients.map((u: any) => u.global_name || u.username).join(', ')
  }
  return 'Chat privado'
}

function CompassAnimation() {
  return (
    <div className="compass-anim">
      <div className="compass-anim__ring" />
      <div className="compass-anim__inner">
        <Compass size={48} className="compass-anim__icon" />
      </div>
      <style>{`
        .compass-anim {
          position: relative; width: 120px; height: 120px;
          display: flex; align-items: center; justify-content: center;
        }
        .compass-anim__ring {
          position: absolute; inset: 0; border: 2px dashed var(--accent);
          border-radius: 50%; opacity: 0.2; animation: spin 10s linear infinite;
        }
        .compass-anim__inner {
          width: 80px; height: 80px; border-radius: 24px;
          background: linear-gradient(135deg, var(--accent), var(--accent-hover));
          box-shadow: 0 0 30px var(--accent-dim);
          display: flex; align-items: center; justify-content: center;
          animation: float 3s ease-in-out infinite; z-index: 1;
        }
        .compass-anim__icon { color: white; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2)); }
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-10px) rotate(2deg); }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

// ─── Main View ───────────────────────────────────────────────────────────────
export default function ExploreView() {
  const { 
    guilds, selectedGuild, selectGuild, loadingGuilds, fetchGuilds,
    channels, selectedChannel, selectChannel, loadingChannels, fetchChannels,
    showStandardChannels, channelSearchQuery, setChannelSearchQuery,
    channelTypeFilters, setChannelTypeFilter, setChannelTypeFilters,
    restrictedChannels
  } = useBrowserStore()
  const { strictChannelFiltering } = useDownloadStore()

  const [search, setSearch] = useState('')

  // Servers filtering
  const filteredServers = useMemo(() => {
    return guilds.filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
  }, [guilds, search])

  const dmGuild = filteredServers.find(g => g.id === '@me')
  const servers = filteredServers.filter(g => g.id !== '@me')

  // Channels filtering & grouping
  const displayedChannels = useMemo(() => {
    if (!selectedGuild) return []
    return filterBrowseChannels(channels, {
      query: channelSearchQuery,
      typeFilters: channelTypeFilters,
      showStandardChannels: showStandardChannels,
      restrictedChannels: restrictedChannels,
      strictPrivacy: strictChannelFiltering
    })
  }, [channels, channelSearchQuery, channelTypeFilters, showStandardChannels, selectedGuild])

  const categories = useMemo(() => {
    return channels.filter(c => c.type === 4).sort((a, b) => (a.position || 0) - (b.position || 0))
  }, [channels])

  const groupedChannels = useMemo(() => {
    const groups: { category: any | null; channels: any[] }[] = []
    
    // Category sections
    categories.forEach(cat => {
      const children = displayedChannels.filter(chan => chan.parent_id === cat.id)
      if (children.length > 0) {
        groups.push({ category: cat, channels: children })
      }
    })

    // Orphan channels (no category or parent not in categories)
    const orphans = displayedChannels.filter(chan => 
      chan.type !== 4 && (!chan.parent_id || !categories.some(c => c.id === chan.parent_id))
    )
    if (orphans.length > 0) {
      groups.push({ category: null, channels: orphans })
    }

    return groups
  }, [categories, displayedChannels])

  useEffect(() => {
    if (guilds.length === 0 && !loadingGuilds) {
      fetchGuilds()
    }
  }, [])

  return (
    <div style={{ 
      display: 'flex', height: '100%', background: 'var(--bg-0)',
      animation: 'fadeIn 0.3s var(--ease)', overflow: 'hidden'
    }}>
      {/* Sidebar: Servers List */}
      <aside style={{ 
        width: 280, borderRight: '1px solid var(--border)', 
        display: 'flex', flexDirection: 'column', background: 'var(--bg-1)'
      }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ 
              width: 32, height: 32, borderRadius: 10, 
              background: 'var(--accent)', display: 'flex', 
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Compass size={18} color="white" />
            </div>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-0)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Servidores</h3>
            <div style={{ flex: 1 }} />
            <button 
              className="btn btn--ghost btn--xs" 
              onClick={() => fetchGuilds()}
              style={{ padding: 6 }}
            >
              <RefreshCw size={14} className={loadingGuilds ? 'spin' : ''} />
            </button>
          </div>
          
          <div className="search-bar" style={{ marginBottom: 4, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search 
              className="search-bar__icon" 
              size={13} 
              style={{ 
                position: 'absolute', 
                left: 12, 
                top: '50%', 
                transform: 'translateY(-50%)',
                opacity: 0.6
              }} 
            />
            <input 
              className="input" 
              placeholder="Buscar servidor..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ background: 'var(--bg-0)', borderRadius: 10, paddingLeft: 34, width: '100%' }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
          {loadingGuilds ? (
            Array(8).fill(0).map((_, i) => (
              <div key={i} className="skeleton skeleton--row" style={{ height: 48, marginBottom: 6, borderRadius: 12 }} />
            ))
          ) : (
            <>
              {dmGuild && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', padding: '0 12px 6px', textTransform: 'uppercase' }}>Privados</div>
                  <ServerRow 
                    guild={dmGuild} 
                    active={selectedGuild?.id === dmGuild.id} 
                    onClick={() => selectGuild(dmGuild)} 
                  />
                </div>
              )}
              
              <div style={{ 
                fontSize: 10, fontWeight: 700, color: 'var(--text-3)', 
                padding: '0 12px 6px', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                Servidores ({servers.length})
                <div style={{ height: 1, flex: 1, background: 'var(--border)', opacity: 0.5 }} />
              </div>
              {servers.map(g => (
                <ServerRow 
                  key={g.id} 
                  guild={g} 
                  active={selectedGuild?.id === g.id} 
                  onClick={() => selectGuild(g)} 
                />
              ))}
              
              {filteredServers.length === 0 && (
                <div style={{ 
                  padding: '40px 20px', textAlign: 'center', opacity: 0.5,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
                }}>
                  <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg-2)' }}>
                    <Search size={20} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Sin resultados</div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Main Content Area: Channels */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' }}>
        {selectedGuild ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', animation: 'fadeUp 0.3s var(--ease)' }}>
            {/* Context Header */}
            <header style={{ 
              padding: '24px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-1)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
                <div style={{ 
                  width: 56, height: 56, borderRadius: 16, 
                  background: selectedGuild.icon ? 'transparent' : 'var(--accent)',
                  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 16px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  {selectedGuild.icon ? (
                    <img 
                      src={`https://cdn.discordapp.com/icons/${selectedGuild.id}/${selectedGuild.icon}.png?size=128`} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: 24, fontWeight: 800, color: 'white' }}>{selectedGuild.name[0]}</span>
                  )}
                </div>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-0)', marginBottom: 2, letterSpacing: '-0.02em' }}>{selectedGuild.name}</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Users size={12} /> {selectedGuild.approximate_member_count?.toLocaleString() || '—'} Miembros
                    </span>
                    {(selectedGuild.premium_tier ?? 0) > 0 && (
                      <span style={{ fontSize: 11, color: boostColor(selectedGuild.premium_tier!), fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Star size={12} fill="currentColor" /> Nivel {selectedGuild.premium_tier}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                <div className="search-bar" style={{ width: 280, height: 40, position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Search 
                    className="search-bar__icon" 
                    size={14} 
                    style={{ 
                      position: 'absolute', 
                      left: 12, 
                      top: '50%', 
                      transform: 'translateY(-50%)',
                      opacity: 0.6
                    }} 
                  />
                  <input 
                    className="input" 
                    placeholder="Filtrar por nombre o tópico..." 
                    value={channelSearchQuery}
                    onChange={e => setChannelSearchQuery(e.target.value)}
                    style={{ background: 'var(--bg-2)', borderRadius: 12, fontSize: 13, paddingLeft: 38, width: '100%' }}
                  />
                </div>
              </div>

              {/* Filtering Chips */}
              <div style={{ width: '100%', display: 'flex', gap: 8, padding: '4px 0' }}>
                <FilterChip 
                  icon={<Layers size={12}/>} 
                  label="Todo" 
                  active={Object.values(channelTypeFilters).every(v=>v)} 
                  onClick={() => {
                    const allOn = { text: true, forum: true, media: true, thread: true, dm: true, voice: true, announcement: true, other: true }
                    setChannelTypeFilters(allOn)
                  }} 
                />
                <FilterChip icon={<LayoutList size={12}/>} label="Foros" active={channelTypeFilters.forum} onClick={() => setChannelTypeFilter('forum', !channelTypeFilters.forum)} />
                <FilterChip icon={<ImageIcon size={12}/>} label="Media" active={channelTypeFilters.media} onClick={() => setChannelTypeFilter('media', !channelTypeFilters.media)} />
                <FilterChip icon={<MessageSquare size={12}/>} label="Texto" active={channelTypeFilters.text} onClick={() => setChannelTypeFilter('text', !channelTypeFilters.text)} />
                <FilterChip icon={<Hash size={12}/>} label="Hilos" active={channelTypeFilters.thread} onClick={() => setChannelTypeFilter('thread', !channelTypeFilters.thread)} />
                <FilterChip icon={<Users size={12}/>} label="DMs" active={channelTypeFilters.dm} onClick={() => setChannelTypeFilter('dm', !channelTypeFilters.dm)} />
                <FilterChip icon={<Volume2 size={12}/>} label="Voz" active={channelTypeFilters.voice} onClick={() => setChannelTypeFilter('voice', !channelTypeFilters.voice)} />
                <FilterChip icon={<Zap size={12}/>} label="Anuncios" active={channelTypeFilters.announcement} onClick={() => setChannelTypeFilter('announcement', !channelTypeFilters.announcement)} />
              </div>
            </header>

            {/* Channels Grid */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
              {loadingChannels ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
                  {Array(6).fill(0).map((_, i) => (
                    <div key={i} className="skeleton skeleton--card" style={{ height: 120, borderRadius: 20 }} />
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 1400, margin: '0 auto' }}>
                  {groupedChannels.map((group, gIdx) => (
                    <ChannelGroup 
                      key={group.category?.id || `g-${gIdx}`}
                      title={group.category?.name || 'Canales General'} 
                      channels={group.channels} 
                      onSelect={selectChannel}
                      selectedId={selectedChannel?.id}
                    />
                  ))}

                  {displayedChannels.length === 0 && (
                    <div style={{ 
                      marginTop: 80, display: 'flex', flexDirection: 'column', 
                      alignItems: 'center', textAlign: 'center' 
                    }}>
                      <div style={{ position: 'relative', marginBottom: 24 }}>
                        <div style={{ 
                          position: 'absolute', inset: -20, background: 'var(--accent)', 
                          filter: 'blur(40px)', opacity: 0.1, borderRadius: '50%' 
                        }} />
                        <ZapOff size={64} style={{ opacity: 0.2, position: 'relative' }} />
                      </div>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-1)' }}>Cero canales encontrados</h3>
                      <p style={{ color: 'var(--text-3)', maxWidth: 360, marginTop: 8, lineHeight: 1.6 }}>
                        No se encontraron canales que coincidan con tus filtros actuales. Prueba ajustando la búsqueda o cambiando los tipos de canales visibles.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ 
            flex: 1, display: 'flex', flexDirection: 'column', 
            alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(circle at center, rgba(88, 101, 242, 0.03) 0%, transparent 70%)'
          }}>
            <CompassAnimation />
            <h3 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--text-0)', marginTop: 24, letterSpacing: '-0.02em' }}>
              Explorador de Comunidades
            </h3>
            <p style={{ color: 'var(--text-3)', fontSize: '1rem', maxWidth: 400, textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
              Selecciona un servidor de la izquierda para desplegar sus canales. Puedes filtrar hilos, foros y canales pesados para una descarga selectiva.
            </p>
          </div>
        )}
      </main>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        
        .server-row {
          display: flex; align-items: center; gap: 12px; padding: 12px;
          border-radius: 14px; cursor: pointer; transition: all 0.2s var(--ease);
          margin-bottom: 4px; border: 1px solid transparent;
        }
        .server-row:hover { background: rgba(255,255,255,0.03); transform: translateX(4px); }
        .server-row--active { 
          background: var(--accent-dim) !important; 
          border-color: var(--accent) !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .channel-card {
          background: var(--bg-1); border: 1px solid var(--border);
          border-radius: 20px; padding: 20px; cursor: pointer;
          transition: all 0.25s var(--ease); display: flex; flex-direction: column; gap: 14px;
          position: relative; overflow: hidden;
        }
        .channel-card::before {
          content: ""; position: absolute; inset: 0; 
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%);
          opacity: 0; transition: opacity 0.2s;
        }
        .channel-card:hover::before { opacity: 1; }
        .channel-card:hover { 
          background: var(--bg-hover); transform: translateY(-5px);
          box-shadow: 0 12px 32px rgba(0,0,0,0.3); border-color: rgba(255,255,255,0.15);
        }
        .channel-card--active { 
          border-color: var(--accent) !important; 
          background: var(--accent-dim) !important; 
          box-shadow: 0 8px 24px var(--accent-dim) !important;
        }
      `}</style>
    </div>
  )
}

function FilterChip({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer',
        transition: 'all 0.2s',
        background: active ? 'var(--accent)' : 'var(--bg-2)',
        color: active ? 'white' : 'var(--text-2)',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
      }}
    >
      {icon} {label}
    </button>
  )
}

function ServerRow({ guild, active, onClick }: { guild: any; active: boolean; onClick: () => void }) {
  const isDM = guild.id === '@me'
  return (
    <div 
      className={`server-row ${active ? 'server-row--active' : ''}`}
      onClick={onClick}
    >
      <div style={{ 
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        background: isDM ? 'var(--accent)' : (guild.icon ? 'transparent' : '#444'),
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {isDM ? (
          <MessageSquare size={16} color="white" />
        ) : guild.icon ? (
          <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, fontWeight: 800, color: 'white' }}>{guild.name[0]}</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ 
          fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--text-0)' : 'var(--text-1)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {guild.name}
        </div>
        {guild.approximate_member_count && (
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{guild.approximate_member_count.toLocaleString()} miembros</div>
        )}
      </div>
      {guild.owner && <Shield size={10} color="#faa61a" />}
    </div>
  )
}

function ChannelGroup({ title, channels, onSelect, selectedId }: { title: string; channels: any[]; onSelect: (c: any) => void; selectedId?: string }) {
  if (channels.length === 0) return null
  return (
    <section>
      <h4 style={{ 
        fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-3)', 
        textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 10
      }}>
        {title} <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
      </h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {channels.map(c => {
          const type = CHANNEL_TYPES[c.type] || CHANNEL_TYPES[0]
          const isActive = selectedId === c.id
          return (
            <div 
              key={c.id} 
              className={`channel-card ${isActive ? 'channel-card--active' : ''}`}
              onClick={() => onSelect(c)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ 
                  width: 36, height: 36, borderRadius: 10, 
                  background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isActive ? 'white' : type.color
                }}>
                  {type.icon(18)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name || getDMName(c)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{type.label}</div>
                </div>
                {type.isHeavy && (
                  <span style={{ 
                    fontSize: 9, fontWeight: 800, padding: '2px 6px', 
                    borderRadius: 6, background: 'rgba(237,66,69,0.1)', color: 'var(--red)' 
                  }}>PESADO</span>
                )}
              </div>
              {c.topic && (
                <div style={{ 
                  fontSize: 11, color: 'var(--text-2)', lineHeight: 1.4, 
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', opacity: 0.8
                }}>
                  {c.topic}
                </div>
              )}
              {c.available_tags && c.available_tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'auto' }}>
                  {c.available_tags.slice(0, 3).map((t: any) => (
                    <span key={t.id} style={{ 
                      fontSize: 9, padding: '2px 6px', borderRadius: 4, 
                      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                      color: 'var(--text-3)'
                    }}>{t.name}</span>
                  ))}
                  {c.available_tags.length > 3 && <span style={{ fontSize: 9, padding: '2px 6px', color: 'var(--text-3)' }}>+{c.available_tags.length - 3}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
