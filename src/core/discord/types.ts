// ============================================================
// Discord API Types — Complete type definitions for all Discord
// forum-related structures. No mocks, real API shapes.
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
  owner_id: string
  member_count?: number
}

export interface DiscordChannel {
  id: string
  type: ChannelType
  guild_id?: string
  name?: string
  topic?: string
  parent_id?: string | null
  last_message_id?: string | null
  available_tags?: ForumTag[]
  default_sort_order?: number | null
  default_forum_layout?: number | null
  message_count?: number
  total_message_sent?: number
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

export interface ForumTag {
  id: string
  name: string
  moderated: boolean
  emoji_id: string | null
  emoji_name: string | null
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
  tts: boolean
  mention_everyone: boolean
  mentions: DiscordUser[]
  mention_roles: string[]
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
  count_details: { burst: number; normal: number }
  me: boolean
  me_burst: boolean
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

// ----- API Response types -----

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

// ----- App-level types -----

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
  errorMessage?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  retryCount: number
}

export type DownloadStatus = 'queued' | 'downloading' | 'processing' | 'exporting' | 'done' | 'error' | 'cancelled' | 'paused'

export interface DownloadProgress {
  phase: 'fetching' | 'downloading_assets' | 'exporting' | 'done'
  messagesTotal: number
  messagesFetched: number
  assetsTotal: number
  assetsDownloaded: number
  bytesTotal: number
  bytesDownloaded: number
  currentFile?: string
  speed: number // bytes per second
  eta: number   // seconds remaining
}

export interface ExportOptions {
  formats: ExportFormat[]
  outputDir: string
  folderStructure: 'by-server' | 'flat' | 'by-date' | 'custom'
  namingPattern: string // e.g. '{num}_{date}_{title}'
  imageQuality: 'original' | 'compressed'
  includeToc: boolean
  threadMode: 'single' | 'separate' | 'both'
  maxFilenameLength: number
  includeAvatars: boolean
  includeStickers: boolean
  includeCustomEmojis: boolean
}

export type ExportFormat = 'markdown' | 'html' | 'json' | 'pdf' | 'epub'

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
  download_path: string
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

// ----- IPC Channel types -----

export interface IpcChannels {
  // Auth
  'auth:set-token': (token: string) => Promise<boolean>
  'auth:get-token': () => Promise<string | null>
  'auth:validate': () => Promise<DiscordUser | null>
  'auth:clear': () => Promise<void>

  // Discord browsing
  'discord:get-guilds': () => Promise<DiscordGuild[]>
  'discord:get-channels': (guildId: string) => Promise<DiscordChannel[]>
  'discord:get-forum-threads': (channelId: string, offset?: number) => Promise<ThreadSearchResponse>
  'discord:get-archived-threads': (channelId: string, before?: string) => Promise<ArchivedThreadsResponse>
  'discord:get-thread-messages': (threadId: string, before?: string) => Promise<DiscordMessage[]>
  'discord:get-user': (userId: string) => Promise<DiscordUser>
  'discord:get-roles': (guildId: string) => Promise<DiscordRole[]>

  // Downloads
  'download:start': (tasks: DownloadTask[]) => Promise<void>
  'download:pause': (taskId: string) => Promise<void>
  'download:resume': (taskId: string) => Promise<void>
  'download:cancel': (taskId: string) => Promise<void>
  'download:pause-all': () => Promise<void>
  'download:resume-all': () => Promise<void>
  'download:get-queue': () => Promise<DownloadTask[]>

  // Export
  'export:set-options': (options: ExportOptions) => Promise<void>
  'export:get-options': () => Promise<ExportOptions>
  'export:pick-directory': () => Promise<string | null>

  // Cache
  'cache:check-post': (threadId: string) => Promise<CachedPostRecord | null>
  'cache:get-outdated': (channelId: string) => Promise<string[]>
  'cache:clear': (threadId?: string) => Promise<void>

  // Window
  'window:minimize': () => void
  'window:toggle-compact': () => void
  'window:close': () => void
}
