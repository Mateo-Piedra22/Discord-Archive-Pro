// ============================================================
// Endpoints de la API de Discord — todos los endpoints REST necesarios
// para navegar foros, obtener hilos y descargar recursos.
// ============================================================

const BASE = 'https://discord.com/api/v10'

export const ENDPOINTS = {
  // Usuario
  CURRENT_USER: `${BASE}/users/@me`,
  USER_CHANNELS: `${BASE}/users/@me/channels`,
  USER: (userId: string) => `${BASE}/users/${userId}`,

  // Servidores
  GUILDS: `${BASE}/users/@me/guilds`,
  GUILD: (guildId: string) => `${BASE}/guilds/${guildId}`,
  GUILD_CHANNELS: (guildId: string) => `${BASE}/guilds/${guildId}/channels`,
  GUILD_ROLES: (guildId: string) => `${BASE}/guilds/${guildId}/roles`,

  // Canales
  CHANNEL: (channelId: string) => `${BASE}/channels/${channelId}`,

  // Hilos (posts de foro)
  THREAD_SEARCH: (channelId: string) => `${BASE}/channels/${channelId}/threads/search`,
  ACTIVE_THREADS: (guildId: string) => `${BASE}/guilds/${guildId}/threads/active`,
  ARCHIVED_PUBLIC_THREADS: (channelId: string) => `${BASE}/channels/${channelId}/threads/archived/public`,

  // Mensajes
  CHANNEL_MESSAGES: (channelId: string) => `${BASE}/channels/${channelId}/messages`,

  // Recursos
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
