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
  topic?: string | null
  recipients?: BrowseChannelRecipient[]
  available_tags?: BrowseChannelTag[]
  member_count?: number
}

export type ChannelNameMap = ReadonlyMap<string, string> | Record<string, string>

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

export function foldChannelText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function getDisplayName(channel: BrowseChannel, names?: ChannelNameMap): string {
  if (names) {
    let mapped: string | undefined
    if (names instanceof Map) {
      mapped = names.get(channel.id)
    } else if (
      typeof (names as ReadonlyMap<string, string>).get === 'function' &&
      !Object.prototype.hasOwnProperty.call(names, 'get')
    ) {
      mapped = (names as ReadonlyMap<string, string>).get(channel.id)
    } else if (Object.prototype.hasOwnProperty.call(names, channel.id)) {
      mapped = (names as Record<string, string>)[channel.id]
    }
    if (typeof mapped === 'string' && mapped.trim().length > 0) {
      return mapped
    }
  }

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

export function filterBrowseChannels<T extends BrowseChannel>(
  channels: T[],
  filters: ChannelBrowseFilters
): T[] {
  const typeFilters = typeFiltersWithDefaults(filters.typeFilters)
  const q = foldChannelText(filters.query).trim()

  const categories = channels.filter(c => c.type === 4)
  const nonCategories = channels.filter(c => c.type !== 4)
  const categoryNameById = new Map<string, string>()
  for (const cat of categories) {
    categoryNameById.set(cat.id, cat.name ?? '')
  }

  const visible = nonCategories.filter(ch => {
    // 1. Comprobar si está restringido explícitamente (recibimos un 403 antes)
    if (filters.restrictedChannels?.has(ch.id)) return false

    // 2. Strict Privacy Mode (opt-in): sólo oculta tickets cerrados, es decir
    //    "ticket-<dígitos>". No adivinamos por nombre (admin, staff, test…):
    //    ocultar canales legítimos hacía que la app pareciera rota.
    if (filters.strictPrivacy && q.length === 0) {
      const normalizedName = ch.name ? foldChannelText(ch.name).trim() : ''
      if (/^ticket-\d+$/.test(normalizedName)) return false
    }

    if (!filters.showStandardChannels && isStandardChannelType(ch.type)) return false

    const key = typeKeyForChannel(ch)
    if (!typeFilters[key]) return false

    if (ch.type === 16 && !typeFilters.media) return false

    if (q.length > 0) {
      const parentName = ch.parent_id ? (categoryNameById.get(ch.parent_id) ?? '') : ''
      const tagNames = ch.available_tags?.map(t => t.name) ?? []
      const matches = [
        getDisplayName(ch),
        parentName,
        ch.topic ?? '',
        ...tagNames,
      ].some(candidate => foldChannelText(candidate).includes(q))
      if (!matches) return false
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

export function sortBrowseChannels<T extends BrowseChannel>(
  channels: T[],
  mode: 'position' | 'name',
  names?: ChannelNameMap
): T[] {
  const sorted = [...channels]
  if (mode === 'position') {
    return sorted.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }
  return sorted.sort((a, b) => {
    const nameA = getDisplayName(a, names)
    const nameB = getDisplayName(b, names)
    const foldedCompare = foldChannelText(nameA).localeCompare(foldChannelText(nameB), 'es')
    return foldedCompare !== 0 ? foldedCompare : nameA.localeCompare(nameB, 'es')
  })
}
