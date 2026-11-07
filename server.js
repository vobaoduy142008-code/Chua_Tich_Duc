'use strict';

// ===================================================================
// Tích Đức — HTTP + REST + Socket.IO server
// ===================================================================

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server: SocketIO } = require('socket.io');

const store = require('./db');
const realtime = require('./server/realtime');
const Rules = require('./public/js/shared/profile-rules');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const IS_PROD = process.env.NODE_ENV === 'production';
// Comma-separated list of extra origins allowed to connect (only needed if the
// frontend is hosted on a different domain than this server).
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);

const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: CORS_ORIGINS.length ? { origin: CORS_ORIGINS } : undefined,
  pingInterval: 10000,
  pingTimeout: 8000,
  maxHttpBufferSize: 16 * 1024,
});

// -------------------------------------------------------------------
// Security headers
// -------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "media-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '8kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(webp|png|jpg|svg|woff2?)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));

// -------------------------------------------------------------------
// Tiny in-memory rate limiter (per key, sliding window)
// -------------------------------------------------------------------
const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      res.setHeader('Retry-After', Math.ceil((windowMs - (now - hits[0])) / 1000));
      return res.status(429).json({ error: 'rate_limited', message: 'Bạn thao tác hơi nhanh, vui lòng thử lại sau ít phút.' });
    }
    hits.push(now);
    buckets.set(key, hits);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of buckets) if (!hits.length || now - hits[hits.length - 1] > 3600000) buckets.delete(k);
}, 600000).unref();

// -------------------------------------------------------------------
// Auth: "Authorization: Bearer <token>" — the token is a guest secret
// -------------------------------------------------------------------
function bearer(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function requireAuth(req, res, next) {
  const userId = store.userIdForToken(bearer(req));
  if (!userId) return res.status(401).json({ error: 'unauthorized', message: 'Phiên chơi không hợp lệ hoặc đã hết hạn.' });
  req.userId = userId;
  next();
}

function profileJson(p) {
  return {
    id: p.id,
    display_name: p.display_name,
    gender: p.gender,
    skin_color: p.skin_color,
    hair_color: p.hair_color,
    hair_style: p.hair_style,
    robe_color: p.robe_color,
    merit_points: p.merit_points,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function validationError(res, errors) {
  return res.status(400).json({ error: 'validation', message: Object.values(errors)[0], fields: errors });
}

// -------------------------------------------------------------------
// REST API
// -------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true, online: realtime.onlineCount() }));

/** Create a guest account + character. Returns the secret token once. */
app.post('/api/players', rateLimit('create', 10, 3600000), (req, res) => {
  try {
    const v = Rules.validateProfile(req.body, false);
    if (!v.ok) return validationError(res, v.errors);
    const { token, profile } = store.createPlayer(crypto.randomUUID(), v.value);
    console.log(`[api] new player ${profile.display_name} (${profile.id.slice(0, 8)})`);
    res.status(201).json({ token, profile: profileJson(profile) });
  } catch (e) {
    console.error('[api] create player failed:', e);
    res.status(500).json({ error: 'server_error', message: 'Không tạo được nhân vật, vui lòng thử lại.' });
  }
});

app.get('/api/me', rateLimit('me', 120, 60000), requireAuth, (req, res) => {
  const p = store.getProfile(req.userId);
  if (!p) return res.status(404).json({ error: 'not_found', message: 'Không tìm thấy nhân vật.' });
  store.touchAccount(req.userId);
  res.json({ profile: profileJson(p) });
});

/** Update name/appearance. Merit is never touched here. */
app.put('/api/me', rateLimit('update', 30, 60000), requireAuth, (req, res) => {
  try {
    const current = store.getProfile(req.userId);
    if (!current) return res.status(404).json({ error: 'not_found', message: 'Không tìm thấy nhân vật.' });
    const body = req.body || {};
    const merged = {};
    for (const f of ['display_name', 'gender', 'skin_color', 'hair_color', 'hair_style', 'robe_color']) {
      merged[f] = body[f] !== undefined ? body[f] : current[f];
    }
    const v = Rules.validateProfile(merged, false);
    if (!v.ok) return validationError(res, v.errors);
    const updated = store.updateProfile(req.userId, v.value);
    realtime.profileUpdated(updated);
    res.json({ profile: profileJson(updated) });
  } catch (e) {
    console.error('[api] update failed:', e);
    res.status(500).json({ error: 'server_error', message: 'Không lưu được thay đổi, vui lòng thử lại.' });
  }
});

/** Recent merit history for the profile panel. */
app.get('/api/me/merit', rateLimit('history', 60, 60000), requireAuth, (req, res) => {
  const rows = store.db.prepare(`
    SELECT activity_type, SUM(points_delta) AS points, COUNT(*) AS times, MAX(created_at) AS last_at
    FROM merit_transactions WHERE user_id = ? GROUP BY activity_type`).all(req.userId);
  res.json({ total: store.getMerit(req.userId), byActivity: rows });
});

/**
 * Profiles created by the first prototype (before accounts existed) only have
 * an id in the browser's localStorage. They can be claimed exactly once.
 */
app.post('/api/players/claim-legacy', rateLimit('claim', 10, 3600000), (req, res) => {
  const id = req.body && req.body.user_id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'bad_request', message: 'Mã nhân vật không hợp lệ.' });
  }
  const token = store.claimLegacyProfile(id);
  if (!token) return res.status(404).json({ error: 'not_claimable', message: 'Nhân vật cũ không còn khả dụng.' });
  console.log(`[api] legacy profile claimed ${id.slice(0, 8)}`);
  res.json({ token, profile: profileJson(store.getProfile(id)) });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Không tìm thấy.' }));

// SPA fallback
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Error handler (malformed JSON etc.)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[http] error:', err);
  res.status(status).json({ error: status === 400 ? 'bad_request' : 'server_error', message: 'Yêu cầu không hợp lệ.' });
});

// -------------------------------------------------------------------
// Socket.IO auth: handshake must carry a valid token
// -------------------------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const userId = store.userIdForToken(token);
  if (!userId) return next(new Error('unauthorized'));
  socket.data.userId = userId;
  next();
});
realtime.init(io);

// -------------------------------------------------------------------
// Lifecycle
// -------------------------------------------------------------------
function shutdown() {
  console.log('\n[server] Đang tắt máy chủ…');
  realtime.shutdown();
  io.close();
  server.close(() => {
    store.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`\n🪷  Tích Đức đang chạy tại http://localhost:${PORT}${IS_PROD ? '' : '  (development)'}\n`);
});
