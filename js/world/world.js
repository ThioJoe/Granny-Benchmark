/* Granny Bench - the 3D world: assembly, per-frame animation, particles, and the endings. */
(function (GB) {
  'use strict';
  const U = GB.U, G = GB.Geo, Node = GB.Node, M = GB.Models;
  const PI = Math.PI;

  const GRANNY_YAW = PI - 0.45;     // she faces away from the train (-Z), angled toward the robot
  const ROBOT_POS = [6.6, 0, 1.2];
  const TRAIN_START = 160;          // distance (m) when the clock starts
  const TRAIN_PARK = 270;           // where it waits before a run
  const IMPACT_DIST = 0.42;
  const STOP_GAP = 0.9;             // closest a braking train gets
  const DASH = 16;                  // meters left when the clock runs out: the train covers them at full speed
  const PANEL_POS = [7.3, 0, 2.45]; // emergency brake panel (shown when a scenario has a "glass" tool)
  const PANEL_YAW = -1.03;          // faces back toward the track and the default cameras

  // ---------------------------------------------------------------------------
  class Pool {
    constructor(parent, mesh, count, mat, behave) {
      this.items = [];
      this.behave = behave;
      this.next = 0;
      for (let i = 0; i < count; i++) {
        const n = new Node('particle', mesh, Object.assign({}, mat, { tint: (mat && mat.tint ? mat.tint.slice() : [1, 1, 1]) }));
        n.visible = false;
        n.castShadow = false;
        parent.add(n);
        this.items.push({ node: n, life: 0, max: 1, vel: [0, 0, 0], spin: [0, 0, 0], size: 1, alive: false });
      }
    }
    spawn(pos, vel, max, size, spin) {
      const it = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
      it.alive = true; it.life = 0; it.max = max; it.size = size || 1;
      it.node.position[0] = pos[0]; it.node.position[1] = pos[1]; it.node.position[2] = pos[2];
      it.vel[0] = vel[0]; it.vel[1] = vel[1]; it.vel[2] = vel[2];
      it.spin = spin || [0, 0, 0];
      it.node.rotation[0] = Math.random() * 6; it.node.rotation[1] = Math.random() * 6; it.node.rotation[2] = Math.random() * 6;
      it.node.visible = true;
      this.behave(it, 0, 0);
      return it;
    }
    update(dt) {
      for (const it of this.items) {
        if (!it.alive) continue;
        it.life += dt;
        const u = it.life / it.max;
        if (u >= 1) { it.alive = false; it.node.visible = false; continue; }
        this.behave(it, dt, u);
      }
    }
    clear() { for (const it of this.items) { it.alive = false; it.node.visible = false; } }
  }

  // ---------------------------------------------------------------------------
  class World {
    constructor() {
      this.ready = false;
      this.events = new U.Emitter();
      this.t = 0; this.st = 0;
      this.timeScale = 1; this.targetTimeScale = 1;
      this.tweens = [];
      this.trainDist = TRAIN_PARK;
      this.trainSpeed = 0;
      this.trainRunning = true;
      this.wheelAngle = 0;
      this.smokeAcc = 0;
      this.braking = false;
      this.grannyFree = false;
      this.grannyAltitude = 0;
      this.speaking = { granny: 0, robot: 0 };      // mouth envelopes
      this.talking = { granny: false, robot: false };
      this.robotTyping = false;
      this.robotLook = 'screen';
      this.robotThinking = false;
      this.grannyLook = 'robot';
      this.lookTrainUntil = 0;
      this.blink = { granny: 2, robot: 3 };
      this.tower = null;
      this.cheer = 0;
      this.alarmUntil = 0;
      this.panelBroken = false;
    }

    init(canvas, opts) {
      opts = opts || {};
      const R = this.R = new GB.Renderer(canvas, { shadows: opts.shadows !== false, pixelRatioCap: opts.pixelRatioCap });
      const scene = this.scene = new Node('scene');

      // scenery
      const sc = M.scenery(R);
      for (const n of sc.nodes) scene.add(n);
      this.clouds = sc.clouds;
      scene.add(M.track(R, -320, 340));

      // granny
      this.granny = M.granny(R);
      this.granny.rig.at(0, 0.18, 0).rot(0, GRANNY_YAW, 0);
      scene.add(this.granny.rig);

      // robot + desk + terminal
      this.robot = M.robot(R);
      this.robot.rig.at(ROBOT_POS[0], ROBOT_POS[1], ROBOT_POS[2]).rot(0, PI / 2, 0);
      scene.add(this.robot.rig);
      this.terminal = new GB.Screens.Terminal(R);
      const scr = this.robot.screen;
      scr.mesh = R.createMesh(G.plane(0.44, 0.33));
      scr.material.texture = this.terminal.tex;
      scr.material.unlit = true;
      scr.castShadow = false;

      // sign
      const sign = M.sign(R);
      sign.rig.at(-3.4, 0, 4.4).rot(0, -2.72, 0);
      scene.add(sign.rig);
      this.sign = new GB.Screens.Sign(R);
      sign.face.mesh = R.createMesh(G.plane(3.12, 1.66));
      sign.face.material.texture = this.sign.tex;
      sign.face.material.emissive = [0.12, 0.1, 0.08];
      sign.face.castShadow = false;
      this.signRig = sign.rig;

      // relay + cable
      this.relay = M.relay(R);
      this.relay.rig.at(1.65, 0, 2.6);
      scene.add(this.relay.rig);
      scene.add(M.cable(R, [[1.9, 0.03, 2.6], [3.5, 0.03, 2.3], [5.4, 0.03, 2.15], [7.69, 0.03, 2.05], [7.69, 0.03, 1.88], [7.69, 0.74, 1.88], [7.86, 0.98, 1.4]]));

      // emergency brake panel (for tool scenarios)
      this.panel = M.brakePanel(R);
      this.panel.rig.at(PANEL_POS[0], PANEL_POS[1], PANEL_POS[2]).rot(0, PANEL_YAW, 0);
      this.panel.label.material.texture = GB.Screens.labelTexture(R, 'EMERGENCY BRAKE', 'BREAK GLASS · PULL HANDLE', '#ffffff', '#b8261c');
      this.panel.rig.visible = false;
      scene.add(this.panel.rig);
      const shardMesh = R.createMesh(G.box(0.07, 0.05, 0.006, '#d4f0ff'));
      this.shards = new Pool(scene, shardMesh, 36, { emissive: [0.25, 0.3, 0.34] }, (it, dt) => {
        const p = it.node.position;
        if (p[1] > 0.012) {
          it.vel[1] -= 9.8 * dt;
          p[0] += it.vel[0] * dt; p[1] += it.vel[1] * dt; p[2] += it.vel[2] * dt;
          it.node.rotation[0] += it.spin[0] * dt; it.node.rotation[1] += it.spin[1] * dt;
          if (p[1] <= 0.012) { p[1] = 0.012; it.node.rotation[0] = PI / 2; it.vel[0] = it.vel[2] = 0; }
        }
      });

      // train
      this.train = M.train(R);
      this.train.root.rot(0, PI, 0);
      scene.add(this.train.root);
      this.carHome = [this.train.tender, ...this.train.cars].map((n) => ({ node: n, pos: n.position.slice(), rot: n.rotation.slice() }));

      // particles
      const smokeMesh = R.createMesh(G.icosphere(0.5, 1, '#ffffff'));
      this.smoke = new Pool(scene, smokeMesh, 80, { tint: [0.92, 0.92, 0.93] }, (it, dt, u) => {
        it.vel[1] *= Math.exp(-dt * 0.4);
        it.vel[0] *= Math.exp(-dt * 0.8); it.vel[2] *= Math.exp(-dt * 0.8);
        it.vel[0] += dt * 0.5;
        const p = it.node.position;
        p[0] += it.vel[0] * dt; p[1] += it.vel[1] * dt; p[2] += it.vel[2] * dt;
        const grow = u < 0.15 ? u / 0.15 : 1 - Math.pow((u - 0.15) / 0.85, 2.2);
        const s = Math.max(0.001, it.size * (0.35 + 0.65 * Math.min(1, u * 4)) * grow);
        it.node.scl(s, s * 0.9, s);
        it.node.rotation[1] += dt * 0.3;
      });
      const sparkMesh = R.createMesh(G.box(0.04, 0.04, 0.2, '#ffd27a'));
      this.sparks = new Pool(scene, sparkMesh, 110, { unlit: true, emissive: [1, 0.55, 0.1] }, (it, dt, u) => {
        it.vel[1] -= 9.8 * dt;
        const p = it.node.position;
        p[0] += it.vel[0] * dt; p[1] += it.vel[1] * dt; p[2] += it.vel[2] * dt;
        if (p[1] < 0.05) { p[1] = 0.05; it.vel[1] *= -0.3; }
        it.node.rotation[1] = Math.atan2(it.vel[0], it.vel[2]);
        it.node.rotation[0] = -Math.atan2(it.vel[1], Math.hypot(it.vel[0], it.vel[2]));
        const s = 1 - u;
        it.node.scl(s, s, s * 1.3);
      });
      const confettiMeshes = ['#ff4d6d', '#ffd23f', '#3ddc84', '#4da3ff', '#b48cff', '#ffffff'].map((c) => R.createMesh(G.box(0.12, 0.012, 0.08, c)));
      this.confetti = confettiMeshes.map((mesh) => new Pool(scene, mesh, 30, { emissive: [0.2, 0.2, 0.2] }, (it, dt) => {
        it.vel[1] -= 2.6 * dt;
        it.vel[0] *= Math.exp(-dt * 1.4); it.vel[2] *= Math.exp(-dt * 1.4);
        if (it.vel[1] < -1.2) it.vel[1] = -1.2;
        const p = it.node.position;
        p[0] += (it.vel[0] + Math.sin(it.life * 6 + it.size * 10) * 0.4) * dt; p[1] += it.vel[1] * dt; p[2] += it.vel[2] * dt;
        if (p[1] < 0.02) { p[1] = 0.02; it.vel[0] = it.vel[2] = 0; }
        else { it.node.rotation[0] += it.spin[0] * dt; it.node.rotation[2] += it.spin[2] * dt; }
      }));

      // clouds she flies through in the "orbit" ending (hidden otherwise)
      this.pathClouds = [[3, 45, -9, 6], [-2.5, 86, -16, 7], [3.5, 128, -21, 8], [-1.5, 172, -25, 9]].map(([x, y, z, r], i) => {
        const parts = [];
        for (let k = 0; k < 5; k++) parts.push({ g: G.icosphere(r * (0.55 + 0.1 * (k % 3)), 1, '#ffffff', 0.1, 70 + i * 9 + k), p: [(k - 2) * r * 0.6, (k % 2) * r * 0.2, ((k * 7) % 3 - 1) * r * 0.35], s: [1, 0.6, 1] });
        const n = new Node('pathCloud', R.createMesh(G.merge(parts)), { emissive: [0.2, 0.2, 0.22] });
        n.at(x, y, z);
        n.visible = false;
        n.castShadow = false;
        scene.add(n);
        return n;
      });

      this.camera = new GB.CameraController(canvas, this);
      this.ready = true;
      this.reset();
      return this;
    }

    // ---------------------------------------------------------------------------
    // public API used by the show / UI
    // ---------------------------------------------------------------------------
    setScenario(sc) {
      if (!this.ready) return;
      // Runs saved by 1.1 and earlier name a song and artist instead of the sign's title lines.
      const P = GB.Prompts, old = sc.signTitle == null && sc.song != null;
      const text = {
        line1: sc.signLine1 != null ? sc.signLine1 : old ? P.SONG.signLine1 : P.SIGN_LINE1,
        title: old ? '“' + sc.song + '”' : sc.signTitle,
        subtitle: old ? (sc.artist ? 'by ' + sc.artist : '') : sc.signSubtitle,
        line2: sc.signLine2 != null ? sc.signLine2 : old ? P.SONG.signLine2 : P.SIGN_LINE2,
      };
      const key = JSON.stringify(text);
      if (key !== this._signKey) { this._signKey = key; this.sign.setText(text); }
      // The brake panel only appears in scenarios that have a tool which breaks its glass.
      const tools = GB.Tools ? GB.Tools.callable(sc) : [];
      this.panel.rig.visible = tools.some((t) => t.effect === 'glass');
    }
    setClock(secondsLeft) { if (this.ready) this.sign.setClock(secondsLeft); }
    setTerminal(patch) { if (this.ready) this.terminal.set(patch); }
    setTimeScale(s) { this.targetTimeScale = s; }
    setTrainDistance(d) { this.trainDist = d; }
    distanceFor(vt, T) { return DASH + (TRAIN_START - DASH) * (1 - U.clamp(vt / T, 0, 1)); }
    // Where a braking train stops for a reply that lands at vt: at the end of the clock, just short of Grandma.
    brakeStopFor(vt, T) { return STOP_GAP + (TRAIN_START - STOP_GAP - 3.2) * (1 - U.clamp(vt / T, 0, 1)); }
    setRelay(color) {
      this._relayColor = color;
      const c = { red: [0.8, 0.05, 0.05], green: [0.1, 0.9, 0.25], amber: [0.9, 0.6, 0.05] }[color] || [0.8, 0.05, 0.05];
      this.relay.lamp.material.emissive = c;
      this.relay.lamp.material.tint = color === 'green' ? [0.3, 1, 0.4] : color === 'amber' ? [1, 0.8, 0.3] : [1, 0.25, 0.25];
    }
    setTalking(who, on) { this.talking[who] = !!on; if (!on) this.speaking[who] = Math.min(this.speaking[who], 0.3); }
    wordPulse(who) { this.speaking[who] = 1; }
    setRobotTyping(on) { this.robotTyping = !!on; }
    setRobotThinking(on) { this.robotThinking = !!on; }
    setRobotLook(where) { this.robotLook = where; }
    grannyLookAtTrain(seconds) { this.lookTrainUntil = this.t + (seconds || 1.6); }

    // Points just above the heads and just below the chins, for the speech bubbles. The ...Seat points are
    // those with the head at rest (Grandma sways in her chair, the robot tilts its head), so a bubble can stay
    // put while its tail follows the head.
    anchors() {
      const g = this.granny, r = this.robot;
      const neck = g.torso.position[1] + g.head.position[1], rNeck = r.head.position[1];
      const seat = (y) => (this.grannyFree ? g.rig.localToWorld([0, neck + y, 0]) : [g.rig.position[0], 0.18 + neck + y, g.rig.position[2]]);
      return {
        granny: g.head.localToWorld([0, 0.48, 0]), grannyChin: g.head.localToWorld([0, -0.02, 0]),
        grannySeat: seat(0.48), grannySeatChin: seat(-0.02),
        robot: r.head.localToWorld([0, 0.62, 0]), robotChin: r.head.localToWorld([0, -0.02, 0]),
        robotSeat: r.body.localToWorld([0, rNeck + 0.62, 0]), robotSeatChin: r.body.localToWorld([0, rNeck - 0.02, 0]),
      };
    }
    trainFront() { return [0, 1.6, this.train.root.position[2]]; }
    grannyWorld() { return this.granny.rig.worldPosition(); }

    reset() {
      this.tweens.length = 0;
      this.grannyFree = false;
      this.grannyAltitude = 0;
      this.braking = false;
      this.trainRunning = true;
      this.cheer = 0;
      this.tower = null;
      const g = this.granny.rig;
      if (g.parent !== this.scene) this.scene.add(g);
      g.visible = true;
      g.at(0, 0.18, 0).rot(0, GRANNY_YAW, 0).scl(1);
      this.granny.torso.rot(0, 0, 0);
      this.granny.head.rot(0, 0, 0);
      for (const h of this.carHome) { h.node.position = h.pos.slice(); h.node.rotation = h.rot.slice(); }
      this.trainDist = TRAIN_PARK;
      this.train.root.position[2] = TRAIN_PARK;
      this.trainSpeed = 0;
      for (const c of this.pathClouds) c.visible = false;
      this.smoke.clear(); this.sparks.clear(); this.shards.clear(); for (const p of this.confetti) p.clear();
      this.panelBroken = false;
      this.panel.glass.visible = true;
      this.panel.handle.rotation[0] = 0;
      this.alarmUntil = 0;
      this.setRelay('red');
      this.setTimeScale(1);
      this.robotLook = 'screen';
      this.robotTyping = false;
      this.robotThinking = false;
      this.talking.granny = this.talking.robot = false;
      this.terminal.set({ mode: 'idle', text: '', status: 'STANDBY', banner: '', bannerSub: '', coverage: null, footer: '' });
      this.setClock(60);
    }

    // Promise-based tween on real time. fn(u, dt, elapsed)
    animate(duration, fn, ease) {
      return new Promise((resolve) => {
        this.tweens.push({ t: 0, dur: Math.max(0.0001, duration), fn, ease: ease || U.ease.linear, resolve });
      });
    }
    wait(seconds) { return this.animate(seconds, () => {}); }

    // Move the train smoothly between distances (used by the show for time passing).
    moveTrain(from, to, seconds, ease) {
      return this.animate(seconds, (u) => { this.trainDist = U.lerp(from, to, u); }, ease || U.ease.linear);
    }

    // ---------------------------------------------------------------------------
    // endings
    // ---------------------------------------------------------------------------
    async brakeTo(stopDist, seconds) {
      const from = this.trainDist;
      const to = Math.max(STOP_GAP, Math.min(from, stopDist));
      this.braking = true;
      this.events.emit('brake');
      await this.animate(seconds, (u) => { this.trainDist = U.lerp(from, to, u); }, U.ease.out);
      this.braking = false;
      this.trainRunning = false;
      this.trainSpeed = 0;
    }

    // A virtual tool was used: 'glass' smashes the brake panel's cover, 'alarm' flashes the lights.
    toolEffect(kind) {
      if (!this.ready) return;
      if (kind === 'glass') {
        this.panel.rig.visible = true;
        this.alarmUntil = this.t + 6;
        if (this.panelBroken) return;
        this.panelBroken = true;
        this.panel.glass.visible = false;
        const origin = this.panel.glass.localToWorld([0, 0, 0]);
        const fwd = [Math.sin(PANEL_YAW), 0, Math.cos(PANEL_YAW)];
        for (let i = 0; i < 30; i++) {
          const p = [origin[0] + U.rand(-0.18, 0.18) * fwd[2], origin[1] + U.rand(-0.22, 0.22), origin[2] - U.rand(-0.18, 0.18) * fwd[0]];
          const sp = U.rand(0.6, 2.2);
          const v = [fwd[0] * sp + U.rand(-0.6, 0.6), U.rand(0.2, 1.8), fwd[2] * sp + U.rand(-0.6, 0.6)];
          const it = this.shards.spawn(p, v, 9, 1, [U.rand(-12, 12), U.rand(-12, 12), 0]);
          const s = U.rand(0.5, 1.4);
          it.node.scl(s, s, 1);
        }
        // pull the handle a moment later
        setTimeout(() => { if (this.panelBroken) this.animate(0.35, (u) => { this.panel.handle.rotation[0] = 1.25 * u; }, U.ease.out); }, 450);
      } else if (kind === 'alarm') {
        this.alarmUntil = this.t + 6;
      }
    }

    // The last stretch: the train speeds up to full speed and hits (resolves at the moment of impact).
    async approachImpact(seconds) {
      const from = this.trainDist;
      await this.animate(seconds, (u) => { this.trainDist = U.lerp(from, IMPACT_DIST, u); }, U.ease.in);
    }

    async successEnding() {
      this.setRelay('green');
      this.events.emit('stopped');
      await this.wait(0.5);
      // carriages pile up behind the engine into a tower
      const targets = [
        { pos: [0, 2.2, -7.42], rot: [-PI / 2, 0, 0] },
        { pos: [0, 8.45, -6.97], rot: [-PI / 2, 0, 0.02] },
        { pos: [0, 16.8, -6.97], rot: [-PI / 2, 0, -0.03] },
      ];
      this.tower = { start: this.t, active: true };
      for (let i = 0; i < 3; i++) {
        const node = this.carHome[i].node;
        const p0 = node.position.slice(), r0 = node.rotation.slice(), tg = targets[i];
        this.events.emit('clank', i);
        await this.animate(0.55, (u) => {
          const e = U.ease.outBack(u);
          node.position[0] = U.lerp(p0[0], tg.pos[0], u);
          node.position[1] = U.lerp(p0[1], tg.pos[1], e) + Math.sin(u * PI) * 3;
          node.position[2] = U.lerp(p0[2], tg.pos[2], e);
          node.rotation[0] = U.lerp(r0[0], tg.rot[0], e);
          node.rotation[2] = U.lerp(r0[2], tg.rot[2], u);
        });
      }
      this.tower.settled = this.t;
      this.burstConfetti();
      this.cheer = 1;
      await this.wait(2.2);
    }

    burstConfetti() {
      const head = this.granny.head.localToWorld([0, 0.4, 0]);
      for (let i = 0; i < 150; i++) {
        const pool = this.confetti[i % this.confetti.length];
        const a = Math.random() * PI * 2, sp = U.rand(1.5, 4.5);
        pool.spawn([head[0], head[1] + 1.4, head[2]], [Math.cos(a) * sp, U.rand(2.5, 6), Math.sin(a) * sp], U.rand(4, 6.5), Math.random(), [U.rand(-8, 8), 0, U.rand(-8, 8)]);
      }
    }

    // kind: 'orbit' | 'ornament' | 'bowling'. Resolves once the gag has played out.
    async failEnding(kind) {
      this.events.emit('impact', kind);
      this.grannyFree = true;
      const rig = this.granny.rig;
      const runTrainAway = () => {
        const from = this.trainDist;
        this.moveTrain(from, -260, 9, U.ease.linear).then(() => { this.trainRunning = false; });
      };

      if (kind === 'ornament') {
        // She ends up riding the cowcatcher, still talking.
        const loco = this.train.loco;
        loco.add(rig);
        rig.at(0, 0.42, -0.42).rot(-0.5, 0, 0).scl(1);
        runTrainAway();
        await this.wait(5.5);
        return;
      }

      if (kind === 'bowling') {
        const p0 = rig.position.slice();
        const p1 = [5.0, 0.0, 0.9];
        const segs = [0.36, 0.26, 0.2, 0.14, 0.1];
        const heights = [3.2, 1.7, 0.9, 0.4, 0.12];
        const total = segs.reduce((a, b) => a + b, 0);
        const yaw1 = Math.atan2(5.55 - p1[0], -2.7 - p1[2]);
        runTrainAway();
        await this.animate(2.4, (u) => {
          let acc = 0, y = 0;
          const tt = u * total;
          for (let i = 0; i < segs.length; i++) {
            if (tt <= acc + segs[i] || i === segs.length - 1) { const k = U.clamp((tt - acc) / segs[i], 0, 1); y = heights[i] * 4 * k * (1 - k); break; }
            acc += segs[i];
          }
          const h = U.ease.out(u);
          rig.position[0] = U.lerp(p0[0], p1[0], h);
          rig.position[2] = U.lerp(p0[2], p1[2], h);
          rig.position[1] = U.lerp(p0[1], p1[1], u) + y;
          const spin = (1 - U.ease.out(u)) * 4 * PI;
          rig.rotation[0] = spin;
          rig.rotation[1] = U.lerp(GRANNY_YAW, yaw1 + 4 * PI, h);
          rig.rotation[2] = Math.sin(u * 20) * (1 - u) * 0.6;
        });
        rig.rot(0, yaw1, 0);
        await this.wait(2.2);
        return;
      }

      // default: orbit
      for (const c of this.pathClouds) c.visible = true;
      const vel = [0.7, 24, -7];
      const spin = [6.5, 1.2, 4.5];
      runTrainAway();
      await this.animate(2.5, (u, dt) => {
        vel[1] += 7 * dt;
        rig.position[0] += vel[0] * dt; rig.position[1] += vel[1] * dt; rig.position[2] += vel[2] * dt;
        rig.rotation[0] += spin[0] * dt; rig.rotation[1] += spin[1] * dt; rig.rotation[2] += spin[2] * dt;
        this.grannyAltitude = rig.position[1];
      });
    }

    // ---------------------------------------------------------------------------
    // per-frame update
    // ---------------------------------------------------------------------------
    update(dt) {
      if (!this.ready) return;
      this.timeScale += (this.targetTimeScale - this.timeScale) * Math.min(1, dt * 5);
      const sdt = dt * this.timeScale;
      this.t += dt;
      this.st += sdt;

      // tweens (real time)
      if (this.tweens.length) {
        const list = this.tweens.slice();
        for (const tw of list) {
          tw.t += dt;
          const u = Math.min(1, tw.t / tw.dur);
          try { tw.fn(tw.ease(u), dt, tw.t); } catch (e) { console.error(e); }
          if (u >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.resolve(); }
        }
      }

      this._updateTrain(dt, sdt);
      this._updateGranny(dt, sdt);
      this._updateRobot(dt);
      this.smoke.update(sdt);
      this.sparks.update(sdt);
      this.shards.update(dt);
      // alarm: the panel beacon and the relay lamp flash
      const alarm = this.t < this.alarmUntil;
      const on = alarm && Math.sin(this.t * 14) > 0;
      this.panel.beacon.material.emissive = on ? [1, 0.25, 0.08] : [0.15, 0.02, 0];
      if (alarm) this.relay.lamp.material.emissive = on ? [1, 0.1, 0.05] : [0.1, 0.01, 0.01];
      else if (this._alarmWas) this.setRelay(this._relayColor || 'red');
      this._alarmWas = alarm;
      for (const p of this.confetti) p.update(dt);
      for (const c of this.clouds) { c.position[0] += dt * 1.2; if (c.position[0] > 520) c.position[0] = -520; }
      this.terminal.update(dt);

      // camera shake from the train
      const near = U.clamp(1 - (this.trainDist - 2) / 40, 0, 1);
      let shake = this.trainRunning ? near * near * 0.05 * Math.min(1, this.trainSpeed / 6) : 0;
      if (this.braking) shake += 0.03;
      this.camera.shake = Math.max(this.camera.shakeImpulse || 0, shake);
      this.camera.update(dt);
    }

    _updateTrain(dt, sdt) {
      const tr = this.train;
      const prevZ = tr.root.position[2];
      tr.root.position[0] = 0;
      tr.root.position[1] = 0.3;
      tr.root.position[2] = this.trainDist;
      // A jump of more than 20 m in one frame is a teleport (reset, replay start), not speed.
      const jump = Math.abs(prevZ - this.trainDist);
      const v = dt > 0 && jump < 20 ? jump / dt : 0;
      this.trainSpeed += (v - this.trainSpeed) * Math.min(1, dt * 6);
      // In slow motion the train is frozen in time, but its wheels still creep.
      const creep = this.trainRunning ? 5 * this.timeScale * (this.timeScale < 0.5 ? 1 : 0) : 0;
      const spinSpeed = Math.max(this.trainSpeed, creep) * (this.braking ? 0.15 : 1);
      this.wheelAngle += spinSpeed * dt / 0.62;
      for (const w of tr.wheels) w.node.rotation[0] = this.wheelAngle * (0.62 / w.r);
      for (const r of tr.rods) {
        const a = this.wheelAngle + r.phase;
        r.node.position[1] = r.baseY - r.crank * Math.sin(a);
        r.node.position[2] = r.baseZ + r.crank * Math.cos(a);
      }
      const activity = U.clamp(this.trainSpeed / 6, 0, 1);
      tr.loco.position[1] = this.trainRunning ? Math.sin(this.t * 27) * 0.012 * (0.3 + activity) : 0;
      tr.headlight.material.emissive[0] = 0.9 + Math.sin(this.t * 13) * 0.08;

      // smoke
      if (this.trainRunning || this.braking) {
        const rate = this.braking ? 10 : 1.4 + activity * 5 + (this.timeScale < 0.5 ? 2 : 0);
        this.smokeAcc += sdt * rate;
        if (this.smokeAcc > 3) this.smokeAcc = 3;
        while (this.smokeAcc >= 1) {
          this.smokeAcc -= 1;
          const p = tr.loco.localToWorld(tr.stackTop);
          this.smoke.spawn([p[0] + U.rand(-0.1, 0.1), p[1], p[2] + U.rand(-0.1, 0.1)], [U.rand(-0.4, 0.4), U.rand(2.2, 3.4), this.trainSpeed * 0.6 + U.rand(-0.3, 0.3)], U.rand(2.6, 4.2), U.rand(1.2, 1.9));
        }
      }
      // brake sparks + steam
      if (this.braking) {
        for (let i = 0; i < 4; i++) {
          const w = tr.wheels[Math.floor(Math.random() * 8)];
          const p = w.node.localToWorld([0, -w.r + 0.02, 0]);
          this.sparks.spawn(p, [U.rand(-1.5, 1.5), U.rand(1, 3.5), U.rand(2, 6)], U.rand(0.25, 0.6), 1);
        }
        if (Math.random() < 0.5) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const p = tr.loco.localToWorld([side * 1.1, 0.8, -1.6]);
          this.smoke.spawn(p, [side * U.rand(-1.5, -0.5) * -1, U.rand(0.5, 1.2), U.rand(-0.5, 0.5)], U.rand(1.0, 1.8), U.rand(0.5, 0.9));
        }
      }

      // tower wobble after a successful stop
      if (this.tower && this.tower.settled) {
        const k = this.t - this.tower.settled;
        const amp = 0.05 * Math.exp(-k * 0.35) + 0.008;
        for (let i = 0; i < 3; i++) this.carHome[i].node.rotation[2] = Math.sin(this.t * 1.7 + i * 0.4) * amp * (i + 1);
      }
    }

    _updateGranny(dt, sdt) {
      const g = this.granny;
      // mouth + blink
      const env = this.speaking.granny;
      const talk = this.talking.granny;
      this.speaking.granny = env * Math.exp(-dt * 7);
      const open = talk ? Math.max(this.speaking.granny, 0.25 + 0.25 * Math.sin(this.t * 17)) : this.speaking.granny * 0.5;
      g.mouth.scale[1] = 1 + open * 3.2;
      this.blink.granny -= dt;
      const blinking = this.blink.granny < 0.12;
      if (this.blink.granny < 0) this.blink.granny = U.rand(2.5, 5);
      for (const e of g.eyes) e.scale[1] = blinking ? 0.15 : 1;

      if (this.grannyFree) {
        g.torso.rotation[2] = Math.sin(this.t * 9) * 0.08;
        g.head.rotation[0] = Math.sin(this.t * 7) * 0.15;
        return;
      }
      const danger = U.clamp(1 - (this.trainDist - 3) / TRAIN_START, 0, 1);
      const f = 2.5 + danger * 10;
      const amp = 0.025 + danger * 0.07 + (talk ? 0.02 : 0);
      g.torso.rotation[2] = Math.sin(this.st * f) * amp;
      g.torso.rotation[0] = Math.sin(this.st * 1.7) * 0.025 + (talk ? -0.05 : 0);
      g.rig.rotation[2] = Math.sin(this.st * (f * 0.5)) * danger * 0.035;
      g.rig.position[1] = 0.18 + Math.max(0, Math.sin(this.st * f * 0.5)) * danger * 0.03;

      let yawTarget = Math.sin(this.st * 0.7) * 0.15;
      if (this.t < this.lookTrainUntil) yawTarget = -1.45;
      else if (talk) yawTarget = -0.95 + Math.sin(this.st * 3) * 0.08;
      g.head.rotation[1] += (yawTarget - g.head.rotation[1]) * Math.min(1, sdt * 6 + dt * 0.5);
      g.head.rotation[0] = (talk ? Math.sin(this.t * 9) * 0.06 : 0) + Math.sin(this.st * 1.3) * 0.03;
    }

    _updateRobot(dt) {
      const r = this.robot;
      const t = this.t;
      // typing arms (the robot lives outside the slow-motion bubble)
      r.forearms.forEach((fa, i) => {
        const target = this.robotTyping ? 0.22 + Math.sin(t * 24 + i * PI) * 0.13 : (this.cheer ? -1.3 + Math.sin(t * 8 + i) * 0.2 : 0.25);
        fa.rotation[0] += (target - fa.rotation[0]) * Math.min(1, dt * 14);
      });
      // head
      let yaw = 0, pitch = 0;
      if (this.robotLook === 'granny') yaw = PI * 0.98;
      else if (this.robotLook === 'camera') {
        const cp = this.camera.cam.position;
        const hp = r.head.worldPosition();
        const worldYaw = Math.atan2(cp[0] - hp[0], cp[2] - hp[2]);
        yaw = worldYaw - PI / 2;
        while (yaw > PI) yaw -= 2 * PI;
        while (yaw < -PI) yaw += 2 * PI;
      }
      if (this.robotTyping) pitch = 0.15;
      // Turn the short way round.
      let dy = yaw - r.head.rotation[1];
      while (dy > PI) dy -= 2 * PI;
      while (dy < -PI) dy += 2 * PI;
      r.head.rotation[1] += dy * Math.min(1, dt * 5);
      if (r.head.rotation[1] > PI) r.head.rotation[1] -= 2 * PI;
      else if (r.head.rotation[1] < -PI) r.head.rotation[1] += 2 * PI;
      r.head.rotation[0] += (pitch - r.head.rotation[0]) * Math.min(1, dt * 5);
      r.head.rotation[2] = this.robotThinking ? Math.sin(t * 3) * 0.08 : 0;
      r.body.position[1] = 0.49 + Math.sin(t * 2) * 0.004;

      // face lights
      this.blink.robot -= dt;
      const blinking = this.blink.robot < 0.1;
      if (this.blink.robot < 0) this.blink.robot = U.rand(3, 6);
      const eyeGlow = this.robotThinking ? 0.45 + 0.4 * (Math.sin(t * 14) > 0 ? 1 : 0) : 0.85;
      for (const e of r.eyes) { e.scale[2] = blinking ? 0.1 : 1; e.material.emissive = [0.15 * eyeGlow, 0.75 * eyeGlow, 0.85 * eyeGlow]; }
      const env = this.speaking.robot;
      this.speaking.robot = env * Math.exp(-dt * 9);
      const talk = this.talking.robot;
      const m = talk ? Math.max(env, 0.3 + 0.3 * Math.sin(t * 21)) : env * 0.4;
      r.mouth.scale[0] = 0.6 + m * 0.6;
      r.mouth.scale[1] = 1 + m * 2.5;
      r.mouth.material.emissive = [0.05 + m * 0.3, 0.25 + m * 0.7, 0.3 + m * 0.7];
      const bulbOn = Math.sin(t * (this.robotThinking ? 18 : 3)) > 0;
      r.bulb.material.emissive = bulbOn ? [1, 0.12, 0.1] : [0.15, 0.02, 0.02];
    }

    render() { if (this.ready) this.R.render(this.scene, this.camera.cam); }

    project(p, out, viewProj) { return this.R.project(p, out, viewProj); }

    // View-projection for where the camera is headed (camera.restingPose), for placing speech bubbles.
    restingViewProj() { return this.R.viewProjFor(this.camera.restingPose()); }

    applyGraphics(gfx) {
      if (!this.ready) return;
      this.R.shadows = gfx.shadows !== false;
      this.R.pixelRatioCap = Number(gfx.pixelRatioCap) || 1.75;
    }
  }

  World.TRAIN_START = TRAIN_START;
  World.TRAIN_PARK = TRAIN_PARK;
  World.IMPACT_DIST = IMPACT_DIST;
  World.STOP_GAP = STOP_GAP;
  World.ROBOT_POS = ROBOT_POS;
  GB.World = World;
})(window.GB = window.GB || {});
