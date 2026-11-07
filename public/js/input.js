// ===== Input: keyboard (WASD / arrows) + on-screen joystick =====
const Input = (() => {
  const held = new Set();
  const pressed = [];          // edge-triggered actions: 'action', 'cancel'
  const joy = { active: false, id: null, cx: 0, cy: 0, x: 0, y: 0, radius: 56 };
  let enabled = false;
  let base = null;
  let knob = null;

  const MOVE_KEYS = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  };

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKeyDown(e) {
    if (!enabled || isTyping(e)) return;
    if (MOVE_KEYS[e.code]) {
      held.add(MOVE_KEYS[e.code]);
      e.preventDefault();
    } else if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
      if (!e.repeat) pressed.push('action');
      e.preventDefault();
    } else if (e.code === 'Escape' || e.code === 'KeyQ') {
      if (!e.repeat) pressed.push('cancel');
    }
  }

  function onKeyUp(e) {
    if (MOVE_KEYS[e.code]) held.delete(MOVE_KEYS[e.code]);
  }

  function setKnob() {
    if (!knob) return;
    knob.style.transform = `translate(${joy.x * joy.radius}px, ${joy.y * joy.radius}px)`;
    base.classList.toggle('active', joy.active);
  }

  function joyMove(e) {
    const dx = e.clientX - joy.cx;
    const dy = e.clientY - joy.cy;
    const d = Math.hypot(dx, dy);
    const k = d > joy.radius ? joy.radius / d : 1;
    joy.x = (dx * k) / joy.radius;
    joy.y = (dy * k) / joy.radius;
    setKnob();
  }

  function initJoystick(el) {
    base = el;
    knob = el.querySelector('.joy-knob');
    el.addEventListener('pointerdown', (e) => {
      if (joy.active) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      joy.active = true;
      joy.id = e.pointerId;
      joy.cx = r.left + r.width / 2;
      joy.cy = r.top + r.height / 2;
      joy.radius = r.width * 0.38;
      joyMove(e);
    });
    el.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.id) joyMove(e); });
    const end = (e) => {
      if (e.pointerId !== joy.id) return;
      joy.active = false;
      joy.id = null;
      joy.x = 0;
      joy.y = 0;
      setKnob();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  return {
    init(joystickEl) {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', () => held.clear());
      if (joystickEl) initJoystick(joystickEl);
    },
    setEnabled(v) {
      enabled = v;
      if (!v) { held.clear(); pressed.length = 0; }
    },
    /** Returns { x, y } in [-1, 1] (length ≤ 1). */
    movement() {
      let x = 0;
      let y = 0;
      if (held.has('left')) x -= 1;
      if (held.has('right')) x += 1;
      if (held.has('up')) y -= 1;
      if (held.has('down')) y += 1;
      if (joy.active) {
        const m = Math.hypot(joy.x, joy.y);
        if (m > 0.18) { x += joy.x; y += joy.y; }
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      return { x, y };
    },
    /** Pop one edge-triggered action ('action' | 'cancel') or null. */
    take() {
      return pressed.shift() || null;
    },
    push(action) {
      pressed.push(action);
    },
  };
})();
