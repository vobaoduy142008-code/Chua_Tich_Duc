'use strict';

// ===================================================================
// Tích Đức — SQLite data layer
//   accounts            guest accounts (secret token, stored hashed)
//   profiles            appearance + display name (1:1 with accounts)
//   player_stats        current merit total (only written by the server)
//   merit_transactions  append-only ledger, UNIQUE(user_id, event_id)
//   player_presence     ephemeral online state (cleared on boot)
// ===================================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Rules = require('./public/js/shared/profile-rules');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, 'tich-duc.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const SCHEMA_VERSION = 1;

// -------------------------------------------------------------------
// Schema (v1)
// -------------------------------------------------------------------
const SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    token_hash    TEXT UNIQUE,              -- NULL only for unclaimed legacy profiles
    created_at    TEXT NOT NULL DEFAULT ${NOW},
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id           TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 64),
    gender       TEXT NOT NULL CHECK (gender IN ('male','female')),
    skin_color   TEXT NOT NULL,
    hair_color   TEXT NOT NULL,
    hair_style   TEXT NOT NULL,
    robe_color   TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT ${NOW},
    updated_at   TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    user_id      TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    merit_points INTEGER NOT NULL DEFAULT 0 CHECK (merit_points >= 0),
    updated_at   TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE IF NOT EXISTS merit_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('incense','meditation','wooden_fish','adjustment')),
    points_delta  INTEGER NOT NULL CHECK (points_delta <> 0),
    event_id      TEXT NOT NULL,            -- client/server generated, makes retries idempotent
    session_id    TEXT,                     -- groups meditation chunks
    created_at    TEXT NOT NULL DEFAULT ${NOW},
    UNIQUE (user_id, event_id)
  );
  CREATE INDEX IF NOT EXISTS idx_merit_tx_user_time ON merit_transactions(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_merit_tx_session ON merit_transactions(session_id);

  CREATE TABLE IF NOT EXISTS player_presence (
    user_id          TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    room_id          TEXT NOT NULL,
    position_x       REAL NOT NULL,
    position_y       REAL NOT NULL,
    facing_direction TEXT NOT NULL DEFAULT 'down',
    activity_state   TEXT NOT NULL DEFAULT 'idle',
    last_seen_at     TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_presence_room ON player_presence(room_id);
`;

function tableExists(name) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}
function nearest(list, hex) {
  const [r, g, b] = hexToRgb(hex);
  let best = list[0].value;
  let bestD = Infinity;
  for (const { value } of list) {
    const [r2, g2, b2] = hexToRgb(value);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) { bestD = d; best = value; }
  }
  return best;
}

/** Migrate the first prototype schema (no accounts, no event ids) to v1, keeping all data. */
function migrateLegacy() {
  console.log('[db] Migrating legacy schema → v1 (keeping existing profiles & merit)…');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      ALTER TABLE profiles RENAME TO legacy_profiles;
      ALTER TABLE player_stats RENAME TO legacy_player_stats;
      ALTER TABLE merit_transactions RENAME TO legacy_merit_transactions;
      DROP TABLE IF EXISTS player_presence;
    `);
    db.exec(SCHEMA_V1);

    const insAcc = db.prepare(`INSERT INTO accounts (id, token_hash, created_at) VALUES (?, NULL, ?)`);
    const insProf = db.prepare(`INSERT INTO profiles (id, display_name, gender, skin_color, hair_color, hair_style, robe_color, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insStats = db.prepare(`INSERT INTO player_stats (user_id, merit_points) VALUES (?, ?)`);
    const iso = (t) => (t ? new Date(String(t).replace(' ', 'T') + (String(t).endsWith('Z') ? '' : 'Z')).toISOString() : new Date().toISOString());

    for (const p of db.prepare(`SELECT * FROM legacy_profiles`).all()) {
      const gender = p.gender === 'female' ? 'female' : 'male';
      const name = Rules.cleanName(p.display_name).slice(0, 64) || 'Phật tử';
      insAcc.run(p.id, iso(p.created_at));
      insProf.run(
        p.id, name.length >= 2 ? name : name + '.', gender,
        nearest(Rules.SKIN_COLORS, p.skin_color),
        nearest(Rules.HAIR_COLORS, p.hair_color),
        gender === 'female' ? 'long' : 'short',
        nearest(Rules.ROBE_COLORS, p.robe_color),
        iso(p.created_at), iso(p.updated_at),
      );
      const s = db.prepare(`SELECT merit_points FROM legacy_player_stats WHERE user_id = ?`).get(p.id);
      insStats.run(p.id, Math.max(0, (s && s.merit_points) || 0));
    }
    db.exec(`
      INSERT OR IGNORE INTO merit_transactions (user_id, activity_type, points_delta, event_id, session_id, created_at)
      SELECT t.user_id, t.activity_type, t.points_delta, 'legacy:' || t.id, t.session_id,
             strftime('%Y-%m-%dT%H:%M:%fZ', t.created_at)
      FROM legacy_merit_transactions t
      WHERE t.points_delta <> 0 AND t.user_id IN (SELECT id FROM profiles);
      DROP TABLE legacy_merit_transactions;
      DROP TABLE legacy_player_stats;
      DROP TABLE legacy_profiles;
    `);
  })();
  db.pragma('foreign_keys = ON');
  const n = db.prepare(`SELECT COUNT(*) AS n FROM profiles`).get().n;
  console.log(`[db] Migration done: ${n} profile(s) kept. They can be re-claimed once from their original browser.`);
}

(function migrate() {
  const version = db.pragma('user_version', { simple: true });
  if (version >= SCHEMA_VERSION) { db.exec(SCHEMA_V1); return; }
  if (tableExists('profiles') && !tableExists('accounts')) migrateLegacy();
  else db.exec(SCHEMA_V1);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
})();

// Presence is ephemeral: nobody is online right after a (re)start.
db.exec(`DELETE FROM player_presence`);
console.log('[db] SQLite ready at', DB_PATH);

// -------------------------------------------------------------------
// Tokens
// -------------------------------------------------------------------
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 160-bit random secret, base32 (Crockford) — also used as the player's recovery code. */
function generateToken() {
  const bytes = crypto.randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out; // 32 chars
}

function normalizeToken(token) {
  if (typeof token !== 'string') return '';
  return token.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

function hashToken(token) {
  return crypto.createHash('sha256').update('tich-duc:' + normalizeToken(token)).digest('hex');
}

// -------------------------------------------------------------------
// Prepared statements
// -------------------------------------------------------------------
const q = {
  insertAccount: db.prepare(`INSERT INTO accounts (id, token_hash, last_login_at) VALUES (?, ?, ${NOW})`),
  accountByHash: db.prepare(`SELECT id FROM accounts WHERE token_hash = ?`),
  touchAccount: db.prepare(`UPDATE accounts SET last_login_at = ${NOW} WHERE id = ?`),
  claimLegacy: db.prepare(`UPDATE accounts SET token_hash = ?, last_login_at = ${NOW} WHERE id = ? AND token_hash IS NULL`),

  insertProfile: db.prepare(`INSERT INTO profiles (id, display_name, gender, skin_color, hair_color, hair_style, robe_color)
                             VALUES (@id, @display_name, @gender, @skin_color, @hair_color, @hair_style, @robe_color)`),
  updateProfile: db.prepare(`UPDATE profiles SET display_name=@display_name, gender=@gender, skin_color=@skin_color,
                               hair_color=@hair_color, hair_style=@hair_style, robe_color=@robe_color, updated_at=${NOW}
                             WHERE id=@id`),
  getProfile: db.prepare(`SELECT p.id, p.display_name, p.gender, p.skin_color, p.hair_color, p.hair_style, p.robe_color,
                                 p.created_at, p.updated_at, COALESCE(s.merit_points, 0) AS merit_points
                          FROM profiles p LEFT JOIN player_stats s ON s.user_id = p.id WHERE p.id = ?`),

  insertStats: db.prepare(`INSERT INTO player_stats (user_id, merit_points) VALUES (?, 0)`),
  getMerit: db.prepare(`SELECT merit_points FROM player_stats WHERE user_id = ?`),
  addMerit: db.prepare(`UPDATE player_stats SET merit_points = merit_points + ?, updated_at = ${NOW} WHERE user_id = ?`),
  insertTx: db.prepare(`INSERT OR IGNORE INTO merit_transactions (user_id, activity_type, points_delta, event_id, session_id)
                        VALUES (?, ?, ?, ?, ?)`),
  findTx: db.prepare(`SELECT points_delta FROM merit_transactions WHERE user_id = ? AND event_id = ?`),

  upsertPresence: db.prepare(`
    INSERT INTO player_presence (user_id, room_id, position_x, position_y, facing_direction, activity_state, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ${NOW})
    ON CONFLICT(user_id) DO UPDATE SET room_id=excluded.room_id, position_x=excluded.position_x,
      position_y=excluded.position_y, facing_direction=excluded.facing_direction,
      activity_state=excluded.activity_state, last_seen_at=excluded.last_seen_at`),
  deletePresence: db.prepare(`DELETE FROM player_presence WHERE user_id = ?`),
};

// -------------------------------------------------------------------
// API
// -------------------------------------------------------------------

/** Create account + profile + stats atomically. Returns { token, profile }. */
const createPlayer = db.transaction((id, profile) => {
  const token = generateToken();
  q.insertAccount.run(id, hashToken(token));
  q.insertProfile.run({ id, ...profile });
  q.insertStats.run(id);
  return { token, profile: q.getProfile.get(id) };
});

function userIdForToken(token) {
  const norm = normalizeToken(token);
  if (norm.length < 20) return null;
  const row = q.accountByHash.get(hashToken(norm));
  return row ? row.id : null;
}

/** One-time claim of a profile created before accounts existed. */
function claimLegacyProfile(userId) {
  const token = generateToken();
  const info = q.claimLegacy.run(hashToken(token), userId);
  return info.changes === 1 ? token : null;
}

function getProfile(id) {
  return q.getProfile.get(id) || null;
}

function updateProfile(id, profile) {
  q.updateProfile.run({ id, ...profile });
  return q.getProfile.get(id);
}

/**
 * Award merit idempotently. The ledger row and the total are written in one
 * transaction; replaying the same eventId returns { duplicate: true } and the
 * unchanged total.
 */
const awardMerit = db.transaction((userId, activityType, delta, eventId, sessionId) => {
  const info = q.insertTx.run(userId, activityType, delta, eventId, sessionId || null);
  if (info.changes === 0) {
    const row = q.getMerit.get(userId);
    return { duplicate: true, total: row ? row.merit_points : 0 };
  }
  q.addMerit.run(delta, userId);
  return { duplicate: false, total: q.getMerit.get(userId).merit_points };
});

function getMerit(userId) {
  const row = q.getMerit.get(userId);
  return row ? row.merit_points : 0;
}

function transactionFor(userId, eventId) {
  return q.findTx.get(userId, eventId) || null;
}

module.exports = {
  db,
  createPlayer,
  userIdForToken,
  claimLegacyProfile,
  touchAccount: (id) => q.touchAccount.run(id),
  getProfile,
  updateProfile,
  awardMerit,
  getMerit,
  transactionFor,
  upsertPresence: (u, room, x, y, dir, act) => q.upsertPresence.run(u, room, x, y, dir, act),
  deletePresence: (u) => q.deletePresence.run(u),
  normalizeToken,
};
