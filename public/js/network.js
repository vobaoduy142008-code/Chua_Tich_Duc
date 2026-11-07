// ===== Network: REST (profile) + Socket.IO (presence, activities) =====
const Net = (() => {
  const TOKEN_KEY = 'tichduc.token';
  const LEGACY_KEY = 'tich_duc_user_id'; // first prototype stored only the id

  let socket = null;
  const handlers = {};
  const pending = new Map();     // eventId -> { event, payload, attempts, resolve, reject }
  let joined = false;
  let roomId = World.DEFAULT_ROOM;

  class ApiError extends Error {
    constructor(status, body) {
      super((body && body.message) || 'Không kết nối được máy chủ.');
      this.status = status;
      this.code = (body && body.error) || 'network';
      this.fields = (body && body.fields) || null;
    }
  }

  function emitLocal(name, data) {
    (handlers[name] || []).forEach((fn) => {
      try { fn(data); } catch (e) { console.error(`[net] handler ${name} failed`, e); }
    });
  }

  async function api(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const headers = { 'Content-Type': 'application/json' };
    const token = Net.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    } catch (e) {
      throw new ApiError(0, { error: 'network', message: 'Không kết nối được máy chủ. Hãy kiểm tra mạng và thử lại.' });
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty */ }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  function flushPending() {
    for (const [id, job] of pending) {
      if (!job.inFlight) send(id, job);
    }
  }

  function send(id, job) {
    if (!socket || !socket.connected || !joined) return;
    job.inFlight = true;
    job.attempts += 1;
    socket.timeout(6000).emit(job.event, { ...job.payload, eventId: id }, (err, res) => {
      job.inFlight = false;
      if (err) {
        // No answer: keep the job and retry with the SAME eventId (server dedupes).
        if (job.attempts >= 4) {
          pending.delete(id);
          emitLocal('sync', pending.size);
          job.reject(Object.assign(new Error('Không đồng bộ được với máy chủ.'), { code: 'timeout' }));
        } else if (socket.connected) {
          setTimeout(() => pending.has(id) && !job.inFlight && send(id, job), 800);
        }
        return;
      }
      pending.delete(id);
      emitLocal('sync', pending.size);
      if (res && res.ok) job.resolve(res);
      else job.reject(Object.assign(new Error((res && res.message) || 'Không thực hiện được.'), res || {}));
    });
  }

  const Net = {
    ApiError,
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },

    token: () => Utils.store.get(TOKEN_KEY, null),
    setToken: (t) => Utils.store.set(TOKEN_KEY, t),
    clearToken: () => Utils.store.remove(TOKEN_KEY),
    legacyId: () => Utils.store.get(LEGACY_KEY, null),
    clearLegacy: () => Utils.store.remove(LEGACY_KEY),

    // ---- REST ----
    async createPlayer(profile) {
      const data = await api('POST', '/api/players', profile);
      Net.setToken(data.token);
      return data.profile;
    },
    async me() { return (await api('GET', '/api/me')).profile; },
    async updateMe(profile) { return (await api('PUT', '/api/me', profile)).profile; },
    async meritSummary() { return api('GET', '/api/me/merit'); },
    async claimLegacy(userId) {
      const data = await api('POST', '/api/players/claim-legacy', { user_id: userId });
      Net.setToken(data.token);
      return data.profile;
    },

    // ---- realtime ----
    connect() {
      if (socket) { socket.auth = { token: Net.token() }; if (!socket.connected) socket.connect(); return; }
      socket = io({
        auth: { token: Net.token() },
        transports: ['websocket', 'polling'],
        reconnectionDelay: 800,
        reconnectionDelayMax: 5000,
      });
      socket.on('connect', () => {
        const tryJoin = () => Net.join().catch((e) => {
          if (e.code === 'no_profile' || e.code === 'no_room') emitLocal('fatal', e);
          else if (socket.connected) setTimeout(tryJoin, 2000);
        });
        tryJoin();
      });
      socket.on('disconnect', (reason) => {
        joined = false;
        emitLocal('status', reason === 'io client disconnect' ? 'closed' : 'reconnecting');
      });
      socket.on('connect_error', (err) => {
        if (err && err.message === 'unauthorized') {
          socket.disconnect();
          emitLocal('fatal', Object.assign(new Error('Phiên chơi không còn hợp lệ.'), { code: 'unauthorized' }));
        } else {
          emitLocal('status', 'reconnecting');
        }
      });
      socket.on('session:replaced', () => {
        socket.disconnect();
        emitLocal('fatal', Object.assign(new Error('Nhân vật của bạn vừa được mở ở một thẻ hoặc thiết bị khác.'), { code: 'replaced' }));
      });
      for (const ev of ['player:joined', 'player:back', 'player:left', 'player:away', 'player:moved', 'player:state',
        'player:updated', 'player:knock', 'incense:planted', 'merit:tick', 'meditation:ended', 'self:correct']) {
        socket.on(ev, (data) => emitLocal(ev, data));
      }
    },

    async join() {
      const res = await socket.timeout(8000).emitWithAck('room:join', { roomId });
      if (!res || !res.ok) throw Object.assign(new Error((res && res.message) || 'Không vào được chính điện.'), res || {});
      joined = true;
      emitLocal('joined', res);
      emitLocal('status', 'connected');
      flushPending();
      return res;
    },

    disconnect() { if (socket) socket.disconnect(); joined = false; },

    isOnline: () => !!socket && socket.connected && joined,

    move(x, y, dir, moving) {
      if (socket && joined) socket.volatile.emit('move', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, dir, moving });
    },

    /**
     * Merit-bearing action. Resolves with the server's answer; if the
     * connection drops the request is retried with the same eventId.
     */
    action(event, payload) {
      return new Promise((resolve, reject) => {
        const id = Utils.eventId();
        const job = { event, payload: payload || {}, attempts: 0, inFlight: false, resolve, reject };
        pending.set(id, job);
        emitLocal('sync', pending.size);
        send(id, job);
      });
    },

    /** Non-idempotent request/response (start/stop meditation). */
    async request(event, payload) {
      if (!socket || !socket.connected) throw Object.assign(new Error('Đang mất kết nối.'), { code: 'offline' });
      let res;
      try {
        res = await socket.timeout(6000).emitWithAck(event, payload || {});
      } catch (_) {
        throw Object.assign(new Error('Máy chủ phản hồi chậm, vui lòng thử lại.'), { code: 'timeout' });
      }
      if (!res || !res.ok) throw Object.assign(new Error((res && res.message) || 'Không thực hiện được.'), res || {});
      return res;
    },

    pendingCount: () => pending.size,
  };
  return Net;
})();
