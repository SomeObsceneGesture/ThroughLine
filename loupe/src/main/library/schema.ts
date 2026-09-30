// Library database schema. Each entry is one migration step; append only.

export const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE imports (
    id          INTEGER PRIMARY KEY,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    mode        TEXT NOT NULL,
    sources     TEXT NOT NULL,
    added       INTEGER NOT NULL DEFAULT 0,
    duplicates  INTEGER NOT NULL DEFAULT 0,
    failed      INTEGER NOT NULL DEFAULT 0,
    cancelled   INTEGER NOT NULL DEFAULT 0
  );

  -- Directories that contain media. Paths inside the library are stored
  -- relative to the library root so the library survives drive-letter or
  -- mount-point changes; referenced folders are stored absolute.
  CREATE TABLE folders (
    id         INTEGER PRIMARY KEY,
    path       TEXT NOT NULL,
    in_library INTEGER NOT NULL DEFAULT 0,
    parent_id  INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    is_root    INTEGER NOT NULL DEFAULT 0,
    display    TEXT NOT NULL DEFAULT '',
    UNIQUE (in_library, path)
  );
  CREATE INDEX folders_parent ON folders(parent_id);

  CREATE TABLE media (
    id             INTEGER PRIMARY KEY,
    kind           INTEGER NOT NULL,            -- 1 photo, 2 video
    path           TEXT NOT NULL,
    in_library     INTEGER NOT NULL,
    folder_id      INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    filename       TEXT NOT NULL,
    ext            TEXT NOT NULL,
    size           INTEGER NOT NULL,
    mtime          INTEGER NOT NULL,
    taken_at       INTEGER,
    sort_date      INTEGER NOT NULL,
    year           INTEGER NOT NULL,
    month          INTEGER NOT NULL,
    added_at       INTEGER NOT NULL,
    import_id      INTEGER REFERENCES imports(id) ON DELETE SET NULL,
    width          INTEGER,
    height         INTEGER,
    duration       REAL,
    orientation    INTEGER,
    rotation       INTEGER NOT NULL DEFAULT 0,
    favorite       INTEGER NOT NULL DEFAULT 0,
    rating         INTEGER NOT NULL DEFAULT 0,
    quick_hash     TEXT,
    full_hash      TEXT,
    phash          TEXT,
    thumb_state    INTEGER NOT NULL DEFAULT 0,  -- 0 pending, 1 ready, 2 failed
    thumb_version  INTEGER NOT NULL DEFAULT 0,
    error          TEXT,
    metadata       TEXT,
    camera         TEXT,
    last_viewed_at INTEGER,
    deleted_at     INTEGER,
    missing        INTEGER NOT NULL DEFAULT 0,
    UNIQUE (in_library, path)
  );
  CREATE INDEX media_sort       ON media(deleted_at, sort_date DESC, id DESC);
  CREATE INDEX media_kind_sort  ON media(kind, deleted_at, sort_date DESC);
  CREATE INDEX media_added      ON media(added_at DESC);
  CREATE INDEX media_folder     ON media(folder_id);
  CREATE INDEX media_favorite   ON media(favorite) WHERE favorite = 1;
  CREATE INDEX media_viewed     ON media(last_viewed_at DESC) WHERE last_viewed_at IS NOT NULL;
  CREATE INDEX media_quick      ON media(size, quick_hash);
  CREATE INDEX media_full       ON media(full_hash) WHERE full_hash IS NOT NULL;
  CREATE INDEX media_pending    ON media(thumb_state) WHERE thumb_state = 0;
  CREATE INDEX media_yearmonth  ON media(year, month);
  CREATE INDEX media_import     ON media(import_id);
  CREATE INDEX media_deleted    ON media(deleted_at) WHERE deleted_at IS NOT NULL;

  CREATE TABLE albums (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
    sort_order     REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE album_items (
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position REAL NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (album_id, media_id)
  ) WITHOUT ROWID;
  CREATE INDEX album_items_pos   ON album_items(album_id, position);
  CREATE INDEX album_items_media ON album_items(media_id);

  CREATE TABLE tags (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE media_tags (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (media_id, tag_id)
  ) WITHOUT ROWID;
  CREATE INDEX media_tags_tag ON media_tags(tag_id, media_id);

  -- Groups of items the user said are not duplicates (or chose to keep).
  CREATE TABLE duplicate_ignores (
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  ) WITHOUT ROWID;

  -- Search index: filename, folder path, tags, albums, camera, date words.
  CREATE VIRTUAL TABLE media_fts USING fts5(text, tokenize = 'trigram remove_diacritics 1');
  `
]
