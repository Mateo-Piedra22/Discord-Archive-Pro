// ============================================================
// SQLite Database Migrations — Schema for cache, downloads,
// and file tracking. Runs on app startup.
// ============================================================

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      -- Meta table for schema versioning
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Cached forum posts/threads
      CREATE TABLE IF NOT EXISTS cached_posts (
        thread_id       TEXT PRIMARY KEY,
        guild_id        TEXT NOT NULL,
        channel_id      TEXT NOT NULL,
        title           TEXT,
        author_id       TEXT,
        created_at      TEXT,
        last_message_id TEXT,
        message_count   INTEGER DEFAULT 0,
        content_hash    TEXT NOT NULL,
        metadata_hash   TEXT NOT NULL,
        first_synced    TEXT NOT NULL,
        last_synced     TEXT NOT NULL,
        last_checked    TEXT NOT NULL,
        sync_status     TEXT DEFAULT 'synced',
        download_path   TEXT,
        file_count      INTEGER DEFAULT 0,
        total_size      INTEGER DEFAULT 0
      );

      -- Individual messages within threads
      CREATE TABLE IF NOT EXISTS cached_messages (
        message_id      TEXT PRIMARY KEY,
        thread_id       TEXT NOT NULL,
        author_id       TEXT,
        content_hash    TEXT NOT NULL,
        attachment_hash TEXT,
        edited_at       TEXT,
        created_at      TEXT,
        last_synced     TEXT NOT NULL,
        sync_status     TEXT DEFAULT 'synced'
      );

      -- Downloaded files tracking
      CREATE TABLE IF NOT EXISTS cached_files (
        file_id         TEXT PRIMARY KEY,
        message_id      TEXT,
        original_url    TEXT NOT NULL,
        local_path      TEXT NOT NULL,
        file_hash       TEXT NOT NULL,
        file_size       INTEGER,
        mime_type       TEXT,
        filename        TEXT,
        downloaded_at   TEXT NOT NULL,
        still_valid     INTEGER DEFAULT 1
      );

      -- Persistent download queue
      CREATE TABLE IF NOT EXISTS download_queue (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id       TEXT NOT NULL,
        guild_id        TEXT NOT NULL,
        channel_id      TEXT NOT NULL,
        guild_name      TEXT,
        channel_name    TEXT,
        thread_name     TEXT,
        priority        INTEGER DEFAULT 0,
        status          TEXT DEFAULT 'queued',
        error_message   TEXT,
        created_at      TEXT NOT NULL,
        started_at      TEXT,
        completed_at    TEXT,
        retry_count     INTEGER DEFAULT 0,
        export_options  TEXT
      );

      -- User cache for mention resolution
      CREATE TABLE IF NOT EXISTS cached_users (
        user_id         TEXT PRIMARY KEY,
        username        TEXT NOT NULL,
        global_name     TEXT,
        discriminator   TEXT,
        avatar          TEXT,
        cached_at       TEXT NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_posts_guild ON cached_posts(guild_id);
      CREATE INDEX IF NOT EXISTS idx_posts_channel ON cached_posts(channel_id);
      CREATE INDEX IF NOT EXISTS idx_posts_status ON cached_posts(sync_status);
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON cached_messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_files_message ON cached_files(message_id);
      CREATE INDEX IF NOT EXISTS idx_queue_status ON download_queue(status);
      CREATE INDEX IF NOT EXISTS idx_files_hash ON cached_files(file_hash);

      INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '1');
    `
  },
  {
    version: 2,
    sql: `
      -- FTS5 Virtual Table for offline full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        thread_id,
        message_id,
        author,
        content,
        content='cached_messages',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS index updated automatically
      CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON cached_messages BEGIN
        INSERT INTO search_index(rowid, thread_id, message_id, author, content) 
        VALUES (new.rowid, new.thread_id, new.message_id, new.author_id, new.content_hash);
      END;

      CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON cached_messages BEGIN
        INSERT INTO search_index(search_index, rowid, thread_id, message_id, author, content) 
        VALUES('delete', old.rowid, old.thread_id, old.message_id, old.author_id, old.content_hash);
      END;

      CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON cached_messages BEGIN
        INSERT INTO search_index(search_index, rowid, thread_id, message_id, author, content) 
        VALUES('delete', old.rowid, old.thread_id, old.message_id, old.author_id, old.content_hash);
        INSERT INTO search_index(rowid, thread_id, message_id, author, content) 
        VALUES (new.rowid, new.thread_id, new.message_id, new.author_id, new.content_hash);
      END;

      INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '2');
    `
  }
  ,
  {
    version: 3,
    sql: `
      -- Download history for auditing and analytics
      -- NOTE: migration v3 adds a compact history table to record summaries
      -- of each queue export. This keeps the heavy queue separate from
      -- audit logs and enables renderer history views without touching the
      -- export files on disk.
      CREATE TABLE IF NOT EXISTS download_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue_id INTEGER,
        thread_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        guild_name TEXT,
        channel_name TEXT,
        thread_name TEXT,
        status TEXT NOT NULL,
        files_count INTEGER DEFAULT 0,
        total_bytes INTEGER DEFAULT 0,
        download_path TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_download_history_thread ON download_history(thread_id);
      CREATE INDEX IF NOT EXISTS idx_download_history_status ON download_history(status);

      INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '3');
    `
  }
]
