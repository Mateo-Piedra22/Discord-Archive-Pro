// ============================================================
// Migraciones SQLite — esquema de caché, cola e historial.
// Cada migración es idempotente y se aplica dentro de una
// transacción; `_meta.schema_version` es la fuente de verdad.
// ============================================================

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS cached_users (
        user_id         TEXT PRIMARY KEY,
        username        TEXT NOT NULL,
        global_name     TEXT,
        discriminator   TEXT,
        avatar          TEXT,
        cached_at       TEXT NOT NULL
      );

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
      -- Índices que faltaban para ordenar y filtrar sin table-scan.
      CREATE INDEX IF NOT EXISTS idx_posts_created ON cached_posts(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON cached_messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_posts_synced ON cached_posts(last_synced);

      INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '2');
    `
  },
  {
    version: 3,
    sql: `
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
      CREATE INDEX IF NOT EXISTS idx_download_history_completed ON download_history(completed_at DESC);

      INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '3');
    `
  },
  {
    version: 4,
    sql: `
      -- La migración v2 original creaba una tabla FTS5 con content='cached_messages'
      -- declarando columnas (author, content) que NO existen en la tabla origen, y
      -- indexaba content_hash en lugar del texto. Cualquier MATCH fallaba. No hay
      -- ninguna función de búsqueda en la app: se elimina por completo.
      DROP TRIGGER IF EXISTS search_index_ai;
      DROP TRIGGER IF EXISTS search_index_ad;
      DROP TRIGGER IF EXISTS search_index_au;
      DROP TABLE IF EXISTS search_index;

      INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '4');
    `
  }
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
