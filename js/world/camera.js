/* Granny Bench - camera: orbit and fly controls, preset shots, and an automatic "director". */
(function (GB) {
  'use strict';
  const U = GB.U, v3 = GB.v3;

  // Static and dynamic shots. Dynamic shots read the world each frame.
  const SHOTS = {
    overview: () => ({ pos: [-9.5, 6.2, -12.5], target: [2.6, 1.0, 5.5] }),
    wide: () => ({ pos: [-24, 11, -15], target: [2, 1, 14] }),
    granny: () => ({ pos: [1.05, 1.55, -2.45], target: [0.05, 1.12, 0.25] }),
    grannyClose: () => ({ pos: [0.62, 1.38, -1.3], target: [0, 1.22, 0.1], fov: 0.8 }),
    track: () => ({ pos: [-1.45, 0.5, -3.7], target: [0, 1.7, 22] }),
    // The robot's corner follows w.station (its distance from the track, 3.3 m unless framing mode moves it).
    // These cameras stay beside the track, never above it, where a stopped train would be.
    robot: (w) => { const s = w.station - 3.3; return { pos: [Math.max(1.9, 2.55 + s), 2.1, -0.3], target: [4.2 + s, 1.05, 1.2] }; },
    terminal: (w) => { const s = w.station - 3.3; return { pos: [3.54 + s, 1.32, 1.18], target: [3.98 + s, 1.06, 1.2], fov: 1.05 }; },
    robotFront: (w) => { const x = w.station, dx = Math.min(2.35, x - 2.0); return { pos: [x - dx, 1.75, 1.2 + Math.sqrt(2.815 * 2.815 - dx * dx)], target: [x, 1.45, 1.2] }; },
    panel: (w) => { const s = w.station - 3.3; return { pos: [Math.max(1.9, 2.42 + s), 1.42, 3.42], target: [4.0 + s, 1.15, 2.45], fov: 0.9 }; },
    panelWide: (w) => { const x = w.station + 0.3, dx = Math.min(2.6, x - 2.0); return { pos: [x - dx, 2.3, 1.9 + Math.sqrt(3.97 * 3.97 - dx * dx)], target: [x, 1.0, 1.9] }; },
    side: () => ({ pos: [-16, 3.2, 9], target: [0, 1.3, 7] }),
    aerial: () => ({ pos: [34, 48, -42], target: [2, 0, 12] }),
    tower: () => ({ pos: [-15, 7, -13], target: [0, 7.5, 9] }),
    trainChase: (w) => { const z = w.train.root.position[2]; return { pos: [-3.4, 2.3, z - 8.5], target: [0, 1.3, z] }; },
    trainCam: (w) => { const z = Math.max(w.train.root.position[2], 6); return { pos: [2.8, 3.8, z + 5], target: [0, 1.0, 0] }; },
    followGranny: (w) => {
      const p = w.granny.rig.position;
      const rise = Math.max(0, p[1] - 2);
      return { pos: [p[0] - 6.5 + Math.min(rise, 4), Math.max(1.4, p[1] - 2.2), p[2] - 8.5 + Math.min(rise, 3)], target: [p[0], p[1] + 0.5, p[2]], fov: 0.9 };
    },
    bowlingLane: (w) => { const s = w.station - 3.3; return { pos: [10.5 + s, 3.2, -6.5], target: [2.6 + 0.8 * s, 0.9, 0.4] }; },
    bowlingLanding: (w) => { const x = w.station; return { pos: [x + 5.2, 1.7, -2.5], target: [x + 0.7, 0.95, -0.4], fov: 0.85 }; },
    idleOrbit: (w) => {
      const a = w.t * 0.045 + 3.9;
      return { pos: [2.5 + Math.cos(a) * 16, 8.6 + Math.sin(w.t * 0.07) * 1.2, 3 + Math.sin(a) * 16], target: [2.6, 1.0, 3.5] };
    },
  };
  const PRESETS = ['overview', 'granny', 'robot', 'terminal', 'track', 'side', 'wide', 'trainCam'];
  const PRESET_LABELS = { overview: 'Overview', granny: 'Grandma', robot: 'Robot', terminal: 'Terminal screen', track: 'Track', side: 'Side', wide: 'Wide', trainCam: 'Train' };

  class CameraController {
    constructor(canvas, world) {
      this.canvas = canvas;
      this.world = world;
      this.events = new U.Emitter();
      this.cam = { position: [-9.5, 6.2, -12.5], target: [2.6, 1.0, 5.5], fov: 0.96, near: 0.08, far: 1600, up: [0, 1, 0], shadowFocus: [2, 0.5, 3] };
      this.base = { pos: this.cam.position.slice(), target: this.cam.target.slice(), fov: 0.96 };
      this.mode = 'orbit';
      this.auto = true;
      this.shot = null;
      this.shotName = '';
      this.shake = 0; this.shakeImpulse = 0;
      this.keys = {};
      this.sensitivity = 1;
      this.invertY = false;
      this.orbit = { target: [2.6, 1.0, 5.5], yaw: 0, pitch: 0, dist: 10 };
      this.fly = { pos: [0, 2, 0], yaw: 0, pitch: 0 };
      this.pointers = new Map();
      this._bind();
      this.goTo('idleOrbit', 0);
    }

    static get presets() { return PRESETS; }
    static get presetLabels() { return PRESET_LABELS; }

    // ---- director ----
    setAuto(on) {
      if (this.auto === on) return;
      this.auto = on;
      if (on) this._manualShot = false;
      if (!on) this._syncManualFromBase();
      this.events.emit('auto', on);
    }

    goTo(name, duration) {
      const fn = SHOTS[name];
      if (!fn) return;
      this.shotName = name;
      this.shot = { fn, t: 0, dur: duration || 0, fromPos: this.base.pos.slice(), fromTarget: this.base.target.slice(), fromFov: this.base.fov };
    }

    // True while the camera glides to a new shot (not while it holds one or is turned by hand).
    get gliding() { const sh = this.shot; return !!sh && (this.auto || this._manualShot) && sh.dur > 0 && sh.t < sh.dur; }

    // Where the camera is headed: the end of its current move to a shot (or the view under manual control),
    // without the handheld drift and shake.
    restingPose() {
      const b = this.base;
      if (this.shot && (this.auto || this._manualShot)) {
        const pose = this.shot.fn(this.world);
        return { position: pose.pos, target: pose.target, fov: pose.fov || 0.96 };
      }
      return { position: b.pos, target: b.target, fov: b.fov };
    }

    // Manual preset button: switches to that view and hands control back to the user.
    preset(name) {
      this.goTo(name, 1.0);
      this._presetHold = name;
      if (this.auto) { this.auto = false; this.events.emit('auto', false); }
      this._manualShot = true;
    }

    cue(beat, ctx) {
      if (!this.auto) return;
      ctx = ctx || {};
      const pick = (list) => {
        const opts = list.filter((n) => n !== this.shotName);
        return opts.length ? U.pick(opts) : list[0];
      };
      switch (beat) {
        case 'idle': this.goTo('idleOrbit', 2.5); break;
        case 'intro': this.goTo('aerial', 0); setTimeout(() => { if (this.auto && this.shotName === 'aerial') this.goTo('overview', 3.2); }, 200); break;
        case 'overview': this.goTo('overview', 1.5); break;
        case 'granny': this.goTo(ctx.danger > 0.55 && Math.random() < 0.6 ? 'track' : pick(['granny', 'grannyClose', 'overview']), 1.1); break;
        case 'thinking': this.goTo(Math.random() < 0.6 ? 'terminal' : 'robot', 1.0); break;
        case 'robot': this.goTo(pick(['robotFront', 'overview', 'granny']), 1.2); break;
        case 'accepted': this.goTo('side', 1.0); break;
        case 'tower': this.goTo('tower', 2.0); break;
        case 'final': this.goTo('track', 0.7); break;
        case 'impact-orbit': this.goTo('followGranny', 0); break;
        case 'impact-ornament': this.goTo('trainChase', 0); break;
        case 'impact-bowling': this.goTo('bowlingLane', 0.25); break;
        case 'landing': this.goTo('bowlingLanding', 0.8); break;
        case 'aftermath': this.goTo('robotFront', 1.4); break;
        case 'tool':
          if (ctx.effect === 'glass') this.goTo('panel', 0.7);
          else this.goTo(this.world.panel && this.world.panel.rig.visible ? 'panelWide' : 'robotFront', 0.9);
          break;
        default: if (SHOTS[beat]) this.goTo(beat, 1.2);
      }
    }

    // ---- manual control state ----
    _syncManualFromBase() {
      const p = this.base.pos, t = this.base.target;
      const d = v3.sub([0, 0, 0], p, t);
      const dist = Math.max(0.5, v3.len(d));
      this.orbit.target = t.slice();
      this.orbit.dist = dist;
      this.orbit.yaw = Math.atan2(d[0], d[2]);
      this.orbit.pitch = Math.asin(U.clamp(d[1] / dist, -1, 1));
      const f = v3.normalize([0, 0, 0], v3.sub([0, 0, 0], t, p));
      this.fly.pos = p.slice();
      this.fly.yaw = Math.atan2(f[0], f[2]);
      this.fly.pitch = Math.asin(U.clamp(f[1], -1, 1));
      this.shot = null;
    }

    setMode(mode) {
      if (mode === this.mode) return;
      this._syncManualFromBase();
      this.mode = mode;
      this.events.emit('mode', mode);
    }

    _manual() {
      if (this.auto) this.setAuto(false);
      this._manualShot = false;
      if (this.shot) this._syncManualFromBase();
    }

    _bind() {
      const c = this.canvas;
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('pointerdown', (e) => {
        c.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
        c.focus({ preventScroll: true });
      });
      c.addEventListener('pointermove', (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (this.pointers.size >= 2) {
          const pts = Array.from(this.pointers.values());
          const before = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          p.x = e.clientX; p.y = e.clientY;
          const pts2 = Array.from(this.pointers.values());
          const after = Math.hypot(pts2[0].x - pts2[1].x, pts2[0].y - pts2[1].y);
          this._manual();
          if (before > 0 && after > 0) this._zoom((before - after) * 4);
          this._pan(dx * 0.5, dy * 0.5);
          return;
        }
        p.x = e.clientX; p.y = e.clientY;
        if (Math.abs(dx) + Math.abs(dy) === 0) return;
        this._manual();
        const panMode = p.button === 2 || p.button === 1 || p.shift;
        const k = 0.005 * this.sensitivity;
        if (this.mode === 'fly') {
          this.fly.yaw -= dx * k;
          this.fly.pitch = U.clamp(this.fly.pitch - dy * k * (this.invertY ? -1 : 1), -1.5, 1.5);
        } else if (panMode) {
          this._pan(dx, dy);
        } else {
          this.orbit.yaw -= dx * k;
          this.orbit.pitch = U.clamp(this.orbit.pitch + dy * k * (this.invertY ? -1 : 1), -0.35, 1.52);
        }
      });
      const up = (e) => { this.pointers.delete(e.pointerId); };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        this._manual();
        this._zoom(e.deltaY * (e.deltaMode === 1 ? 30 : 1));
      }, { passive: false });

      window.addEventListener('keydown', (e) => {
        if (this._typing(e)) return;
        // Not while a dialog is open or another page covers the 3D view.
        if ((GB.Modal && GB.Modal.stack.length) || (GB.App && GB.App.tab && GB.App.tab !== 'arena')) return;
        const k = e.key.toLowerCase();
        if ((k === ' ' || k === 'enter') && e.target && /^(button|a|summary)$/i.test(e.target.tagName || '')) return;
        if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'c'].includes(k)) {
          if (k === ' ' && this.mode !== 'fly') return;
          this.keys[k] = true;
          if (k.startsWith('arrow') || k === ' ') e.preventDefault();
        }
        if (e.key === 'Shift') this.keys.shift = true;
        if (k === 'f' && !e.ctrlKey && !e.metaKey) { this._manual(); this.setMode(this.mode === 'fly' ? 'orbit' : 'fly'); }
        if (/^[1-8]$/.test(k) && !this.blockNumberKeys) { this.preset(PRESETS[Number(k) - 1]); }
        if (k === 'r' && !e.ctrlKey && !e.metaKey) { this.setAuto(true); this.events.emit('reset-auto'); }
      });
      window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        delete this.keys[k];
        if (e.key === 'Shift') delete this.keys.shift;
      });
      window.addEventListener('blur', () => { this.keys = {}; });
    }

    _typing(e) {
      const t = e.target;
      if (!t) return false;
      const tag = (t.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable || e.ctrlKey || e.metaKey || e.altKey;
    }

    _pan(dx, dy) {
      if (this.mode === 'fly') return;
      const o = this.orbit;
      const s = o.dist * 0.0016;
      const right = [Math.cos(o.yaw), 0, -Math.sin(o.yaw)];
      const fwd = [Math.sin(o.yaw), 0, Math.cos(o.yaw)];
      const upAmt = Math.cos(o.pitch);
      o.target[0] += -dx * s * right[0] - dy * s * fwd[0] * Math.sin(o.pitch);
      o.target[2] += -dx * s * right[2] - dy * s * fwd[2] * Math.sin(o.pitch);
      o.target[1] = U.clamp(o.target[1] + dy * s * upAmt, -2, 400);
    }

    _zoom(delta) {
      if (this.mode === 'fly') {
        const f = this._flyForward();
        v3.addScaled(this.fly.pos, this.fly.pos, f, -delta * 0.012);
      } else {
        this.orbit.dist = U.clamp(this.orbit.dist * Math.exp(delta * 0.0012), 0.6, 600);
      }
    }

    _flyForward() {
      const f = this.fly;
      return [Math.cos(f.pitch) * Math.sin(f.yaw), Math.sin(f.pitch), Math.cos(f.pitch) * Math.cos(f.yaw)];
    }

    _keyboard(dt) {
      const k = this.keys;
      const any = k.w || k.a || k.s || k.d || k.q || k.e || k.arrowup || k.arrowdown || k.arrowleft || k.arrowright || k[' '] || k.c;
      if (!any) return;
      this._manual();
      const speed = (k.shift ? 24 : 7) * dt;
      const fwdIn = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
      const rightIn = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
      const upIn = (k.e || k[' '] ? 1 : 0) - (k.q || k.c ? 1 : 0);
      if (this.mode === 'fly') {
        const f = this._flyForward();
        const r = [Math.cos(this.fly.yaw), 0, -Math.sin(this.fly.yaw)];
        v3.addScaled(this.fly.pos, this.fly.pos, f, fwdIn * speed);
        v3.addScaled(this.fly.pos, this.fly.pos, r, -rightIn * speed);
        this.fly.pos[1] += upIn * speed;
      } else {
        const o = this.orbit;
        const fwd = [-Math.sin(o.yaw), 0, -Math.cos(o.yaw)];
        const right = [Math.cos(o.yaw), 0, -Math.sin(o.yaw)];
        const s = speed * Math.max(0.4, o.dist / 12);
        o.target[0] += fwd[0] * fwdIn * s + right[0] * rightIn * s;
        o.target[2] += fwd[2] * fwdIn * s + right[2] * rightIn * s;
        o.target[1] = U.clamp(o.target[1] + upIn * s, -2, 400);
      }
    }

    update(dt) {
      this._keyboard(dt);
      const b = this.base;
      if (this.shot && (this.auto || this._manualShot)) {
        const sh = this.shot;
        sh.t += dt;
        const pose = sh.fn(this.world);
        const u = sh.dur > 0 ? U.ease.inOut(Math.min(1, sh.t / sh.dur)) : 1;
        v3.lerp(b.pos, sh.fromPos, pose.pos, u);
        v3.lerp(b.target, sh.fromTarget, pose.target, u);
        b.fov = U.lerp(sh.fromFov, pose.fov || 0.96, u);
        if (this._manualShot && u >= 1) { this._manualShot = false; this._syncManualFromBase(); }
      } else if (this.mode === 'fly') {
        const f = this._flyForward();
        v3.copy(b.pos, this.fly.pos);
        v3.add(b.target, this.fly.pos, f);
        b.fov += (0.96 - b.fov) * Math.min(1, dt * 3);
      } else {
        const o = this.orbit;
        b.target = o.target.slice();
        b.pos = [o.target[0] + o.dist * Math.cos(o.pitch) * Math.sin(o.yaw), o.target[1] + o.dist * Math.sin(o.pitch), o.target[2] + o.dist * Math.cos(o.pitch) * Math.cos(o.yaw)];
        b.fov += (0.96 - b.fov) * Math.min(1, dt * 3);
      }
      // gentle handheld drift on director shots + shake
      const t = this.world.t;
      const drift = this.auto ? 0.04 : 0;
      this.shakeImpulse *= Math.exp(-dt * 2.5);
      const sk = this.shake;
      const c = this.cam;
      c.position[0] = b.pos[0] + Math.sin(t * 0.31) * drift + (Math.random() - 0.5) * sk;
      c.position[1] = Math.max(-1, b.pos[1] + Math.sin(t * 0.43) * drift * 0.6 + (Math.random() - 0.5) * sk);
      c.position[2] = b.pos[2] + Math.cos(t * 0.27) * drift + (Math.random() - 0.5) * sk;
      c.target[0] = b.target[0] + (Math.random() - 0.5) * sk * 0.5;
      c.target[1] = b.target[1] + (Math.random() - 0.5) * sk * 0.5;
      c.target[2] = b.target[2] + (Math.random() - 0.5) * sk * 0.5;
      c.fov = b.fov;
      c.shadowFocus = [U.clamp(b.target[0], -30, 30), U.clamp(b.target[1], 0, 2), U.clamp(b.target[2], -30, 60)];
    }
  }

  GB.CameraController = CameraController;
})(window.GB = window.GB || {});
