// ===== Shared profile rules: appearance palettes + display-name validation =====
// Loaded by the browser (window.ProfileRules) and by the server (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProfileRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GENDERS = ['male', 'female'];

  const SKIN_COLORS = [
    { value: '#FBE3CC', label: 'Rất sáng' },
    { value: '#F3CDA8', label: 'Sáng' },
    { value: '#E5B48A', label: 'Trung bình' },
    { value: '#C98E62', label: 'Bánh mật' },
    { value: '#A06B43', label: 'Nâu' },
    { value: '#6E452B', label: 'Nâu đậm' },
  ];

  const HAIR_COLORS = [
    { value: '#2A1A14', label: 'Đen nâu' },
    { value: '#16121A', label: 'Đen' },
    { value: '#4A2E20', label: 'Nâu đậm' },
    { value: '#7A4B2C', label: 'Nâu hạt dẻ' },
    { value: '#9C7A55', label: 'Nâu nhạt' },
    { value: '#B9B4AE', label: 'Bạc' },
  ];

  const ROBE_COLORS = [
    { value: '#EFE6D2', label: 'Trắng ngà' },
    { value: '#8E8C8F', label: 'Xám' },
    { value: '#6F8288', label: 'Xanh xám' },
    { value: '#8A5A36', label: 'Nâu' },
  ];

  const HAIR_STYLES = {
    male: [
      { value: 'short', label: 'Tóc ngắn' },
      { value: 'shaved', label: 'Cạo trọc' },
    ],
    female: [
      { value: 'long', label: 'Tóc dài' },
      { value: 'bun', label: 'Búi cao' },
      { value: 'low_bun', label: 'Búi thấp' },
    ],
  };

  const DEFAULTS = {
    gender: 'male',
    skin_color: SKIN_COLORS[1].value,
    hair_color: HAIR_COLORS[0].value,
    hair_style: 'short',
    robe_color: ROBE_COLORS[1].value,
  };

  const NAME_MIN = 2;
  const NAME_MAX = 16;

  // ---- Name filtering -----------------------------------------------------
  // Whole-token matches (compared without diacritics). Short/ambiguous words
  // live here so that innocent names containing them are not rejected.
  const BLOCKED_TOKENS = [
    'dm', 'dmm', 'dcm', 'dkm', 'dmcs', 'cmm', 'clm', 'vcl', 'vkl', 'vl', 'cl',
    'clgt', 'loz', 'cak', 'buoi', 'dit', 'deo', 'cac', 'lon',
    'ass', 'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy',
    'sex', 'porn', 'nazi', 'hitler', 'admin', 'administrator', 'moderator', 'mod',
    'system', 'server',
  ];
  // Tokens that are only offensive WITH their Vietnamese diacritics.
  // (e.g. "lon" may be "lớn"/"lợn", "cac" may be "các")
  const DIACRITIC_ONLY = new Set(['dit', 'deo', 'cac', 'lon', 'buoi']);
  const BLOCKED_WITH_DIACRITICS = ['địt', 'đụ', 'đéo', 'cặc', 'lồn', 'dái', 'buồi', 'đĩ', 'điếm'];
  // Substring matches (compared without diacritics, spaces and punctuation removed).
  const BLOCKED_SUBSTRINGS = [
    'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'nigger', 'nigga', 'faggot', 'whore',
    'porn', 'ditme', 'ditmama', 'dittmemay', 'dumama', 'dume', 'concac', 'conchonhu',
    'occho', 'occac', 'dmvcl', 'quantri', 'administrator',
  ];

  function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }

  function deLeet(s) {
    return s.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
      .replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's');
  }

  /** Collapse whitespace and normalise Unicode. */
  function cleanName(raw) {
    if (typeof raw !== 'string') return '';
    return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  }

  // Letters (any script incl. Vietnamese), combining marks, digits, space, . _ - '
  const ALLOWED = /^[\p{L}\p{M}\p{N} ._'-]+$/u;

  /**
   * Validate a display name. Returns { ok, name, error } where error is a
   * Vietnamese message suitable for showing to the player.
   */
  function validateName(raw) {
    const name = cleanName(raw);
    const len = Array.from(name).length;
    if (len < NAME_MIN) return { ok: false, name, error: `Tên cần ít nhất ${NAME_MIN} ký tự.` };
    if (len > NAME_MAX) return { ok: false, name, error: `Tên tối đa ${NAME_MAX} ký tự.` };
    if (!ALLOWED.test(name)) {
      return { ok: false, name, error: 'Tên chỉ gồm chữ, số, khoảng trắng và các dấu . _ - \'' };
    }
    if (!/[\p{L}]/u.test(name)) return { ok: false, name, error: 'Tên cần có ít nhất một chữ cái.' };

    const lower = name.toLowerCase();
    const rawTokens = lower.split(/[\s._'-]+/).filter(Boolean);
    for (const t of rawTokens) {
      if (BLOCKED_WITH_DIACRITICS.includes(t)) return blocked(name);
    }
    const plain = deLeet(stripDiacritics(lower));
    const tokens = plain.split(/[\s._'-]+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (BLOCKED_TOKENS.includes(t)) {
        // Ambiguous Vietnamese words only count when typed without diacritics
        // AND the original token had none (e.g. "các" is fine, "cac" alone is not).
        if (DIACRITIC_ONLY.has(t) && stripDiacritics(rawTokens[i]) !== rawTokens[i]) continue;
        return blocked(name);
      }
    }
    const squashed = plain.replace(/[^a-z]/g, '');
    for (const w of BLOCKED_SUBSTRINGS) if (squashed.includes(w)) return blocked(name);
    return { ok: true, name, error: null };
  }

  function blocked(name) {
    return { ok: false, name, error: 'Tên có từ ngữ chưa phù hợp với không gian chùa. Bạn chọn tên khác nhé.' };
  }

  const has = (list, v) => list.some((o) => o.value === v);

  /**
   * Validate an appearance/profile payload. `partial` allows missing fields.
   * Returns { ok, value, errors } with normalised values.
   */
  function validateProfile(body, partial) {
    const errors = {};
    const value = {};
    const src = body && typeof body === 'object' ? body : {};

    if (!partial || src.display_name !== undefined) {
      const r = validateName(src.display_name);
      if (!r.ok) errors.display_name = r.error; else value.display_name = r.name;
    }
    if (!partial || src.gender !== undefined) {
      if (!GENDERS.includes(src.gender)) errors.gender = 'Giới tính không hợp lệ.';
      else value.gender = src.gender;
    }
    const pick = (field, list, label) => {
      if (!partial || src[field] !== undefined) {
        const v = typeof src[field] === 'string' ? src[field].toUpperCase() : '';
        if (!has(list, v)) errors[field] = `${label} không hợp lệ.`;
        else value[field] = v;
      }
    };
    pick('skin_color', SKIN_COLORS, 'Màu da');
    pick('hair_color', HAIR_COLORS, 'Màu tóc');
    pick('robe_color', ROBE_COLORS, 'Màu trang phục');

    if (!partial || src.hair_style !== undefined) {
      const g = value.gender || src.gender;
      const styles = HAIR_STYLES[g] || [];
      if (!has(styles, src.hair_style)) errors.hair_style = 'Kiểu tóc không hợp lệ.';
      else value.hair_style = src.hair_style;
    }
    return { ok: Object.keys(errors).length === 0, value, errors };
  }

  return {
    GENDERS, SKIN_COLORS, HAIR_COLORS, ROBE_COLORS, HAIR_STYLES, DEFAULTS,
    NAME_MIN, NAME_MAX,
    cleanName, validateName, validateProfile,
  };
});
