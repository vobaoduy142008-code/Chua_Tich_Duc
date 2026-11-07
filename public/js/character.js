// ===== Character renderer =====
// Chibi lay-Buddhist characters drawn with Canvas paths, styled after the
// reference sheets (big head, large brown eyes, wrap robe with a tied sash).
// Local origin = point between the feet; 1 unit = 1 world pixel; ~150 tall.
const Character = (() => {
  const OUT = '#3b2416';
  const LW = 2.2;
  const paletteCache = new Map();

  function palette(a) {
    const key = `${a.skin}|${a.hair}|${a.robe}`;
    let p = paletteCache.get(key);
    if (p) return p;
    p = {
      skin: a.skin,
      skinShade: Utils.mix(a.skin, '#b0603f', 0.28),
      skinDeep: Utils.mix(a.skin, '#7a3a24', 0.45),
      hair: a.hair,
      hairShade: Utils.shade(a.hair, -0.35),
      hairHi: Utils.mix(a.hair, '#f4d6b0', 0.32),
      robe: a.robe,
      robeHi: Utils.shade(a.robe, 0.16),
      robeShade: Utils.mix(a.robe, '#2a1a12', 0.22),
      robeDeep: Utils.mix(a.robe, '#2a1a12', 0.36),
      trousers: Utils.mix(a.robe, '#2a1a12', 0.1),
      shoe: '#2e2320',
    };
    paletteCache.set(key, p);
    return p;
  }

  // ---------------------------------------------------------------
  // primitives
  // ---------------------------------------------------------------
  function fs(ctx, fill, lw) {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = lw || LW;
    ctx.strokeStyle = OUT;
    ctx.stroke();
  }

  function ellipse(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
  }

  /** Thick limb as an outlined stroke (used for raised arms). */
  function limb(ctx, pts, width, fill) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      if (pts.length === 6) ctx.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]);
      else ctx.lineTo(pts[2], pts[3]);
    };
    path();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = width + LW * 2;
    ctx.stroke();
    path();
    ctx.strokeStyle = fill;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function shadow(ctx, rx, ry) {
    ellipse(ctx, 0, -1, rx, ry);
    ctx.fillStyle = 'rgba(45, 20, 8, 0.28)';
    ctx.fill();
  }

  // ---------------------------------------------------------------
  // head, face, hair
  // ---------------------------------------------------------------
  const HEAD_RX = 31;
  const HEAD_RY = 29;

  function head(ctx, c, hy, view, look) {
    // ears (visible unless long hair covers them — hair is drawn later anyway)
    if (view !== 'side') {
      ellipse(ctx, -30, hy + 5, 5.5, 7.5); fs(ctx, c.skin);
      ellipse(ctx, 30, hy + 5, 5.5, 7.5); fs(ctx, c.skin);
    } else {
      ellipse(ctx, -6, hy + 5, 5.5, 7.5); fs(ctx, c.skin);
    }
    ellipse(ctx, 0, hy, HEAD_RX, HEAD_RY);
    fs(ctx, c.skin);
    // soft jaw shading
    ctx.save();
    ellipse(ctx, 0, hy, HEAD_RX - 1, HEAD_RY - 1);
    ctx.clip();
    ctx.fillStyle = Utils.rgba(c.skinShade, 0.35);
    ellipse(ctx, view === 'side' ? -16 : 12, hy + 14, 26, 16);
    ctx.fill();
    ctx.restore();
    if (view !== 'back') face(ctx, c, hy, view, look);
  }

  function face(ctx, c, hy, view, look) {
    const side = view === 'side';
    const fx = side ? 10 : 0;            // face shifts toward the facing side
    const ey = hy + 5;
    const eyes = side ? [[fx - 3, 0.62], [fx + 14, 1]] : [[-11.5, 1], [11.5, 1]];

    // eyebrows
    ctx.lineCap = 'round';
    ctx.strokeStyle = Utils.shade(c.hair, -0.1);
    ctx.lineWidth = 1.8;
    for (const [ex, w] of eyes) {
      ctx.beginPath();
      ctx.ellipse(ex, ey - 7, 5.5 * w, 3, 0, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }

    for (const [ex, w] of eyes) {
      if (look.closed) {
        ctx.beginPath();
        ctx.ellipse(ex, ey + 1, 5.5 * w, 3, 0, Math.PI * 0.1, Math.PI * 0.9);
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 2;
        ctx.stroke();
        continue;
      }
      const ry = 7.6;
      const rx = 6.2 * w;
      const g = ctx.createLinearGradient(0, ey - ry, 0, ey + ry);
      g.addColorStop(0, '#2c160c');
      g.addColorStop(0.55, '#5a321c');
      g.addColorStop(1, '#a8703f');
      ellipse(ctx, ex, ey + (look.down ? 1.5 : 0), rx, ry);
      ctx.fillStyle = g;
      ctx.fill();
      ellipse(ctx, ex + (side ? 1 : 0), ey + 1 + (look.down ? 1.5 : 0), rx * 0.48, ry * 0.5);
      ctx.fillStyle = '#1e0f08';
      ctx.fill();
      // highlights
      ellipse(ctx, ex - rx * 0.32, ey - 2.8, 2.3 * w, 2.3);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ellipse(ctx, ex + rx * 0.35, ey + 3.2, 1.1 * w, 1.1);
      ctx.fill();
      // upper lid
      ctx.beginPath();
      ctx.ellipse(ex, ey + 0.5, rx + 0.8, ry + 0.6, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      if (look.lashes) {
        ctx.beginPath();
        const dirX = ex > fx ? 1 : -1;
        ctx.moveTo(ex + dirX * (rx + 0.5), ey - 3);
        ctx.lineTo(ex + dirX * (rx + 3.2), ey - 5.5);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }

    // blush
    ctx.fillStyle = 'rgba(236, 118, 104, 0.26)';
    const blush = side ? [[fx + 18, 1], [fx - 6, 0.6]] : [[-19, 1], [19, 1]];
    for (const [bx, w] of blush) { ellipse(ctx, bx, hy + 14, 5.5 * w, 3); ctx.fill(); }

    // nose + mouth
    ctx.strokeStyle = c.skinDeep;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(fx + (side ? 6 : 0), hy + 11);
    ctx.lineTo(fx + (side ? 7 : 0.6), hy + 13);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(fx + (side ? 6 : 0), hy + 15.5, 4, Math.PI * 0.18, Math.PI * 0.82);
    ctx.strokeStyle = '#8a4636';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function hairHighlight(ctx, c, hy, x) {
    ctx.beginPath();
    ctx.ellipse(x || -6, hy - 20, 14, 5, -0.25, Math.PI * 1.05, Math.PI * 1.95);
    ctx.strokeStyle = Utils.rgba(c.hairHi, 0.8);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /** Hair drawn behind the head/body (long hair, buns). */
  function hairBack(ctx, c, a, hy, view) {
    const st = a.hairStyle;
    if (st === 'long') {
      ctx.beginPath();
      if (view === 'back') {
        ctx.moveTo(-33, hy - 6);
        ctx.bezierCurveTo(-36, hy + 30, -37, hy + 52, -32, hy + 62);
        ctx.quadraticCurveTo(-16, hy + 70, 0, hy + 64);
        ctx.quadraticCurveTo(16, hy + 70, 32, hy + 62);
        ctx.bezierCurveTo(37, hy + 52, 36, hy + 30, 33, hy - 6);
        ctx.closePath();
      } else if (view === 'side') {
        ctx.moveTo(-28, hy - 14);
        ctx.bezierCurveTo(-40, hy + 20, -38, hy + 50, -30, hy + 60);
        ctx.quadraticCurveTo(-18, hy + 64, -6, hy + 56);
        ctx.lineTo(4, hy + 6);
        ctx.closePath();
      } else {
        ctx.moveTo(-34, hy - 4);
        ctx.bezierCurveTo(-40, hy + 26, -40, hy + 44, -36, hy + 54);
        ctx.lineTo(36, hy + 54);
        ctx.bezierCurveTo(40, hy + 44, 40, hy + 26, 34, hy - 4);
        ctx.closePath();
      }
      fs(ctx, c.hairShade);
    } else if (st === 'bun') {
      const bx = view === 'side' ? -6 : 0;
      ellipse(ctx, bx, hy - 33, 14, 12.5); fs(ctx, c.hair);
      ctx.beginPath();
      ctx.arc(bx - 3, hy - 37, 7, Math.PI * 1.1, Math.PI * 1.7);
      ctx.strokeStyle = Utils.rgba(c.hairHi, 0.8);
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else if (st === 'low_bun' && view !== 'back') {
      const bx = view === 'side' ? -27 : 26;
      ellipse(ctx, bx, hy + 18, 11.5, 10.5); fs(ctx, c.hair);
    }
  }

  /** Hair drawn over the head. */
  function hairFront(ctx, c, a, hy, view) {
    const st = a.hairStyle;
    const side = view === 'side';

    if (st === 'shaved') {
      ctx.save();
      ellipse(ctx, 0, hy, HEAD_RX - 1, HEAD_RY - 1);
      ctx.clip();
      ctx.fillStyle = Utils.rgba(c.hair, 0.16);
      ctx.beginPath();
      if (view === 'back') ctx.rect(-40, hy - 40, 80, 58);
      else ctx.ellipse(side ? -6 : 0, hy - 16, 36, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ellipse(ctx, side ? -4 : -9, hy - 17, 9, 4.5, -0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      return;
    }

    if (view === 'back') {
      ctx.beginPath();
      if (st === 'short') {
        ctx.moveTo(-32, hy + 4);
        ctx.bezierCurveTo(-36, hy - 30, -16, hy - 36, 0, hy - 35);
        ctx.bezierCurveTo(16, hy - 36, 36, hy - 30, 32, hy + 4);
        ctx.lineTo(26, hy + 14); ctx.lineTo(18, hy + 10); ctx.lineTo(10, hy + 18);
        ctx.lineTo(0, hy + 12); ctx.lineTo(-10, hy + 18); ctx.lineTo(-18, hy + 10);
        ctx.lineTo(-26, hy + 14);
        ctx.closePath();
        fs(ctx, c.hair);
      } else {
        ctx.moveTo(-33, hy + 6);
        ctx.bezierCurveTo(-36, hy - 30, -16, hy - 35, 0, hy - 34);
        ctx.bezierCurveTo(16, hy - 35, 36, hy - 30, 33, hy + 6);
        if (st === 'long') { ctx.lineTo(33, hy + 20); ctx.lineTo(-33, hy + 20); }
        else ctx.quadraticCurveTo(0, hy + 26, -33, hy + 6);
        ctx.closePath();
        fs(ctx, c.hair);
        if (st === 'long') {
          ctx.strokeStyle = Utils.rgba(c.hairShade, 0.9);
          ctx.lineWidth = 1.4;
          for (const sx of [-16, 0, 16]) {
            ctx.beginPath();
            ctx.moveTo(sx, hy - 18);
            ctx.quadraticCurveTo(sx + 3, hy + 30, sx - 2, hy + 60);
            ctx.stroke();
          }
        }
        if (st === 'low_bun') { ellipse(ctx, 0, hy + 22, 13, 11); fs(ctx, c.hair); }
      }
      hairHighlight(ctx, c, hy, 0);
      return;
    }

    const ox = side ? -5 : 0;
    if (st === 'short') {
      ctx.beginPath();
      ctx.moveTo(ox - 32, hy + 6);
      ctx.bezierCurveTo(ox - 35, hy - 26, ox - 16, hy - 36, ox + 2, hy - 35);
      ctx.bezierCurveTo(ox + 22, hy - 35, ox + 36, hy - 24, ox + 33, hy + 4);
      if (side) {
        ctx.lineTo(ox + 34, hy - 6); ctx.lineTo(ox + 28, hy - 10); ctx.lineTo(ox + 30, hy - 15);
        ctx.lineTo(ox + 20, hy - 14); ctx.lineTo(ox + 14, hy - 21); ctx.lineTo(ox + 8, hy - 12);
        ctx.lineTo(ox - 2, hy - 18); ctx.lineTo(ox - 4, hy - 4); ctx.lineTo(ox - 14, hy + 2);
        ctx.lineTo(ox - 20, hy + 14);
      } else {
        ctx.lineTo(ox + 30, hy - 2); ctx.lineTo(ox + 25, hy - 12); ctx.lineTo(ox + 20, hy - 9);
        ctx.lineTo(ox + 16, hy - 18); ctx.lineTo(ox + 10, hy - 9); ctx.lineTo(ox + 4, hy - 19);
        ctx.lineTo(ox - 3, hy - 9); ctx.lineTo(ox - 9, hy - 18); ctx.lineTo(ox - 15, hy - 10);
        ctx.lineTo(ox - 21, hy - 16); ctx.lineTo(ox - 25, hy - 6); ctx.lineTo(ox - 30, hy - 2);
      }
      ctx.closePath();
      fs(ctx, c.hair);
      hairHighlight(ctx, c, hy, ox - 4);
      return;
    }

    // ---- female styles ----
    if (st === 'long') {
      for (const s of side ? [-1] : [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(ox, hy - 33);
        ctx.bezierCurveTo(ox + s * 22, hy - 35, ox + s * 36, hy - 20, ox + s * 35, hy + 2);
        ctx.bezierCurveTo(ox + s * 36, hy + 24, ox + s * 38, hy + 40, ox + s * 34, hy + 52);
        ctx.quadraticCurveTo(ox + s * 28, hy + 56, ox + s * 24, hy + 48);
        ctx.bezierCurveTo(ox + s * 26, hy + 30, ox + s * 27, hy + 10, ox + s * 25, hy - 4);
        ctx.bezierCurveTo(ox + s * 22, hy - 18, ox + s * 10, hy - 26, ox + s * 1, hy - 26);
        ctx.closePath();
        fs(ctx, c.hair);
      }
      if (side) {
        ctx.beginPath();
        ctx.moveTo(ox, hy - 33);
        ctx.bezierCurveTo(ox + 20, hy - 34, ox + 33, hy - 22, ox + 32, hy - 6);
        ctx.quadraticCurveTo(ox + 18, hy - 22, ox + 1, hy - 26);
        ctx.closePath();
        fs(ctx, c.hair);
      }
      hairHighlight(ctx, c, hy, ox - 9);
      return;
    }

    // bun / low bun: hair pulled back with a soft parted front
    ctx.beginPath();
    ctx.moveTo(ox - 32, hy + 6);
    ctx.bezierCurveTo(ox - 35, hy - 26, ox - 16, hy - 35, ox + 1, hy - 34);
    ctx.bezierCurveTo(ox + 20, hy - 35, ox + 35, hy - 24, ox + 33, hy + 6);
    ctx.bezierCurveTo(ox + 30, hy - 6, ox + 22, hy - 18, ox + 6, hy - 22);
    ctx.quadraticCurveTo(ox + 1, hy - 18, ox - 3, hy - 22);
    ctx.bezierCurveTo(ox - 20, hy - 18, ox - 29, hy - 6, ox - 32, hy + 6);
    ctx.closePath();
    fs(ctx, c.hair);
    // loose strands at the temples (as on the reference sheet)
    ctx.strokeStyle = c.hair;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const s of side ? [1] : [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(ox + s * 27, hy - 4);
      ctx.quadraticCurveTo(ox + s * 31, hy + 10, ox + s * 27, hy + 20);
      ctx.stroke();
    }
    hairHighlight(ctx, c, hy, ox - 4);
  }

  // ---------------------------------------------------------------
  // standing body (front / back / side)
  // ---------------------------------------------------------------
  function robePath(ctx, sh, hem, top, bottom, flare) {
    ctx.beginPath();
    ctx.moveTo(-sh, top);
    ctx.quadraticCurveTo(-sh - 4, (top + bottom) / 2, -hem + flare, bottom);
    ctx.quadraticCurveTo(flare / 2, bottom + 4, hem + flare, bottom);
    ctx.quadraticCurveTo(sh + 4, (top + bottom) / 2, sh, top);
    ctx.quadraticCurveTo(0, top - 7, -sh, top);
    ctx.closePath();
  }

  function legs(ctx, c, view, phase, moving) {
    const s = moving ? Math.sin(phase) : 0;
    if (view === 'side') {
      for (const k of [-1, 1]) {
        const off = s * 10 * k;
        const lift = moving ? Math.max(0, Math.sin(phase + (k > 0 ? 0 : Math.PI))) * 4 : 0;
        ctx.beginPath();
        ctx.moveTo(off - 6, -38);
        ctx.lineTo(off - 7, -9 - lift);
        ctx.lineTo(off + 7, -9 - lift);
        ctx.lineTo(off + 6, -38);
        ctx.closePath();
        fs(ctx, k < 0 ? c.robeShade : c.trousers);
        ellipse(ctx, off + 3, -5 - lift, 11, 5.5);
        fs(ctx, c.shoe);
      }
      return;
    }
    for (const k of [-1, 1]) {
      const lift = moving ? Math.max(0, s * k) * 5 : 0;
      ctx.beginPath();
      ctx.moveTo(k * 3, -38);
      ctx.lineTo(k * 3, -9 - lift);
      ctx.lineTo(k * 17, -9 - lift);
      ctx.lineTo(k * 18, -38);
      ctx.closePath();
      fs(ctx, c.trousers);
      ellipse(ctx, k * 10.5, -5.5 - lift, 9.5, 6);
      fs(ctx, c.shoe);
    }
  }

  function sleeveFront(ctx, c, k, swing) {
    // k = -1 left, +1 right (screen)
    const sx = k * 19;
    ctx.beginPath();
    ctx.moveTo(sx, -82);
    ctx.quadraticCurveTo(k * 31, -78, k * 33, -62 + swing * 0.3);
    ctx.lineTo(k * 36, -44 + swing);
    ctx.quadraticCurveTo(k * 29, -40 + swing, k * 21, -44 + swing);
    ctx.lineTo(k * 21, -62);
    ctx.closePath();
    fs(ctx, k > 0 ? c.robeShade : c.robe);
    // sleeve opening
    ellipse(ctx, k * 28.5, -43.5 + swing, 7.5, 2.6);
    ctx.fillStyle = c.robeDeep;
    ctx.fill();
    // hand
    ellipse(ctx, k * 28, -40 + swing, 5.2, 5.6);
    fs(ctx, c.skin, 1.8);
  }

  function collarFront(ctx, c, top) {
    // skin V at the neck
    ctx.beginPath();
    ctx.moveTo(-8, top - 4);
    ctx.lineTo(8, top - 4);
    ctx.lineTo(0, top + 10);
    ctx.closePath();
    ctx.fillStyle = c.skin;
    ctx.fill();
    // right panel edge (under)
    ctx.beginPath();
    ctx.moveTo(9, top - 5);
    ctx.lineTo(13, top - 3);
    ctx.lineTo(1, top + 13);
    ctx.lineTo(-1, top + 10);
    ctx.closePath();
    fs(ctx, c.robeDeep, 1.6);
    // left panel crossing over (left over right)
    ctx.beginPath();
    ctx.moveTo(-12, top - 3);
    ctx.lineTo(-7, top - 5);
    ctx.lineTo(11, top + 24);
    ctx.lineTo(5, top + 26);
    ctx.closePath();
    fs(ctx, c.robeDeep, 1.6);
  }

  function sash(ctx, c, y, bodyClip, bow) {
    ctx.save();
    bodyClip();
    ctx.clip();
    ctx.fillStyle = c.robeDeep;
    ctx.fillRect(-40, y, 80, 7);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-40, y); ctx.lineTo(40, y); ctx.moveTo(-40, y + 7); ctx.lineTo(40, y + 7); ctx.stroke();
    ctx.restore();
    if (!bow) return;
    const bx = -9;
    const by = y + 3.5;
    // tails
    for (const [ex, ey] of [[-14, by + 20], [-5, by + 17]]) {
      limb(ctx, [bx, by + 2, ex - 1, by + 10, ex, ey], 3.4, c.robeShade);
    }
    // loops
    ellipse(ctx, bx - 7, by - 1, 6.5, 3.6, -0.35); fs(ctx, c.robeShade, 1.6);
    ellipse(ctx, bx + 7, by - 1, 6.5, 3.6, 0.35); fs(ctx, c.robeShade, 1.6);
    ellipse(ctx, bx, by, 3, 3); fs(ctx, c.robeDeep, 1.6);
  }

  function drawStanding(ctx, a, c, st, t) {
    const view = st.dir === 'up' ? 'back' : (st.dir === 'left' || st.dir === 'right') ? 'side' : 'front';
    const moving = st.moving;
    const ph = st.walkPhase || 0;
    const bob = moving ? -Math.abs(Math.sin(ph)) * 2.6 : Math.sin(t * 1.6) * 0.6;
    const swing = moving ? Math.sin(ph) * 4 : 0;
    const look = { closed: blink(st, t), lashes: a.gender === 'female', down: false };

    shadow(ctx, 30, 8);
    if (st.dir === 'left') ctx.scale(-1, 1);

    legs(ctx, c, view, ph, moving);
    ctx.translate(0, bob);
    const hy = -112;

    if (view === 'side') {
      hairBack(ctx, c, a, hy, view);
      // far arm (behind the body)
      ctx.save();
      ctx.translate(-2, -78);
      ctx.rotate(Math.sin(ph) * (moving ? 0.35 : 0));
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.quadraticCurveTo(-10, 18, -8, 34); ctx.lineTo(8, 34); ctx.quadraticCurveTo(8, 16, 6, 0);
      ctx.closePath();
      fs(ctx, c.robeDeep);
      ctx.restore();
      // body
      const bodyClip = () => robePath(ctx, 16, 21, -82, -30, -2);
      bodyClip(); fs(ctx, c.robe);
      ctx.save(); bodyClip(); ctx.clip();
      ctx.fillStyle = Utils.rgba(c.robeShade, 0.6); ctx.fillRect(-30, -90, 14, 70);
      ctx.restore();
      // collar (side)
      ctx.beginPath();
      ctx.moveTo(4, -86); ctx.lineTo(10, -84); ctx.lineTo(16, -60); ctx.lineTo(11, -60);
      ctx.closePath();
      fs(ctx, c.robeDeep, 1.6);
      sash(ctx, c, -60, bodyClip, false);
      // sash tails on the front side
      limb(ctx, [14, -55, 18, -45, 16, -36], 3.2, c.robeShade);
      // neck + head
      ctx.fillStyle = c.skin;
      ctx.fillRect(-1, -92, 9, 10);
      head(ctx, c, hy, view, look);
      hairFront(ctx, c, a, hy, view);
      // near arm
      ctx.save();
      ctx.translate(2, -79);
      ctx.rotate(-Math.sin(ph) * (moving ? 0.35 : 0.04));
      ctx.beginPath();
      ctx.moveTo(-7, 0); ctx.quadraticCurveTo(-11, 18, -9, 36); ctx.lineTo(10, 36); ctx.quadraticCurveTo(10, 14, 7, 0);
      ctx.closePath();
      fs(ctx, c.robe);
      ellipse(ctx, 0.5, 36, 9.5, 2.6); ctx.fillStyle = c.robeDeep; ctx.fill();
      ellipse(ctx, 1, 40, 5, 5.4); fs(ctx, c.skin, 1.8);
      ctx.restore();
      return;
    }

    if (view === 'back') {
      hairBack(ctx, c, a, hy, view);
      sleeveFront(ctx, c, -1, -swing);
      sleeveFront(ctx, c, 1, swing);
      const bodyClip = () => robePath(ctx, 21, 27, -82, -30, 0);
      bodyClip(); fs(ctx, c.robe);
      ctx.save(); bodyClip(); ctx.clip();
      ctx.fillStyle = Utils.rgba(c.robeShade, 0.5); ctx.fillRect(6, -90, 30, 70);
      // back seam
      ctx.strokeStyle = Utils.rgba(c.robeDeep, 0.8); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -84); ctx.lineTo(0, -30); ctx.stroke();
      ctx.restore();
      sash(ctx, c, -60, bodyClip, false);
      ctx.fillStyle = c.skin;
      ctx.fillRect(-6, -92, 12, 9);
      // back collar
      ctx.beginPath(); ctx.moveTo(-12, -84); ctx.quadraticCurveTo(0, -78, 12, -84); ctx.lineTo(10, -88); ctx.quadraticCurveTo(0, -83, -10, -88); ctx.closePath();
      fs(ctx, c.robeDeep, 1.6);
      head(ctx, c, hy, view, look);
      hairFront(ctx, c, a, hy, view);
      if (a.hairStyle === 'bun') hairBack(ctx, c, a, hy, 'front');
      return;
    }

    // front
    hairBack(ctx, c, a, hy, view);
    const bodyClip = () => robePath(ctx, 21, 27, -82, -30, 0);
    bodyClip(); fs(ctx, c.robe);
    ctx.save(); bodyClip(); ctx.clip();
    const g = ctx.createLinearGradient(-28, 0, 28, 0);
    g.addColorStop(0, Utils.rgba(c.robeHi, 0.45));
    g.addColorStop(0.45, 'rgba(0,0,0,0)');
    g.addColorStop(1, Utils.rgba(c.robeShade, 0.75));
    ctx.fillStyle = g; ctx.fillRect(-30, -90, 60, 70);
    // fold line of the wrap
    ctx.strokeStyle = Utils.rgba(c.robeDeep, 0.7); ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(8, -56); ctx.quadraticCurveTo(10, -42, 6, -30); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = c.skin;
    ctx.fillRect(-6, -92, 12, 9);
    collarFront(ctx, c, -82);
    sash(ctx, c, -60, bodyClip, true);
    sleeveFront(ctx, c, -1, -swing);
    sleeveFront(ctx, c, 1, swing);
    head(ctx, c, hy, view, look);
    hairFront(ctx, c, a, hy, view);
  }

  // ---------------------------------------------------------------
  // seated poses: meditation + wooden fish
  // ---------------------------------------------------------------
  function cushion(ctx) {
    ellipse(ctx, 0, -9, 40, 13);
    fs(ctx, '#7a3424');
    ellipse(ctx, 0, -13, 36, 10);
    ctx.fillStyle = '#9b4a32';
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,20,10,0.5)';
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 9, -21);
      ctx.quadraticCurveTo(i * 10.5, -12, i * 12, -4);
      ctx.stroke();
    }
  }

  function seatedBase(ctx, c) {
    // crossed legs under the robe
    ctx.beginPath();
    ctx.moveTo(-38, -18);
    ctx.quadraticCurveTo(-40, -32, -24, -34);
    ctx.lineTo(24, -34);
    ctx.quadraticCurveTo(40, -32, 38, -18);
    ctx.quadraticCurveTo(20, -8, 0, -12);
    ctx.quadraticCurveTo(-20, -8, -38, -18);
    ctx.closePath();
    fs(ctx, c.robe);
    ctx.fillStyle = Utils.rgba(c.robeShade, 0.7);
    ellipse(ctx, 18, -19, 16, 7);
    ctx.fill();
    ctx.strokeStyle = Utils.rgba(c.robeDeep, 0.8);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-26, -22); ctx.quadraticCurveTo(0, -14, 26, -22);
    ctx.stroke();
  }

  function seatedTorso(ctx, c, a, breathe, look, armsFn) {
    const top = -68 + breathe;
    const bodyClip = () => robePath(ctx, 19, 25, top, -26, 0);
    const hy = top - 30;
    hairBack(ctx, c, a, hy, 'front');
    bodyClip(); fs(ctx, c.robe);
    ctx.save(); bodyClip(); ctx.clip();
    const g = ctx.createLinearGradient(-26, 0, 26, 0);
    g.addColorStop(0, Utils.rgba(c.robeHi, 0.4));
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, Utils.rgba(c.robeShade, 0.7));
    ctx.fillStyle = g; ctx.fillRect(-30, top - 8, 60, 60);
    ctx.restore();
    ctx.fillStyle = c.skin;
    ctx.fillRect(-6, top - 10, 12, 9);
    collarFront(ctx, c, top);
    sash(ctx, c, top + 20, bodyClip, false);
    armsFn(top);
    head(ctx, c, hy, 'front', look);
    hairFront(ctx, c, a, hy, 'front');
    if (a.hairStyle === 'bun') { /* bun drawn in hairBack */ }
    return hy;
  }

  function drawMeditating(ctx, a, c, st, t) {
    shadow(ctx, 44, 11);
    // soft golden aura, very subtle
    const pulse = 0.5 + Math.sin(t * 1.1) * 0.5;
    const r = 70 + pulse * 8;
    const g = ctx.createRadialGradient(0, -60, 10, 0, -60, r);
    g.addColorStop(0, `rgba(255, 222, 150, ${0.16 + pulse * 0.06})`);
    g.addColorStop(1, 'rgba(255, 222, 150, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, -60, r, 0, Math.PI * 2); ctx.fill();

    cushion(ctx);
    seatedBase(ctx, c);
    const breathe = Math.sin(t * 1.3) * 1.1;
    seatedTorso(ctx, c, a, breathe, { closed: true, lashes: a.gender === 'female' }, (top) => {
      for (const k of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(k * 18, top + 2);
        ctx.quadraticCurveTo(k * 32, top + 14, k * 30, -30);
        ctx.quadraticCurveTo(k * 16, -24, k * 4, -28);
        ctx.quadraticCurveTo(k * 14, top + 26, k * 16, top + 14);
        ctx.closePath();
        fs(ctx, k > 0 ? c.robeShade : c.robe);
      }
      // hands resting in the lap (dhyana mudra)
      ellipse(ctx, 0, -30, 11, 5); fs(ctx, c.skin, 1.8);
      ctx.beginPath(); ctx.moveTo(-4, -33); ctx.quadraticCurveTo(0, -37, 4, -33);
      ctx.strokeStyle = c.skinDeep; ctx.lineWidth = 1.2; ctx.stroke();
    });
  }

  function drawFish(ctx, a, c, st, t) {
    shadow(ctx, 44, 11);
    cushion(ctx);
    seatedBase(ctx, c);
    // strike curve: quick hit, slow return
    const age = st.knockAge == null ? 9 : st.knockAge;
    let k;
    if (age < 0.07) k = age / 0.07;
    else if (age < 0.45) k = 1 - Utils.easeOut((age - 0.07) / 0.38);
    else k = 0;
    const lift = 1 - k;
    seatedTorso(ctx, c, a, 0, { closed: blink(st, t), lashes: a.gender === 'female', down: true }, (top) => {
      // left arm resting on the knee
      ctx.beginPath();
      ctx.moveTo(-18, top + 2);
      ctx.quadraticCurveTo(-32, top + 14, -32, -30);
      ctx.quadraticCurveTo(-22, -24, -16, -30);
      ctx.quadraticCurveTo(-16, top + 22, -16, top + 14);
      ctx.closePath();
      fs(ctx, c.robe);
      ellipse(ctx, -26, -27, 5, 4.6); fs(ctx, c.skin, 1.8);
      // right arm with the mallet
      // the mõ sits in front of the lap; its top is ~30 units above the seat
      const hx = Utils.lerp(14, 30, lift);
      const hyy = Utils.lerp(-48, -70, lift);
      limb(ctx, [17, top + 4, 30, top + 18, hx, hyy], 12, c.robeShade);
      const ang = Utils.lerp(2.1, -0.5, lift);
      const mx = hx + Math.cos(ang) * 24;
      const my = hyy + Math.sin(ang) * 24;
      ctx.lineCap = 'round';
      ctx.strokeStyle = OUT; ctx.lineWidth = 6.5;
      ctx.beginPath(); ctx.moveTo(hx, hyy); ctx.lineTo(mx, my); ctx.stroke();
      ctx.strokeStyle = '#7b4a2a'; ctx.lineWidth = 3.6;
      ctx.beginPath(); ctx.moveTo(hx, hyy); ctx.lineTo(mx, my); ctx.stroke();
      ellipse(ctx, mx, my, 6, 5.2, ang); fs(ctx, '#a0683c', 1.8);
      ellipse(ctx, hx, hyy, 5.4, 5.4); fs(ctx, c.skin, 1.8);
    });
  }

  // ---------------------------------------------------------------
  // offering incense (seen from behind, facing the altar)
  // ---------------------------------------------------------------
  /** Returns {handY, bow, sticks} for time t (s) into the offering. */
  function incenseTimeline(tt) {
    let handY;
    let bow = 0;
    let sticks = true;
    if (tt < 0.7) handY = Utils.lerp(-62, -150, Utils.easeInOut(tt / 0.7));
    else if (tt < 2.5) {
      handY = -150;
      const cyc = ((tt - 0.7) % 0.6) / 0.6;
      bow = Math.sin(cyc * Math.PI) ** 2;
    } else if (tt < 3.0) handY = Utils.lerp(-150, -166, Utils.easeInOut((tt - 2.5) / 0.5));
    else { handY = Utils.lerp(-166, -66, Utils.easeInOut(Math.min(1, (tt - 3.0) / 0.5))); sticks = false; }
    if (tt > 2.85) sticks = false;
    return { handY, bow, sticks };
  }

  function drawIncense(ctx, a, c, st, t) {
    const tt = st.actT || 0;
    const { handY, bow, sticks } = incenseTimeline(tt);
    shadow(ctx, 30, 8);
    legs(ctx, c, 'back', 0, false);
    const dip = bow * 9;
    const hy = -112 + dip;
    const hY = handY + dip;

    // raised arms are in front of the body (hidden side) → draw first.
    // Elbows go out wider than the head so the gesture reads from behind.
    const raise = Utils.clamp((-hY - 62) / 88, 0, 1);
    for (const k of [-1, 1]) {
      limb(ctx, [k * 19, -78 + dip * 0.4, k * Utils.lerp(26, 42, raise), Utils.lerp(-70, -118, raise) + dip, k * 5, hY + 8], 12, c.robeShade);
    }
    if (sticks) {
      for (let i = -1; i <= 1; i++) {
        const x0 = i * 2;
        const x1 = i * 7;
        ctx.strokeStyle = '#a0402a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, hY + 4); ctx.lineTo(x1, hY - 44); ctx.stroke();
        const glow = 0.7 + Math.sin(t * 9 + i) * 0.3;
        ctx.fillStyle = `rgba(255, 120, 50, ${glow})`;
        ctx.beginPath(); ctx.arc(x1, hY - 45, 2, 0, Math.PI * 2); ctx.fill();
        // thin smoke wisp
        ctx.strokeStyle = 'rgba(235, 225, 215, 0.28)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x1, hY - 46);
        ctx.bezierCurveTo(x1 + Math.sin(t * 2 + i) * 6, hY - 60, x1 - Math.sin(t * 1.7 + i) * 7, hY - 72, x1 + Math.sin(t * 1.3 + i) * 4, hY - 86);
        ctx.stroke();
      }
    }
    // joined hands (chắp tay) holding the sticks
    ellipse(ctx, 0, hY + 3, 7.5, 7); fs(ctx, c.skin, 1.8);
    ctx.strokeStyle = c.skinDeep; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, hY - 3); ctx.lineTo(0, hY + 9); ctx.stroke();

    ctx.save();
    ctx.translate(0, dip * 0.3);
    hairBack(ctx, c, a, hy - dip * 0.3, 'back');
    const bodyClip = () => robePath(ctx, 21, 27, -82 + dip * 0.4, -30, 0);
    bodyClip(); fs(ctx, c.robe);
    ctx.save(); bodyClip(); ctx.clip();
    ctx.fillStyle = Utils.rgba(c.robeShade, 0.5); ctx.fillRect(6, -90, 30, 70);
    ctx.restore();
    sash(ctx, c, -60, bodyClip, false);
    ctx.restore();
    ctx.fillStyle = c.skin;
    ctx.fillRect(-6, hy + 20, 12, 9);
    head(ctx, c, hy, 'back', {});
    hairFront(ctx, c, a, hy, 'back');
    if (a.hairStyle === 'bun') hairBack(ctx, c, a, hy, 'front');
  }

  function blink(st, t) {
    const period = 3.6 + (st.blinkSeed || 0) * 2.4;
    return ((t + (st.blinkSeed || 0) * 10) % period) < 0.13;
  }

  // ---------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------
  /**
   * @param ctx    canvas context, already transformed to world units
   * @param a      appearance { gender, skin, hair, hairStyle, robe }
   * @param st     state { x, y, dir, moving, walkPhase, activity, actT, knockAge, blinkSeed, away }
   * @param t      global time in seconds
   * @param scale  optional extra scale (preview)
   */
  function draw(ctx, a, st, t, scale) {
    const c = palette(a);
    ctx.save();
    ctx.translate(st.x, st.y);
    if (scale) ctx.scale(scale, scale);
    if (st.away) ctx.globalAlpha *= 0.45;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    switch (st.activity) {
      case 'meditating': drawMeditating(ctx, a, c, st, t); break;
      case 'wooden_fish': drawFish(ctx, a, c, st, t); break;
      case 'incense': drawIncense(ctx, a, c, st, t); break;
      default: drawStanding(ctx, a, c, st, t);
    }
    ctx.restore();
  }

  /** Height of the name label anchor above the feet for a given activity. */
  function labelOffset(activity) {
    if (activity === 'meditating' || activity === 'wooden_fish') return 140;
    return 168;
  }

  return { draw, labelOffset, incenseTimeline };
})();
