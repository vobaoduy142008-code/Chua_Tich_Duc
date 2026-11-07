// ===== UI: screens, character creator, HUD, panels =====
const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const R = ProfileRules;
  const DIRS = ['down', 'left', 'up', 'right'];

  const creator = {
    mode: 'create',
    values: { ...R.DEFAULTS, display_name: '' },
    dirIndex: 0,
    raf: 0,
    onSubmit: null,
    onCancel: null,
  };
  let toastTimer = 0;
  let connTimer = 0;

  // ---------------------------------------------------------------
  // generic
  // ---------------------------------------------------------------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (id === 'screen-create') startPreview(); else stopPreview();
  }

  function openOverlay(id) {
    const el = $(id);
    el.hidden = false;
    const focusable = el.querySelector('input, button:not(.close-btn), .btn');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 30);
    document.dispatchEvent(new CustomEvent('overlaychange'));
  }

  function closeOverlay(id) {
    $(id).hidden = true;
    document.dispatchEvent(new CustomEvent('overlaychange'));
  }

  function anyOverlayOpen() {
    return [...document.querySelectorAll('.overlay')].some((o) => !o.hidden);
  }

  function appearanceOf(v) {
    return { gender: v.gender, skin: v.skin_color, hair: v.hair_color, hairStyle: v.hair_style, robe: v.robe_color };
  }

  function formatCode(token) {
    return (token || '').replace(/(.{4})(?=.)/g, '$1-');
  }

  // ---------------------------------------------------------------
  // character creator
  // ---------------------------------------------------------------
  function buildOptions() {
    const swatch = (group, name, list) => {
      $(group).innerHTML = '';
      for (const o of list) {
        const label = document.createElement('label');
        label.title = o.label;
        label.innerHTML = `<input type="radio" name="${name}" value="${o.value}" aria-label="${o.label}"><span></span>`;
        label.querySelector('span').style.background = o.value;
        $(group).appendChild(label);
      }
    };
    swatch('skin-group', 'skin_color', R.SKIN_COLORS);
    swatch('hair-group', 'hair_color', R.HAIR_COLORS);
    $('robe-group').innerHTML = '';
    for (const o of R.ROBE_COLORS) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="radio" name="robe_color" value="${o.value}"><span><i></i>${o.label}</span>`;
      label.querySelector('i').style.background = o.value;
      $('robe-group').appendChild(label);
    }
  }

  function buildStyles() {
    const g = creator.values.gender;
    const styles = R.HAIR_STYLES[g];
    if (!styles.some((s) => s.value === creator.values.hair_style)) creator.values.hair_style = styles[0].value;
    $('style-group').innerHTML = '';
    for (const s of styles) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="radio" name="hair_style" value="${s.value}"><span>${s.label}</span>`;
      $('style-group').appendChild(label);
    }
  }

  function syncForm() {
    const v = creator.values;
    const form = $('create-form');
    for (const name of ['gender', 'skin_color', 'hair_color', 'hair_style', 'robe_color']) {
      form.querySelectorAll(`input[name="${name}"]`).forEach((i) => { i.checked = i.value === v[name]; });
    }
    $('input-name').value = v.display_name || '';
    updateNameState(false);
  }

  function updateNameState(showError) {
    const raw = $('input-name').value;
    const len = Array.from(R.cleanName(raw)).length;
    $('name-count').textContent = `${len}/${R.NAME_MAX}`;
    $('name-count').classList.toggle('over', len > R.NAME_MAX);
    const res = R.validateName(raw);
    const msg = res.ok || (!showError && len === 0) ? '' : res.error;
    $('name-error').textContent = msg;
    $('input-name').classList.toggle('invalid', !!msg);
    return res;
  }

  function sizePreview() {
    const c = $('preview-canvas');
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
  }

  function startPreview() {
    stopPreview();
    sizePreview();
    const c = $('preview-canvas');
    const ctx = c.getContext('2d');
    const loop = (ms) => {
      const t = ms / 1000;
      const dpr = c.width / Math.max(1, c.clientWidth);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      const h = c.clientHeight;
      const s = Math.min(1.9, (h * 0.8) / 170);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      Character.draw(ctx, appearanceOf(creator.values), {
        x: c.clientWidth / 2, y: h * 0.9, dir: DIRS[creator.dirIndex], moving: false, blinkSeed: 0.4,
      }, t, s);
      creator.raf = requestAnimationFrame(loop);
    };
    creator.raf = requestAnimationFrame(loop);
  }

  function stopPreview() {
    if (creator.raf) cancelAnimationFrame(creator.raf);
    creator.raf = 0;
  }

  function initCreator() {
    buildOptions();
    buildStyles();
    const form = $('create-form');
    form.addEventListener('change', (e) => {
      const { name, value } = e.target;
      if (!name || name === 'display_name') return;
      creator.values[name] = value;
      if (name === 'gender') { buildStyles(); syncForm(); }
      Sound.click();
    });
    $('input-name').addEventListener('input', () => {
      creator.values.display_name = $('input-name').value;
      updateNameState(false);
    });
    $('input-name').addEventListener('blur', () => updateNameState(true));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const res = updateNameState(true);
      if (!res.ok) { $('input-name').focus(); return; }
      creator.values.display_name = res.name;
      $('form-error').textContent = '';
      if (creator.onSubmit) creator.onSubmit({ ...creator.values });
    });
    document.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => {
      creator.dirIndex = (creator.dirIndex + Number(b.dataset.rot) + 4) % 4;
    }));
    $('btn-cancel-edit').addEventListener('click', () => creator.onCancel && creator.onCancel());
    window.addEventListener('resize', () => { if (creator.raf) sizePreview(); });
  }

  // ---------------------------------------------------------------
  // HUD helpers
  // ---------------------------------------------------------------
  function drawPortrait(canvas, appearance, mode) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mode === 'head') {
      const s = canvas.width / 76;
      Character.draw(ctx, appearance, { x: canvas.width / 2, y: canvas.height * 0.56 + 112 * s, dir: 'down' }, 0.5, s);
    } else {
      const s = (canvas.height * 0.86) / 165;
      Character.draw(ctx, appearance, { x: canvas.width / 2, y: canvas.height * 0.95, dir: 'down' }, 0.5, s);
    }
  }

  function toast(text, kind, ms) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind || ''}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, ms || 2600);
  }

  function setPrimary(opts) {
    const btn = $('btn-primary');
    if (!opts) { btn.hidden = true; return; }
    btn.hidden = false;
    if (btn.dataset.key !== opts.key) {
      btn.dataset.key = opts.key;
      $('act-label').textContent = opts.label;
      $('act-icon').setAttribute('href', `#i-${opts.icon}`);
    }
    btn.classList.toggle('busy', !!opts.busy);
    $('act-cooldown').style.width = `${Math.round((opts.cooldown || 0) * 100)}%`;
  }

  return {
    $,
    show,
    openOverlay,
    closeOverlay,
    anyOverlayOpen,
    appearanceOf,
    formatCode,
    toast,

    init() {
      initCreator();
      document.querySelectorAll('.overlay [data-close]').forEach((b) => {
        b.addEventListener('click', () => closeOverlay(b.closest('.overlay').id));
      });
      document.querySelectorAll('.overlay').forEach((o) => {
        o.addEventListener('click', (e) => { if (e.target === o && o.id !== 'error-overlay' && o.id !== 'tutorial') closeOverlay(o.id); });
        o.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && o.id !== 'error-overlay') { e.stopPropagation(); closeOverlay(o.id); }
        });
      });
      if (Utils.isTouchDevice()) document.body.classList.add('touch');
      window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
      this.initSettings();
    },

    // ---- welcome ----
    welcome({ status, error, profile, busy }) {
      $('welcome-status').textContent = status || '';
      $('welcome-status').classList.toggle('error', !!error);
      const enter = $('btn-enter');
      enter.disabled = !!busy;
      enter.textContent = error ? 'Thử lại' : profile ? 'Vào chùa' : 'Tạo nhân vật';
      $('btn-recover').hidden = !!profile;
    },

    // ---- creator ----
    openCreator(mode, profile, handlers) {
      creator.mode = mode;
      creator.onSubmit = handlers.onSubmit;
      creator.onCancel = handlers.onCancel;
      creator.values = profile
        ? {
          display_name: profile.display_name, gender: profile.gender, skin_color: profile.skin_color,
          hair_color: profile.hair_color, hair_style: profile.hair_style, robe_color: profile.robe_color,
        }
        : { ...R.DEFAULTS, display_name: '' };
      creator.dirIndex = 0;
      buildStyles();
      syncForm();
      $('form-error').textContent = '';
      $('create-title').textContent = mode === 'edit' ? 'Chỉnh sửa ngoại hình' : 'Tạo nhân vật';
      $('create-sub').textContent = mode === 'edit'
        ? 'Thay đổi dáng vẻ không ảnh hưởng đến công đức đã tích lũy.'
        : 'Chọn dáng vẻ giản dị cho chuyến viếng chùa của bạn.';
      $('btn-save').textContent = mode === 'edit' ? 'Lưu thay đổi' : 'Vào chùa';
      $('btn-cancel-edit').hidden = mode !== 'edit';
      this.creatorBusy(false);
      show('screen-create');
      if (mode === 'create') setTimeout(() => $('input-name').focus({ preventScroll: true }), 50);
    },
    creatorBusy(busy) {
      $('btn-save').disabled = busy;
      $('btn-save').textContent = busy ? 'Đang lưu…' : creator.mode === 'edit' ? 'Lưu thay đổi' : 'Vào chùa';
    },
    creatorError(err) {
      if (err && err.fields && err.fields.display_name) {
        $('name-error').textContent = err.fields.display_name;
        $('input-name').classList.add('invalid');
      }
      $('form-error').textContent = (err && err.message) || 'Không lưu được, vui lòng thử lại.';
    },

    // ---- loading ----
    loading(text, progress) {
      if (text) $('loading-text').textContent = text;
      if (progress != null) $('loading-bar').style.width = `${Math.round(progress * 100)}%`;
    },

    // ---- HUD ----
    setPlayer(profile) {
      $('hud-name').textContent = profile.display_name;
      drawPortrait($('avatar-canvas'), appearanceOf(profile), 'head');
    },
    setMerit(total, bump) {
      $('merit-value').textContent = Utils.formatNumber(total);
      if (bump) {
        const pill = $('merit-pill');
        pill.classList.remove('bump');
        void pill.offsetWidth;
        pill.classList.add('bump');
      }
    },
    setOnline(n) { $('online-count').textContent = n; },
    setSync(n) { $('sync-chip').hidden = !n; },
    meditation(info) {
      const chip = $('med-chip');
      if (!info) { chip.hidden = true; return; }
      chip.hidden = false;
      $('med-time').textContent = Utils.formatTime(info.seconds);
      $('med-points').textContent = `+${Utils.formatNumber(info.points)}`;
    },
    actions({ primary, secondary }) {
      setPrimary(primary);
      $('btn-secondary').hidden = !secondary;
    },
    connection(state) {
      const el = $('conn-banner');
      clearTimeout(connTimer);
      if (state === 'reconnecting') {
        el.className = 'conn-banner';
        el.textContent = 'Mất kết nối — đang kết nối lại… Công đức chưa đồng bộ sẽ được gửi lại.';
        el.hidden = false;
      } else if (state === 'restored') {
        el.className = 'conn-banner ok';
        el.textContent = 'Đã kết nối lại với chính điện';
        el.hidden = false;
        connTimer = setTimeout(() => { el.hidden = true; }, 2200);
      } else {
        el.hidden = true;
      }
    },
    showTouchControls(on) { $('joystick').hidden = !on; },

    tutorial(isTouch) {
      $('tut-move').textContent = isTouch ? 'Cần điều khiển trái' : 'W A S D / ← ↑ → ↓';
      document.querySelectorAll('.tut-key').forEach((k, i) => {
        if (i > 0 && i < 4) k.textContent = isTouch ? 'Nút bên phải' : 'E · Space';
        if (i === 4) k.textContent = isTouch ? 'Nút Đứng dậy' : 'Esc';
      });
      openOverlay('tutorial');
    },

    // ---- panels ----
    openProfile(profile, summary, token) {
      $('profile-title').textContent = profile.display_name;
      $('profile-merit').textContent = Utils.formatNumber(profile.merit_points);
      drawPortrait($('profile-canvas'), appearanceOf(profile), 'full');
      const names = { incense: 'Dâng hương', meditation: 'Ngồi thiền', wooden_fish: 'Gõ mõ' };
      const list = $('merit-breakdown');
      list.innerHTML = '';
      const rows = (summary && summary.byActivity) || [];
      if (!rows.length) {
        const li = document.createElement('li');
        li.textContent = 'Chưa có công đức nào — hãy bắt đầu bằng một nén hương.';
        list.appendChild(li);
      }
      for (const r of rows) {
        if (!names[r.activity_type]) continue;
        const li = document.createElement('li');
        const unit = r.activity_type === 'meditation' ? '' : ` · ${Utils.formatNumber(r.times)} lần`;
        li.innerHTML = `<span>${names[r.activity_type]}${unit}</span><b>+${Utils.formatNumber(r.points)}</b>`;
        list.appendChild(li);
      }
      const code = $('recovery-code');
      code.textContent = '••••-••••-••••-••••';
      code.classList.add('masked');
      $('btn-show-code').textContent = 'Hiện';
      $('btn-show-code').onclick = () => {
        const masked = code.classList.toggle('masked');
        code.textContent = masked ? '••••-••••-••••-••••' : formatCode(token);
        $('btn-show-code').textContent = masked ? 'Hiện' : 'Ẩn';
      };
      $('btn-copy-code').onclick = async () => {
        try {
          await navigator.clipboard.writeText(formatCode(token));
          toast('Đã sao chép mã khôi phục. Hãy cất ở nơi an toàn.', 'good');
        } catch (_) {
          code.classList.remove('masked');
          code.textContent = formatCode(token);
          toast('Không sao chép tự động được — bạn hãy chép mã đang hiển thị.', 'warn');
        }
      };
      openOverlay('panel-profile');
    },

    initSettings() {
      const s = Sound.settings;
      $('set-music').checked = s.music;
      $('set-sfx').checked = s.sfx;
      $('set-music-vol').value = Math.round(s.musicVolume * 100);
      $('set-sfx-vol').value = Math.round(s.sfxVolume * 100);
      $('set-music').addEventListener('change', (e) => { Sound.unlock(); Sound.set('music', e.target.checked); });
      $('set-sfx').addEventListener('change', (e) => { Sound.unlock(); Sound.set('sfx', e.target.checked); });
      $('set-music-vol').addEventListener('input', (e) => { Sound.unlock(); Sound.set('musicVolume', e.target.value / 100); });
      $('set-sfx-vol').addEventListener('input', (e) => { Sound.unlock(); Sound.set('sfxVolume', e.target.value / 100); });
      this.soundIcon();
    },
    soundIcon() {
      const on = !Sound.settings.muted;
      const btn = $('btn-sound');
      btn.querySelector('use').setAttribute('href', on ? '#i-sound' : '#i-mute');
      btn.setAttribute('aria-label', on ? 'Tắt âm thanh' : 'Bật âm thanh');
      btn.title = on ? 'Tắt âm thanh' : 'Bật âm thanh';
    },

    error({ title, message, retryLabel, onRetry, altLabel, onAlt }) {
      $('error-title').textContent = title || 'Có chút trục trặc';
      $('error-message').textContent = message || 'Đã xảy ra lỗi.';
      $('btn-error-retry').textContent = retryLabel || 'Thử lại';
      $('btn-error-retry').onclick = () => { closeOverlay('error-overlay'); onRetry && onRetry(); };
      $('btn-error-alt').hidden = !altLabel;
      $('btn-error-alt').textContent = altLabel || '';
      $('btn-error-alt').onclick = () => { closeOverlay('error-overlay'); onAlt && onAlt(); };
      openOverlay('error-overlay');
    },
  };
})();
