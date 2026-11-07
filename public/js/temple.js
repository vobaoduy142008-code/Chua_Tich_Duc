// ===== Main hall scene: painted background + living light/smoke + props =====
const Temple = (() => {
  let room = null;
  let bg = null;
  const smoke = [];
  const dust = [];
  let sticks = [];          // planted incense (shared by everyone in the room)
  const fishFx = {};        // fishId -> last knock time (s)
  let puff = null;          // soft smoke sprite
  let glow = null;          // warm glow sprite
  let spawnAcc = 0;

  // Light anchors measured on the background art (world units)
  const CANDLES = [
    { x: 621, y: 420, r: 46, k: 1 }, { x: 857, y: 420, r: 46, k: 1 },     // floor candlesticks
    { x: 627, y: 247, r: 30, k: 0.8 }, { x: 779, y: 247, r: 30, k: 0.8 }, // red altar candles
    { x: 597, y: 196, r: 26, k: 0.7 }, { x: 806, y: 196, r: 26, k: 0.7 }, // golden candlesticks
    { x: 489, y: 344, r: 22, k: 0.6 }, { x: 929, y: 342, r: 22, k: 0.6 }, // lotus lamps
  ];
  const LANTERNS = [
    { x: 92, y: 142, r: 120 }, { x: 290, y: 96, r: 105 }, { x: 1112, y: 96, r: 105 }, { x: 1306, y: 142, r: 120 },
  ];
  const CENSERS = [{ x: 582, y: 318 }, { x: 820, y: 316 }];
  const BURNER_SMOKE = { x: 766, y: 414 };
  const SHAFTS = [
    { x0: 40, y0: 230, x1: 380, y1: 780, w: 120 },
    { x0: 1490, y0: 230, x1: 1230, y1: 720, w: 110 },
  ];
  const FLOOR_LIGHT = [
    { x: 300, y: 690, rx: 170, ry: 70 }, { x: 1300, y: 660, rx: 150, ry: 55 },
  ];

  function makeSprites() {
    puff = document.createElement('canvas');
    puff.width = puff.height = 64;
    let g = puff.getContext('2d');
    let grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(240,232,222,0.9)');
    grad.addColorStop(0.5, 'rgba(232,224,214,0.35)');
    grad.addColorStop(1, 'rgba(230,220,210,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);

    glow = document.createElement('canvas');
    glow.width = glow.height = 128;
    g = glow.getContext('2d');
    grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,214,140,0.85)');
    grad.addColorStop(0.25, 'rgba(255,180,90,0.35)');
    grad.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }

  function init(roomDef, image) {
    room = roomDef;
    bg = image;
    if (!puff) makeSprites();
    smoke.length = 0;
    dust.length = 0;
    for (let i = 0; i < 46; i++) dust.push(newMote(true));
    for (let i = 0; i < 40; i++) stepSmoke(spawnSmoke(BURNER_SMOKE.x, BURNER_SMOKE.y, 1), Math.random() * 4);
  }

  function newMote(randomT) {
    const s = SHAFTS[Math.random() < 0.6 ? 0 : 1];
    const t = Math.random();
    return {
      shaft: s,
      t: randomT ? t : 0,
      off: (Math.random() - 0.5) * s.w,
      speed: 0.012 + Math.random() * 0.02,
      size: 0.8 + Math.random() * 1.8,
      phase: Math.random() * 10,
    };
  }

  function spawnSmoke(x, y, strength) {
    const p = {
      x: x + (Math.random() - 0.5) * 6,
      y,
      vx: (Math.random() - 0.5) * 4,
      vy: -(16 + Math.random() * 12),
      age: 0,
      life: 3.2 + Math.random() * 2.2,
      size: 5 + Math.random() * 4,
      grow: 7 + Math.random() * 5,
      alpha: (0.11 + Math.random() * 0.08) * strength,
      seed: Math.random() * 100,
    };
    smoke.push(p);
    return p;
  }

  function stepSmoke(p, dt) {
    p.age += dt;
    p.x += (p.vx + Math.sin(p.seed + p.age * 1.3) * 6) * dt;
    p.y += p.vy * dt;
    p.vy *= 1 - 0.08 * dt;
    p.size += p.grow * dt;
  }

  function update(dt, t) {
    const now = Date.now();
    sticks = sticks.filter((s) => s.expiresAt > now);

    // incense smoke: base wisps + more for each planted stick
    spawnAcc += dt;
    const live = sticks.filter((s) => s.plantAt <= now);
    const rate = 1 / (4 + live.length * 2.5);
    while (spawnAcc > rate) {
      spawnAcc -= rate;
      const src = live.length && Math.random() < 0.7 ? live[(Math.random() * live.length) | 0] : null;
      if (src) {
        const tip = stickTip(src, now);
        spawnSmoke(tip.x, tip.y, 1.1);
      } else if (Math.random() < 0.55) {
        spawnSmoke(BURNER_SMOKE.x, BURNER_SMOKE.y, 1);
      } else {
        const c = CENSERS[(Math.random() * 2) | 0];
        spawnSmoke(c.x, c.y, 0.55).life *= 0.6;
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      stepSmoke(smoke[i], dt);
      if (smoke[i].age > smoke[i].life) smoke.splice(i, 1);
    }
    for (const m of dust) {
      m.t += m.speed * dt;
      if (m.t > 1) Object.assign(m, newMote(false));
    }
  }

  function stickTip(s, now) {
    const burnt = Utils.clamp((now - s.plantAt) / (s.expiresAt - s.plantAt), 0, 1);
    const len = Utils.lerp(56, 22, burnt);
    return { x: room.incenseBurner.mouth.x + s.x * 0.9 + s.x * 0.15, y: room.incenseBurner.mouth.y - len, len };
  }

  // ---------------------------------------------------------------
  // drawing
  // ---------------------------------------------------------------
  function drawBackground(ctx, t, highlight) {
    ctx.drawImage(bg, 0, 0, room.width, room.height);

    // slow breathing of the sun patches on the floor
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    FLOOR_LIGHT.forEach((f, i) => {
      const a = 0.18 + Math.sin(t * 0.35 + i * 2) * 0.08;
      ctx.globalAlpha = a;
      ctx.drawImage(glow, f.x - f.rx, f.y - f.ry, f.rx * 2, f.ry * 2);
    });
    ctx.restore();

    // candle glow behind characters (flicker)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    CANDLES.forEach((c, i) => {
      const f = 0.75 + Math.sin(t * 9.3 + i * 1.7) * 0.08 + Math.sin(t * 23 + i * 3.1) * 0.05 + Math.sin(t * 2.1 + i) * 0.06;
      const r = c.r * (0.92 + f * 0.12);
      ctx.globalAlpha = 0.32 * c.k * f;
      ctx.drawImage(glow, c.x - r, c.y - r, r * 2, r * 2);
      // tiny bright core so the painted flame seems to dance
      ctx.globalAlpha = 0.45 * c.k * f;
      const cr = c.r * 0.16;
      ctx.drawImage(glow, c.x - cr + Math.sin(t * 7 + i) * 0.8, c.y - cr * 1.4, cr * 2, cr * 2.6);
    });
    ctx.restore();

    if (highlight) drawHighlight(ctx, t, highlight);

    // planted incense sticks
    const now = Date.now();
    const mouth = room.incenseBurner.mouth;
    for (const s of sticks) {
      if (s.plantAt > now) continue;
      const tip = stickTip(s, now);
      const x0 = mouth.x + s.x * 0.9;
      ctx.strokeStyle = '#8f3424';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(x0, mouth.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.65 + Math.sin(t * 6 + s.x) * 0.25;
      ctx.drawImage(glow, tip.x - 6, tip.y - 6, 12, 12);
      ctx.restore();
    }

    // smoke (behind characters: the burner stands behind the floor)
    ctx.save();
    for (const p of smoke) {
      const k = p.age / p.life;
      const a = p.alpha * Math.min(1, p.age * 2.5) * (1 - k) * (1 - k * 0.4);
      if (a <= 0.003) continue;
      ctx.globalAlpha = a;
      const s = p.size * 2;
      ctx.drawImage(puff, p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  function drawHighlight(ctx, t, h) {
    const pulse = 0.5 + Math.sin(t * 3.2) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255, 210, 120, ${0.25 + pulse * 0.25})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 18;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, h.rx, h.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Atmosphere drawn above the characters. */
  function drawAtmosphere(ctx, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    LANTERNS.forEach((l, i) => {
      const f = 0.85 + Math.sin(t * 1.6 + i * 1.3) * 0.08 + Math.sin(t * 5.2 + i) * 0.04;
      ctx.globalAlpha = 0.2 * f;
      const r = l.r * (0.95 + f * 0.08);
      ctx.drawImage(glow, l.x - r, l.y - r, r * 2, r * 2);
    });
    // light shafts
    for (const s of SHAFTS) {
      const a = 0.05 + Math.sin(t * 0.4 + s.x0) * 0.015;
      const grad = ctx.createLinearGradient(s.x0, s.y0, s.x1, s.y1);
      grad.addColorStop(0, `rgba(255, 220, 160, ${a * 1.6})`);
      grad.addColorStop(1, 'rgba(255, 210, 150, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      const nx = (s.y1 - s.y0);
      const ny = -(s.x1 - s.x0);
      const len = Math.hypot(nx, ny);
      const ox = (nx / len) * s.w / 2;
      const oy = (ny / len) * s.w / 2;
      ctx.beginPath();
      ctx.moveTo(s.x0 - ox * 0.6, s.y0 - oy * 0.6);
      ctx.lineTo(s.x0 + ox * 0.6, s.y0 + oy * 0.6);
      ctx.lineTo(s.x1 + ox * 1.4, s.y1 + oy * 1.4);
      ctx.lineTo(s.x1 - ox * 1.4, s.y1 - oy * 1.4);
      ctx.closePath();
      ctx.fill();
    }
    // dust motes floating in the sun
    ctx.fillStyle = 'rgba(255, 236, 196, 1)';
    for (const m of dust) {
      const s = m.shaft;
      const x = Utils.lerp(s.x0, s.x1, m.t) + m.off * (0.6 + m.t) + Math.sin(t * 0.6 + m.phase) * 8;
      const y = Utils.lerp(s.y0, s.y1, m.t) + Math.cos(t * 0.5 + m.phase) * 6;
      const tw = 0.5 + Math.sin(t * 2 + m.phase * 3) * 0.5;
      ctx.globalAlpha = (0.25 + tw * 0.45) * Math.sin(m.t * Math.PI);
      ctx.beginPath();
      ctx.arc(x, y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------
  // wooden fish (mõ) prop — y-sorted with the characters
  // ---------------------------------------------------------------
  function drawFish(ctx, f, t, occupied) {
    const last = fishFx[f.id];
    const age = last == null ? 9 : t - last;
    const bounce = age < 0.25 ? Math.sin((age / 0.25) * Math.PI) * 0.035 : 0;
    const x = f.x;
    const y = f.y;
    const OUT = '#2e160c';
    ctx.save();
    ctx.lineJoin = 'round';

    // shadow
    ctx.fillStyle = 'rgba(40,16,6,0.32)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 56, 13, 0, 0, Math.PI * 2); ctx.fill();

    // low lacquered stand
    ctx.fillStyle = '#4a2114';
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 50, y - 24); ctx.lineTo(x + 50, y - 24); ctx.lineTo(x + 46, y - 6); ctx.lineTo(x - 46, y - 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6b301c';
    ctx.beginPath();
    ctx.moveTo(x - 54, y - 30); ctx.lineTo(x + 54, y - 30); ctx.lineTo(x + 50, y - 24); ctx.lineTo(x - 50, y - 24); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#d1a050';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - 42, y - 15); ctx.lineTo(x + 42, y - 15); ctx.stroke();
    for (const lx of [-42, 42]) {
      ctx.fillStyle = '#3a190e';
      ctx.fillRect(x + lx - 4, y - 7, 8, 7);
    }

    // red cushion
    ctx.fillStyle = '#9a2c22';
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y - 34, 42, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(230,180,90,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(x, y - 35, 34, 7.5, 0, 0, Math.PI * 2); ctx.stroke();

    // the mõ
    ctx.save();
    ctx.translate(x, y - 40);
    ctx.scale(1 + bounce, 1 - bounce);
    const g = ctx.createRadialGradient(-10, -30, 4, 0, -18, 44);
    g.addColorStop(0, '#c0643a');
    g.addColorStop(0.45, '#8a3a1e');
    g.addColorStop(1, '#4a1a0c');
    ctx.fillStyle = g;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-34, -4);
    ctx.bezierCurveTo(-38, -30, -20, -44, 0, -44);
    ctx.bezierCurveTo(20, -44, 38, -30, 34, -4);
    ctx.quadraticCurveTo(0, 6, -34, -4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // carved scales / gold line work
    ctx.strokeStyle = 'rgba(232, 186, 98, 0.85)';
    ctx.lineWidth = 1.3;
    for (let row = 0; row < 2; row++) {
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(i * 9 + (row ? 4.5 : 0), -34 + row * 7, 4.5, Math.PI * 0.05, Math.PI * 0.95);
        ctx.stroke();
      }
    }
    // the slit "mouth" with round ends
    ctx.strokeStyle = '#1e0904';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-24, -12); ctx.quadraticCurveTo(0, -4, 24, -12); ctx.stroke();
    ctx.fillStyle = '#1e0904';
    for (const ex of [-25, 25]) { ctx.beginPath(); ctx.arc(ex, -12.5, 3.2, 0, Math.PI * 2); ctx.fill(); }
    // eyes of the fish
    ctx.fillStyle = 'rgba(232, 186, 98, 0.9)';
    for (const ex of [-17, 17]) { ctx.beginPath(); ctx.arc(ex, -22, 2.3, 0, Math.PI * 2); ctx.fill(); }
    // lacquer shine
    ctx.fillStyle = 'rgba(255, 230, 200, 0.28)';
    ctx.beginPath(); ctx.ellipse(-12, -32, 9, 4, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // resting mallet
    if (!occupied) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = OUT; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x + 26, y - 30); ctx.lineTo(x + 56, y - 46); ctx.stroke();
      ctx.strokeStyle = '#7b4a2a'; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.moveTo(x + 26, y - 30); ctx.lineTo(x + 56, y - 46); ctx.stroke();
      ctx.fillStyle = '#a0683c'; ctx.strokeStyle = OUT; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(x + 59, y - 48, 6, 5, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // soft golden ripple when struck
    if (age < 0.8) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255, 210, 130, ${0.45 * (1 - age / 0.8)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y - 62, 30 + age * 60, 12 + age * 22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  return {
    init,
    update,
    drawBackground,
    drawAtmosphere,
    drawFish,
    setIncense(list) { sticks = (list || []).slice(); },
    addIncense(stick) { sticks.push(stick); },
    knock(fishId, t) { fishFx[fishId] = t; },
    lastKnock: (fishId) => fishFx[fishId],
  };
})();
