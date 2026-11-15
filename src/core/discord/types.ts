// ============================================================
// Tipos de la API de Discord — Tipos reales de la API v10 usados por la app.
// ============================================================

export interface DiscordUser {
  id: string
  username: string
  discriminator: string
  global_name: string | null
  avatar: string | null
  bot?: boolean
}

export interface DiscordGuild {
  id: string
  name: string
  icon: string | null
  owner?: boolean
  owner_id?: string
  permissions?: string
  approximate_member_count?: number
  premium_tier?: number
}

export interface DiscordChannel {
  id: string
  type: ChannelType
  guild_id?: string
  name?: string
  topic?: string | null
  parent_id?: string | null
  position?: number
  last_message_id?: string | null
  available_tags?: ForumTag[]
  default_sort_order?: number | null
  default_forum_layout?: number | null
  message_count?: number
  total_message_sent?: number
  recipients?: DiscordUser[]
}

export enum ChannelType {
  GUILD_TEXT = 0,
  DM = 1,
  GUILD_VOICE = 2,
  GROUP_DM = 3,
  GUILD_CATEGORY = 4,
  GUILD_ANNOUNCEMENT = 5,
  ANNOUNCEMENT_THREAD = 10,
  PUBLIC_THREAD = 11,
  PRIVATE_THREAD = 12,
  GUILD_STAGE_VOICE = 13,
  GUILD_DIRECTORY = 14,
  GUILD_FORUM = 15,
  GUILD_MEDIA = 16
}

/** Canales de los que se puede extraer historial de mensajes. */
export const MESSAGE_CAPABLE_TYPES: ChannelType[] = [
  ChannelType.GUILD_TEXT,
  ChannelType.DM,
  ChannelType.GROUP_DM,
  ChannelType.GUILD_ANNOUNCEMENT,
  ChannelType.PUBLIC_THREAD,
  ChannelType.PRIVATE_THREAD,
  ChannelType.ANNOUNCEMENT_THREAD
]

/** Canales que se navegan como lista de posts (foros y media). */
export const FORUM_TYPES: ChannelType[] = [ChannelType.GUILD_FORUM, ChannelType.GUILD_MEDIA]

export function isMessageCapable(type: number): boolean {
  return MESSAGE_CAPABLE_TYPES.includes(type as ChannelType)
}

export function isForum(type: number): boolean {
  return FORUM_TYPES.includes(type as ChannelType)
}

export interface ForumTag {
  id: string
  name: string
  moderated?: boolean
  emoji_id?: string | null
  emoji_name?: string | null
}

export interface DiscordThread {
  id: string
  guild_id: string
  parent_id: string
  owner_id: string
  name: string
  type: ChannelType
  last_message_id: string | null
  message_count: number
  member_count: number
  total_message_sent: number
  applied_tags: string[]
  thread_metadata: ThreadMetadata
  created_timestamp: string
}

export interface ThreadMetadata {
  archived: boolean
  auto_archive_duration: number
  archive_timestamp: string
  locked: boolean
  invitable?: boolean
  create_timestamp?: string
}

export interface DiscordMessage {
  id: string
  channel_id: string
  author: DiscordUser
  content: string
  timestamp: string
  edited_timestamp: string | null
  tts?: boolean
  mention_everyone?: boolean
  mentions?: DiscordUser[]
  mention_roles?: string[]
  attachments: DiscordAttachment[]
  embeds: DiscordEmbed[]
  reactions?: DiscordReaction[]
  pinned: boolean
  type: MessageType
  flags?: number
  referenced_message?: DiscordMessage | null
  sticker_items?: StickerItem[]
  components?: MessageComponent[]
}

export enum MessageType {
  DEFAULT = 0,
  RECIPIENT_ADD = 1,
  RECIPIENT_REMOVE = 2,
  CALL = 3,
  CHANNEL_NAME_CHANGE = 4,
  CHANNEL_ICON_CHANGE = 5,
  CHANNEL_PINNED_MESSAGE = 6,
  USER_JOIN = 7,
  REPLY = 19,
  CHAT_INPUT_COMMAND = 20,
  THREAD_STARTER_MESSAGE = 21,
  GUILD_INVITE_REMINDER = 22
}

export interface DiscordAttachment {
  id: string
  filename: string
  description?: string
  content_type?: string
  size: number
  url: string
  proxy_url: string
  height?: number | null
  width?: number | null
  ephemeral?: boolean
}

export interface DiscordEmbed {
  title?: string
  type?: EmbedType
  description?: string
  url?: string
  timestamp?: string
  color?: number
  footer?: EmbedFooter
  image?: EmbedMedia
  thumbnail?: EmbedMedia
  video?: EmbedMedia
  provider?: EmbedProvider
  author?: EmbedAuthor
  fields?: EmbedField[]
}

export type EmbedType = 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link'

export interface EmbedFooter {
  text: string
  icon_url?: string
  proxy_icon_url?: string
}

