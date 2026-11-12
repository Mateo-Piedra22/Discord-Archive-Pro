export interface BrowseChannelRecipient {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
}

export interface BrowseChannelTag {
  id: string
  name: string
  emoji_name?: string | null
}

export interface BrowseChannel {
  id: string
  name?: string
  type: number
  position?: number
  parent_id?: string | null
  recipients?: BrowseChannelRecipient[]
  available_tags?: BrowseChannelTag[]
  member_count?: number
}

export type ChannelTypeFilterKey =
  | 'text'
  | 'forum'
  | 'voice'
  | 'dm'
  | 'thread'
  | 'announcement'
  | 'media'
  | 'other'

export type ChannelTypeFilters = Record<ChannelTypeFilterKey, boolean>

export interface ChannelBrowseFilters {
  query: string
  typeFilters: ChannelTypeFilters
  showStandardChannels: boolean
  restrictedChannels?: Set<string>
  strictPrivacy?: boolean
}

const DEFAULT_TYPE_FILTERS: ChannelTypeFilters = {
  text: true,
  forum: true,
  voice: true,
  dm: true,
  thread: true,
  announcement: true,
  media: true,
  other: true,
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

function getDisplayName(channel: BrowseChannel): string {
  if (channel.type === 1 || channel.type === 3) {
    if (channel.name && channel.name.trim().length > 0) return channel.name
    const rec = channel.recipients ?? []
    if (rec.length > 0) {
      return rec.map(u => u.global_name ?? u.username).join(', ')
    }
    return 'Chat privado'
  }

  return channel.name ?? ''
}

function typeKeyForChannel(channel: BrowseChannel): ChannelTypeFilterKey {
  switch (channel.type) {
    case 0:
      return 'text'
    case 2:
    case 13:
      return 'voice'
    case 5:
      return 'announcement'
    case 1:
    case 3:
      return 'dm'
    case 11:
    case 12:
      return 'thread'
    case 15:
    case 16:
      return 'forum'
    default:
      return 'other'
  }
}

function isStandardChannelType(type: number): boolean {
  return type === 0 || type === 2 || type === 5 || type === 13
}

function typeFiltersWithDefaults(filters: Partial<ChannelTypeFilters> | undefined): ChannelTypeFilters {
  return { ...DEFAULT_TYPE_FILTERS, ...(filters ?? {}) }
}

export function filterBrowseChannels(
  channels: BrowseChannel[],
  filters: ChannelBrowseFilters
): BrowseChannel[] {
  const typeFilters = typeFiltersWithDefaults(filters.typeFilters)
  const q = normalizeText(filters.query)

  const categories = channels.filter(c => c.type === 4)
  const nonCategories = channels.filter(c => c.type !== 4)

  const visible = nonCategories.filter(ch => {
    // 1. Comprobar si está restringido explícitamente (recibimos un 403 antes)
    if (filters.restrictedChannels?.has(ch.id)) return false

    // 2. Strict Privacy Mode (opt-in): sólo oculta tickets cerrados, es decir
    //    "ticket-<dígitos>". No adivinamos por nombre (admin, staff, test…):
    //    ocultar canales legítimos hacía que la app pareciera rota.
    if (filters.strictPrivacy && q.length === 0) {
      const normalizedName = ch.name ? normalizeText(ch.name) : ''
      if (/^ticket-\d+$/.test(normalizedName)) return false
    }

    if (!filters.showStandardChannels && isStandardChannelType(ch.type)) return false

    const key = typeKeyForChannel(ch)
    if (!typeFilters[key]) return false

    if (ch.type === 16 && !typeFilters.media) return false

    if (q.length > 0) {
      const name = normalizeText(getDisplayName(ch))
      if (!name.includes(q)) return false
    }

    return true
  })

  const neededCategoryIds = new Set<string>()
  for (const ch of visible) {
    const parentId = ch.parent_id
    if (typeof parentId === 'string' && parentId.length > 0) {
      neededCategoryIds.add(parentId)
    }
  }

  const keptCategories = categories.filter(c => neededCategoryIds.has(c.id))

  return [...keptCategories, ...visible]
}
