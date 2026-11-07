// ===== Game: boot flow, main loop, activities, other players =====
(() => {
  const { RULES } = World;
  const $ = UI.$;
  const TUTORIAL_KEY = 'tichduc.tutorialSeen';
  const SEND_EVERY = 1 / 15;

  const room = World.getRoom(World.DEFAULT_ROOM);
  const others = new Map();
  const floats = [];
  let profile = null;
  let bgImage = null;
  let bgPromise = null;
  let running = false;
  let lastMs = 0;
  let t = 0;
  let sendAcc = 0;
  let wasMoving = false;
  let everJoined = false;
  let disconnected = false;
  let joinWaiter = null;
  let lastIncenseAt = 0;
  let lastKnockAt = 0;
  let vignette = null;

  const me = {
    x: room.spawn.x, y: room.spawn.y, dir: 'up', moving: false, walkPhase: 0,
    activity: 'idle', actStart: 0, knockAt: -9, fishId: null, busy: false,
    med: null, // { seconds, points }
    incenseTimer: 0,
  };

  // ---------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------
  function loadBackground() {
    if (bgPromise) return bgPromise;
    bgPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { bgImage = img; resolve(img); };
      img.onerror = () => { bgPromise = null; reject(new Error('Không tải được hình chính điện.')); };
      img.src = room.background;
    });
    return bgPromise;
  }

  async function findProfile() {
    UI.welcome({ status: 'Đang tìm nhân vật của bạn…', busy: true });
    try {
      if (Net.token()) {
        try {
          profile = await Net.me();
        } catch (e) {
          if (e.status === 401 || e.status === 404) { Net.clearToken(); profile = null; } else throw e;
        }
      }
      if (!profile && Net.legacyId()) {
        try {
          profile = await Net.claimLegacy(Net.legacyId());
          UI.toast('Đã chuyển nhân vật cũ sang hệ thống mới. Công đức được giữ nguyên.', 'good', 4200);
        } catch (e) {
          if (e.status === 0) throw e;
        }
        Net.clearLegacy();
      }
      if (profile) {
        UI.welcome({ status: `Chào mừng trở lại, ${profile.display_name} · ${Utils.formatNumber(profile.merit_points)} công đức`, profile });
      } else {
        UI.welcome({ status: 'Lần đầu ghé chùa? Hãy tạo nhân vật nhé.' });
      }
    } catch (e) {
      UI.welcome({ status: e.message || 'Không kết nối được máy chủ.', error: true });
    }
  }

  function openCreate() {
    UI.openCreator('create', null, {
      onSubmit: async (values) => {
        UI.creatorBusy(true);
        try {
          profile = await Net.createPlayer(values);
          enterTemple();
        } catch (e) {
          UI.creatorBusy(false);
          UI.creatorError(e);
        }
      },
    });
  }

  function openEdit() {
    UI.closeOverlay('panel-profile');
    Input.setEnabled(false);
    UI.openCreator('edit', profile, {
      onSubmit: async (values) => {
        UI.creatorBusy(true);
        try {
          profile = await Net.updateMe(values);
          UI.setPlayer(profile);
          UI.show('screen-game');
          UI.toast('Đã cập nhật ngoại hình — công đức vẫn được giữ nguyên.', 'good');
          refreshInputState();
        } catch (e) {
          UI.creatorBusy(false);
          UI.creatorError(e);
        }
      },
      onCancel: () => { UI.show('screen-game'); refreshInputState(); },
    });
  }

  async function enterTemple() {
    UI.show('screen-loading');
    UI.loading('Đang thắp đèn chính điện…', 0.15);
    try {
      await loadBackground();
      UI.loading('Đang mở cửa chính điện…', 0.6);
      Temple.init(room, bgImage);
      Renderer.setWorld(room.width, room.height, room.minVisibleHeight);
      UI.setPlayer(profile);
      UI.setMerit(profile.merit_points);
      const joined = new Promise((resolve, reject) => {
        joinWaiter = { resolve, reject };
        setTimeout(() => reject(new Error('Máy chủ phản hồi chậm. Hãy kiểm tra mạng và thử lại.')), 12000);
      });
      Net.connect();
      await joined;
      UI.loading('', 1);
      UI.show('screen-game');
      UI.showTouchControls(document.body.classList.contains('touch'));
      Renderer.follow(me.x, me.y, 0, true);
      start();
      if (!Utils.store.get(TUTORIAL_KEY, false)) {
        UI.tutorial(document.body.classList.contains('touch'));
        Utils.store.set(TUTORIAL_KEY, true);
      }
      refreshInputState();
    } catch (e) {
      joinWaiter = null;
      UI.error({
        title: 'Chưa vào được chính điện',
        message: e.message || 'Đã có lỗi khi tải cảnh.',
        onRetry: enterTemple,
        altLabel: 'Về màn hình chính',
        onAlt: () => { Net.disconnect(); UI.show('screen-welcome'); findProfile(); },
      });
    }
  }

  function refreshInputState() {
    const inGame = $('screen-game').classList.contains('active');
    Input.setEnabled(inGame && !UI.anyOverlayOpen());
  }

  // ---------------------------------------------------------------
  // network events
  // ---------------------------------------------------------------
  function addOther(p) {
    const prev = others.get(p.id);
    const o = prev || { rx: p.x, ry: p.y, walkPhase: 0, actStart: t, knockAt: -9, blinkSeed: Utils.hash(p.id) };
    Object.assign(o, {
      id: p.id, name: p.name, tx: p.x, ty: p.y, dir: p.dir, activity: p.activity, fishId: p.fishId, away: p.away,
      appearance: { gender: p.gender, skin: p.skin, hair: p.hair, hairStyle: p.hairStyle, robe: p.robe },
      lastMove: performance.now(),
    });
    if (!prev) { o.rx = p.x; o.ry = p.y; }
    others.set(p.id, o);
    UI.setOnline(others.size + 1);
  }

  function setupNet() {
    Net.on('joined', (res) => {
      const s = res.self;
      me.x = s.x; me.y = s.y; me.dir = s.dir;
      if (me.activity !== s.activity) {
        // The server is authoritative after a reconnect (e.g. meditation ended on disconnect).
        me.activity = s.activity;
        me.fishId = s.fishId;
        if (s.activity !== 'meditating') { me.med = null; UI.meditation(null); }
      }
      profile.merit_points = s.merit;
      UI.setMerit(s.merit);
      others.clear();
      res.players.forEach(addOther);
      UI.setOnline(others.size + 1);
      Temple.setIncense(res.incense);
      if (joinWaiter) { joinWaiter.resolve(); joinWaiter = null; }
      if (everJoined && disconnected) UI.connection('restored');
      everJoined = true;
      disconnected = false;
    });
    Net.on('status', (s) => {
      if (s === 'reconnecting' && everJoined) {
        disconnected = true;
        UI.connection('reconnecting');
        if (me.activity === 'meditating') {
          me.activity = 'idle';
          me.med = null;
          UI.meditation(null);
          UI.toast('Phiên thiền đã dừng do mất kết nối. Công đức đã được máy chủ ghi nhận đến lúc ngắt.', 'warn', 4200);
        }
      }
    });
    Net.on('sync', (n) => UI.setSync(n));
    Net.on('fatal', (e) => {
      if (joinWaiter) { joinWaiter.reject(e); joinWaiter = null; return; }
      stop();
      if (e.code === 'replaced') {
        UI.error({
          title: 'Nhân vật đang mở ở nơi khác',
          message: e.message,
          retryLabel: 'Chơi tiếp ở đây',
          onRetry: () => { Net.connect(); start(); },
        });
      } else {
        UI.error({
          title: 'Phiên chơi đã hết hạn',
          message: 'Không xác thực được nhân vật của bạn. Nếu bạn có mã khôi phục, hãy dùng nó ở màn hình chính.',
          retryLabel: 'Về màn hình chính',
          onRetry: () => location.reload(),
          altLabel: 'Tạo nhân vật mới',
          onAlt: () => { Net.clearToken(); location.reload(); },
        });
      }
    });

    Net.on('player:joined', addOther);
    Net.on('player:back', addOther);
    Net.on('player:updated', addOther);
    Net.on('player:left', ({ id }) => { others.delete(id); UI.setOnline(others.size + 1); });
    Net.on('player:away', ({ id }) => {
      const o = others.get(id);
      if (o) { o.away = true; if (o.activity !== 'idle') o.activity = 'idle'; }
    });
    Net.on('player:moved', (d) => {
      const o = others.get(d.id);
      if (!o) return;
      o.tx = d.x; o.ty = d.y; o.dir = d.dir; o.lastMove = performance.now(); o.away = false;
    });
    Net.on('player:state', (d) => {
      if (profile && d.id === profile.id) return;
      const o = others.get(d.id);
      if (!o) return;
      if (o.activity !== d.activity) o.actStart = t;
      o.activity = d.activity; o.fishId = d.fishId; o.dir = d.dir;
      o.tx = d.x; o.ty = d.y;
      if (d.activity !== 'idle') { o.rx = d.x; o.ry = d.y; }
    });
    Net.on('player:knock', (d) => {
      const o = others.get(d.id);
      if (o) o.knockAt = t;
      Temple.knock(d.fishId, t);
      const f = room.woodenFish.find((x) => x.id === d.fishId);
      const pan = f ? (f.x - me.x) / 700 : 0;
      Sound.woodFish(pan, true);
    });
    Net.on('incense:planted', (s) => Temple.addIncense(s));
    Net.on('merit:tick', (d) => {
      profile.merit_points = d.total;
      UI.setMerit(d.total);
      if (me.activity === 'meditating') {
        me.med = { seconds: d.sessionSeconds, points: d.sessionPoints };
        UI.meditation(me.med);
      }
    });
    Net.on('meditation:ended', (d) => {
      me.activity = 'idle';
      me.med = null;
      UI.meditation(null);
      profile.merit_points = d.total;
      UI.setMerit(d.total);
      UI.toast(`Bạn đã thiền ${Utils.formatTime(d.seconds)}. Hãy nghỉ ngơi một chút rồi tiếp tục nhé.`, 'good', 4500);
    });
    Net.on('self:correct', (d) => {
      me.x = d.x; me.y = d.y;
      if (d.activity && d.activity !== me.activity && me.activity === 'idle') me.activity = d.activity;
    });
  }

  // ---------------------------------------------------------------
  // activities
  // ---------------------------------------------------------------
  function floatText(text, x, y) {
    floats.push({ text, x, y, age: 0 });
  }

  function gainMerit(total, delta, x, y) {
    profile.merit_points = total;
    UI.setMerit(total, true);
    if (delta > 0) floatText(`+${delta} công đức`, x, y);
  }

  function friendly(e) {
    if (!Net.isOnline()) return 'Đang mất kết nối, thao tác sẽ được gửi khi kết nối lại.';
    return e.message || 'Không thực hiện được, vui lòng thử lại.';
  }

  async function offerIncense() {
    if (me.busy || me.activity !== 'idle') return;
    me.busy = true;
    try {
      const res = await Net.action('action:incense');
      lastIncenseAt = performance.now();
      if (!res.duplicate) {
        me.x = res.x; me.y = res.y; me.dir = 'up'; me.moving = false;
        me.activity = 'incense';
        me.actStart = t;
        Sound.incense();
        clearTimeout(me.incenseTimer);
        me.incenseTimer = setTimeout(() => { if (me.activity === 'incense') me.activity = 'idle'; }, RULES.INCENSE_DURATION_MS);
        setTimeout(() => Sound.merit(), 900);
      }
      gainMerit(res.total, res.duplicate ? 0 : res.delta, me.x, me.y - 175);
    } catch (e) {
      if (e.code === 'cooldown' && e.retryInMs) UI.toast(`Hương vừa thắp còn đang cháy — chờ ${Math.ceil(e.retryInMs / 1000)} giây nữa nhé.`);
      else UI.toast(friendly(e), 'warn');
    } finally {
      me.busy = false;
    }
  }

  async function knockFish() {
    if (me.busy || (me.activity !== 'idle' && me.activity !== 'wooden_fish')) return;
    const now = performance.now();
    if (now - lastKnockAt < RULES.FISH_MIN_INTERVAL_MS) return;
    lastKnockAt = now;
    me.busy = true;
    try {
      const res = await Net.action('action:fish');
      if (me.activity !== 'wooden_fish') {
        me.activity = 'wooden_fish';
        me.fishId = res.fishId;
        me.x = res.x; me.y = res.y; me.dir = 'down'; me.moving = false;
      }
      me.knockAt = t;
      Temple.knock(res.fishId, t);
      Sound.woodFish(0, false);
      gainMerit(res.total, res.duplicate ? 0 : res.delta, me.x + 46, me.y - 120);
    } catch (e) {
      if (e.code !== 'too_fast') UI.toast(friendly(e), 'warn');
    } finally {
      me.busy = false;
    }
  }

  async function startMeditation() {
    if (me.busy || me.activity !== 'idle') return;
    me.busy = true;
    try {
      await Net.request('meditation:start');
      me.activity = 'meditating';
      me.dir = 'down';
      me.moving = false;
      me.actStart = t;
      me.med = { seconds: 0, points: 0 };
      UI.meditation(me.med);
      Sound.meditationBell();
      UI.toast('Hít vào nhẹ nhàng, thở ra chậm rãi… Mỗi giây thiền được +1 công đức.', '', 3200);
    } catch (e) {
      UI.toast(friendly(e), 'warn');
    } finally {
      me.busy = false;
    }
  }

  async function standUp() {
    if (me.busy || (me.activity !== 'meditating' && me.activity !== 'wooden_fish')) return;
    const wasMeditating = me.activity === 'meditating';
    me.busy = true;
    try {
      const res = await Net.request('activity:stop');
      if (wasMeditating && res.meditation) {
        const m = res.meditation;
        profile.merit_points = res.total;
        UI.setMerit(res.total, m.points > 0);
        if (m.points > 0) {
          UI.toast(`Thiền ${Utils.formatTime(m.seconds)} · +${Utils.formatNumber(m.points)} công đức`, 'good', 3200);
          Sound.merit();
        }
      }
    } catch (_) {
      // Offline: the server ends the session on disconnect anyway.
    } finally {
      me.activity = 'idle';
      me.fishId = null;
      me.med = null;
      UI.meditation(null);
      me.busy = false;
    }
  }

  // Which actions are available right now?
  function context() {
    const now = performance.now();
    if (me.activity === 'meditating') return { primary: { key: 'stand', icon: 'stand', label: 'Đứng dậy', run: standUp, busy: me.busy } };
    if (me.activity === 'wooden_fish') {
      const cd = Utils.clamp(1 - (now - lastKnockAt) / RULES.FISH_MIN_INTERVAL_MS, 0, 1);
      return {
        primary: { key: 'fish', icon: 'fish', label: 'Gõ mõ', run: knockFish, cooldown: cd, busy: me.busy },
        secondary: { run: standUp },
        highlight: null,
      };
    }
    if (me.activity !== 'idle') return {};
    if (World.nearIncense(room, me.x, me.y)) {
      const b = room.incenseBurner;
      const cd = Utils.clamp(1 - (now - lastIncenseAt) / RULES.INCENSE_COOLDOWN_MS, 0, 1);
      return {
        primary: { key: 'incense', icon: 'incense', label: 'Dâng hương', run: offerIncense, cooldown: cd, busy: me.busy },
        highlight: { x: b.x, y: b.y + 8, rx: 112, ry: 34 },
        hint: { x: b.x, y: 380, text: 'Dâng hương' },
      };
    }
    const fish = World.nearestFish(room, me.x, me.y);
    if (fish) {
      let taker = null;
      for (const o of others.values()) if (o.activity === 'wooden_fish' && o.fishId === fish.id) taker = o;
      if (taker) return { hint: { x: fish.x, y: fish.y - 112, text: `${taker.name} đang gõ mõ` } };
      return {
        primary: { key: 'fish', icon: 'fish', label: 'Gõ mõ', run: knockFish, busy: me.busy },
        highlight: { x: fish.x, y: fish.y - 2, rx: 70, ry: 22 },
        hint: { x: fish.x, y: fish.y - 112, text: 'Gõ mõ' },
      };
    }
    if (World.canMeditateAt(room, me.x, me.y)) {
      return { primary: { key: 'meditate', icon: 'meditate', label: 'Ngồi thiền', run: startMeditation, busy: me.busy } };
    }
    return {};
  }

  let ctxNow = {};

  // ---------------------------------------------------------------
  // loop
  // ---------------------------------------------------------------
  function start() {
    if (running) return;
    running = true;
    lastMs = performance.now();
    requestAnimationFrame(frame);
  }

  function stop() { running = false; }

  function frame(ms) {
    if (!running) return;
    const dt = Math.min(0.05, (ms - lastMs) / 1000);
    lastMs = ms;
    t += dt;
    update(dt);
    render(dt);
    requestAnimationFrame(frame);
  }

  function update(dt) {
    Temple.update(dt, t);

    // input
    let act;
    while ((act = Input.take())) {
      if (act === 'action' && ctxNow.primary) ctxNow.primary.run();
      if (act === 'cancel') standUp();
    }

    const mv = Input.movement();
    const mag = Math.hypot(mv.x, mv.y);
    if (me.activity === 'idle' && !me.busy) {
      if (mag > 0.05) {
        if (Math.abs(mv.x) > Math.abs(mv.y)) me.dir = mv.x > 0 ? 'right' : 'left';
        else me.dir = mv.y > 0 ? 'down' : 'up';
        const speed = RULES.PLAYER_SPEED * Math.min(1, mag);
        const nx = World.moveWithCollision(room, me.x, me.y, mv.x * speed * dt, mv.y * speed * dt);
        const d = Math.hypot(nx.x - me.x, nx.y - me.y);
        me.x = nx.x;
        me.y = nx.y;
        me.moving = d > 0.01;
        me.walkPhase += d * 0.085;
      } else {
        me.moving = false;
      }
    } else if ((me.activity === 'meditating' || me.activity === 'wooden_fish') && mag > 0.4) {
      standUp();
    }

    sendAcc += dt;
    if ((me.moving && sendAcc >= SEND_EVERY) || me.moving !== wasMoving) {
      sendAcc = 0;
      Net.move(me.x, me.y, me.dir, me.moving);
      wasMoving = me.moving;
    }

    // others: smooth interpolation + walk animation
    const nowMs = performance.now();
    for (const o of others.values()) {
      const px = o.rx;
      const py = o.ry;
      o.rx = Utils.damp(o.rx, o.tx, 12, dt);
      o.ry = Utils.damp(o.ry, o.ty, 12, dt);
      const d = Math.hypot(o.rx - px, o.ry - py);
      o.walkPhase += d * 0.085;
      o.moving = o.activity === 'idle' && (d > 0.15 || nowMs - o.lastMove < 120);
    }

    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].age += dt;
      if (floats[i].age > 1.6) floats.splice(i, 1);
    }

    ctxNow = context();
    UI.actions(ctxNow);
  }

  // ---------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------
  function charState(o, isMe) {
    return {
      x: isMe ? o.x : o.rx,
      y: isMe ? o.y : o.ry,
      dir: o.dir,
      moving: o.moving,
      walkPhase: o.walkPhase,
      activity: o.activity,
      actT: t - o.actStart,
      knockAge: t - o.knockAt,
      blinkSeed: isMe ? 0.21 : o.blinkSeed,
      away: !isMe && o.away,
    };
  }

  function render(dt) {
    const ctx = Renderer.ctx;
    Renderer.clear(bgImage);
    Renderer.follow(me.x, me.y, dt, false);
    Renderer.applyWorld();

    Temple.drawBackground(ctx, t, ctxNow.highlight);

    const list = [];
    const myAppearance = UI.appearanceOf(profile);
    list.push({ y: me.y, draw: () => Character.draw(ctx, myAppearance, charState(me, true), t) });
    for (const o of others.values()) {
      const st = charState(o, false);
      list.push({ y: st.y, draw: () => Character.draw(ctx, o.appearance, st, t) });
    }
    for (const f of room.woodenFish) {
      let occupied = me.activity === 'wooden_fish' && me.fishId === f.id;
      for (const o of others.values()) if (o.activity === 'wooden_fish' && o.fishId === f.id) occupied = true;
      list.push({ y: f.y, draw: () => Temple.drawFish(ctx, f, t, occupied) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();

    Temple.drawAtmosphere(ctx, t);

    // ---- screen space ----
    Renderer.applyScreen();
    drawVignette(ctx);
    drawLabels(ctx);
    if (ctxNow.hint) drawHint(ctx, ctxNow.hint);
    drawFloats(ctx);
  }

  function drawVignette(ctx) {
    const w = Renderer.viewW;
    const h = Renderer.viewH;
    if (!vignette || vignette.w !== w || vignette.h !== h) {
      const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(20,8,2,0)');
      g.addColorStop(1, 'rgba(20,8,2,0.42)');
      vignette = { w, h, g };
    }
    ctx.fillStyle = vignette.g;
    ctx.fillRect(0, 0, w, h);
  }

  const LABEL_FONT = '600 12.5px "Be Vietnam Pro", system-ui, sans-serif';

  function drawLabels(ctx) {
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const items = [];
    const mk = (name, x, y, activity, isMe, away) => {
      const p = Renderer.worldToScreen(x, y - Character.labelOffset(activity));
      let text = name;
      while (ctx.measureText(text).width > 140 && text.length > 3) text = text.slice(0, -2) + '…';
      const w = ctx.measureText(text).width + 18;
      items.push({ text, x: p.x, y: p.y, w, h: 22, isMe, away, depth: y });
    };
    mk(profile.display_name, me.x, me.y, me.activity, true, false);
    for (const o of others.values()) mk(o.name, o.rx, o.ry, o.activity, false, o.away);

    // de-overlap: local player first, then nearer (lower on screen) characters
    const placed = [];
    items.sort((a, b) => (b.isMe - a.isMe) || (b.depth - a.depth));
    for (const it of items) {
      it.alpha = it.away ? 0.5 : 1;
      for (let attempt = 0; attempt < 3; attempt++) {
        const hit = placed.some((p) => Math.abs(p.x - it.x) < (p.w + it.w) / 2 + 2 && Math.abs(p.y - it.y) < (p.h + it.h) / 2 + 1);
        if (!hit) break;
        if (attempt === 2) { it.alpha *= 0.45; break; }
        it.y -= it.h + 2;
      }
      placed.push(it);
    }
    for (const it of placed.reverse()) {
      ctx.globalAlpha = it.alpha;
      Utils.roundRect(ctx, it.x - it.w / 2, it.y - it.h / 2, it.w, it.h, 11);
      ctx.fillStyle = it.isMe ? 'rgba(255, 249, 238, 0.95)' : 'rgba(255, 246, 232, 0.86)';
      ctx.fill();
      ctx.lineWidth = it.isMe ? 1.5 : 1;
      ctx.strokeStyle = it.isMe ? 'rgba(201, 143, 69, 0.95)' : 'rgba(120, 80, 45, 0.35)';
      ctx.stroke();
      ctx.fillStyle = '#3a2214';
      ctx.fillText(it.text, it.x, it.y + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  function drawHint(ctx, h) {
    const p = Renderer.worldToScreen(h.x, h.y);
    const bob = Math.sin(t * 3) * 2;
    const touch = document.body.classList.contains('touch');
    const label = touch || h.text.includes('đang') ? h.text : `E  ·  ${h.text}`;
    ctx.font = '600 13px "Be Vietnam Pro", system-ui, sans-serif';
    const w = ctx.measureText(label).width + 26;
    Utils.roundRect(ctx, p.x - w / 2, p.y - 15 + bob, w, 30, 15);
    ctx.fillStyle = 'rgba(30, 16, 8, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 196, 122, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y + 15 + bob);
    ctx.lineTo(p.x, p.y + 22 + bob);
    ctx.lineTo(p.x + 6, p.y + 15 + bob);
    ctx.fillStyle = 'rgba(30, 16, 8, 0.82)';
    ctx.fill();
    ctx.fillStyle = '#f6dca8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x, p.y + bob + 0.5);
  }

  function drawFloats(ctx) {
    ctx.font = '700 15px "Noto Serif", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floats) {
      const k = f.age / 1.6;
      const p = Renderer.worldToScreen(f.x, f.y);
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
      const y = p.y - Utils.easeOut(k) * 46;
      const w = ctx.measureText(f.text).width + 22;
      Utils.roundRect(ctx, p.x - w / 2, y - 14, w, 28, 14);
      ctx.fillStyle = 'rgba(34, 16, 6, 0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(240, 196, 122, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#ffe3a3';
      ctx.fillText(f.text, p.x, y + 1);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------
  // wiring
  // ---------------------------------------------------------------
  function wire() {
    $('btn-enter').addEventListener('click', () => {
      Sound.unlock();
      if ($('welcome-status').classList.contains('error')) { findProfile(); return; }
      if (profile) enterTemple(); else openCreate();
    });
    $('btn-recover').addEventListener('click', () => {
      $('recover-error').textContent = '';
      $('recover-input').value = '';
      UI.openOverlay('panel-recover');
    });
    $('recover-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = $('recover-input').value.toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (code.length < 26) { $('recover-error').textContent = 'Mã khôi phục chưa đủ ký tự.'; return; }
      const prev = Net.token();
      Net.setToken(code);
      $('btn-recover-go').disabled = true;
      try {
        profile = await Net.me();
        UI.closeOverlay('panel-recover');
        UI.welcome({ status: `Chào mừng trở lại, ${profile.display_name} · ${Utils.formatNumber(profile.merit_points)} công đức`, profile });
        UI.toast('Đã khôi phục nhân vật.', 'good');
      } catch (err) {
        if (prev) Net.setToken(prev); else Net.clearToken();
        $('recover-error').textContent = err.status === 401 ? 'Mã khôi phục không đúng. Bạn kiểm tra lại nhé.' : err.message;
      } finally {
        $('btn-recover-go').disabled = false;
      }
    });

    $('btn-primary').addEventListener('click', () => { Sound.unlock(); if (ctxNow.primary) ctxNow.primary.run(); });
    $('btn-secondary').addEventListener('click', () => standUp());
    $('btn-sound').addEventListener('click', () => { Sound.unlock(); Sound.toggleMute(); UI.soundIcon(); });
    $('btn-settings').addEventListener('click', () => { Sound.unlock(); UI.openOverlay('panel-settings'); });
    $('btn-show-tutorial').addEventListener('click', () => {
      UI.closeOverlay('panel-settings');
      UI.tutorial(document.body.classList.contains('touch'));
    });
    $('btn-tutorial-ok').addEventListener('click', () => UI.closeOverlay('tutorial'));
    $('btn-profile').addEventListener('click', async () => {
      Sound.unlock();
      let summary = null;
      try { summary = await Net.meritSummary(); } catch (_) { /* show what we have */ }
      if (summary) profile.merit_points = summary.total;
      UI.openProfile(profile, summary, Net.token());
    });
    $('btn-edit-look').addEventListener('click', openEdit);
    document.addEventListener('overlaychange', refreshInputState);
    // first gesture anywhere unlocks audio (never autoplay before that)
    window.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  }

  function boot() {
    UI.init();
    Renderer.init($('game-canvas'));
    Input.init($('joystick'));
    setupNet();
    wire();
    loadBackground().catch(() => { /* retried on enter */ });
    findProfile();
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
