// ===== Small helpers shared by the client modules =====
const Utils = (() => {
  const colorCache = new Map();

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
  }

  function rgbToHex(r, g, b) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  /** Lighten (amt > 0) or darken (amt < 0) a hex colour. Cached. */
  function shade(hex, amt) {
    const key = hex + amt;
    let v = colorCache.get(key);
    if (v) return v;
    const [r, g, b] = hexToRgb(hex);
    v = amt >= 0
      ? rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt)
      : rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
    colorCache.set(key, v);
    return v;
  }

  /** Mix two hex colours (t = 0 → a, 1 → b). */
  function mix(a, b, t) {
    const key = a + b + t;
    let v = colorCache.get(key);
    if (v) return v;
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    v = rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
    colorCache.set(key, v);
    return v;
  }

  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  return {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    /** Frame-rate independent smoothing towards a target. */
    damp: (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt)),
    easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),

    eventId() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    },

    formatTime(sec) {
      sec = Math.max(0, Math.floor(sec));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const mm = String(m).padStart(2, '0');
      const ss = String(s).padStart(2, '0');
      return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    },

    formatNumber: (n) => Number(n || 0).toLocaleString('vi-VN'),

    store: {
      get(key, fallback = null) {
        try {
          const v = localStorage.getItem(key);
          return v === null ? fallback : JSON.parse(v);
        } catch (_) {
          return fallback;
        }
      },
      set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
      },
      remove(key) {
        try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
      },
    },

    shade,
    mix,
    rgba,

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
      r = Math.min(r, w / 2, h / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    /** Seeded pseudo-random (stable per player for blink timing etc.) */
    hash(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0) / 4294967295;
    },

    isTouchDevice() {
      return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    },
  };
})();
