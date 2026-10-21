/* Granny Bench - procedurally synthesized sound effects (Web Audio API, no audio files). */
(function (GB) {
  'use strict';
  const U = GB.U;

  const SFX = {
    ctx: null,
    master: null,
    enabled: true,
    volume: 0.7,
    music: true,
    _noise: null,
    _train: null,
    _chuffT: 0,
    _clackT: 0,
    _drone: null,
    _tickT: 0,

    // The Arena's pause button: all sound stops where it is until resumed.
    setPaused(on) {
      this.paused = !!on;
      if (!this.ctx) return;
      if (on) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    },

    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume().catch(() => {}); return true; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ctx = new AC();
      } catch (e) { return false; }
      const c = this.ctx;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.master = c.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(comp);
      comp.connect(c.destination);
      // Typed-out dialogue blips have their own bus: they follow the voices switch, not the sound effects one.
      this.voiceBus = c.createGain();
      this.voiceBus.connect(comp);
      // shared noise buffer
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
      this._startTrainBed();
      return true;
    },

    apply(audio) {
      this.enabled = audio.enabled !== false;
      this.volume = U.clamp(Number(audio.volume == null ? 0.7 : audio.volume), 0, 1);
      this.music = audio.music !== false;
      if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
      if (!this.music) this.setDanger(0);
    },

    _noiseSrc() {
      const s = this.ctx.createBufferSource();
      s.buffer = this._noise;
      s.loop = true;
      s.loopStart = Math.random();
      return s;
    },

    _env(g, t, a, peak, d, end) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, end || 0.0001), t + a + d);
    },

    // ---- continuous train bed (rumble), plus chuffs and clacks scheduled from update() ----
    _startTrainBed() {
      const c = this.ctx;
      const src = this._noiseSrc();
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(this.master);
      src.start();
      this._train = { gain: g, lp };
    },

    // Called every frame with the train state relative to the camera.
    update(dt, s) {
      if (!this.ctx || !this._train) return;
      const c = this.ctx, now = c.currentTime;
      const prox = U.clamp(22 / (s.camDist + 8), 0, 1.3);
      const running = s.running ? 1 : 0;
      const sp = U.clamp(s.speed / 8, 0, 1);
      const rumble = running * prox * (0.08 + sp * 0.35) * (s.timeScale < 0.5 ? 0.5 : 1);
      this._train.gain.gain.setTargetAtTime(rumble, now, 0.15);
      this._train.lp.frequency.setTargetAtTime(s.timeScale < 0.5 ? 70 : 140 + sp * 120, now, 0.2);
      if (!running) return;
      // chuffs: roughly one per meter traveled, slowed in bullet time
      const rate = (s.timeScale < 0.5 ? 0.8 : Math.max(1.1, s.speed * 0.95)) * (s.braking ? 0.4 : 1);
      // Never build up a backlog of chuffs (e.g. after the train jumps or the tab was hidden).
      this._chuffT = Math.max(this._chuffT - dt * rate, -1);
      if (this._chuffT <= 0) {
        this._chuffT += 1;
        this._chuff(prox, s.timeScale < 0.5);
      }
      if (s.speed > 2 && prox > 0.25 && s.timeScale >= 0.5) {
        this._clackT = Math.max(this._clackT - dt * s.speed / 12, -1);
        if (this._clackT <= 0) { this._clackT += 1; this._clack(prox); }
      }
    },

    _chuff(prox, slow) {
      const c = this.ctx, t = c.currentTime;
      const src = this._noiseSrc();
      src.playbackRate.value = slow ? 0.35 : 1;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = slow ? 300 : U.rand(650, 900); bp.Q.value = 0.8;
      const g = c.createGain();
      src.connect(bp); bp.connect(g); g.connect(this.master);
      this._env(g, t, 0.008, 0.5 * prox, slow ? 0.6 : 0.16);
      src.start(t); src.stop(t + (slow ? 0.8 : 0.3));
    },

    _clack(prox) {
      const c = this.ctx, t = c.currentTime;
      for (const off of [0, 0.11]) {
        const src = this._noiseSrc();
        const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2200; hp.Q.value = 2;
        const g = c.createGain();
        src.connect(hp); hp.connect(g); g.connect(this.master);
        this._env(g, t + off, 0.002, 0.25 * prox, 0.05);
        src.start(t + off); src.stop(t + off + 0.08);
      }
    },

    horn(prox, duration) {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      const dur = duration || 1.1;
      const g = c.createGain();
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      lp.connect(g); g.connect(this.master);
      const vib = c.createOscillator(); vib.frequency.value = 5.5;
      const vibAmt = c.createGain(); vibAmt.gain.value = 2.2;
      vib.connect(vibAmt);
      for (const f of [277.2, 349.2, 415.3, 554.4]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        vibAmt.connect(o.frequency);
        const og = c.createGain(); og.gain.value = 0.16;
        o.connect(og); og.connect(lp);
        o.start(t); o.stop(t + dur + 0.4);
      }
      vib.start(t); vib.stop(t + dur + 0.4);
      const peak = U.clamp(0.25 + (prox || 0.5) * 0.75, 0.15, 1.1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.06);
      g.gain.setValueAtTime(peak, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    },

    brakes(duration) {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime, dur = duration || 2.5;
      const out = c.createGain(); out.connect(this.master);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
      out.gain.setValueAtTime(0.5, t + dur * 0.7);
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      for (const f of [2650, 3920]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const lfo = c.createOscillator(); lfo.frequency.value = U.rand(6, 9);
        const la = c.createGain(); la.gain.value = f * 0.012;
        lfo.connect(la); la.connect(o.frequency);
        o.frequency.linearRampToValueAtTime(f * 0.86, t + dur);
        const og = c.createGain(); og.gain.value = 0.18;
        o.connect(og); og.connect(out);
        o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
      }
      const n = this._noiseSrc();
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 3;
      const ng = c.createGain(); ng.gain.value = 0.35;
      n.connect(bp); bp.connect(ng); ng.connect(out);
      n.start(t); n.stop(t + dur);
      this.steam(dur * 0.9);
    },

    steam(duration) {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime, dur = duration || 1.2;
      const n = this._noiseSrc();
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const g = c.createGain();
      n.connect(hp); hp.connect(g); g.connect(this.master);
      this._env(g, t, 0.05, 0.22, dur);
      n.start(t); n.stop(t + dur + 0.1);
    },

    impact() {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      // thud
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.45);
      const g = c.createGain(); o.connect(g); g.connect(this.master);
      this._env(g, t, 0.005, 1.0, 0.55);
      o.start(t); o.stop(t + 0.7);
      // crash
      const n = this._noiseSrc();
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.6);
      const ng = c.createGain(); n.connect(lp); lp.connect(ng); ng.connect(this.master);
      this._env(ng, t, 0.003, 0.7, 0.6);
      n.start(t); n.stop(t + 0.8);
      this.boing(t + 0.08);
    },

    boing(at) {
      if (!this.ensure()) return;
      const c = this.ctx, t = at || c.currentTime;
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.8);
      const lfo = c.createOscillator(); lfo.frequency.value = 16;
      const la = c.createGain(); la.gain.value = 40;
      lfo.connect(la); la.connect(o.frequency);
      const g = c.createGain(); o.connect(g); g.connect(this.master);
      this._env(g, t, 0.01, 0.45, 0.85);
      o.start(t); lfo.start(t); o.stop(t + 0.95); lfo.stop(t + 0.95);
    },

    slideWhistle(duration) {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime, dur = duration || 1.6;
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(2100, t + dur);
      const lfo = c.createOscillator(); lfo.frequency.value = 7;
      const la = c.createGain(); la.gain.value = 18;
      lfo.connect(la); la.connect(o.frequency);
      const g = c.createGain(); o.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
      g.gain.setValueAtTime(0.25, t + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    },

    clank(i) {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      const n = this._noiseSrc();
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + (i || 0) * 250; bp.Q.value = 6;
      const g = c.createGain(); n.connect(bp); bp.connect(g); g.connect(this.master);
      this._env(g, t, 0.002, 0.8, 0.35);
      n.start(t); n.stop(t + 0.45);
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 150 - (i || 0) * 20;
      const og = c.createGain(); o.connect(og); og.connect(this.master);
      this._env(og, t, 0.002, 0.25, 0.25);
      o.start(t); o.stop(t + 0.3);
    },

    key() {
      if (!this.ctx || !this.enabled) return;
      const c = this.ctx, t = c.currentTime;
      const n = this._noiseSrc();
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = U.rand(2500, 4000);
      const g = c.createGain(); n.connect(hp); hp.connect(g); g.connect(this.master);
      this._env(g, t, 0.001, 0.07, 0.025);
      n.start(t); n.stop(t + 0.05);
    },

    tick(high) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = high ? 1500 : 1100;
      const g = c.createGain(); o.connect(g); g.connect(this.master);
      this._env(g, t, 0.001, 0.12, 0.04);
      o.start(t); o.stop(t + 0.06);
    },

    // One "voice" blip for typed-out dialogue. o: {freq, wave, dur, vol}
    blip(o) {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      const osc = c.createOscillator();
      osc.type = o.wave || 'triangle';
      osc.frequency.setValueAtTime(o.freq, t);
      osc.frequency.exponentialRampToValueAtTime(o.freq * 0.88, t + o.dur);
      const g = c.createGain();
      if (o.wave === 'square') {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
        osc.connect(lp); lp.connect(g);
      } else osc.connect(g);
      g.connect(this.voiceBus);
      this._env(g, t, 0.004, o.vol, o.dur);
      osc.start(t); osc.stop(t + o.dur + 0.02);
    },

    // Virtual tool used: two quick blips.
    toolBeep() {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      [[1200, 0], [1600, 0.09]].forEach(([f, d]) => {
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
        const g = c.createGain(); o.connect(lp); lp.connect(g); g.connect(this.master);
        this._env(g, t + d, 0.003, 0.09, 0.07);
        o.start(t + d); o.stop(t + d + 0.1);
      });
    },

    // Breaking glass: a bright crash, then falling shards.
    glass() {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      const n = this._noiseSrc();
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
      const g = c.createGain(); n.connect(hp); hp.connect(g); g.connect(this.master);
      this._env(g, t, 0.002, 0.6, 0.35);
      n.start(t); n.stop(t + 0.45);
      for (let i = 0; i < 14; i++) {
        const d = 0.04 + Math.random() * 0.7;
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = U.rand(3000, 7500);
        const og = c.createGain(); o.connect(og); og.connect(this.master);
        this._env(og, t + d, 0.001, U.rand(0.03, 0.09), U.rand(0.08, 0.25));
        o.start(t + d); o.stop(t + d + 0.3);
      }
    },

    // Alarm siren, alternating two tones.
    siren(duration) {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime, dur = duration || 3;
      const o = c.createOscillator(); o.type = 'sawtooth';
      for (let k = 0, x = 0; x < dur; k++, x += 0.38) o.frequency.setValueAtTime(k % 2 ? 640 : 860, t + x);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      const g = c.createGain(); o.connect(lp); lp.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.05);
      g.gain.setValueAtTime(0.11, t + dur - 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    },

    // Radio static with a squelch at both ends.
    radio(duration) {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime, dur = duration || 1.6;
      const n = this._noiseSrc();
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.1;
      const g = c.createGain(); n.connect(bp); bp.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0.0001, t);
      for (let x = 0; x < dur; x += 0.05) g.gain.setValueAtTime(U.rand(0.04, 0.16), t + x);
      g.gain.setValueAtTime(0.0001, t + dur);
      n.start(t); n.stop(t + dur + 0.05);
      [0, dur].forEach((d) => {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 1900;
        const og = c.createGain(); o.connect(og); og.connect(this.master);
        this._env(og, t + d, 0.003, 0.08, 0.08);
        o.start(t + d); o.stop(t + d + 0.12);
      });
    },

    buzzer() {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 98;
      const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 103;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = c.createGain();
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
      g.gain.setValueAtTime(0.28, t + 0.38);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.start(t); o2.start(t); o.stop(t + 0.5); o2.stop(t + 0.5);
    },

    chime() {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      [[880, 0], [1318.5, 0.12], [1760, 0.24]].forEach(([f, d]) => {
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const g = c.createGain(); o.connect(g); g.connect(this.master);
        this._env(g, t + d, 0.005, 0.25, 0.6);
        o.start(t + d); o.stop(t + d + 0.7);
      });
    },

    fanfare() {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      const notes = [[523.3, 0, 0.14], [659.3, 0.14, 0.14], [784, 0.28, 0.14], [1046.5, 0.42, 0.7]];
      for (const [f, d, len] of notes) {
        for (const det of [-4, 4]) {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
          const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
          const g = c.createGain(); o.connect(lp); lp.connect(g); g.connect(this.master);
          this._env(g, t + d, 0.02, 0.12, len);
          o.start(t + d); o.stop(t + d + len + 0.1);
        }
      }
    },

    whoosh() {
      if (!this.ensure()) return;
      const c = this.ctx, t = c.currentTime;
      const n = this._noiseSrc();
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
      const g = c.createGain(); n.connect(bp); bp.connect(g); g.connect(this.master);
      this._env(g, t, 0.15, 0.4, 0.5);
      n.start(t); n.stop(t + 0.8);
    },

    // Low suspense drone that rises as the train gets closer. danger 0..1 (0 = off).
    setDanger(danger) {
      if (!this.ctx) return;
      const c = this.ctx, now = c.currentTime;
      if (!this._drone && danger > 0 && this.music) {
        const g = c.createGain(); g.gain.value = 0;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
        lp.connect(g); g.connect(this.master);
        const oscs = [0, 7, 12].map((semi, i) => {
          const o = c.createOscillator(); o.type = i === 1 ? 'triangle' : 'sawtooth';
          o.frequency.value = 55 * Math.pow(2, semi / 12);
          o.detune.value = (i - 1) * 6;
          const og = c.createGain(); og.gain.value = i === 1 ? 0.5 : 0.3;
          o.connect(og); og.connect(lp); o.start();
          return o;
        });
        this._drone = { g, lp, oscs };
      }
      if (!this._drone) return;
      const d = this.music ? U.clamp(danger, 0, 1) : 0;
      this._drone.g.gain.setTargetAtTime(d * 0.22, now, 0.4);
      this._drone.lp.frequency.setTargetAtTime(300 + d * 900, now, 0.4);
      this._drone.oscs.forEach((o, i) => o.frequency.setTargetAtTime(55 * Math.pow(2, [0, 7, 12][i] / 12) * (1 + d * 0.5), now, 0.6));
    },
  };

  GB.SFX = SFX;
})(window.GB = window.GB || {});
