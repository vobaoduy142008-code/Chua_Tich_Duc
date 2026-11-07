// ===== Sound: generative temple ambience + soft effects (Web Audio API) =====
// Nothing plays until the player interacts (browser autoplay policy) and the
// music can be turned off / adjusted at any time from the HUD or settings.
const Sound = (() => {
  const SETTINGS_KEY = 'tichduc.sound';
  const settings = Object.assign(
    { muted: false, music: true, sfx: true, musicVolume: 0.55, sfxVolume: 0.7 },
    Utils.store.get(SETTINGS_KEY, {}),
  );

  let ac = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let reverb = null;
  let started = false;
  let musicTimer = null;
  let drone = [];

  // D major pentatonic (D E F# A B) — calm and "Eastern" without being kitsch
  const SCALE = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88, 587.33];

  function save() { Utils.store.set(SETTINGS_KEY, settings); }

  function makeImpulse(seconds, decay) {
    const rate = ac.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function ensure() {
    if (ac) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    ac = new Ctx();
    master = ac.createGain();
    master.connect(ac.destination);
    musicBus = ac.createGain();
    sfxBus = ac.createGain();
    reverb = ac.createConvolver();
    reverb.buffer = makeImpulse(3.4, 2.6);
    const wet = ac.createGain();
    wet.gain.value = 0.42;
    reverb.connect(wet).connect(master);
    musicBus.connect(master);
    sfxBus.connect(master);
    musicBus.connect(reverb);
    sfxBus.connect(reverb);
    apply();
    return true;
  }

  function apply() {
    if (!ac) return;
    const t = ac.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.08);
    musicBus.gain.setTargetAtTime(settings.music ? settings.musicVolume * 0.5 : 0, t, 0.3);
    sfxBus.gain.setTargetAtTime(settings.sfx ? settings.sfxVolume : 0, t, 0.05);
  }

  // ---------------- music ----------------
  function startDrone() {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.11, ac.currentTime, 4);
    lp.connect(g).connect(musicBus);
    for (const [f, type, det] of [[73.42, 'sine', 0], [110, 'triangle', 4], [146.83, 'sine', -3]]) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const og = ac.createGain();
      og.gain.value = type === 'triangle' ? 0.35 : 0.5;
      const lfo = ac.createOscillator();
      const lfoG = ac.createGain();
      lfo.frequency.value = 0.05 + Math.random() * 0.06;
      lfoG.gain.value = 0.18;
      lfo.connect(lfoG).connect(og.gain);
      o.connect(og).connect(lp);
      o.start();
      lfo.start();
      drone.push(o, lfo);
    }
  }

  /** Plucked-string note with a gentle pitch bend (đàn tranh "nhấn"). */
  function pluck(freq, when, vol, bus) {
    const o = ac.createOscillator();
    const o2 = ac.createOscillator();
    const g = ac.createGain();
    const lp = ac.createBiquadFilter();
    o.type = 'triangle';
    o2.type = 'sine';
    o.frequency.setValueAtTime(freq, when);
    o2.frequency.setValueAtTime(freq * 2, when);
    if (Math.random() < 0.35) {
      o.frequency.setValueAtTime(freq, when + 0.25);
      o.frequency.linearRampToValueAtTime(freq * 1.06, when + 0.55);
      o.frequency.linearRampToValueAtTime(freq, when + 0.9);
    }
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, when);
    lp.frequency.exponentialRampToValueAtTime(700, when + 1.6);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 3.2);
    const g2 = ac.createGain();
    g2.gain.value = 0.25;
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(bus || musicBus);
    o.start(when); o2.start(when);
    o.stop(when + 3.3); o2.stop(when + 3.3);
  }

  /** Singing bowl / temple bell: inharmonic partials with long decay. */
  function bowl(freq, when, vol, bus, length) {
    const len = length || 7;
    for (const [ratio, amp, dec] of [[1, 1, 1], [2.71, 0.45, 0.6], [5.12, 0.18, 0.35], [8.2, 0.06, 0.2]]) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      o.detune.value = (Math.random() - 0.5) * 6;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol * amp, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len * dec);
      o.connect(g).connect(bus || musicBus);
      o.start(when);
      o.stop(when + len * dec + 0.1);
    }
  }

  let step = 4;
  function musicLoop() {
    if (!ac || !settings.music) { musicTimer = setTimeout(musicLoop, 2000); return; }
    const now = ac.currentTime + 0.05;
    // a short phrase of 2–5 notes, then silence
    const notes = 2 + Math.floor(Math.random() * 4);
    let t = now;
    for (let i = 0; i < notes; i++) {
      step = Utils.clamp(step + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)], 0, SCALE.length - 1);
      pluck(SCALE[step], t, 0.09 + Math.random() * 0.05);
      if (Math.random() < 0.25) pluck(SCALE[Math.max(0, step - 3)] / 2, t, 0.05);
      t += 0.45 + Math.random() * 0.7;
    }
    if (Math.random() < 0.22) bowl(Math.random() < 0.5 ? 196 : 220, t + 0.8, 0.06);
    musicTimer = setTimeout(musicLoop, (t - now) * 1000 + 3500 + Math.random() * 6000);
  }

  function startMusic() {
    if (started) return;
    started = true;
    startDrone();
    bowl(220, ac.currentTime + 0.3, 0.07);
    musicTimer = setTimeout(musicLoop, 2500);
  }

  // ---------------- effects ----------------
  function woodTok(when, vol, pan) {
    const out = ac.createGain();
    out.gain.value = vol;
    let dest = sfxBus;
    if (pan && ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Utils.clamp(pan, -0.9, 0.9);
      p.connect(sfxBus);
      dest = p;
    }
    out.connect(dest);
    // hollow body resonance
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(560, when);
    o.frequency.exponentialRampToValueAtTime(410, when + 0.12);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.9, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    o.connect(g).connect(out);
    o.start(when); o.stop(when + 0.25);
    // second partial
    const o2 = ac.createOscillator();
    const g2 = ac.createGain();
    o2.type = 'sine';
    o2.frequency.value = 1230;
    g2.gain.setValueAtTime(0.0001, when);
    g2.gain.exponentialRampToValueAtTime(0.25, when + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
    o2.connect(g2).connect(out);
    o2.start(when); o2.stop(when + 0.1);
    // knock noise
    const n = ac.createBufferSource();
    const len = Math.floor(ac.sampleRate * 0.03);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    n.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 1.2;
    const ng = ac.createGain();
    ng.gain.value = 0.5;
    n.connect(bp).connect(ng).connect(out);
    n.start(when);
  }

  function chime(when, vol) {
    pluck(880, when, vol * 0.5, sfxBus);
    pluck(1318.5, when + 0.09, vol * 0.35, sfxBus);
  }

  return {
    settings,
    /** Call from a user gesture. Starts audio if allowed by the settings. */
    unlock() {
      if (!ensure()) return;
      if (ac.state === 'suspended') ac.resume();
      if (!started) startMusic();
    },
    isUnlocked: () => !!ac && ac.state === 'running',
    toggleMute() {
      settings.muted = !settings.muted;
      save();
      if (!settings.muted) this.unlock();
      apply();
      return !settings.muted;
    },
    set(key, value) {
      settings[key] = value;
      save();
      apply();
    },
    woodFish(pan, quiet) {
      if (!ac) return;
      woodTok(ac.currentTime + 0.005, quiet ? 0.28 : 0.75, pan);
    },
    incense() {
      if (!ac) return;
      bowl(330, ac.currentTime + 0.05, 0.12, sfxBus, 6);
    },
    meditationBell() {
      if (!ac) return;
      bowl(174.6, ac.currentTime + 0.05, 0.18, sfxBus, 9);
    },
    merit() {
      if (!ac) return;
      chime(ac.currentTime + 0.02, 0.12);
    },
    click() {
      if (!ac) return;
      pluck(659, ac.currentTime, 0.04, sfxBus);
    },
    stop() {
      clearTimeout(musicTimer);
      drone.forEach((n) => { try { n.stop(); } catch (_) { /* already stopped */ } });
      drone = [];
      started = false;
    },
  };
})();
