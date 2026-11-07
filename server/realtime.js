'use strict';

// ===================================================================
// Realtime layer: rooms, presence, movement validation and every
// merit-earning activity. The browser only *asks*; this file decides.
// ===================================================================

const crypto = require('crypto');
const World = require('../public/js/shared/world');
const store = require('../db');

const { RULES } = World;
const AWAY_GRACE_MS = 15000;        // keep a disconnected avatar (faded) this long
const MED_FLUSH_EVERY_S = 10;       // write meditation points to the ledger every N seconds
const PRESENCE_WRITE_MS = 2000;
const MAX_MOVES_PER_SEC = 40;
const EVENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DIRS = ['up', 'down', 'left', 'right'];

/** userId -> PlayerState (online or in grace period) */
const players = new Map();
/** roomId -> [{ id, x, expiresAt }] incense sticks currently smoking in the burner */
const incenseByRoom = new Map();

let io = null;

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function publicPlayer(p) {
  return {
    id: p.userId,
    name: p.profile.display_name,
    gender: p.profile.gender,
    skin: p.profile.skin_color,
    hair: p.profile.hair_color,
    hairStyle: p.profile.hair_style,
    robe: p.profile.robe_color,
    x: Math.round(p.x),
    y: Math.round(p.y),
    dir: p.dir,
    moving: p.moving,
    activity: p.activity,
    fishId: p.fishId || null,
    away: !p.connected,
  };
}

function broadcastState(p, extra) {
  io.to(p.roomId).emit('player:state', {
    id: p.userId, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir,
    activity: p.activity, fishId: p.fishId || null, ...(extra || {}),
  });
  savePresence(p, true);
}

function savePresence(p, force) {
  const now = Date.now();
  if (!force && now - (p.lastPresenceWrite || 0) < PRESENCE_WRITE_MS) return;
  p.lastPresenceWrite = now;
  try {
    store.upsertPresence(p.userId, p.roomId, p.x, p.y, p.dir, p.activity);
  } catch (e) {
    console.error('[presence] write failed:', e.message);
  }
}

function setIdle(p) {
  clearTimeout(p.activityTimer);
  p.activityTimer = null;
  p.activity = 'idle';
  p.fishId = null;
  p.moving = false;
}

function validEventId(id) {
  return typeof id === 'string' && EVENT_ID_RE.test(id);
}

function fail(ack, code, message, retryInMs) {
  if (typeof ack === 'function') ack({ ok: false, code, message, retryInMs: retryInMs > 0 ? retryInMs : undefined });
}

function ok(ack, data) {
  if (typeof ack === 'function') ack({ ok: true, ...data });
}

function activeIncense(roomId) {
  const now = Date.now();
  const list = (incenseByRoom.get(roomId) || []).filter((s) => s.expiresAt > now);
  incenseByRoom.set(roomId, list);
  return list;
}

// -------------------------------------------------------------------
// Meditation (server counts the seconds)
// -------------------------------------------------------------------
function meditationCredit(p, final) {
  const m = p.med;
  if (!m) return;
  const elapsed = Math.min(RULES.MEDITATION_MAX_SECONDS, Math.floor((Date.now() - m.startedAt) / 1000));
  if (elapsed > m.seconds) {
    m.unflushed += (elapsed - m.seconds) * RULES.MEDITATION_POINTS_PER_SEC;
    m.seconds = elapsed;
  }
  if (m.unflushed > 0 && (final || m.unflushed >= MED_FLUSH_EVERY_S)) {
    const res = store.awardMerit(p.userId, 'meditation', m.unflushed, `med:${m.sessionId}:${m.chunk}`, m.sessionId);
    m.flushed += m.unflushed;
    m.unflushed = 0;
    m.chunk += 1;
    p.merit = res.total;
  }
}

function endMeditation(p, reason) {
  if (!p.med) return null;
  meditationCredit(p, true);
  const summary = { sessionId: p.med.sessionId, seconds: p.med.seconds, points: p.med.flushed, reason };
  console.log(`[merit] ${p.userId} meditated ${summary.seconds}s (+${summary.points}) reason=${reason}`);
  p.med = null;
  setIdle(p);
  return summary;
}

