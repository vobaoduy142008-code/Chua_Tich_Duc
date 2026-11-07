// ===== Shared world definition (used by browser AND server) =====
// Coordinates are in world units = pixels of the 1536x1024 background art.
// Character positions are the point between the feet.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.World = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROOMS = {
    main_hall: {
      id: 'main_hall',
      name: 'Chính điện',
      width: 1536,
      height: 1024,
      background: '/assets/img/chinh-dien.webp',
      spawn: { x: 768, y: 830 },
      // Walkable floor (feet). Everything above minY is steps / altar platform.
      bounds: { minX: 44, maxX: 1492, minY: 642, maxY: 950 },
      // Rows from the top that must always be visible (statue + whole floor).
      minVisibleHeight: 966,
      // Blocked areas on the floor (feet may not enter).
      obstacles: [
        { type: 'ellipse', x: 142, y: 640, rx: 88, ry: 34 },    // left pillar base
        { type: 'ellipse', x: 1393, y: 640, rx: 88, ry: 34 },   // right pillar base
        { type: 'ellipse', x: 768, y: 604, rx: 100, ry: 40 },   // incense burner
        { type: 'rect', x0: 0, y0: 790, x1: 200, y1: 1024 },    // lotus pot (left)
        { type: 'rect', x0: 1336, y0: 790, x1: 1536, y1: 1024 },// lotus pot (right)
        { type: 'rect', x0: 180, y0: 912, x1: 500, y1: 1024 },  // railing (left)
        { type: 'rect', x0: 1040, y0: 912, x1: 1360, y1: 1024 },// railing (right)
        { type: 'ellipse', x: 360, y: 770, rx: 52, ry: 22 },    // wooden fish (left)
        { type: 'ellipse', x: 1176, y: 770, rx: 52, ry: 22 },   // wooden fish (right)
      ],
      incenseBurner: {
        x: 768, y: 600,             // base of the burner
        mouth: { x: 768, y: 486 },  // where sticks are planted
        range: 150,                 // max distance (feet → base) to offer
        offerSpot: { y: 668, minX: 700, maxX: 836 }, // where the player stands while offering
      },
      woodenFish: [
        { id: 'fish_left', x: 360, y: 770, range: 120, seat: { x: 360, y: 716 } },
        { id: 'fish_right', x: 1176, y: 770, range: 120, seat: { x: 1176, y: 716 } },
      ],
      // Meditation is not allowed this close to an interactable (keeps paths clear)
      meditationClearance: 70,
    },
  };

  const DEFAULT_ROOM = 'main_hall';

  const RULES = {
    PLAYER_SPEED: 230,            // world units / second
    INCENSE_POINTS: 2,
    INCENSE_DURATION_MS: 3600,    // animation length, movement locked
    INCENSE_COOLDOWN_MS: 6000,    // min time between two offerings
    INCENSE_STICK_TTL_MS: 90000,  // how long planted sticks keep smoking
    FISH_POINTS: 1,
    FISH_MIN_INTERVAL_MS: 700,    // max ~85 knocks per minute
    MEDITATION_POINTS_PER_SEC: 1,
    MEDITATION_MAX_SECONDS: 30 * 60,
    NAME_MIN: 2,
    NAME_MAX: 16,
  };

  function insideObstacle(o, x, y) {
    if (o.type === 'rect') return x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1;
    const dx = (x - o.x) / o.rx;
    const dy = (y - o.y) / o.ry;
    return dx * dx + dy * dy < 1;
  }

  function isWalkable(room, x, y) {
    const b = room.bounds;
    if (!(x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY)) return false;
    for (const o of room.obstacles) if (insideObstacle(o, x, y)) return false;
    return true;
  }

  /** Move from (x,y) by (dx,dy) with axis sliding against obstacles. */
  function moveWithCollision(room, x, y, dx, dy) {
    let nx = x + dx;
    let ny = y + dy;
    if (isWalkable(room, nx, ny)) return { x: nx, y: ny };
    if (isWalkable(room, nx, y)) return { x: nx, y };
    if (isWalkable(room, x, ny)) return { x, y: ny };
    return { x, y };
  }

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function nearIncense(room, x, y) {
    const b = room.incenseBurner;
    return dist(x, y, b.x, b.y) <= b.range;
  }

  function nearestFish(room, x, y) {
    let best = null;
    let bestD = Infinity;
    for (const f of room.woodenFish) {
      const d = dist(x, y, f.x, f.y);
      if (d <= f.range && d < bestD) { best = f; bestD = d; }
    }
    return best;
  }

  function canMeditateAt(room, x, y) {
    if (!isWalkable(room, x, y)) return false;
    const c = room.meditationClearance;
    const b = room.incenseBurner;
    if (dist(x, y, b.x, b.y) < b.range * 0.75) return false;
    for (const f of room.woodenFish) if (dist(x, y, f.x, f.y) < c + 30) return false;
    return true;
  }

  function offerSpotFor(room, x) {
    const s = room.incenseBurner.offerSpot;
    return { x: Math.max(s.minX, Math.min(s.maxX, x)), y: s.y };
  }

  return {
    ROOMS,
    DEFAULT_ROOM,
    RULES,
    getRoom: (id) => ROOMS[id] || null,
    isWalkable,
    moveWithCollision,
    nearIncense,
    nearestFish,
    canMeditateAt,
    offerSpotFor,
    dist,
  };
});
