// audio.js — fully synthesized sound design. No audio files: every creak,
// roar and heartbeat is built from oscillators and filtered noise at
// runtime, so the game ships with complete sound out of the box.

import { clamp, rand } from './utils.js';

class SfxEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.8;
  }

  // must be called from a user gesture (the Play button)
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 8;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);

    // shared noise buffer (2s of white noise)
    const len = this.ctx.sampleRate * 2;
    this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // shared hallway-reverb send: a synthesized impulse response (decaying
    // filtered noise) rather than a sampled IR file, so wet sounds have
    // spatial depth without needing an audio asset.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 3.2);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.4;
    this.reverb.connect(this.reverbGain).connect(this.master);
  }

  _makeImpulse(duration, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  // sends a fraction of `node`'s signal into the shared reverb bus
  _sendReverb(node, amount = 0.35) {
    if (!this.reverb) return;
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(this.reverb);
  }

  // a WaveShaper curve for distortion/growl effects
  _distortionCurve(amount = 30) {
    const n = 4096;
    const curve = new Float32Array(n);
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // Shepard tone: several sine layers an octave apart, all rising together,
  // each gain-windowed around a "sweet spot" frequency so the ones fading
  // out (too high) are covered by ones fading in (too low) — the classic
  // illusion of a pitch that rises forever. Used for Ambush's scream.
  _shepardRise({ t0 = null, dur = 1.3, out = null, gainMul = 1, sweet = 660, octaves = 2.2 } = {}) {
    if (!this.ctx) return;
    const t = t0 ?? this.now;
    const bases = [55, 110, 220, 440, 880, 1760, 3520];
    const sweetLog = Math.log2(sweet);
    const sigma = 1.15;
    const steps = 28;
    for (const f0 of bases) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const g = this.ctx.createGain();
      o.connect(g).connect(out || this.master);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * Math.pow(2, octaves), t + dur);
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) {
        const frac = i / (steps - 1);
        const freq = f0 * Math.pow(2, octaves * frac);
        const x = (Math.log2(freq) - sweetLog) / sigma;
        curve[i] = Math.max(0.0001, Math.exp(-x * x / 2) * gainMul);
      }
      g.gain.setValueCurveAtTime(curve, t, dur);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  resume() { this.ctx?.resume?.(); }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  // distance -> gain falloff for pseudo-3D one-shots
  volAt(dist, ref = 45) {
    return clamp(1 - dist / ref, 0, 1) ** 1.6;
  }

  // ---- primitives -------------------------------------------------
  _osc({ type = 'sine', freq = 440, freqEnd = null, t0 = null, dur = 0.3,
         gain = 0.2, attack = 0.005, out = null }) {
    if (!this.ctx) return;
    const t = t0 ?? this.now;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd != null) o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noiseBurst({ t0 = null, dur = 0.3, gain = 0.2, type = 'lowpass', freq = 800,
                freqEnd = null, q = 0.8, attack = 0.004, playbackRate = 1, out = null }) {
    if (!this.ctx) return;
    const t = t0 ?? this.now;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    src.playbackRate.value = playbackRate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd != null) f.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 10), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ---- loops (return a handle: setVol / stop) ----------------------
  _loopHandle(nodes, gainNode, timer = null) {
    return {
      setVol: (v) => { if (gainNode) gainNode.gain.value = v; },
      stop: () => {
        if (timer) clearInterval(timer);
        for (const n of nodes) { try { n.stop(); } catch (_) { /* already stopped */ } }
        setTimeout(() => gainNode?.disconnect?.(), 60);
      },
    };
  }

  // ---- ambient one-shot events (routed to a caller-supplied bus so they
  // share the ambience gain + reverb). Each is guarded and randomized. ----
  _ambientCreak(out, amp = 1) {
    if (!this.ctx) return;
    const t = this.now;
    const base = rand(55, 120);
    this._osc({ type: 'sawtooth', freq: base, freqEnd: base * rand(1.6, 2.4), t0: t, dur: rand(0.5, 1.1), gain: 0.02 * amp, attack: 0.12, out });
    this._noiseBurst({ t0: t, dur: 0.5, gain: 0.012 * amp, type: 'bandpass', freq: rand(700, 1200), q: 3, out });
  }

  _ambientThump(out, amp = 1) {
    if (!this.ctx) return;
    const t = this.now;
    this._osc({ type: 'sine', freq: 70, freqEnd: 34, t0: t, dur: 0.5, gain: 0.05 * amp, attack: 0.006, out });
    this._noiseBurst({ t0: t, dur: 0.28, gain: 0.03 * amp, type: 'lowpass', freq: 180, freqEnd: 60, out });
  }

  _windGust(out, amp = 1) {
    if (!this.ctx) return;
    this._noiseBurst({ dur: rand(1.2, 2.2), gain: 0.05 * amp, type: 'bandpass', freq: 320, freqEnd: 620, q: 0.5, out });
  }

  _ambientGroan(out, amp = 1) {
    if (!this.ctx) return;
    const t = this.now;
    const f = rand(70, 110);
    this._osc({ type: 'sawtooth', freq: f, freqEnd: f * 0.8, t0: t, dur: rand(1.4, 2.4), gain: 0.03 * amp, attack: 0.4, out });
    this._osc({ type: 'sine', freq: f * 1.5, t0: t, dur: 1.2, gain: 0.015 * amp, attack: 0.5, out });
  }

  // The background "soundtrack": a layered low drone (root + detuned beating
  // partner + a sub-octave for weight) and airy wind, always present. On top,
  // a scheduler randomly emits creaks/groans/distant thumps/wind-gusts whose
  // frequency and loudness scale with the current tension level, so calm
  // rooms are near-silent and dangerous ones feel like the building is alive
  // and settling around you. `setTension(level)` (0..1) both fades in a
  // dissonant drone cluster and drives that event density. Handle exposes
  // setTension, plus setVol/stop from _loopHandle.
  ambience() {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    g.connect(this.master);

    // layered low drone
    const o1 = this.ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.8;
    const oSub = this.ctx.createOscillator(); oSub.type = 'sine'; oSub.frequency.value = 27.5;
    const oSubG = this.ctx.createGain(); oSubG.gain.value = 0.6;
    o1.connect(g); o2.connect(g); oSub.connect(oSubG).connect(g);

    // slow airy wind noise with a breathing LFO
    const wind = this.ctx.createBufferSource();
    wind.buffer = this._noise; wind.loop = true; wind.playbackRate.value = 0.3;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'bandpass'; wf.frequency.value = 300; wf.Q.value = 0.4;
    const wg = this.ctx.createGain(); wg.gain.value = 0.18;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.1;
    lfo.connect(lfoG).connect(wg.gain);
    wind.connect(wf).connect(wg).connect(g);

    // tension layer: dissonant minor-second cluster, fades in via setTension()
    const tensionG = this.ctx.createGain();
    tensionG.gain.value = 0;
    tensionG.connect(g);
    const t1 = this.ctx.createOscillator(); t1.type = 'sine'; t1.frequency.value = 61.5;
    const t2 = this.ctx.createOscillator(); t2.type = 'sine'; t2.frequency.value = 65.2;
    const t3 = this.ctx.createOscillator(); t3.type = 'triangle'; t3.frequency.value = 82.4;
    t1.connect(tensionG); t2.connect(tensionG); t3.connect(tensionG);

    o1.start(); o2.start(); oSub.start(); wind.start(); lfo.start();
    t1.start(); t2.start(); t3.start();

    // randomized ambient events, scaled by tension
    let tension = 0;
    const eventBus = this.ctx.createGain();
    eventBus.gain.value = 1;
    eventBus.connect(g);
    this._sendReverb(eventBus, 0.5);
    const tick = () => {
      if (!this.ctx) return;
      if (Math.random() < 0.12 + tension * 0.5) {
        const r = Math.random();
        const amp = 0.5 + tension * 0.8;
        if (r < 0.4) this._ambientCreak(eventBus, amp);
        else if (r < 0.7) this._ambientThump(eventBus, amp);
        else if (r < 0.88) this._windGust(eventBus, amp);
        else this._ambientGroan(eventBus, amp);
      }
    };
    const timer = setInterval(tick, 2600);

    const handle = this._loopHandle([o1, o2, oSub, wind, lfo, t1, t2, t3], g, timer);
    handle.setTension = (level) => {
      if (!this.ctx) return;
      const lv = clamp(level, 0, 1);
      tension = lv;
      tensionG.gain.setTargetAtTime(lv * 0.11, this.now, 1.6);
    };
    return handle;
  }

  // Heartbeat: a lub-dub pulse the orchestrator drives up as danger rises or
  // health drops. It self-schedules so the tempo can change live. Returns a
  // handle:
  //   setVol(v)        overall loudness (~0..1; default 0.9)
  //   setRate(bpm)     beats per minute, clamped 30..200 (default 66)
  //   setIntensity(x)  0..1 — harder, higher-pitched, more panicked beats,
  //                    adding a thud on top past ~0.6
  //   stop()
  heartbeatLoop() {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = 0.9;
    g.connect(this.master);
    let bpm = 66;
    let intensity = 0.35;
    let stopped = false;
    let timer = null;
    const beat = () => {
      if (stopped || !this.ctx) return;
      const t = this.now + 0.02;
      const amp = 0.3 + intensity * 0.5;
      const pitch = 1 + intensity * 0.5;
      this._osc({ type: 'sine', freq: 58 * pitch, freqEnd: 40 * pitch, t0: t, dur: 0.14, gain: 0.5 * amp, out: g });        // lub
      this._osc({ type: 'sine', freq: 52 * pitch, freqEnd: 38 * pitch, t0: t + 0.2, dur: 0.12, gain: 0.35 * amp, out: g }); // dub
      if (intensity > 0.6) {
        this._noiseBurst({ t0: t, dur: 0.05, gain: 0.06 * intensity, type: 'lowpass', freq: 220, out: g }); // panicked thud
      }
      timer = setTimeout(beat, 60000 / clamp(bpm, 30, 200));
    };
    beat();
    return {
      setVol: (v) => { g.gain.value = v; },
      setRate: (b) => { bpm = clamp(b, 30, 200); },
      setIntensity: (x) => { intensity = clamp(x, 0, 1); },
      stop: () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        setTimeout(() => { try { g.disconnect(); } catch (_) { /* already gone */ } }, 60);
      },
    };
  }

  // Rush/Ambush's roar: TWO layers, like the real game's separately-recorded
  // far/near audio — a muffled, heavily-lowpassed distant rumble that's
  // always present at some level, and a bright, distorted, aggressive layer
  // that fades in as the entity gets close. `setDistance(t)` (0=far, 1=on
  // top of you) crossfades between them; `setVol(v)` is the overall
  // envelope (used for the warning fade-in), independent of that balance.
  rushLoop() {
    if (!this.ctx) return null;
    const outG = this.ctx.createGain();
    outG.gain.value = 0;

    const tremolo = this.ctx.createGain();
    tremolo.gain.value = 1;
    outG.connect(tremolo).connect(this.master);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 12;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.32;
    lfo.connect(lfoG).connect(tremolo.gain);

    // FAR layer: muffled, distant, always at least a little present
    const farG = this.ctx.createGain();
    farG.gain.value = 1;
    farG.connect(outG);
    const farSrc = this.ctx.createBufferSource();
    farSrc.buffer = this._noise; farSrc.loop = true; farSrc.playbackRate.value = 0.55;
    const farF = this.ctx.createBiquadFilter();
    farF.type = 'lowpass'; farF.frequency.value = 140; farF.Q.value = 1;
    farSrc.connect(farF).connect(farG);
    const farSub = this.ctx.createOscillator();
    farSub.type = 'sine'; farSub.frequency.value = 34;
    const farSubG = this.ctx.createGain();
    farSubG.gain.value = 0.5;
    farSub.connect(farSubG).connect(farG);

    // NEAR layer: bright, present, distorted — fades in as it closes in
    const nearG = this.ctx.createGain();
    nearG.gain.value = 0;
    const nearWS = this.ctx.createWaveShaper();
    nearWS.curve = this._distortionCurve(28);
    nearWS.oversample = '2x';
    nearWS.connect(nearG).connect(outG);
    const nearSrc = this.ctx.createBufferSource();
    nearSrc.buffer = this._noise; nearSrc.loop = true; nearSrc.playbackRate.value = 0.85;
    const nearF = this.ctx.createBiquadFilter();
    nearF.type = 'bandpass'; nearF.frequency.value = 480; nearF.Q.value = 0.8;
    nearSrc.connect(nearF).connect(nearWS);
    const nearSaw = this.ctx.createOscillator();
    nearSaw.type = 'sawtooth'; nearSaw.frequency.value = 46;
    const nearSawG = this.ctx.createGain();
    nearSawG.gain.value = 0.45;
    nearSaw.connect(nearSawG).connect(nearWS);

    farSrc.start(); farSub.start(); nearSrc.start(); nearSaw.start(); lfo.start();
    const nodes = [farSrc, farSub, nearSrc, nearSaw, lfo];

    return {
      setVol: (v) => { outG.gain.value = v; },
      setDistance: (t) => {
        const tt = clamp(t, 0, 1);
        farG.gain.value = 1 - tt * 0.55;
        nearG.gain.value = tt;
      },
      stop: () => {
        for (const n of nodes) { try { n.stop(); } catch (_) { /* already stopped */ } }
        setTimeout(() => outG.disconnect(), 60);
      },
    };
  }

  eyesLoop() {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    const o1 = this.ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 96;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 99.5;
    o1.connect(g); o2.connect(g);
    o1.start(); o2.start();
    return this._loopHandle([o1, o2], g);
  }

  rumbleLoop() {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise; src.loop = true; src.playbackRate.value = 0.35;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 70;
    src.connect(f).connect(g);
    src.start();
    return this._loopHandle([src], g);
  }

  // ---- one-shots ---------------------------------------------------
  // The horror creak: two detuned sawtooth "hinge" swells plus a woody
  // rasp. Pitch/length are randomized per call so repeated doors down a long
  // hallway never sound identical.
  doorCreak(vol = 1) {
    if (!this.ctx) return;
    const t = this.now;
    const base = rand(60, 84);
    this._osc({ type: 'sawtooth', freq: base, freqEnd: base * rand(2.0, 2.6), t0: t, dur: rand(0.55, 0.8), gain: 0.05 * vol, attack: 0.08 });
    this._osc({ type: 'sawtooth', freq: base * 1.3, freqEnd: base * 3, t0: t + 0.08, dur: 0.55, gain: 0.035 * vol, attack: 0.1 });
    this._noiseBurst({ t0: t, dur: 0.6, gain: 0.03 * vol, type: 'bandpass', freq: rand(800, 1050), q: 2 });
  }

  doorSlam(vol = 1) {
    if (!this.ctx) return;
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.25, gain: 0.5 * vol, type: 'lowpass', freq: 300, freqEnd: 60 });
    this._osc({ type: 'sine', freq: 70, freqEnd: 35, t0: t, dur: 0.3, gain: 0.5 * vol });
    // sharp wood crack on impact + a longer sub tail so the slam has weight
    this._noiseBurst({ t0: t, dur: 0.08, gain: 0.18 * vol, type: 'highpass', freq: 1800 });
    this._osc({ type: 'sine', freq: 44, freqEnd: 30, t0: t + 0.02, dur: 0.45, gain: 0.25 * vol });
  }

  // A cleaner, non-creaky door swing (latch click + low swing whoosh) for
  // doors that open normally — distinct from the horror doorCreak.
  doorOpen(vol = 1) {
    if (!this.ctx) return;
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.04, gain: 0.14 * vol, type: 'highpass', freq: 2600 }); // latch
    this._noiseBurst({ t0: t + 0.03, dur: 0.4, gain: 0.06 * vol, type: 'bandpass', freq: 220, freqEnd: 520, q: 0.5 }); // swing
    this._osc({ type: 'sine', freq: 80, freqEnd: 120, t0: t + 0.03, dur: 0.35, gain: 0.05 * vol, attack: 0.05 });
  }

  doorClose(vol = 1) {
    if (!this.ctx) return;
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.3, gain: 0.06 * vol, type: 'bandpass', freq: 500, freqEnd: 200, q: 0.5 }); // swing
    this._noiseBurst({ t0: t + 0.26, dur: 0.09, gain: 0.22 * vol, type: 'lowpass', freq: 240, freqEnd: 90 }); // thud
    this._noiseBurst({ t0: t + 0.28, dur: 0.03, gain: 0.12 * vol, type: 'highpass', freq: 2800 }); // latch click
    this._osc({ type: 'sine', freq: 70, freqEnd: 40, t0: t + 0.26, dur: 0.22, gain: 0.28 * vol });
  }

  doorLocked(vol = 1) {
    const t = this.now;
    for (let i = 0; i < 2; i++) {
      this._noiseBurst({ t0: t + i * 0.14, dur: 0.08, gain: 0.3 * vol, freq: 500, freqEnd: 150 });
      this._osc({ type: 'square', freq: 130, t0: t + i * 0.14, dur: 0.06, gain: 0.1 * vol });
    }
  }

  unlock(vol = 1) {
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.05, gain: 0.25 * vol, type: 'highpass', freq: 2000 });
    this._osc({ type: 'sine', freq: 950, t0: t + 0.08, dur: 0.25, gain: 0.12 * vol });
  }

  keyPickup() {
    const t = this.now;
    [1320, 1660, 2090].forEach((f, i) =>
      this._osc({ type: 'sine', freq: f, t0: t + i * 0.07, dur: 0.3, gain: 0.09 }));
  }

  goldPickup() {
    const t = this.now;
    this._osc({ type: 'sine', freq: 1720, t0: t, dur: 0.18, gain: 0.1 });
    this._osc({ type: 'sine', freq: 2150, t0: t + 0.06, dur: 0.26, gain: 0.09 });
  }

  purchase() {
    const t = this.now;
    [880, 1100, 1320, 1760].forEach((f, i) =>
      this._osc({ type: 'triangle', freq: f, t0: t + i * 0.08, dur: 0.2, gain: 0.1 }));
  }

  lightSwitch(vol = 1) {
    this._noiseBurst({ dur: 0.03, gain: 0.22 * vol, type: 'highpass', freq: 2500 });
  }

  shatter(vol = 1) {
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.3, gain: 0.3 * vol, type: 'highpass', freq: 2200 });
    for (let i = 0; i < 5; i++) {
      this._osc({ type: 'sine', freq: rand(2200, 5200), t0: t + rand(0.02, 0.2), dur: 0.15, gain: 0.05 * vol });
    }
  }

  flicker(vol = 1) {
    this._noiseBurst({ dur: 0.05, gain: 0.06 * vol, type: 'bandpass', freq: 3400, q: 6 });
  }

  closetIn() {
    this.doorCreak(0.7);
    this._osc({ type: 'sine', freq: 90, freqEnd: 50, t0: this.now + 0.25, dur: 0.2, gain: 0.2 });
  }

  closetOut() { this.doorCreak(0.6); }

  // Breathy, unsettling, reverbed whisper — airy noise shaped by shifting
  // vocal-formant bandpasses (two per "syllable") so it reads as a voice you
  // can't quite make out, like Halt's/Screech's murmurs. `vol` scales it for
  // distance. No handle: it's a short one-shot.
  whisper(vol = 1) {
    if (!this.ctx) return;
    const t = this.now;
    const bus = this.ctx.createGain();
    bus.gain.value = vol;
    bus.connect(this.master);
    this._sendReverb(bus, 0.6);
    const syllables = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < syllables; i++) {
      const st = t + i * rand(0.16, 0.28);
      this._noiseBurst({ t0: st, dur: rand(0.1, 0.2), gain: 0.11, type: 'bandpass', freq: rand(500, 900), q: 5, out: bus });   // 1st formant
      this._noiseBurst({ t0: st, dur: rand(0.08, 0.16), gain: 0.07, type: 'bandpass', freq: rand(1400, 2600), q: 8, out: bus }); // 2nd formant
    }
    // continuous airy breath underneath
    this._noiseBurst({ t0: t, dur: syllables * 0.24, gain: 0.04, type: 'highpass', freq: 4000, out: bus });
  }

  psst() {
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.09, gain: 0.22, type: 'highpass', freq: 3800 });
    this._noiseBurst({ t0: t + 0.13, dur: 0.16, gain: 0.2, type: 'highpass', freq: 3400 });
  }

  screechScream() {
    const t = this.now;
    this._osc({ type: 'sawtooth', freq: 1200, freqEnd: 420, t0: t, dur: 0.5, gain: 0.35 });
    this._osc({ type: 'sawtooth', freq: 1780, freqEnd: 600, t0: t, dur: 0.45, gain: 0.22 });
    this._noiseBurst({ t0: t, dur: 0.5, gain: 0.25, type: 'bandpass', freq: 2600, q: 1.5 });
  }

  bite() {
    this._osc({ type: 'sine', freq: 90, freqEnd: 40, dur: 0.25, gain: 0.55 });
    this._noiseBurst({ dur: 0.18, gain: 0.4, freq: 700, freqEnd: 180 });
  }

  // The jumpscare hit: a sub-bass thump, a distorted downward scream sweep,
  // a bright noise impact, static, and a low rumbling tail — layered the
  // way the real game's scares combine a scream with static/pitch-bent
  // audio rather than a single clean sound.
  sting() {
    if (!this.ctx) return;
    const t = this.now;
    // sub-bass thump
    this._osc({ type: 'sine', freq: 58, freqEnd: 26, t0: t, dur: 0.55, gain: 0.55, attack: 0.004 });
    // bright impact
    this._noiseBurst({ t0: t, dur: 0.3, gain: 0.5, freq: 2200, freqEnd: 250, type: 'lowpass' });
    // distorted downward scream sweep
    const scream = this.ctx.createOscillator();
    scream.type = 'sawtooth';
    scream.frequency.setValueAtTime(1500, t);
    scream.frequency.exponentialRampToValueAtTime(170, t + 0.85);
    const screamGain = this.ctx.createGain();
    screamGain.gain.setValueAtTime(0.0001, t);
    screamGain.gain.exponentialRampToValueAtTime(0.34, t + 0.02);
    screamGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    const ws = this.ctx.createWaveShaper();
    ws.curve = this._distortionCurve(38);
    ws.oversample = '4x';
    scream.connect(ws).connect(screamGain).connect(this.master);
    this._sendReverb(screamGain, 0.3);
    scream.start(t);
    scream.stop(t + 1);
    // static layered underneath
    this._noiseBurst({ t0: t + 0.04, dur: 0.55, gain: 0.16, type: 'highpass', freq: 4200 });
    // low rumbling tail
    [108, 114, 216, 322].forEach((f) =>
      this._osc({ type: 'sawtooth', freq: f, t0: t, dur: 1.15, gain: 0.14, attack: 0.015 }));
  }

  // Ambush's scream: a Shepard tone (illusion of endlessly rising pitch),
  // matching the real game's use of a similarly disorienting effect.
  ambushScream() {
    if (!this.ctx) return;
    const t = this.now;
    this._shepardRise({ t0: t, dur: 1.6, gainMul: 0.22, sweet: 700 });
    this._noiseBurst({ t0: t, dur: 1.4, gain: 0.12, type: 'bandpass', freq: 1800, q: 0.6 });
  }

  // Seek's chase ("Here I Come"): a building, distorted roar that SUSTAINS for
  // the whole chase. Sub-bass foundation + distorted mid roar + a driving
  // tremolo pulse. Returns a handle:
  //   setVol(v)        overall loudness (starts at 0 — ramp it up)
  //   setIntensity(x)  0..1 — as Seek closes / the chase escalates, opens the
  //                    filter, drives distortion harder and speeds the pulse
  //                    so the dread keeps mounting
  //   stop()
  seekRumble() {
    if (!this.ctx) return null;
    const outG = this.ctx.createGain();
    outG.gain.value = 0;
    const tremolo = this.ctx.createGain();
    tremolo.gain.value = 1;
    outG.connect(tremolo).connect(this.master);
    this._sendReverb(tremolo, 0.35);
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 6;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.25;
    lfo.connect(lfoG).connect(tremolo.gain);

    // sub-bass foundation
    const sub = this.ctx.createOscillator();
    sub.type = 'sine'; sub.frequency.value = 30;
    const subG = this.ctx.createGain(); subG.gain.value = 0.5;
    sub.connect(subG).connect(outG);

    // distorted mid roar (filtered noise + a snarling saw, through a shaper)
    const ws = this.ctx.createWaveShaper();
    ws.curve = this._distortionCurve(24);
    ws.oversample = '2x';
    ws.connect(outG);
    const roar = this.ctx.createBufferSource();
    roar.buffer = this._noise; roar.loop = true; roar.playbackRate.value = 0.7;
    const roarF = this.ctx.createBiquadFilter();
    roarF.type = 'bandpass'; roarF.frequency.value = 300; roarF.Q.value = 0.9;
    roar.connect(roarF).connect(ws);
    const saw = this.ctx.createOscillator();
    saw.type = 'sawtooth'; saw.frequency.value = 44;
    const sawG = this.ctx.createGain(); sawG.gain.value = 0.4;
    saw.connect(sawG).connect(ws);

    sub.start(); roar.start(); saw.start(); lfo.start();
    const nodes = [sub, roar, saw, lfo];
    return {
      setVol: (v) => { outG.gain.value = v; },
      setIntensity: (x) => {
        if (!this.ctx) return;
        const xx = clamp(x, 0, 1);
        const now = this.now;
        roarF.frequency.setTargetAtTime(300 + xx * 1400, now, 0.3);
        lfo.frequency.setTargetAtTime(5 + xx * 9, now, 0.3);
        lfoG.gain.setTargetAtTime(0.15 + xx * 0.35, now, 0.3);
        sawG.gain.setTargetAtTime(0.3 + xx * 0.5, now, 0.3);
      },
      stop: () => {
        for (const n of nodes) { try { n.stop(); } catch (_) { /* already stopped */ } }
        setTimeout(() => { try { outG.disconnect(); } catch (_) { /* already gone */ } }, 60);
      },
    };
  }

  // Timothy: the jump-scare spider from a drawer. Described as "rumbling
  // thunder, then it comes" — a low rolling rumble, a burst of high skittering
  // ticks, and a sharp distorted screech chirp as he lunges at the screen.
  // Short one-shot; `vol` scales the whole hit. No handle.
  timothyScreech(vol = 1) {
    if (!this.ctx) return;
    const t = this.now;
    // low rolling thunder-rumble
    this._noiseBurst({ t0: t, dur: 0.5, gain: 0.28 * vol, type: 'lowpass', freq: 120, freqEnd: 60, q: 1 });
    this._osc({ type: 'sine', freq: 55, freqEnd: 30, t0: t, dur: 0.5, gain: 0.3 * vol });
    // rapid skittering ticks (many legs)
    for (let i = 0; i < 10; i++) {
      this._noiseBurst({ t0: t + 0.3 + i * rand(0.015, 0.035), dur: 0.02, gain: 0.09 * vol, type: 'bandpass', freq: rand(2600, 5200), q: 8 });
    }
    // sharp distorted screech chirp on the lunge
    const sc = this.ctx.createOscillator();
    sc.type = 'sawtooth';
    sc.frequency.setValueAtTime(2400, t + 0.32);
    sc.frequency.exponentialRampToValueAtTime(900, t + 0.55);
    const scg = this.ctx.createGain();
    scg.gain.setValueAtTime(0.0001, t + 0.32);
    scg.gain.exponentialRampToValueAtTime(0.28 * vol, t + 0.35);
    scg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    const ws = this.ctx.createWaveShaper();
    ws.curve = this._distortionCurve(20);
    sc.connect(ws).connect(scg).connect(this.master);
    this._sendReverb(scg, 0.25);
    sc.start(t + 0.32);
    sc.stop(t + 0.65);
  }

  whoosh(vol = 1) {
    this._noiseBurst({ dur: 0.55, gain: 0.28 * vol, type: 'bandpass', freq: 240, freqEnd: 2800, q: 0.6 });
  }

  growl(vol = 1) {
    const t = this.now;
    this._osc({ type: 'sawtooth', freq: 58, freqEnd: 42, t0: t, dur: 1.0, gain: 0.28 * vol, attack: 0.1 });
    this._noiseBurst({ t0: t, dur: 1.0, gain: 0.1 * vol, freq: 160, q: 2 });
  }

  bookFlip() {
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.07, gain: 0.16, type: 'highpass', freq: 1500 });
    this._noiseBurst({ t0: t + 0.09, dur: 0.09, gain: 0.13, type: 'highpass', freq: 1200 });
  }

  leverPull() {
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.12, gain: 0.3, freq: 900, freqEnd: 250 });
    this._osc({ type: 'square', freq: 180, t0: t + 0.14, dur: 0.1, gain: 0.15 });
  }

  ding() {
    this._osc({ type: 'sine', freq: 880, dur: 1.4, gain: 0.16 });
    this._osc({ type: 'sine', freq: 1760, dur: 1.0, gain: 0.07 });
  }

  winTune() {
    const t = this.now;
    [[523, 0], [659, 0.18], [784, 0.36], [1047, 0.54], [784, 0.86], [1047, 1.04]].forEach(([f, dt]) =>
      this._osc({ type: 'triangle', freq: f, t0: t + dt, dur: 0.5, gain: 0.14 }));
  }

  crucifixBanish() {
    const t = this.now;
    for (let i = 0; i < 6; i++) {
      this._osc({ type: 'sine', freq: rand(2000, 4200), t0: t + i * 0.06, dur: 0.3, gain: 0.08 });
    }
    this._osc({ type: 'triangle', freq: 523, t0: t, dur: 0.9, gain: 0.15 });
    this._osc({ type: 'triangle', freq: 784, t0: t + 0.1, dur: 0.9, gain: 0.13 });
  }

  heal() {
    const t = this.now;
    this._osc({ type: 'sine', freq: 660, t0: t, dur: 0.3, gain: 0.08 });
    this._osc({ type: 'sine', freq: 990, t0: t + 0.12, dur: 0.35, gain: 0.07 });
  }

  // Footstep. `surface` tunes the timbre: wood/tile/metal are sharp and
  // bright, carpet/dirt are soft and dull. Defaults to 'wood' so existing
  // callers using step(crouched) are unchanged. Crouching stays silent.
  step(crouched, surface = 'wood') {
    if (crouched) return; // crouching is silent (the Figure cares)
    if (!this.ctx) return;
    const t = this.now;
    switch (surface) {
      case 'carpet':
      case 'dirt':
        // soft, dull, no click
        this._noiseBurst({ t0: t, dur: 0.09, gain: rand(0.03, 0.05), type: 'lowpass', freq: rand(150, 240), freqEnd: 80, q: 0.6 });
        break;
      case 'tile':
      case 'stone':
      case 'concrete':
        // hard, bright, with a sharp click
        this._noiseBurst({ t0: t, dur: 0.05, gain: rand(0.04, 0.06), type: 'bandpass', freq: rand(500, 800), q: 1.4 });
        this._noiseBurst({ t0: t, dur: 0.03, gain: rand(0.02, 0.035), type: 'highpass', freq: 3200 });
        break;
      case 'metal':
        // ringing tap
        this._noiseBurst({ t0: t, dur: 0.08, gain: rand(0.04, 0.06), type: 'bandpass', freq: rand(900, 1400), q: 3 });
        this._osc({ type: 'triangle', freq: rand(1200, 1800), t0: t, dur: 0.06, gain: 0.02 });
        break;
      case 'wood':
      default:
        // woody knock with a faint top click
        this._noiseBurst({ t0: t, dur: 0.07, gain: rand(0.04, 0.07), type: 'lowpass', freq: rand(260, 400), freqEnd: 110, q: 0.9 });
        this._noiseBurst({ t0: t, dur: 0.03, gain: rand(0.015, 0.03), type: 'highpass', freq: 2200 });
        break;
    }
  }

  // a soft cloth/knee cue on entering/leaving crouch — quiet enough not to
  // itself alert the Figure, just tactile feedback for the player
  crouchToggle(down) {
    const t = this.now;
    this._noiseBurst({ t0: t, dur: 0.12, gain: 0.05, type: 'lowpass', freq: down ? 500 : 700, freqEnd: down ? 250 : 900 });
  }

  padClick() {
    this._noiseBurst({ dur: 0.03, gain: 0.14, type: 'highpass', freq: 3000 });
  }

  uiClick() {
    this._osc({ type: 'sine', freq: 700, dur: 0.06, gain: 0.07 });
  }

  error() {
    this._osc({ type: 'square', freq: 220, freqEnd: 180, dur: 0.18, gain: 0.09 });
  }
}

export const Sfx = new SfxEngine();