function meditationTick() {
  for (const p of players.values()) {
    if (!p.med || !p.connected) continue;
    try {
      meditationCredit(p, false);
      const sessionPoints = p.med.flushed + p.med.unflushed;
      if (p.med.seconds >= RULES.MEDITATION_MAX_SECONDS) {
        const summary = endMeditation(p, 'max');
        p.socket.emit('meditation:ended', { ...summary, total: p.merit });
        broadcastState(p);
        continue;
      }
      // Confirmed by the server: ledger total + seconds counted but not yet flushed.
      p.socket.emit('merit:tick', {
        total: p.merit + p.med.unflushed,
        sessionSeconds: p.med.seconds,
        sessionPoints,
      });
    } catch (e) {
      console.error('[meditation] tick failed:', e.message);
    }
  }
}

// -------------------------------------------------------------------
// Connection handling
// -------------------------------------------------------------------
function attach(socket) {
  const userId = socket.data.userId;

  socket.on('room:join', (data, ack) => {
    try {
      const roomId = (data && data.roomId) || World.DEFAULT_ROOM;
      const room = World.getRoom(roomId);
      if (!room) return fail(ack, 'no_room', 'Phòng không tồn tại.');
      const profile = store.getProfile(userId);
      if (!profile) return fail(ack, 'no_profile', 'Không tìm thấy nhân vật.');

      let p = players.get(userId);
      if (p && p.socket && p.socket.id !== socket.id && p.connected) {
        // Same account opened in another tab/device: the newest wins.
        p.socket.emit('session:replaced');
        p.socket.disconnect(true);
      }
      if (p && p.roomId !== roomId) {
        io.to(p.roomId).emit('player:left', { id: userId });
        p = null;
      }
      if (!p) {
        p = {
          userId, roomId, x: room.spawn.x + (Math.random() - 0.5) * 160, y: room.spawn.y + (Math.random() - 0.5) * 60,
          dir: 'up', moving: false, activity: 'idle', fishId: null, med: null,
          lastMoveAt: Date.now(), lastIncenseAt: 0, lastKnockAt: 0, moveCount: 0, moveWindow: 0,
        };
        if (!World.isWalkable(room, p.x, p.y)) { p.x = room.spawn.x; p.y = room.spawn.y; }
        players.set(userId, p);
      }
      const wasAway = p.socket && !p.connected;
      clearTimeout(p.awayTimer);
      p.awayTimer = null;
      p.socket = socket;
      p.connected = true;
      p.profile = profile;
      p.merit = profile.merit_points;
      p.lastMoveAt = Date.now();
      socket.data.roomId = roomId;
      socket.join(roomId);
      store.touchAccount(userId);
      savePresence(p, true);

      const others = [];
      for (const o of players.values()) if (o.roomId === roomId && o.userId !== userId) others.push(publicPlayer(o));

      ok(ack, {
        roomId,
        self: { ...publicPlayer(p), merit: p.merit },
        players: others,
        incense: activeIncense(roomId),
        meditation: p.med ? { sessionId: p.med.sessionId, seconds: p.med.seconds } : null,
        serverTime: Date.now(),
      });
      socket.to(roomId).emit(wasAway ? 'player:back' : 'player:joined', publicPlayer(p));
      console.log(`[ws] ${profile.display_name} (${userId.slice(0, 8)}) ${wasAway ? 'reconnected to' : 'joined'} ${roomId}`);
    } catch (e) {
      console.error('[ws] room:join error:', e);
      fail(ack, 'server_error', 'Máy chủ gặp lỗi, vui lòng thử lại.');
    }
  });

  socket.on('move', (data) => {
    const p = players.get(userId);
    if (!p || p.socket !== socket || !data) return;
    const room = World.getRoom(p.roomId);
    const now = Date.now();

    // Flood protection
    if (now - p.moveWindow > 1000) { p.moveWindow = now; p.moveCount = 0; }
    if (++p.moveCount > MAX_MOVES_PER_SEC) return;

    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const dir = DIRS.includes(data.dir) ? data.dir : p.dir;
    const moving = !!data.moving;

    if (p.activity !== 'idle') {
      // Movement is locked during activities; tell the client where it really is.
      if (World.dist(x, y, p.x, p.y) > 2) socket.emit('self:correct', { x: p.x, y: p.y, activity: p.activity });
      return;
    }

    const dt = Math.min(1.5, (now - p.lastMoveAt) / 1000);
    const allowed = RULES.PLAYER_SPEED * (dt + 0.2) * 1.25 + 12;
    const d = World.dist(x, y, p.x, p.y);
    if (d > allowed || !World.isWalkable(room, x, y)) {
      socket.emit('self:correct', { x: p.x, y: p.y });
      return;
    }
    p.x = x;
    p.y = y;
    p.dir = dir;
    p.moving = moving;
    p.lastMoveAt = now;
    socket.to(p.roomId).volatile.emit('player:moved', { id: userId, x: Math.round(x), y: Math.round(y), dir, moving });
    savePresence(p, false);
  });

  // ---- Dâng hương ---------------------------------------------------
  socket.on('action:incense', (data, ack) => {
    try {
      const p = players.get(userId);
      if (!p || p.socket !== socket) return fail(ack, 'not_joined', 'Bạn chưa vào chính điện.');
      const eventId = data && data.eventId;
      if (!validEventId(eventId)) return fail(ack, 'bad_request', 'Yêu cầu không hợp lệ.');

      const prior = store.transactionFor(userId, `incense:${eventId}`);
      if (prior) return ok(ack, { duplicate: true, delta: prior.points_delta, total: store.getMerit(userId) });

      const room = World.getRoom(p.roomId);
      const now = Date.now();
      if (p.activity !== 'idle') return fail(ack, 'busy', 'Bạn đang thực hiện hoạt động khác.');
      if (!World.nearIncense(room, p.x, p.y)) return fail(ack, 'too_far', 'Hãy đến gần lư hương hơn.');
      const wait = p.lastIncenseAt + RULES.INCENSE_COOLDOWN_MS - now;
      if (wait > 0) return fail(ack, 'cooldown', 'Xin chờ hương trước cháy thêm chút nữa.', wait);

      const res = store.awardMerit(userId, 'incense', RULES.INCENSE_POINTS, `incense:${eventId}`, null);
      p.merit = res.total;
      p.lastIncenseAt = now;
      const spot = World.offerSpotFor(room, p.x);
      p.x = spot.x;
      p.y = spot.y;
      p.dir = 'up';
      p.moving = false;
      p.activity = 'incense';
      const until = now + RULES.INCENSE_DURATION_MS;
      clearTimeout(p.activityTimer);
      p.activityTimer = setTimeout(() => {
        if (p.activity === 'incense') { setIdle(p); broadcastState(p); }
      }, RULES.INCENSE_DURATION_MS);
      broadcastState(p);

      // Shared burner: everyone sees the newly planted sticks smoke for a while.
      const stick = {
        id: crypto.randomUUID(),
        x: Math.round((Math.random() - 0.5) * 44),
        plantAt: now + RULES.INCENSE_DURATION_MS - 900,
        expiresAt: now + RULES.INCENSE_STICK_TTL_MS,
      };
      const list = activeIncense(p.roomId);
      list.push(stick);
      if (list.length > 12) list.shift();
      io.to(p.roomId).emit('incense:planted', stick);

      console.log(`[merit] ${userId.slice(0, 8)} incense +${RULES.INCENSE_POINTS} → ${res.total}`);
      ok(ack, { delta: RULES.INCENSE_POINTS, total: res.total, x: p.x, y: p.y, until });
    } catch (e) {
      console.error('[ws] incense error:', e);
      fail(ack, 'server_error', 'Máy chủ gặp lỗi, vui lòng thử lại.');
    }
  });

  // ---- Gõ mõ -----------------------------------------------------------
  socket.on('action:fish', (data, ack) => {
    try {
      const p = players.get(userId);
      if (!p || p.socket !== socket) return fail(ack, 'not_joined', 'Bạn chưa vào chính điện.');
      const eventId = data && data.eventId;
      if (!validEventId(eventId)) return fail(ack, 'bad_request', 'Yêu cầu không hợp lệ.');

      const prior = store.transactionFor(userId, `fish:${eventId}`);
      if (prior) return ok(ack, { duplicate: true, delta: prior.points_delta, total: store.getMerit(userId) });

      const room = World.getRoom(p.roomId);
      const now = Date.now();

      if (p.activity === 'idle') {
        const fish = World.nearestFish(room, p.x, p.y);
        if (!fish) return fail(ack, 'too_far', 'Hãy đến gần chiếc mõ hơn.');
        for (const o of players.values()) {
          if (o !== p && o.roomId === p.roomId && o.activity === 'wooden_fish' && o.fishId === fish.id) {
            return fail(ack, 'occupied', `${o.profile.display_name} đang gõ mõ này. Bạn thử chiếc mõ còn lại nhé.`);
          }
        }
        p.activity = 'wooden_fish';
        p.fishId = fish.id;
        p.x = fish.seat.x;
        p.y = fish.seat.y;
        p.dir = 'down';
        p.moving = false;
        broadcastState(p);
      } else if (p.activity !== 'wooden_fish') {
        return fail(ack, 'busy', 'Bạn đang thực hiện hoạt động khác.');
      }

      if (now - p.lastKnockAt < RULES.FISH_MIN_INTERVAL_MS) {
        return fail(ack, 'too_fast', 'Gõ chậm lại một chút, giữ nhịp đều nhé.');
      }
      p.lastKnockAt = now;
      const res = store.awardMerit(userId, 'wooden_fish', RULES.FISH_POINTS, `fish:${eventId}`, null);
      p.merit = res.total;
      socket.to(p.roomId).emit('player:knock', { id: userId, fishId: p.fishId });
      ok(ack, { delta: RULES.FISH_POINTS, total: res.total, fishId: p.fishId, x: p.x, y: p.y });
    } catch (e) {
      console.error('[ws] fish error:', e);
      fail(ack, 'server_error', 'Máy chủ gặp lỗi, vui lòng thử lại.');
    }
  });

  // ---- Ngồi thiền -----------------------------------------------------
  socket.on('meditation:start', (_data, ack) => {
    try {
      const p = players.get(userId);
      if (!p || p.socket !== socket) return fail(ack, 'not_joined', 'Bạn chưa vào chính điện.');
      if (p.activity === 'meditating' && p.med) {
        return ok(ack, { sessionId: p.med.sessionId, seconds: p.med.seconds, resumed: true });
      }
      if (p.activity !== 'idle') return fail(ack, 'busy', 'Bạn đang thực hiện hoạt động khác.');
      const room = World.getRoom(p.roomId);
      if (!World.canMeditateAt(room, p.x, p.y)) {
        return fail(ack, 'bad_spot', 'Hãy chọn chỗ sàn trống, cách xa lư hương và mõ một chút.');
      }
      p.activity = 'meditating';
      p.moving = false;
      p.dir = 'down';
      p.med = { sessionId: crypto.randomUUID(), startedAt: Date.now(), seconds: 0, unflushed: 0, flushed: 0, chunk: 0 };
      broadcastState(p);
      ok(ack, { sessionId: p.med.sessionId, seconds: 0 });
    } catch (e) {
      console.error('[ws] meditation:start error:', e);
      fail(ack, 'server_error', 'Máy chủ gặp lỗi, vui lòng thử lại.');
    }
  });

  // Stand up from meditation or leave the wooden fish.
  socket.on('activity:stop', (_data, ack) => {
    try {
      const p = players.get(userId);
      if (!p || p.socket !== socket) return fail(ack, 'not_joined', 'Bạn chưa vào chính điện.');
      if (p.activity === 'meditating') {
        const summary = endMeditation(p, 'stood_up');
        broadcastState(p);
        return ok(ack, { meditation: summary, total: p.merit });
      }
      if (p.activity === 'wooden_fish') {
        setIdle(p);
        broadcastState(p);
        return ok(ack, { total: p.merit, x: p.x, y: p.y });
      }
      return ok(ack, { total: p.merit, x: p.x, y: p.y, activity: p.activity });
    } catch (e) {
      console.error('[ws] activity:stop error:', e);
      fail(ack, 'server_error', 'Máy chủ gặp lỗi, vui lòng thử lại.');
    }
  });

  socket.on('disconnect', () => {
    const p = players.get(userId);
    if (!p || p.socket !== socket) return;
    p.connected = false;
    // Meditation must not continue without a live connection.
    if (p.med) endMeditation(p, 'disconnected');
    if (p.activity === 'wooden_fish') setIdle(p);
    io.to(p.roomId).emit('player:away', { id: userId });
    p.awayTimer = setTimeout(() => {
      if (p.connected) return;
      players.delete(userId);
      try { store.deletePresence(userId); } catch (_) { /* ignore */ }
      io.to(p.roomId).emit('player:left', { id: userId });
      console.log(`[ws] ${userId.slice(0, 8)} left ${p.roomId}`);
    }, AWAY_GRACE_MS);
  });
}

/** Called by the REST layer after a profile edit so others see the new look. */
function profileUpdated(profile) {
  const p = players.get(profile.id);
  if (!p) return;
  p.profile = profile;
  io.to(p.roomId).emit('player:updated', publicPlayer(p));
}

function init(socketServer) {
  io = socketServer;
  io.on('connection', attach);
  setInterval(meditationTick, 1000).unref();
}

/** Flush running meditation sessions before shutdown. */
function shutdown() {
  for (const p of players.values()) {
    if (p.med) {
      try { endMeditation(p, 'server_shutdown'); } catch (e) { console.error(e.message); }
    }
  }
}

module.exports = { init, profileUpdated, shutdown, onlineCount: () => players.size };
