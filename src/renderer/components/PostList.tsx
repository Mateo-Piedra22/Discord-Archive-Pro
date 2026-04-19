// PostList.tsx — Rich post/message list with:
// - Type chip: Publicación / Mensaje / Hilo / DM
// - Reply count, attachment count, reaction count, image count
// - Author avatar + name + date
// - Locked / Archived / Pinned badges
// - Tag pills + tag-based selection
// - Expandable rich preview
// - Grouping by tag (collapsible) when enabled

import React, { useState } from 'react'
import {
  ChevronDown, ChevronUp, Paperclip, Hash, MessageSquare,
  Lock, Archive, Pin, Image as ImageIcon, ThumbsUp,
  Download, X, LayoutList, Clock, User, Search, ChevronRight,
  MessageCircle, Star
} from 'lucide-react'
import { useBrowserStore } from '../stores/browserStore'
import { useDownloadStore } from '../stores/downloadStore'
import { showToast } from './Toast'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getChannelTypeLabel(type: number): { label: string; color: string; icon: React.ReactNode } {
  switch (type) {
    case 11: return { label: 'Hilo Público',  color: 'var(--accent)',  icon: <MessageSquare size={11} /> }
    case 12: return { label: 'Hilo Privado',  color: '#eb459e',        icon: <MessageSquare size={11} /> }
    case 0:  return { label: 'Canal Texto',   color: 'var(--text-2)',  icon: <Hash size={11} /> }
    case 1:  return { label: 'DM',            color: 'var(--text-2)',  icon: <User size={11} /> }
    case 3:  return { label: 'Grupo DM',      color: 'var(--text-2)',  icon: <User size={11} /> }
    case 5:  return { label: 'Anuncios',      color: '#f0b232',        icon: <Hash size={11} /> }
    case 15: return { label: 'Publicación',   color: '#23c55e',        icon: <LayoutList size={11} /> }
    case 16: return { label: 'Media',         color: '#eb459e',        icon: <ImageIcon size={11} /> }
    default: return { label: 'Post',          color: 'var(--text-3)',  icon: <Hash size={11} /> }
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return 'Reciente'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Reciente'
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) return `Hace ${days} días`
  if (days < 30) return `Hace ${Math.floor(days / 7)} sem.`
  if (days < 365) return `Hace ${Math.floor(days / 30)} mes.`
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatFullDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ─── Single post card ─────────────────────────────────────────────────────────
function PostCard({ post, isSelected, isPreview, onToggle, onPreview }: {
  post: any
  isSelected: boolean
  isPreview: boolean
  onToggle: () => void
  onPreview: (e: React.MouseEvent) => void
}) {
  const author = post.firstMessage?.author
  const authorName = author?.global_name || author?.username || 'Sistema'
  const thread = post.thread
  const isSingleChat = [0, 1, 3, 5].includes(thread.type)
  const typeInfo = getChannelTypeLabel(thread.type)

  const dateRaw = post.firstMessage?.timestamp || thread.thread_metadata?.create_timestamp || thread.created_timestamp
  const dateShort = formatDate(dateRaw)
  const dateFull = formatFullDate(dateRaw)

  const replyCount: number = post.replyCount || 0
  const attachCount: number = post.firstMessage?.attachments?.length || 0
  const imgCount: number = post.firstMessage?.attachments?.filter((a: any) => a.content_type?.startsWith('image/')).length || 0
  const reactionCount: number = (post.firstMessage?.reactions || []).reduce((s: number, r: any) => s + (r.count || 0), 0)

  const isLocked: boolean = thread.thread_metadata?.locked === true
  const isArchived: boolean = thread.thread_metadata?.archived === true
  const isPinned: boolean = post.firstMessage?.pinned === true

  return (
    <div
      className={`post-card${isSelected ? ' post-card--selected' : ''}${isPreview ? ' post-card--preview' : ''}`}
      style={{
        background: isSelected ? 'var(--accent-dim)' : 'rgba(255, 255, 255, 0.02)',
        backdropFilter: 'blur(10px)',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.05)'}`,
        borderRadius: 14,
        padding: '12px 16px',
        marginBottom: 8,
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: 'pointer',
        boxShadow: isSelected ? '0 8px 24px rgba(0,0,0,0.2)' : 'none'
      }}
    >
      {/* Main row */}
      <div 
        className="post-card__row" 
        onClick={onToggle} 
        style={{ display: 'flex', alignItems: 'center', gap: 14 }}
      >
        {/* Checkbox */}
        <div 
          className={`check${isSelected ? ' check--on' : ''}`} 
          style={{ 
            flexShrink: 0,
            width: 18, height: 18,
            borderRadius: 6,
            border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--text-3)'}`,
            background: isSelected ? 'var(--accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s'
          }}
        >
          {isSelected && <Star size={10} fill="white" color="white" />}
        </div>

        {/* Author avatar */}
        <div style={{ flexShrink: 0, position: 'relative' }}>
          {author?.avatar ? (
            <img
              src={`https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=48`}
              style={{ width: 36, height: 36, borderRadius: 12, objectFit: 'cover' }}
              alt=""
            />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: 12,
              background: `hsl(${parseInt((author?.id || '0').slice(-3), 16) % 360}, 45%, 45%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, color: 'white', fontWeight: 800
            }}>
              {(authorName)[0].toUpperCase()}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="post-card__main" style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="post-card__title" style={{ 
              fontWeight: 800, fontSize: '0.95rem', color: isSelected ? 'var(--text-0)' : 'var(--text-1)', 
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              letterSpacing: '-0.01em'
            }}>
              {thread.name || '(sin título)'}
            </span>

            {/* Status badges */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {isLocked && (
                <span title="Bloqueado" style={{ color: 'var(--red)', background: 'rgba(237,66,69,0.1)', padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center' }}><Lock size={10} /></span>
              )}
              {isArchived && (
                <span title="Archivado" style={{ color: 'var(--text-3)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center' }}><Archive size={10} /></span>
              )}
              {isPinned && (
                <span title="Fijado" style={{ color: '#f0b232', background: 'rgba(240,178,50,0.1)', padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center' }}><Pin size={10} /></span>
              )}
            </div>
          </div>

          {/* Meta row */}
          <div className="post-card__info" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
            {/* Type chip */}
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 800,
              background: isSelected ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
              color: isSelected ? 'white' : typeInfo.color,
              display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
              textTransform: 'uppercase', letterSpacing: '0.02em'
            }}>
              {typeInfo.icon} {typeInfo.label}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 700 }}>{authorName}</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-3)' }} />
              <span title={dateFull} style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={11} /> {dateShort}
              </span>
            </div>

            {/* Metrics */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
              {replyCount > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <MessageSquare size={12} style={{ opacity: 0.6 }} /> {replyCount}
                </span>
              )}
              {imgCount > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <ImageIcon size={12} style={{ opacity: 0.6 }} /> {imgCount}
                </span>
              )}
              {attachCount > imgCount && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <Paperclip size={12} style={{ opacity: 0.6 }} /> {attachCount - imgCount}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Expand button */}
        {!isSingleChat && (
          <button
            className="btn btn--ghost btn--xs"
            onClick={(e) => { e.stopPropagation(); onPreview(e); }}
            title="Ver contenido"
            style={{
              width: 32, height: 32, borderRadius: 10,
              background: isPreview ? 'var(--accent)' : 'rgba(255,255,255,0.02)',
              color: isPreview ? '#fff' : 'var(--text-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            {isPreview ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>

      {/* Rich preview panel */}
      {isPreview && !isSingleChat && (
        <div className="post-card__body" style={{
          marginTop: 12, padding: 16,
          background: 'rgba(0,0,0,0.2)', borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.05)',
          animation: 'fadeDown 0.2s var(--ease)'
        }}>
          {/* Author header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {author?.avatar ? (
              <img
                src={`https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=64`}
                style={{ width: 32, height: 32, borderRadius: '50%' }}
                alt="Avatar"
              />
            ) : (
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: `hsl(${parseInt((author?.id || '0').slice(-3), 16) % 360}, 45%, 45%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, color: 'white', fontWeight: 800
              }}>
                {authorName[0].toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.875rem', color: 'var(--text-0)' }}>{authorName}</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{dateFull}</div>
            </div>

            {/* Thread metadata */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {replyCount > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MessageSquare size={12} /> {replyCount} respuestas
                </span>
              )}
            </div>
          </div>

          {/* Content */}
          {post.firstMessage?.content ? (
            <div className="markdown-body" style={{ fontSize: '0.9rem', color: 'var(--text-1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {post.firstMessage.content.length > 900
                ? post.firstMessage.content.substring(0, 900) + '…'
                : post.firstMessage.content
              }
            </div>
          ) : (
            <div style={{ fontStyle: 'italic', color: 'var(--text-3)', fontSize: '0.9rem' }}>
              Sin texto. Puede contener sólo imágenes o adjuntos.
            </div>
          )}

          {/* Attachments */}
          {attachCount > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {post.firstMessage?.attachments?.map((a: any) => (
                <div key={a.id} style={{
                  padding: '4px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 20,
                  border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-2)',
                  display: 'flex', alignItems: 'center', gap: 6
                }}>
                  {a.content_type?.startsWith('image/') ? <ImageIcon size={12} /> : <Paperclip size={12} />}
                  {a.filename}
                </div>
              ))}
            </div>
          )}

          {/* Reactions */}
          {post.firstMessage?.reactions?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {post.firstMessage.reactions.slice(0, 8).map((r: any, i: number) => (
                <div key={i} style={{
                  padding: '4px 10px', background: 'rgba(88,101,242,0.1)',
                  border: '1px solid rgba(88,101,242,0.2)', borderRadius: 10,
                  fontSize: 13, display: 'flex', alignItems: 'center', gap: 6
                }}>
                  {r.emoji.name} <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 800 }}>{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PostList() {
  const {
    posts, selectedPosts, selectedChannel, loadingPosts,
    togglePostSelection, selectAllPosts, deselectAllPosts,
    searchQuery, setSearchQuery, selectedGuild
  } = useBrowserStore()
  const { startDownload, outputDir, pickDirectory } = useDownloadStore()
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [previewPost, setPreviewPost] = useState<string | null>(null)
  const [groupByTag, setGroupByTag] = useState(false)
  const [sortBy, setSortBy] = useState<'date' | 'replies' | 'name'>('date')

  if (!selectedChannel) {
    return (
      <div className="panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at center, rgba(88, 101, 242, 0.03) 0%, transparent 70%)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 140, height: 140, margin: '0 auto 24px', opacity: 0.4 }}>
            <MessageCircle size={140} color="var(--accent)" />
          </div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-0)', marginBottom: 8 }}>Selecciona un canal</h3>
          <p style={{ color: 'var(--text-3)', maxWidth: 300, fontSize: '0.9rem' }}>Elige una sala de chat o foro del servidor actual para desplegar el contenido.</p>
        </div>
      </div>
    )
  }

  if (loadingPosts) {
    return (
      <div className="panel">
        <div className="panel__pad">
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)', textAlign: 'center', padding: '12px 0' }}>
            Cargando publicaciones…
          </div>
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton skeleton--card" />)}
        </div>
      </div>
    )
  }

  // Collect unique tags
  const allTagsMap = new Map<string, { id: string; name: string; count: number }>()
  posts.forEach(p => {
    p.tags?.forEach((tag: any) => {
      const ex = allTagsMap.get(tag.id)
      if (ex) ex.count++
      else allTagsMap.set(tag.id, { ...tag, count: 1 })
    })
  })
  const allTags = Array.from(allTagsMap.values()).sort((a, b) => b.count - a.count)

  // Filter
  let filtered = posts.filter(p => {
    if (tagFilter && !p.tags?.some((t: any) => t.id === tagFilter)) return false
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      p.thread.name?.toLowerCase().includes(q) ||
      (p.firstMessage?.content || '').toLowerCase().includes(q) ||
      (p.firstMessage?.author?.global_name || p.firstMessage?.author?.username || '').toLowerCase().includes(q)
    )
  })

  // Sort
  if (sortBy === 'replies') filtered = [...filtered].sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0))
  else if (sortBy === 'name') filtered = [...filtered].sort((a, b) => (a.thread.name || '').localeCompare(b.thread.name || ''))
  // 'date' = natural server order

  // Stats
  const forumPosts = posts.filter(p => p.thread.type === 15 || p.thread.type === 16)
  const chatMsgs = posts.filter(p => [0, 1, 3, 5].includes(p.thread.type))
  const totalReplies = posts.reduce((s, p) => s + (p.replyCount || 0), 0)
  const totalAttach = posts.reduce((s, p) => s + (p.firstMessage?.attachments?.length || 0), 0)

  const handleDownload = async () => {
    if (selectedPosts.size === 0) { showToast('Selecciona al menos un post', 'warning'); return }
    const selected = posts.filter(p => selectedPosts.has(p.thread.id)).map(p => ({ thread: p.thread, tags: p.tags }))
    await startDownload(selected, selectedGuild?.name || '', selectedChannel?.name || '')
    showToast(`Descarga iniciada: ${selected.length} elemento(s)`, 'info')
  }

  const selectByTag = (tagId: string) => {
    posts.forEach(p => {
      if (p.tags?.some((t: any) => t.id === tagId) && !selectedPosts.has(p.thread.id)) togglePostSelection(p.thread.id)
    })
    const tag = allTagsMap.get(tagId)
    if (tag) showToast(`Seleccionados ${tag.count} posts con tag "${tag.name}"`, 'info')
  }

  // Group by first tag when enabled
  type Group = { id: string; name: string; items: any[] }
  let groups: Group[] = []
  if (groupByTag && allTags.length > 0) {
    const used = new Set<string>()
    for (const tag of allTags) {
      const items = filtered.filter(p => p.tags?.some((t: any) => t.id === tag.id) && !used.has(p.thread.id))
      items.forEach(p => used.add(p.thread.id))
      if (items.length > 0) groups.push({ id: tag.id, name: tag.name, items })
    }
    const untagged = filtered.filter(p => !used.has(p.thread.id))
    if (untagged.length > 0) groups.push({ id: '__none__', name: 'Sin tag', items: untagged })
  } else {
    groups = [{ id: '__all__', name: '', items: filtered }]
  }

  return (
    <div className="post-view">
      {/* ── Toolbar */}
      <div className="toolbar" style={{
        background: 'rgba(255, 255, 255, 0.02)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        padding: '12px 16px',
        zIndex: 5
      }}>
        <button
          className="btn btn--ghost btn--xs"
          onClick={() => useBrowserStore.setState({ selectedChannel: null })}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--accent)' }}
        >
          <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Volver
        </button>
        
        <div className="spacer--h" style={{ width: 16 }} />

        <button
          className="btn btn--ghost btn--xs"
          onClick={selectedPosts.size === filtered.length && filtered.length > 0
            ? deselectAllPosts
            : () => filtered.forEach(p => { if (!selectedPosts.has(p.thread.id)) togglePostSelection(p.thread.id) })}
          style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}
        >
          {selectedPosts.size > 0 ? `${selectedPosts.size} seleccionados` : 'Seleccionar todos'}
        </button>
        <div style={{ flex: 1 }} />

        {/* Sort */}
        <select
          className="input input--inline"
          style={{ fontSize: 11, padding: '2px 8px', height: 28, borderRadius: 8, background: 'var(--bg-2)' }}
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
        >
          <option value="date">Ordenar por Fecha</option>
          <option value="replies">Más respuestas</option>
          <option value="name">Alfabético</option>
        </select>

        {/* Group by tag toggle */}
        {allTags.length > 0 && (
          <button
            className={`btn btn--ghost btn--xs${groupByTag ? ' btn--accent-outline' : ''}`}
            onClick={() => setGroupByTag(g => !g)}
            title="Agrupar por tag"
            style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: groupByTag ? 1 : 0.7, background: groupByTag ? 'var(--accent-dim)' : 'transparent' }}
          >
            <LayoutList size={14} /> Tags
          </button>
        )}

        <div className="spacer--h" style={{ width: 12 }} />
        
        <span className="toolbar__info" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>
          {filtered.length} / {posts.length} elementos
        </span>
      </div>

      {/* ── Stats bar */}
      <div style={{ padding: '8px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {forumPosts.length > 0 && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(88,101,242,0.1)', color: 'var(--accent)', border: '1px solid rgba(88,101,242,0.2)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
            <LayoutList size={10} /> {forumPosts.length} PUBLICACIONES
          </span>
        )}
        {chatMsgs.length > 0 && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.03)', color: 'var(--text-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
            <MessageSquare size={10} /> {chatMsgs.length} MENSAJES
          </span>
        )}
        {totalReplies > 0 && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.03)', color: 'var(--text-3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <MessageCircle size={10} /> {totalReplies} RESPUESTAS
          </span>
        )}
        {totalAttach > 0 && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.03)', color: 'var(--text-3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <Paperclip size={10} /> {totalAttach} ADJUNTOS
          </span>
        )}
      </div>

      {/* ── Search + Tags */}
      <div className="panel__pad" style={{ paddingBottom: 0, paddingTop: 6 }}>
        <div className="search-bar" style={{ height: 42 }}>
          <Search className="search-bar__icon" size={14} style={{ top: '50%', transform: 'translateY(-50%)' }} />
          <input
            className="input"
            placeholder="Buscar por título, autor o contenido..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ borderRadius: 12, background: 'var(--bg-1)', paddingLeft: 38 }}
          />
          {searchQuery && (
            <button className="search-bar__clear" onClick={() => setSearchQuery('')} style={{ top: '50%', transform: 'translateY(-50%)' }}><X size={14} /></button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="tag-bar" style={{ marginTop: 12, gap: 6 }}>
            <button 
              className={`tag${!tagFilter ? ' tag--active' : ''}`} 
              onClick={() => setTagFilter(null)}
              style={{ borderRadius: 8, fontSize: 11, fontWeight: 700 }}
            >
              Todos
            </button>
            {allTags.map(tag => (
              <button
                key={tag.id}
                className={`tag${tagFilter === tag.id ? ' tag--active' : ''}`}
                onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
                onContextMenu={e => { e.preventDefault(); selectByTag(tag.id) }}
                title="Click: filtrar · Click-derecho: seleccionar todos"
                style={{ borderRadius: 8, fontSize: 11, fontWeight: 700 }}
              >
                {tag.name} <span className="tag__count" style={{ background: 'rgba(255,255,255,0.1)', padding: '0 4px', borderRadius: 4, marginLeft: 4 }}>{tag.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Posts */}
      <div className="panel" style={{ padding: '8px 16px', flex: 1, overflowY: 'auto' }}>
        {groups.map(group => (
          <CollapsibleGroup
            key={group.id}
            group={group}
            showHeader={groupByTag && groups.length > 1}
            selectedPosts={selectedPosts}
            previewPost={previewPost}
            onToggle={togglePostSelection}
            onPreview={(id, e) => { e.stopPropagation(); setPreviewPost(previewPost === id ? null : id) }}
          />
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: '60px 0', textAlign: 'center', opacity: 0.5 }}>
            <div style={{ marginBottom: 12 }}><Search size={48} style={{ opacity: 0.2 }} /></div>
            <div style={{ fontWeight: 700, color: 'var(--text-2)' }}>{searchQuery || tagFilter ? 'Sin resultados para los filtros' : 'Este canal está vacío'}</div>
          </div>
        )}
      </div>

      {/* ── Action bar */}
      {selectedPosts.size > 0 && (
        <div className="action-bar" style={{ 
          margin: '16px', borderRadius: 16, background: 'var(--accent)', 
          boxShadow: '0 8px 32px var(--accent-dim)', border: 'none',
          padding: '12px'
        }}>
          <div className="action-bar__row" style={{ gap: 12 }}>
            {!outputDir ? (
              <button className="btn" style={{ flex: 1, background: 'white', color: 'var(--accent)', fontWeight: 800 }} onClick={pickDirectory}>
                <Download size={16} /> ELEGIR CARPETA DE DESTINO
              </button>
            ) : (
              <button className="btn" style={{ flex: 1, background: 'white', color: 'var(--accent)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }} onClick={handleDownload}>
                <Download size={16} />
                DESCARGAR {selectedPosts.size} ELEMENTO{selectedPosts.size > 1 ? 'S' : ''}
              </button>
            )}
            <button 
              className="btn" 
              onClick={deselectAllPosts} 
              style={{ background: 'rgba(255,255,255,0.15)', color: 'white', width: 44, padding: 0, justifyContent: 'center' }}
              title="Limpiar selección"
            >
              <X size={20} />
            </button>
          </div>
          {outputDir && (
            <div 
              style={{ 
                marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.8)', 
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em'
              }} 
              onClick={pickDirectory}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{outputDir}</span>
              <span style={{ marginLeft: 'auto', textDecoration: 'underline' }}>CAMBIAR</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Collapsible tag group ─────────────────────────────────────────────────────
function CollapsibleGroup({ group, showHeader, selectedPosts, previewPost, onToggle, onPreview }: {
  group: { id: string; name: string; items: any[] }
  showHeader: boolean
  selectedPosts: Set<string>
  previewPost: string | null
  onToggle: (id: string) => void
  onPreview: (id: string, e: React.MouseEvent) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div style={{ marginBottom: 12 }}>
      {showHeader && (
        <button
          onClick={() => setCollapsed(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '8px 4px', background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text-3)', marginBottom: 6, borderBottom: '1px solid var(--border)'
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {group.name}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, marginLeft: 'auto', background: 'var(--bg-3)', padding: '2px 6px', borderRadius: 4 }}>
            {group.items.length} ELEMENTOS
          </span>
        </button>
      )}

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {group.items.map(post => (
            <PostCard
              key={post.thread.id}
              post={post}
              isSelected={selectedPosts.has(post.thread.id)}
              isPreview={previewPost === post.thread.id}
              onToggle={() => onToggle(post.thread.id)}
              onPreview={e => onPreview(post.thread.id, e)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
