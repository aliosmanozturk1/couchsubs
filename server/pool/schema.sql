-- Subtitle pool: oyuncuların okuduğu, paketlerde olmayan İngilizce satırlar.
-- IP, kullanıcı adı ya da PSN bilgisi tutulmaz; yalnız rastgele kurulum kimliği.
CREATE TABLE IF NOT EXISTS lines (
  key TEXT PRIMARY KEY,          -- canon(text) SHA-256 ilk 16 hex
  text TEXT NOT NULL,            -- ilk gelen okuma
  installs INTEGER NOT NULL DEFAULT 0,  -- kaç farklı kurulum gördü
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  exported INTEGER NOT NULL DEFAULT 0,  -- çeviriye alındı mı
  title_id TEXT,                 -- PS5'te çalışan oyunun kimliği (ör. PPSA01234); eski sürümlerde ve bilinmezse NULL
  game TEXT                      -- PS5'in bildirdiği oyun adı; NULL olabilir
);
CREATE INDEX IF NOT EXISTS lines_installs ON lines(installs, exported);
-- Var olan veritabanında bu iki sütun ve dizin migrate-2026-11-14-game.sql ile eklenir.
CREATE INDEX IF NOT EXISTS lines_title ON lines(title_id, installs);

CREATE TABLE IF NOT EXISTS sightings (
  key TEXT NOT NULL,
  install TEXT NOT NULL,
  PRIMARY KEY (key, install)
);

-- Kimliksiz gelen oyun adı (uygulamanın paketten tanıdığı ya da kullanıcının seçtiği): kurulum başına bir oy.
-- Gece paketi (src/autopack.js) bir adı en az iki kurulum oyladıysa ayrı paket yapar. game_key: src/games.js gameKey.
CREATE TABLE IF NOT EXISTS game_votes (
  game_key TEXT NOT NULL,
  install TEXT NOT NULL,
  PRIMARY KEY (game_key, install)
);

CREATE TABLE IF NOT EXISTS quota (
  install TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install, day)
);