export interface EmbedMedia {
  url: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface EmbedProvider {
  name?: string
  url?: string
}

export interface EmbedAuthor {
  name: string
  url?: string
  icon_url?: string
  proxy_icon_url?: string
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordReaction {
  count: number
  count_details?: { burst: number; normal: number }
  me?: boolean
  me_burst?: boolean
  emoji: ReactionEmoji
}

export interface ReactionEmoji {
  id: string | null
  name: string | null
  animated?: boolean
}

export interface StickerItem {
  id: string
  name: string
  format_type: number // 1=PNG, 2=APNG, 3=LOTTIE, 4=GIF
}

export interface MessageComponent {
  type: number
  components?: MessageComponent[]
  style?: number
  label?: string
  emoji?: ReactionEmoji
  custom_id?: string
  url?: string
  disabled?: boolean
}

export interface DiscordRole {
  id: string
  name: string
  color: number
  position: number
  permissions: string
}

// ----- Tipos de respuesta de la API -----

export interface ThreadListResponse {
  threads: DiscordThread[]
  members: unknown[]
  has_more: boolean
}

export interface ThreadSearchResponse {
  threads: DiscordThread[]
  members: unknown[]
  total_results: number
  has_more: boolean
  first_messages: DiscordMessage[]
}

export interface ArchivedThreadsResponse {
  threads: DiscordThread[]
  members: unknown[]
  has_more: boolean
}

// ----- Tipos a nivel de aplicación -----

export interface ForumPost {
  thread: DiscordThread
  firstMessage: DiscordMessage | null
  tags: ForumTag[]
  replyCount: number
}

export interface DownloadTask {
  id: string
  threadId: string
  guildId: string
  channelId: string
  guildName: string
  channelName: string
  threadName: string
  priority: number
  status: DownloadStatus
  progress: DownloadProgress
  downloadPath?: string
  errorMessage?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  retryCount: number
}

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'paused'

export interface DownloadProgress {
  phase: 'fetching' | 'downloading_assets' | 'exporting' | 'done'
  messagesTotal: number
  messagesFetched: number
  assetsTotal: number
  assetsDownloaded: number
  bytesTotal: number
  bytesDownloaded: number
  currentFile?: string
  speed: number // bytes por segundo
  eta: number   // segundos restantes
}

export interface ExportOptions {
  formats: ExportFormat[]
  outputDir: string
  folderStructure: 'by-server' | 'flat' | 'by-date'
  namingPattern: string
  includeToc: boolean
  threadMode: 'single' | 'separate' | 'both'
  maxFilenameLength: number
  includeAvatars: boolean
  includeStickers: boolean
  includeCustomEmojis: boolean
  /** Tamaño máximo por adjunto en bytes. 0 = sin límite. */
  maxFileSize: number
  /** Conservar el nombre original del adjunto en lugar de un hash. */
  preserveFilenames: boolean
  dateFormat: 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'YYYYMMDD'
  /** quick = salta si no hay cambios, force = reexporta siempre. */
  syncMode: 'quick' | 'force'
}

export type ExportFormat = 'markdown' | 'html' | 'json' | 'csv' | 'pdf' | 'epub'

export interface ContentSelection {
  text: boolean
  images: boolean
  videos: boolean
  files: boolean
  embeds: boolean
  replies: boolean
  metadata: boolean
  customEmojis: boolean
  stickers: boolean
  avatars: boolean
}

export interface CachedPostRecord {
  thread_id: string
  guild_id: string
  channel_id: string
  title: string
  author_id: string
  author_name?: string
  created_at: string
  last_message_id: string
  message_count: number
  content_hash: string
  metadata_hash: string
  first_synced: string
  last_synced: string
  last_checked: string
  sync_status: 'synced' | 'outdated' | 'deleted' | 'error'
  download_path: string | null
  file_count: number
  total_size: number
}

export interface CachedMessageRecord {
  message_id: string
  thread_id: string
  author_id: string
  content_hash: string
  attachment_hash: string | null
  edited_at: string | null
  created_at: string
  last_synced: string
  sync_status: 'synced' | 'edited' | 'deleted' | 'new'
}

export interface CachedFileRecord {
  file_id: string
  message_id: string
  original_url: string
  local_path: string
  file_hash: string
  file_size: number
  mime_type: string
  filename: string
  downloaded_at: string
  still_valid: boolean
}

/** Entrada de la cola persistente tal como vive en SQLite. */
export interface PersistedQueueItem {
  id: number
  thread_id: string
  guild_id: string
  channel_id: string
  guild_name: string | null
  channel_name: string | null
  thread_name: string | null
  priority: number
  status: string
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  retry_count: number
  export_options: string | null
}

export interface DownloadHistoryRecord {
  id: number
  queue_id: number | null
  thread_id: string
  guild_id: string
  channel_id: string
  guild_name: string | null
  channel_name: string | null
  thread_name: string | null
  status: string
  files_count: number
  total_bytes: number
  download_path: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
}
