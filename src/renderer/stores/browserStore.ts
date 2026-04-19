import { create } from 'zustand'

import type { ChannelTypeFilters } from '../channelFilters'

interface Guild {
  id: string
  name: string
  icon: string | null
  owner?: boolean
  approximate_member_count?: number
  premium_tier?: number
}

interface Channel {
  id: string
  name: string
  type: number
  topic?: string | null
  parent_id?: string | null
  position?: number
  available_tags?: { id: string; name: string; emoji_name: string | null }[]
  recipients?: { id: string; username: string; global_name: string | null; avatar: string | null }[]
}

interface ForumPost {
  thread: {
    id: string
    name: string
    type: number
    owner_id: string
    message_count: number
    created_timestamp: string
    last_message_id: string | null
    applied_tags: string[]
    thread_metadata: { archived: boolean; locked: boolean; create_timestamp?: string }
  }
  firstMessage: {
    id: string
    content: string
    author: { id: string; username: string; global_name: string | null; avatar: string | null }
    timestamp: string
    attachments: { id: string; filename: string; content_type?: string; size: number }[]
    reactions?: { count: number; emoji: { name: string | null; id: string | null } }[]
  } | null
  tags: { id: string; name: string }[]
  replyCount: number
}

interface BrowserState {
  guilds: Guild[]
  channels: Channel[]
  posts: ForumPost[]
  selectedGuild: Guild | null
  selectedChannel: Channel | null
  selectedPosts: Set<string>
  loadingGuilds: boolean
  loadingChannels: boolean
  loadingPosts: boolean
  restrictedChannels: Set<string>
  searchQuery: string
  totalPosts: number

  channelSearchQuery: string
  channelTypeFilters: ChannelTypeFilters

  fetchGuilds: () => Promise<void>
  fetchChannels: (guildId: string) => Promise<void>
  fetchPosts: (channelId: string) => Promise<void>
  selectGuild: (guild: Guild) => void
  selectChannel: (channel: Channel) => void
  togglePostSelection: (threadId: string) => void
  selectAllPosts: () => void
  deselectAllPosts: () => void
  setSearchQuery: (query: string) => void
  showStandardChannels: boolean
  setShowStandardChannels: (val: boolean) => void

  setChannelSearchQuery: (query: string) => void
  setChannelTypeFilters: (filters: ChannelTypeFilters) => void
  setChannelTypeFilter: (key: keyof ChannelTypeFilters, enabled: boolean) => void
}

const LS_KEY_CHANNEL_SEARCH_QUERY = 'channel_search_query'
const LS_KEY_CHANNEL_TYPE_FILTERS = 'channel_type_filters'

function readChannelTypeFilters(): ChannelTypeFilters {
  const fallback: ChannelTypeFilters = {
    text: true,
    forum: true,
    voice: true,
    dm: true,
    thread: true,
    announcement: true,
    media: true,
    other: true,
  }

  const raw = localStorage.getItem(LS_KEY_CHANNEL_TYPE_FILTERS)
  if (!raw) return fallback

  try {
    const parsed = JSON.parse(raw) as Partial<ChannelTypeFilters>
    return { ...fallback, ...parsed }
  } catch {
    return fallback
  }
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  guilds: [],
  channels: [],
  posts: [],
  selectedGuild: null,
  selectedChannel: null,
  selectedPosts: new Set(),
  loadingGuilds: false,
  loadingChannels: false,
  loadingPosts: false,
  restrictedChannels: new Set<string>(),
  searchQuery: '',
  totalPosts: 0,

  channelSearchQuery: localStorage.getItem(LS_KEY_CHANNEL_SEARCH_QUERY) ?? '',
  channelTypeFilters: readChannelTypeFilters(),
  showStandardChannels: localStorage.getItem('show_standard_channels') !== 'false',

  setShowStandardChannels: (val: boolean) => {
    localStorage.setItem('show_standard_channels', String(val))
    set({ showStandardChannels: val })
  },

  setChannelSearchQuery: (query: string) => {
    localStorage.setItem(LS_KEY_CHANNEL_SEARCH_QUERY, query)
    set({ channelSearchQuery: query })
  },

  setChannelTypeFilters: (filters: ChannelTypeFilters) => {
    localStorage.setItem(LS_KEY_CHANNEL_TYPE_FILTERS, JSON.stringify(filters))
    set({ channelTypeFilters: filters })
  },

  setChannelTypeFilter: (key: keyof ChannelTypeFilters, enabled: boolean) => {
    const next: ChannelTypeFilters = { ...get().channelTypeFilters, [key]: enabled }
    localStorage.setItem(LS_KEY_CHANNEL_TYPE_FILTERS, JSON.stringify(next))
    set({ channelTypeFilters: next })
  },

  fetchGuilds: async () => {
    set({ loadingGuilds: true })
    try {
      const guilds = await window.api.discord.getGuilds()
      if (get().showStandardChannels) {
        guilds.unshift({ id: '@me', name: 'Mensajes Directos', icon: null })
      }
      set({ guilds, loadingGuilds: false })
    } catch (error) {
      console.error('Failed to fetch guilds:', error)
      set({ loadingGuilds: false })
    }
  },

  fetchChannels: async (guildId: string) => {
    set({ loadingChannels: true, channels: [], posts: [], selectedChannel: null, selectedPosts: new Set() })
    try {
      const channels = await window.api.discord.getChannels(guildId)
      set({ channels, loadingChannels: false })
    } catch (error) {
      console.error('Failed to fetch channels:', error)
      set({ loadingChannels: false })
    }
  },

  fetchPosts: async (channelId: string) => {
    set({ loadingPosts: true, posts: [], selectedPosts: new Set() })
    try {
      const posts = await window.api.discord.getAllForumPosts(channelId)
      set({ posts, loadingPosts: false, totalPosts: posts.length })
    } catch (error: any) {
      console.error('Failed to fetch posts:', error)
      if (error.message?.includes('403') || error.message?.toLowerCase().includes('access denied')) {
        set(state => {
          const next = new Set(state.restrictedChannels)
          next.add(channelId)
          return { restrictedChannels: next, loadingPosts: false }
        })
      } else {
        set({ loadingPosts: false })
      }
    }
  },

  selectGuild: async (guild: Guild) => {
    set({ selectedGuild: guild })
    get().fetchChannels(guild.id)
    
    // Fetch full guild with counts if it's a real guild
    if (guild.id && guild.id !== '@me') {
      try {
        const full: any = await window.api.discord.getGuild(guild.id)
        if (full && get().selectedGuild?.id === guild.id) {
          set({ selectedGuild: { ...guild, ...full } })
        }
      } catch (err) {
        console.warn('[Store] Failed to fetch full guild info:', err)
      }
    }
  },

  selectChannel: (channel: Channel) => {
    set({ selectedChannel: channel })
    get().fetchPosts(channel.id)
  },

  togglePostSelection: (threadId: string) => {
    set((state) => {
      const next = new Set(state.selectedPosts)
      if (next.has(threadId)) next.delete(threadId)
      else next.add(threadId)
      return { selectedPosts: next }
    })
  },

  selectAllPosts: () => {
    set((state) => ({
      selectedPosts: new Set(state.posts.map(p => p.thread.id))
    }))
  },

  deselectAllPosts: () => {
    set({ selectedPosts: new Set() })
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
  }
}))
