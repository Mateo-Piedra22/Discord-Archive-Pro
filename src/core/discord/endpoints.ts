// ============================================================
// Discord API Endpoints — All REST endpoints needed for
// forum browsing, thread fetching, and asset downloads.
// ============================================================

const BASE = 'https://discord.com/api/v10'

export const ENDPOINTS = {
  // User
  CURRENT_USER: `${BASE}/users/@me`,
  USER_CHANNELS: `${BASE}/users/@me/channels`,
  USER: (userId: string) => `${BASE}/users/${userId}`,

  // Guilds
  GUILDS: `${BASE}/users/@me/guilds`,
  GUILD: (guildId: string) => `${BASE}/guilds/${guildId}`,
  GUILD_CHANNELS: (guildId: string) => `${BASE}/guilds/${guildId}/channels`,
  GUILD_ROLES: (guildId: string) => `${BASE}/guilds/${guildId}/roles`,

  // Channels
  CHANNEL: (channelId: string) => `${BASE}/channels/${channelId}`,

  // Threads (Forum posts)
  THREAD_SEARCH: (channelId: string) => `${BASE}/channels/${channelId}/threads/search`,
  ACTIVE_THREADS: (guildId: string) => `${BASE}/guilds/${guildId}/threads/active`,
  ARCHIVED_PUBLIC_THREADS: (channelId: string) => `${BASE}/channels/${channelId}/threads/archived/public`,

  // Messages
  CHANNEL_MESSAGES: (channelId: string) => `${BASE}/channels/${channelId}/messages`,

  // Assets
  GUILD_ICON: (guildId: string, hash: string) => `https://cdn.discordapp.com/icons/${guildId}/${hash}.png`,
  USER_AVATAR: (userId: string, hash: string) => `https://cdn.discordapp.com/avatars/${userId}/${hash}.png`,
  DEFAULT_AVATAR: (index: number) => `https://cdn.discordapp.com/embed/avatars/${index}.png`,
  CUSTOM_EMOJI: (emojiId: string, animated: boolean) =>
    `https://cdn.discordapp.com/emojis/${emojiId}.${animated ? 'gif' : 'png'}`,
  STICKER: (stickerId: string, format: 'png' | 'gif' | 'json') =>
    `https://media.discordapp.net/stickers/${stickerId}.${format}`
} as const

export const API_VERSION = 'v10'
export const BASE_URL = BASE
