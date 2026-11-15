import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ChevronDown, ChevronUp, Paperclip, MessageSquare,
  Lock, Archive, Pin, Image as ImageIcon, Download, X,
  Search, MessageCircle, Tag, Check, BookOpen, Copy, FolderCheck
} from 'lucide-react'
import { useBrowserStore } from '../stores/browserStore'
import { useDownloadStore } from '../stores/downloadStore'
import { useUiStore } from '../stores/uiStore'
import { showToast } from './Toast'
import type { DiscordUser, ForumPost } from '../../core/discord/types'

// ─── Utilidades ───────────────────────────────────────────────────────────────

function formatDate(iso: string | undefined): string {
  if (!iso) return 'Reciente'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Reciente'
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
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
  return d.toLocaleString('es', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function getPostDate(post: ForumPost): string | undefined {
  return (
    post.firstMessage?.timestamp ||
    post.thread.thread_metadata?.create_timestamp ||
    post.thread.created_timestamp
  )
}

function Avatar({ author, size }: { author: DiscordUser | null | undefined; size: number }) {
  const name = author?.global_name || author?.username || 'Sistema'
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 'var(--r-sm)',
    objectFit: 'cover',
    flexShrink: 0
  }

  if (author?.avatar) {
    return (
      <img
        src={`https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=64`}
        alt=""
        style={base}
      />
    )
  }

  return (
    <div
      style={{
        ...base,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `hsl(${parseInt((author?.id || '0').slice(-3), 16) % 360}, 40%, 40%)`,
        color: '#fff',
        fontSize: size > 26 ? 'var(--text-sm)' : 'var(--text-2xs)',
        fontWeight: 600
      }}
    >
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  )
}

function Metric({ icon, value }: { icon: React.ReactNode; value: number }) {
  return (
    <span className="list__meta row">
      {icon}
      <span className="mono">{value}</span>
    </span>
  )
}

// ─── Fila + vista previa ──────────────────────────────────────────────────────

interface CachedPostInfo {
  download_path?: string
  message_count?: number
  last_synced?: string
}

function PostRow({
  post,
  selected,
  expanded,
  cachedInfo,
  onToggle,
  onExpand,
  onRead
}: {
  post: ForumPost
  selected: boolean
  expanded: boolean
  cachedInfo?: CachedPostInfo
  onToggle: (e: React.MouseEvent) => void
  onExpand: () => void
  onRead: () => void
}) {
  const author = post.firstMessage?.author ?? null
  const authorName = author?.global_name || author?.username || 'Sistema'
  const dateRaw = getPostDate(post)
  const attachments = post.firstMessage?.attachments ?? []
  const reactions = post.firstMessage?.reactions ?? []
  const images = attachments.filter((a) => a.content_type?.startsWith('image/')).length
  const files = attachments.length - images
  const replies = post.replyCount || 0
  const content = post.firstMessage?.content?.trim() ?? ''
  const hasPreview = content.length > 0 || attachments.length > 0 || reactions.length > 0

  return (
    <>
      <div
        className={`list__row${selected ? ' list__row--active' : ''}`}
        onClick={(e) => onToggle(e)}
      >
        <div
          className={`checkbox${selected ? ' checkbox--on' : ''}`}
          role="checkbox"
          aria-checked={selected}
          onClick={(e) => { e.stopPropagation(); onToggle(e) }}
        >
          {selected && <Check size={11} strokeWidth={2.5} />}
        </div>

        <Avatar author={author} size={30} />

        <div className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <div className="row" style={{ minWidth: 0 }}>
            <span className="list__name truncate">
              {post.thread.name || '(sin título)'}
            </span>
            {cachedInfo && (
              <span className="badge badge--ok" title="Ya descargado en el archivo local">
                En archivo
              </span>
            )}
            {post.thread.thread_metadata?.locked && (
              <Lock size={12} strokeWidth={1.8} className="dim" />
            )}
            {post.thread.thread_metadata?.archived && (
              <Archive size={12} strokeWidth={1.8} className="dim" />
            )}
            {post.firstMessage?.pinned && (
              <Pin size={12} strokeWidth={1.8} className="dim" />
            )}
          </div>

          <div className="row">
            <span className="list__meta truncate">
              {post.firstMessage
                ? authorName
                : post.thread.message_count > 0
                  ? `Canal completo · ${post.thread.message_count} mensajes`
                  : 'Canal completo'}
            </span>
            {post.firstMessage && (
              <>
                <span className="dim">·</span>
                <span className="list__meta" title={formatFullDate(dateRaw)}>
                  {formatDate(dateRaw)}
                </span>
              </>
            )}
            <div className="spacer" />
            {replies > 0 && <Metric icon={<MessageSquare size={11} strokeWidth={1.8} />} value={replies} />}
            {images > 0 && <Metric icon={<ImageIcon size={11} strokeWidth={1.8} />} value={images} />}
            {files > 0 && <Metric icon={<Paperclip size={11} strokeWidth={1.8} />} value={files} />}
          </div>
        </div>

        {cachedInfo?.download_path && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={(e) => {
              e.stopPropagation()
              if (cachedInfo.download_path) {
                useUiStore.getState().abrirArchivo(cachedInfo.download_path)
              }
            }}
            title="Abrir copia local en el visor integrado"
          >
            <FolderCheck size={15} strokeWidth={1.8} />
          </button>
        )}

        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={(e) => { e.stopPropagation(); onRead() }}
          title="Leer el hilo sin descargarlo"
        >
          <BookOpen size={15} strokeWidth={1.8} />
        </button>

        {hasPreview && (
          <button
            className="btn btn--ghost btn--icon btn--sm"
            onClick={(e) => { e.stopPropagation(); onExpand() }}
            title={expanded ? 'Ocultar contenido' : 'Ver contenido'}
          >
            {expanded
              ? <ChevronUp size={15} strokeWidth={1.8} />
              : <ChevronDown size={15} strokeWidth={1.8} />}
          </button>
        )}
      </div>

      {expanded && (
        <div className="card" style={{ margin: '0 0 var(--sp-2)' }}>
          <div className="card__body">
            <div className="row">
              <Avatar author={author} size={24} />
              <div className="col" style={{ minWidth: 0 }}>
                <span className="truncate" style={{ fontWeight: 600 }}>{authorName}</span>
                <span className="list__meta">{formatFullDate(dateRaw)}</span>
              </div>
              <div className="spacer" />
              {replies > 0 && (
                <span className="list__meta row">
                  <MessageSquare size={11} strokeWidth={1.8} />
                  {replies} {replies === 1 ? 'respuesta' : 'respuestas'}
                </span>
              )}
            </div>

            {content ? (
              <div
                className="markdown-body"
                style={{
                  marginTop: 'var(--sp-3)',
                  fontSize: 'var(--text-md)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {content.length > 900 ? `${content.slice(0, 900)}…` : content}
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--text-md)' }}>
                Sin texto. Puede contener sólo adjuntos.
              </div>
            )}

            {attachments.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
                {attachments.map((a) => (
                  <span key={a.id} className="badge" style={{ textTransform: 'none' }}>
                    {a.content_type?.startsWith('image/')
                      ? <ImageIcon size={11} strokeWidth={1.8} />
                      : <Paperclip size={11} strokeWidth={1.8} />}
                    {a.filename}
                  </span>
                ))}
              </div>
            )}

            {reactions.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
                {reactions.slice(0, 8).map((r, i) => (
                  <span key={i} className="badge badge--info" style={{ textTransform: 'none' }}>
                    {r.emoji.name}
                    <span className="mono">{r.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const TAMANO_PAGINA_POSTS = 150

type QuickFilter = 'all' | 'attachments' | 'pinned' | 'archived' | 'cached'
type SortBy = 'date' | 'replies' | 'name' | 'attachments'

function limitarGrupos<T>(
  grupos: { id: string; name: string; items: T[] }[],
  maximo: number
): { visibleGroups: { id: string; name: string; items: T[] }[]; renderedCount: number } {
  const visibleGroups: { id: string; name: string; items: T[] }[] = []
  let restantes = maximo
  let renderedCount = 0
  for (const grupo of grupos) {
    if (restantes <= 0) break
    const porcion = grupo.items.slice(0, restantes)
    if (porcion.length > 0) {
      visibleGroups.push({ id: grupo.id, name: grupo.name, items: porcion })
      restantes -= porcion.length
      renderedCount += porcion.length
    }
  }
  return { visibleGroups, renderedCount }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PostList() {
  const {
    posts, selectedPosts, selectedChannel, loadingPosts,
    togglePostSelection, deselectAllPosts,
    searchQuery, setSearchQuery, selectedGuild,
    postsProgressCount, postsProgressTotal, cancelFetchPosts
  } = useBrowserStore()
  const { startDownload, outputDir, pickDirectory } = useDownloadStore()
  const abrirHilo = useUiStore((s) => s.abrirHilo)

  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [previewPost, setPreviewPost] = useState<string | null>(null)
  const [groupByTag, setGroupByTag] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [visibleCount, setVisibleCount] = useState(TAMANO_PAGINA_POSTS)
  const [cachedMap, setCachedMap] = useState<Map<string, CachedPostInfo>>(() => new Map())
  const lastClickedIdRef = useRef<string | null>(null)

  useEffect(() => {
    setVisibleCount(TAMANO_PAGINA_POSTS)
  }, [selectedChannel?.id, tagFilter, quickFilter, searchQuery, sortBy, groupByTag])

  useEffect(() => {
    lastClickedIdRef.current = null
    setQuickFilter('all')
    setTagFilter(null)
    setCachedMap(new Map())
  }, [selectedChannel?.id])

  useEffect(() => {
    const channelId = selectedChannel?.id
    if (!channelId) {
      setCachedMap(new Map())
      return
    }
    let cancelado = false
    void window.api.cache
      .getCachedPosts(channelId)
      .then((rows) => {
        if (cancelado) return
        const next = new Map<string, CachedPostInfo>()
        if (Array.isArray(rows)) {
          for (const raw of rows) {
            if (!raw || typeof raw !== 'object') continue
            const item = raw as {
              thread_id?: unknown
              download_path?: unknown
              message_count?: unknown
              last_synced?: unknown
            }
            if (typeof item.thread_id === 'string' && item.thread_id) {
              next.set(item.thread_id, {
                download_path: typeof item.download_path === 'string' ? item.download_path : undefined,
                message_count: typeof item.message_count === 'number' ? item.message_count : undefined,
                last_synced: typeof item.last_synced === 'string' ? item.last_synced : undefined
              })
            }
          }
        }
        setCachedMap(next)
      })
      .catch(() => {
        if (!cancelado) setCachedMap(new Map())
      })
    return () => {
      cancelado = true
    }
  }, [selectedChannel?.id, posts.length])

  const quickCounts = useMemo(() => {
    let attachments = 0
    let pinned = 0
    let archived = 0
    let cached = 0
    for (const p of posts) {
      if ((p.firstMessage?.attachments?.length || 0) > 0) attachments++
      if (p.firstMessage?.pinned) pinned++
      if (p.thread.thread_metadata?.archived) archived++
      if (cachedMap.has(p.thread.id)) cached++
    }
    return {
      all: posts.length,
      attachments,
      pinned,
      archived,
      cached
    }
  }, [posts, cachedMap])

  const allTags = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>()
    posts.forEach((p) => {
      p.tags?.forEach((tag) => {
        const existing = map.get(tag.id)
        if (existing) existing.count++
        else map.set(tag.id, { id: tag.id, name: tag.name, count: 1 })
      })
    })
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  }, [posts])

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase()
    let result = posts.filter((p) => {
      if (tagFilter && !p.tags?.some((t) => t.id === tagFilter)) return false
      if (quickFilter === 'attachments' && (p.firstMessage?.attachments?.length || 0) === 0) return false
      if (quickFilter === 'pinned' && !p.firstMessage?.pinned) return false
      if (quickFilter === 'archived' && !p.thread.thread_metadata?.archived) return false
      if (quickFilter === 'cached' && !cachedMap.has(p.thread.id)) return false
      if (!q) return true
      return (
        (p.thread.name || '').toLowerCase().includes(q) ||
        (p.firstMessage?.content || '').toLowerCase().includes(q) ||
        (p.firstMessage?.author?.global_name || p.firstMessage?.author?.username || '').toLowerCase().includes(q)
      )
    })
    if (sortBy === 'replies') {
      result = [...result].sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0))
    } else if (sortBy === 'attachments') {
      result = [...result].sort(
        (a, b) => (b.firstMessage?.attachments?.length || 0) - (a.firstMessage?.attachments?.length || 0)
      )
    } else if (sortBy === 'name') {
      result = [...result].sort((a, b) => (a.thread.name || '').localeCompare(b.thread.name || ''))
    }
    return result
  }, [posts, tagFilter, quickFilter, searchQuery, sortBy, cachedMap])

  const groups = useMemo(() => {
    if (!groupByTag || allTags.length === 0) {
      return [{ id: '__all__', name: '', items: filtered }]
    }
    const used = new Set<string>()
    const result: { id: string; name: string; items: ForumPost[] }[] = []
    for (const tag of allTags) {
      const items = filtered.filter((p) => p.tags?.some((t) => t.id === tag.id) && !used.has(p.thread.id))
      items.forEach((p) => used.add(p.thread.id))
      if (items.length > 0) result.push({ id: tag.id, name: tag.name, items })
    }
    const untagged = filtered.filter((p) => !used.has(p.thread.id))
    if (untagged.length > 0) result.push({ id: '__none__', name: 'Sin tag', items: untagged })
    return result
  }, [filtered, groupByTag, allTags])

  const { visibleGroups, renderedCount } = useMemo(
    () => limitarGrupos(groups, visibleCount),
    [groups, visibleCount]
  )

  const handleScrollPosts = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (renderedCount >= filtered.length) return
    const el = e.currentTarget
    const restante = el.scrollHeight - el.scrollTop - el.clientHeight
    if (restante < 320) {
      setVisibleCount((prev) => Math.min(filtered.length, prev + TAMANO_PAGINA_POSTS))
    }
  }, [renderedCount, filtered.length])

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedPosts.has(p.thread.id))

  const toggleSelectAllFiltered = () => {
    filtered.forEach((p) => {
      const has = selectedPosts.has(p.thread.id)
      if (allFilteredSelected ? has : !has) togglePostSelection(p.thread.id)
    })
  }

  const invertFilteredSelection = () => {
    filtered.forEach((p) => {
      togglePostSelection(p.thread.id)
    })
  }

  const handlePostToggle = (postId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      window.getSelection()?.removeAllRanges()
    }
    if (e.shiftKey && lastClickedIdRef.current) {
      const startIdx = filtered.findIndex((p) => p.thread.id === lastClickedIdRef.current)
      const endIdx = filtered.findIndex((p) => p.thread.id === postId)
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        for (let i = from; i <= to; i++) {
          const id = filtered[i].thread.id
          if (!selectedPosts.has(id)) togglePostSelection(id)
        }
        lastClickedIdRef.current = postId
        return
      }
    }
    togglePostSelection(postId)
    lastClickedIdRef.current = postId
  }

  const handleCopySelectedList = async () => {
    const selected = posts.filter((p) => selectedPosts.has(p.thread.id))
    if (selected.length === 0) return
    const text = selected.map((p) => `${p.thread.name || '(sin título)'} — ${p.thread.id}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      showToast(
        `Copiados ${selected.length} ${selected.length === 1 ? 'elemento' : 'elementos'} al portapapeles`,
        'success'
      )
    } catch {
      showToast('No se pudo copiar la lista al portapapeles', 'error')
    }
  }

  const selectByTag = (tagId: string) => {
    const items = posts.filter((p) => p.tags?.some((t) => t.id === tagId))
    items.forEach((p) => {
      if (!selectedPosts.has(p.thread.id)) togglePostSelection(p.thread.id)
    })
    const tag = allTags.find((t) => t.id === tagId)
    if (tag) showToast(`Seleccionados ${items.length} elementos con tag "${tag.name}"`, 'info')
  }

  const handleDownload = async () => {
    if (selectedPosts.size === 0) {
      showToast('Selecciona al menos un elemento', 'warning')
      return
    }
    const selected = posts
      .filter((p) => selectedPosts.has(p.thread.id))
      .map((p) => ({ thread: p.thread, tags: p.tags }))
    const started = await startDownload(selected, selectedGuild?.name || '', selectedChannel?.name || '')
    if (!started) return
    showToast(`Descarga iniciada: ${selected.length} elemento(s)`, 'info')
  }

  // ── Sin canal ────────────────────────────────────────────────────────────
  if (!selectedChannel) {
    return (
      <div className="workspace__body" style={{ display: 'flex' }}>
        <div className="empty">
          <div className="empty__icon">
            <MessageCircle size={20} strokeWidth={1.8} />
          </div>
          <div className="empty__title">Selecciona un canal</div>
          <div className="empty__text">
            Elige un canal de texto o un foro del servidor para listar sus publicaciones.
          </div>
        </div>
      </div>
    )
  }

  // ── Cargando ─────────────────────────────────────────────────────────────
  if (loadingPosts) {
    const total = postsProgressTotal || 0
    const count = postsProgressCount || 0
    const percent = total > 0 ? Math.round((count / total) * 100) : 0

    return (
      <>
        <header className="workspace__header">
          <button
            className="btn btn--ghost btn--icon"
            onClick={() => useBrowserStore.setState({ selectedChannel: null })}
            title="Volver"
          >
            <ArrowLeft size={16} strokeWidth={1.8} />
          </button>
          <div className="workspace__titles">
            <div className="workspace__title truncate">{selectedChannel.name || 'Canal'}</div>
            <div className="workspace__subtitle">Cargando publicaciones…</div>
          </div>
        </header>

        <div className="workspace__body" onScroll={handleScrollPosts}>
          <div className="view-pad">
            <div className="row">
              <span className="muted" style={{ fontSize: 'var(--text-md)' }}>
                Recuperando publicaciones
              </span>
              <div className="spacer" />
              <span className="mono muted">
                {total > 0 ? `${count} / ${total}` : '—'}
              </span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => void cancelFetchPosts(selectedChannel.id)}
              >
                Cancelar
              </button>
            </div>

            <div className="progress" style={{ marginTop: 'var(--sp-2)' }}>
              <div
                className={`progress__fill${total > 0 ? '' : ' progress__fill--indeterminate'}`}
                style={total > 0 ? { width: `${percent}%` } : undefined}
              />
            </div>

            <div className="col" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton skeleton--card" />
              ))}
            </div>
          </div>
        </div>
      </>
    )
  }

  const forumCount = posts.filter((p) => p.thread.type === 15 || p.thread.type === 16).length
  const messageCount = posts.length - forumCount
  const totalAttach = posts.reduce((sum, p) => sum + (p.firstMessage?.attachments?.length || 0), 0)

  return (
    <>
      <header className="workspace__header">
        <button
          className="btn btn--ghost btn--icon"
          onClick={() => useBrowserStore.setState({ selectedChannel: null })}
          title="Volver"
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
        </button>

        <div className="workspace__titles">
          <div className="workspace__title truncate">
            {selectedChannel.name || 'Canal'}
          </div>
          <div className="workspace__subtitle">
            {forumCount} {forumCount === 1 ? 'publicación' : 'publicaciones'} · {messageCount}{' '}
            {messageCount === 1 ? 'mensaje' : 'mensajes'} · {totalAttach}{' '}
            {totalAttach === 1 ? 'adjunto' : 'adjuntos'}
          </div>
        </div>

        <div className="workspace__actions">
          <select
            className="select"
            style={{ width: 'auto', height: 30 }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            title="Ordenar"
          >
            <option value="date">Por fecha</option>
            <option value="replies">Por respuestas</option>
            <option value="attachments">Por adjuntos</option>
            <option value="name">Por nombre</option>
          </select>

          {allTags.length > 0 && (
            <button
              className={`btn btn--sm${groupByTag ? '' : ' btn--ghost'}`}
              onClick={() => setGroupByTag((v) => !v)}
              title="Agrupar por tag"
            >
              <Tag size={14} strokeWidth={1.8} />
              Agrupar
            </button>
          )}
        </div>
      </header>

      <div className="workspace__body" onScroll={handleScrollPosts}>
        <div className="view-pad--tight">
          <div className="row">
            <div className="search" style={{ flex: 1 }}>
              <Search size={14} strokeWidth={1.8} className="search__icon" />
              <input
                className="input input--search"
                placeholder="Buscar por título, autor o contenido"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              className="btn btn--ghost btn--sm"
              onClick={toggleSelectAllFiltered}
              disabled={filtered.length === 0}
              title={allFilteredSelected ? 'Quitar la selección' : 'Seleccionar los elementos filtrados'}
            >
              {allFilteredSelected ? 'Deseleccionar' : 'Seleccionar todos'}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={invertFilteredSelection}
              disabled={filtered.length === 0}
              title="Invertir la selección sobre los elementos filtrados"
            >
              Invertir
            </button>
          </div>

          {posts.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
              {(
                [
                  { key: 'all', label: 'Todos', count: quickCounts.all },
                  { key: 'cached', label: 'En archivo', count: quickCounts.cached },
                  { key: 'attachments', label: 'Con adjuntos', count: quickCounts.attachments },
                  { key: 'pinned', label: 'Fijados', count: quickCounts.pinned },
                  { key: 'archived', label: 'Archivados', count: quickCounts.archived }
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`chip${quickFilter === item.key ? ' chip--active' : ''}`}
                  onClick={() =>
                    setQuickFilter(item.key === 'all' ? 'all' : quickFilter === item.key ? 'all' : item.key)
                  }
                >
                  {item.label} <span className="mono">{item.count}</span>
                </button>
              ))}
            </div>
          )}

          {allTags.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
              <button
                className={`chip${tagFilter === null ? ' chip--active' : ''}`}
                onClick={() => setTagFilter(null)}
              >
                Todos <span className="mono">{posts.length}</span>
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag.id}
                  className={`chip${tagFilter === tag.id ? ' chip--active' : ''}`}
                  onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
                  onContextMenu={(e) => { e.preventDefault(); selectByTag(tag.id) }}
                  title="Click: filtrar · Click derecho: seleccionar todos"
                >
                  {tag.name} <span className="mono">{tag.count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="listmeta">
            <span>{filtered.length} de {posts.length} elementos</span>
            <div className="spacer" />
            <span className="mono">{selectedPosts.size} seleccionados</span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty">
              <div className="empty__icon">
                <Search size={20} strokeWidth={1.8} />
              </div>
              <div className="empty__title">
                {searchQuery || tagFilter || quickFilter !== 'all' ? 'Sin resultados' : 'Canal vacío'}
              </div>
              <div className="empty__text">
                {searchQuery || tagFilter || quickFilter !== 'all'
                  ? 'Ningún elemento coincide con la búsqueda o los filtros activos.'
                  : 'Este canal no tiene publicaciones para descargar.'}
              </div>
            </div>
          ) : (
            <>
              <div className="list">
                {visibleGroups.map((group) => (
                  <React.Fragment key={group.id}>
                    {groupByTag && visibleGroups.length > 1 && group.name && (
                      <div className="listmeta">
                        <span className="truncate">{group.name}</span>
                        <div className="spacer" />
                        <span className="mono">{group.items.length}</span>
                      </div>
                    )}
                    {group.items.map((post) => (
                      <PostRow
                        key={post.thread.id}
                        post={post}
                        selected={selectedPosts.has(post.thread.id)}
                        expanded={previewPost === post.thread.id}
                        cachedInfo={cachedMap.get(post.thread.id)}
                        onToggle={(e) => handlePostToggle(post.thread.id, e)}
                        onExpand={() => setPreviewPost(previewPost === post.thread.id ? null : post.thread.id)}
                        onRead={() => abrirHilo({
                          threadId: post.thread.id,
                          nombre: post.thread.name || 'Hilo',
                          canal: selectedChannel?.name || '',
                          servidor: selectedGuild?.name || ''
                        })}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </div>
              {renderedCount < filtered.length && (
                <div className="row" style={{ justifyContent: 'center', padding: 'var(--sp-3) 0' }}>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setVisibleCount((prev) => Math.min(filtered.length, prev + TAMANO_PAGINA_POSTS))}
                  >
                    Cargar más ({renderedCount} de {filtered.length})
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setVisibleCount(filtered.length)}
                  >
                    Mostrar todos
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedPosts.size > 0 && (
        <div className="actionbar">
          <button className="btn btn--primary" onClick={() => void handleDownload()}>
            <Download size={15} strokeWidth={1.8} />
            Descargar {selectedPosts.size} {selectedPosts.size === 1 ? 'elemento' : 'elementos'}
          </button>
          <button className="btn btn--ghost" onClick={() => void handleCopySelectedList()}>
            <Copy size={15} strokeWidth={1.8} />
            Copiar lista
          </button>
          <button className="btn btn--ghost" onClick={deselectAllPosts}>
            <X size={15} strokeWidth={1.8} />
            Limpiar selección
          </button>
          <div className="spacer" />
          <span className="mono muted truncate" style={{ maxWidth: 340, fontSize: 'var(--text-xs)' }} title={outputDir || undefined}>
            {outputDir || 'Sin carpeta de destino'}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => void pickDirectory()}>
            Cambiar
          </button>
        </div>
      )}
    </>
  )
}
