// ===== Canvas + camera =====
// The world (1536x1024) is scaled to cover the screen and the camera follows
// the local player, so phones in portrait still get large, readable sprites.
const Renderer = {
  canvas: null,
  ctx: null,
  dpr: 1,
  viewW: 0,
  viewH: 0,
  scale: 1,
  camX: 0,           // world x at the left edge of the screen
  camY: 0,
  offsetX: 0,        // letterbox offset in CSS px when the world is smaller than the screen
  offsetY: 0,
  worldW: 1536,
  worldH: 1024,
  backdrop: null,    // blurred image used to fill letterbox areas

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.resize();
  },

  /**
   * @param minVisibleH  world rows (from the top) that must always be on screen,
   *                     so the altar and the Buddha statue are never cropped.
   */
  setWorld(w, h, minVisibleH) {
    this.worldW = w;
    this.worldH = h;
    this.minVisH = Math.min(h, minVisibleH || h);
    this.resize();
  },

  resize() {
    if (!this.canvas) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
    this.canvas.style.width = this.viewW + 'px';
    this.canvas.style.height = this.viewH + 'px';

    const cover = Math.max(this.viewW / this.worldW, this.viewH / this.worldH);
    // Fill the screen, but never zoom so far that the top `minVisH` rows
    // (altar + statue) no longer fit vertically. Very wide screens get soft
    // blurred side bars instead of a cropped Buddha.
    const maxByHeight = this.viewH / (this.minVisH || this.worldH);
    this.scale = Math.min(cover, maxByHeight);
    this.offsetX = Math.max(0, (this.viewW - this.worldW * this.scale) / 2);
    this.offsetY = Math.max(0, (this.viewH - this.worldH * this.scale) / 2);
    this._backdropDirty = true;
  },

  /** Visible world size */
  get visW() { return Math.min(this.worldW, this.viewW / this.scale); },
  get visH() { return Math.min(this.worldH, this.viewH / this.scale); },

  /** Centre the camera on (x, y). `snap` skips smoothing. */
  follow(x, y, dt, snap) {
    const tx = Utils.clamp(x - this.visW / 2, 0, this.worldW - this.visW);
    // Vertically the camera stays anchored to the top of the hall: the whole
    // walkable floor fits inside `minVisH`, so there is no need to pan down.
    const ty = 0;
    if (snap) {
      this.camX = tx;
      this.camY = ty;
    } else {
      this.camX = Utils.damp(this.camX, tx, 6, dt);
      this.camY = Utils.damp(this.camY, ty, 6, dt);
    }
  },

  /** Transform for drawing in world units. */
  applyWorld() {
    const s = this.scale * this.dpr;
    this.ctx.setTransform(s, 0, 0, s, (this.offsetX - this.camX * this.scale) * this.dpr, (this.offsetY - this.camY * this.scale) * this.dpr);
  },

  /** Transform for drawing in CSS pixels (HUD text, labels). */
  applyScreen() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },

  worldToScreen(x, y) {
    return {
      x: this.offsetX + (x - this.camX) * this.scale,
      y: this.offsetY + (y - this.camY) * this.scale,
    };
  },

  clear(bgImage) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#140b07';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if ((this.offsetX > 0 || this.offsetY > 0) && bgImage) {
      if (this._backdropDirty || !this.backdrop) this._buildBackdrop(bgImage);
      ctx.drawImage(this.backdrop, 0, 0, this.canvas.width, this.canvas.height);
    }
  },

  _buildBackdrop(img) {
    this._backdropDirty = false;
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = Math.max(1, Math.round(320 * this.viewH / this.viewW));
    const g = c.getContext('2d');
    g.filter = 'blur(10px) brightness(0.45) saturate(0.9)';
    const s = Math.max(c.width / img.width, c.height / img.height) * 1.2;
    g.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
    this.backdrop = c;
  },
};
