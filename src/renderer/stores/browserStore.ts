import { create } from 'zustand'
import type { DiscordChannel, DiscordGuild, ForumPost } from '../../core/discord/types'
import type { ChannelTypeFilters } from '../channelFilters'
import { showToast } from '../components/Toast'

type Guild = DiscordGuild & { isDM?: boolean }
type Channel = DiscordChannel

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
  postsProgressCount: number
  postsProgressTotal: number
  restrictedChannels: Set<string>
  searchQuery: string
  totalPosts: number
  channelSearchQuery: string
  channelTypeFilters: ChannelTypeFilters
  showStandardChannels: boolean

  fetchGuilds: () => Promise<void>
  fetchChannels: (guildId: string) => Promise<void>
  fetchPosts: (channelId: string) => Promise<void>
  cancelFetchPosts: (channelId: string) => Promise<void>
  selectGuild: (guild: Guild) => void
  selectChannel: (channel: Channel | null) => void
  togglePostSelection: (threadId: string) => void
  selectAllPosts: () => void
  deselectAllPosts: () => void
  setSearchQuery: (query: string) => void
  setShowStandardChannels: (val: boolean) => void
  setChannelSearchQuery: (query: string) => void
  setChannelTypeFilters: (filters: ChannelTypeFilters) => void
  setChannelTypeFilter: (key: keyof ChannelTypeFilters, enabled: boolean) => void
}

const LS_CHANNEL_SEARCH = 'channel_search_query'
const LS_TYPE_FILTERS = 'channel_type_filters'
const LS_SHOW_STANDARD = 'show_standard_channels'

function readChannelTypeFilters(): ChannelTypeFilters {
  const fallback: ChannelTypeFilters = {
    text: true,
    forum: true,
    voice: true,
    dm: true,
    thread: true,
    announcement: true,
    media: true,
    other: true
  }
  const raw = localStorage.getItem(LS_TYPE_FILTERS)
  if (!raw) return fallback
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<ChannelTypeFilters>) }
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
  selectedPosts: new Set<string>(),
  loadingGuilds: false,
  loadingChannels: false,
  loadingPosts: false,
  postsProgressCount: 0,
  postsProgressTotal: 0,
  restrictedChannels: new Set<string>(),
  searchQuery: '',
  totalPosts: 0,

  channelSearchQuery: localStorage.getItem(LS_CHANNEL_SEARCH) ?? '',
  channelTypeFilters: readChannelTypeFilters(),
  showStandardChannels: localStorage.getItem(LS_SHOW_STANDARD) !== 'false',

  setShowStandardChannels: (val) => {
    localStorage.setItem(LS_SHOW_STANDARD, String(val))
    set({ showStandardChannels: val })
    // El acceso a MD depende de este flag: recargamos la lista.
    void get().fetchGuilds()
  },

  setChannelSearchQuery: (query) => {
    localStorage.setItem(LS_CHANNEL_SEARCH, query)
    set({ channelSearchQuery: query })
  },

  setChannelTypeFilters: (filters) => {
    localStorage.setItem(LS_TYPE_FILTERS, JSON.stringify(filters))
    set({ channelTypeFilters: filters })
  },

  setChannelTypeFilter: (key, enabled) => {
    const next = { ...get().channelTypeFilters, [key]: enabled }
    localStorage.setItem(LS_TYPE_FILTERS, JSON.stringify(next))
    set({ channelTypeFilters: next })
  },

  fetchGuilds: async () => {
    set({ loadingGuilds: true })
    try {
      const guilds = await window.api.discord.getGuilds()
      const list: Guild[] = [...guilds]
      if (get().showStandardChannels) {
        list.unshift({ id: '@me', name: 'Mensajes Directos', icon: null, isDM: true })
      }
      set({ guilds: list, loadingGuilds: false })
    } catch (error) {
      console.error('Failed to fetch guilds:', error)
      set({ loadingGuilds: false })
    }
  },

  fetchChannels: async (guildId) => {
    set({
      loadingChannels: true,
      channels: [],
      posts: [],
      selectedChannel: null,
      selectedPosts: new Set<string>()
    })
    try {
      const channels = await window.api.discord.getChannels(guildId)
      set({ channels, loadingChannels: false })
    } catch (error) {
      console.error('Failed to fetch channels:', error)
      set({ loadingChannels: false })
    }
  },

  fetchPosts: async (channelId) => {
    set({
      loadingPosts: true,
      posts: [],
      selectedPosts: new Set<string>(),
      postsProgressCount: 0,
      postsProgressTotal: 0
    })

    const unsubscribe = window.api.discord.onForumPostsProgress((data) => {
      set({ postsProgressCount: data.count || 0, postsProgressTotal: data.total || 0 })
    })

    try {
      const posts = await window.api.discord.getAllForumPosts(channelId)
      set({
        posts,
        loadingPosts: false,
        totalPosts: posts.length,
        postsProgressCount: 0,
        postsProgressTotal: 0
      })
    } catch (error) {
      const message = (error as Error).message || ''
      if (message === 'cancelled') {
        set({ loadingPosts: false })
      } else if (message.includes('403') || message.toLowerCase().includes('access denied')) {
        set((state) => {
          const next = new Set(state.restrictedChannels)
          next.add(channelId)
          return { restrictedChannels: next, loadingPosts: false }
        })
      } else {
        showToast(`No se pudieron cargar las publicaciones: ${message}`, 'error')
        set({ loadingPosts: false })
      }
    } finally {
      unsubscribe()
    }
  },

  cancelFetchPosts: async (channelId) => {
    try {
      const result = await window.api.discord.cancelGetAllForumPosts(channelId)
      if (result.success) showToast('Carga cancelada', 'info')
    } catch (error) {
      console.warn('[store] cancelFetchPosts failed', error)
    } finally {
      set({ loadingPosts: false, postsProgressCount: 0, postsProgressTotal: 0 })
    }
  },

  selectGuild: (guild) => {
    set({ selectedGuild: guild })
    void get().fetchChannels(guild.id)

    if (guild.id && guild.id !== '@me') {
      void window.api.discord
        .getGuild(guild.id)
        .then((full) => {
          if (get().selectedGuild?.id === guild.id) {
            set({ selectedGuild: { ...guild, ...full } })
          }
        })
        .catch((error) => console.warn('[store] no se pudo cargar el gremio:', error))
    }
  },

  selectChannel: (channel) => {
    // Volver atrás (null) debe dejar la vista limpia y sin publicaciones
    // pendientes: si no, al reentrar aparecía la lista del canal anterior.
    if (!channel) {
      set({
        selectedChannel: null,
        posts: [],
        selectedPosts: new Set<string>(),
        loadingPosts: false,
        postsProgressCount: 0,
        postsProgressTotal: 0
      })
      return
    }
    set({ selectedChannel: channel, posts: [], selectedPosts: new Set<string>() })
    void get().fetchPosts(channel.id)
  },

  togglePostSelection: (threadId) => {
    set((state) => {
      const next = new Set(state.selectedPosts)
      if (next.has(threadId)) next.delete(threadId)
      else next.add(threadId)
      return { selectedPosts: next }
    })
  },

  selectAllPosts: () => {
    set((state) => ({ selectedPosts: new Set(state.posts.map((p) => p.thread.id)) }))
  },

  deselectAllPosts: () => {
    set({ selectedPosts: new Set<string>() })
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query })
  }
}))
