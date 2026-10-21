/* Granny Bench - the 3D world: assembly, per-frame animation, particles, and the endings. */
(function (GB) {
  'use strict';
  const U = GB.U, G = GB.Geo, Node = GB.Node, M = GB.Models;
  const PI = Math.PI;

  const GRANNY_YAW = PI - 0.45;     // she faces away from the train (-Z), angled toward the robot
  const ROBOT_POS = [3.3, 0, 1.2];
  const TRAIN_START = 160;          // distance (m) when the clock starts
  const TRAIN_PARK = 270;           // where it waits before a run
  const IMPACT_DIST = 0.42;
  const STOP_GAP = 0.9;             // closest a braking train gets
  const DASH = 16;                  // meters left when the clock runs out: the train covers them at full speed
  const PANEL_POS = [4.0, 0, 2.45]; // emergency brake panel (shown when a scenario has a "glass" tool)
  const PANEL_YAW = -1.03;          // faces back toward the track and the default cameras
  // Grandma's head turn when she talks: most of the way to the robot (at x from the track).
  const grannyTalkYaw = (x) => Math.atan2(x, ROBOT_POS[2]) - GRANNY_YAW + 0.35;
  // Bowling ending: a rack of 10 pins on a deck on the track, far ahead of the train (behind the usual cameras).
  const PIN_Z = -46;                // head pin
  const PIN_GAP = 1.0;              // between pin centers in a row
  const PIN_ROW = 0.866;            // between rows
  const PIN_R = 0.2;                // pin radius at its widest
  const PIN_CM = 0.546;             // a pin's center of mass above its base
  const DECK_TOP = 0.38;
  const LANE_HALF = 1.5 * PIN_GAP + PIN_R;   // the invisible walls leading to the rack: as wide as the rack
  const BALL_R = 0.5;               // Grandma and her chair, as a bowling ball
  const BALL_C = 0.62;              // ...whose middle is this far above the rig origin

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
      this.paused = false;
      this.frameTrain = null;       // framing mode: the train's distance and the robot's head turn, set by hand
      this.frameHeadYaw = null;
      this.frameHidePanel = false;  // framing mode: hide the brake panel
      this.station = ROBOT_POS[0];  // the robot's distance from the track (framing mode can move it)
      this.panelWanted = false;     // the brake panel is shown (the scenario has a glass tool, or it was used)
      this.grannyLook = 'robot';
      this.lookTrainUntil = 0;
      this.blink = { granny: 2, robot: 3 };
      this.tower = null;
      this.cheer = 0;
      this.alarmUntil = 0;
      this.panelBroken = false;
      this.pinZ = PIN_Z;
      this.pinsDown = 0;
      this.bowl = null;             // the bowling ending while it plays
    }

    init(canvas, opts) {
      opts = opts || {};
      const R = this.R = new GB.Renderer(canvas, { shadows: opts.shadows !== false, pixelRatioCap: opts.pixelRatioCap });
      const scene = this.scene = new Node('scene');

      // scenery
      const sc = M.scenery(R);
      for (const n of sc.nodes) scene.add(n);
      this.clouds = sc.clouds;
      this.poles = sc.poles;
      this.foliage = sc.foliage;   // rocks, bushes and flowers
      this.trees = sc.trees;
      this.mountains = sc.mountains;
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
      this._buildCable();

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

      // the pins for the bowling ending and the deck they stand on (hidden until that ending is coming)
      this.pinDeck = M.pinDeck(R);
      this.pinDeck.visible = false;
      scene.add(this.pinDeck);
      const pinMesh = M.pin(R).mesh;
      this.pins = [];
      for (let row = 0; row < 4; row++) {
        for (let i = 0; i <= row; i++) {
          const node = new Node('pin', pinMesh);
          node.visible = false;
          scene.add(node);
          this.pins.push({ node, home: [(i - row / 2) * PIN_GAP, PIN_Z - row * PIN_ROW] });
        }
      }

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
      this.panelWanted = tools.some((t) => t.effect === 'glass');
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

    // Framing mode: how far the robot sits from the track. Its desk and the brake panel move with it; the relay
    // stays by the track and the cable is laid again.
    setStation(x) {
      if (!this.ready) return;
      this.station = x;
      this.robot.rig.position[0] = x;
      this.panel.rig.position[0] = x + PANEL_POS[0] - ROBOT_POS[0];
      this._buildCable();
    }

    _buildCable() {
      const s = this.station - ROBOT_POS[0], e = 4.39 + s;   // e: the desk's far corner
      if (this.cable) this.scene.remove(this.cable);
      this.cable = M.cable(this.R, [[1.9, 0.03, 2.6], [3.2 + s / 2, 0.03, 2.3], [e, 0.03, 2.05], [e, 0.03, 1.88], [e, 0.74, 1.88], [e + 0.17, 0.98, 1.4]]);
      this.scene.add(this.cable);
    }

    // The robot's head turn (relative to its body, 0 = facing its screen) that looks at a point.
    robotHeadYawTo(p) {
      const hp = this.robot.head.worldPosition();
      let yaw = Math.atan2(p[0] - hp[0], p[2] - hp[2]) - PI / 2;
      while (yaw > PI) yaw -= 2 * PI;
      while (yaw < -PI) yaw += 2 * PI;
      return yaw;
    }
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
      this.bowl = null;
      this.pinsDown = 0;
      this.pinDeck.visible = false;
      for (const p of this.pins) p.node.visible = false;
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
        this.panelWanted = true;
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

    // kind: 'orbit' | 'ornament' | 'bowling' (set up the pins with setupPins first). Resolves once the gag has played out.
    async failEnding(kind) {
      this.events.emit('impact', kind);
      this.grannyFree = true;
      const rig = this.granny.rig;
      const runTrainAway = () => {
        const from = this.trainDist;
        this.moveTrain(from, -260, 9, U.ease.linear).then(() => { this.trainRunning = false; });
      };

      if (kind === 'ornament') {
        // She ends up riding the cowcatcher.
        const loco = this.train.loco;
        loco.add(rig);
        rig.at(0, 0.42, -0.42).rot(-0.5, 0, 0).scl(1);
        runTrainAway();
        await this.wait(5.5);
        return;
      }

      if (kind === 'bowling') {
        // The train brakes to a stop well short of the pins, and Grandma goes on down the track as the ball.
        const from = this.trainDist, stop = -12;
        this.braking = true;
        this.animate(U.clamp((2 * (from - stop)) / Math.max(8, this.trainSpeed), 0.8, 2.6), (u) => { this.trainDist = U.lerp(from, stop, u); }, U.ease.out)
          .then(() => { this.braking = false; this.trainRunning = false; this.trainSpeed = 0; });
        if (!this.pinDeck.visible) this.setupPins();
        await new Promise((resolve) => {
          this.bowl = {
            c: [rig.position[0], rig.position[1] + BALL_C, rig.position[2]],
            v: [U.rand(-1.6, 1.6), U.rand(7, 8.5), -U.rand(22, 25)],
            w: [-U.rand(9, 12), U.rand(-4, 4), U.rand(-5, 5)],
            t: 0, firstHit: 0, still: 0, hold: 0, done: false, near: false, resolve,
          };
        });
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

    // Bowling ending: stand the rack up on its deck far down the track, out of sight of the usual cameras.
    setupPins() {
      if (!this.ready) return;
      this.pinDeck.at(0, DECK_TOP - 0.03, PIN_Z - 1.3);
      this.pinDeck.visible = true;
      for (const p of this.pins) {
        p.c = [p.home[0], DECK_TOP + PIN_CM, p.home[1]];
        p.v = [0, 0, 0];
        p.yaw = 0; p.pitch = 0; p.wp = 0; p.wy = 0;
        p.down = false; p.rest = true;
        this._placePin(p);
        p.node.visible = true;
      }
      this.pinsDown = 0;
    }

    // A pin's node from its center of mass and its tilt (pitch, toward yaw). Returns its axis.
    _placePin(p) {
      const s = Math.sin(p.pitch);
      const a = [s * Math.sin(p.yaw), Math.cos(p.pitch), s * Math.cos(p.yaw)];
      p.node.at(p.c[0] - a[0] * PIN_CM, p.c[1] - a[1] * PIN_CM, p.c[2] - a[2] * PIN_CM).rot(p.pitch, p.yaw, 0);
      return a;
    }

    // Ground height for the bowling ending: the pin deck, the track, or the field beside it.
    _ground(x, z) {
      if (Math.abs(x) < 1.95 && z < PIN_Z + 1.0 && z > PIN_Z - 3.6) return DECK_TOP;
      return Math.abs(x) < 1.45 ? 0.18 : -0.03;
    }

    _knockPin(p, dir, speed, up) {
      p.down = true; p.rest = false;
      p.yaw = Math.atan2(dir[0], dir[2]);
      p.v = [dir[0] * speed, up, dir[2] * speed];
      p.wp = U.rand(5, 9) + speed * 0.5;
      p.wy = U.rand(-3, 3);
      this.pinsDown++;
      this.events.emit('pin', U.clamp(speed / 10, 0.3, 1));
      if (this.pinsDown === this.pins.length) this.events.emit('strike');
    }

    _updateBowl(dt) {
      const b = this.bowl;
      if (dt <= 0) return;
      const n = Math.ceil(dt / (1 / 240)), h = dt / n;
      for (let i = 0; i < n; i++) this._bowlStep(b, h);
      // Grandma tumbles around her middle (the rig's origin is at the chair's feet)
      const rig = this.granny.rig, r = rig.rotation;
      const sx = Math.sin(r[0]), cx = Math.cos(r[0]), sy = Math.sin(r[1]), cy = Math.cos(r[1]), sz = Math.sin(r[2]), cz = Math.cos(r[2]);
      const up = [sy * sx * cz - cy * sz, cx * cz, cy * sx * cz + sy * sz];   // the rig's local +Y in the world
      rig.at(b.c[0] - up[0] * BALL_C, b.c[1] - up[1] * BALL_C, b.c[2] - up[2] * BALL_C);
      for (const p of this.pins) if (p.down) this._placePin(p);
      // she is close to the pins (the show cuts to them)
      if (!b.near && b.c[2] < PIN_Z + 11) { b.near = true; this.events.emit('bowl', 'near'); }
      // done once Grandma and the pins have stopped (or time is up), then a moment to read the count
      if (!b.done) {
        const moving = this.pins.some((p) => p.down && !p.rest);
        b.still = b.firstHit && !moving && Math.hypot(b.v[0], b.v[1], b.v[2]) < 0.3 ? b.still + dt : 0;
        if (b.still > 0.2 || (b.firstHit && b.t - b.firstHit > 4.5) || b.t > 12) { b.done = true; b.hold = 2; this.events.emit('bowl', 'settled'); }
      } else if (b.hold > 0) {
        b.hold -= dt;
        if (b.hold <= 0) b.resolve();
      }
    }

    _bowlStep(b, h) {
      const c = b.c, v = b.v, rig = this.granny.rig;
      b.t += h;
      const lane = c[2] > PIN_Z + 0.4;   // still between the invisible walls, short of the head pin
      // Gravity, plus an extra pull down close to the pins so she can't hop over them.
      let floor = this._ground(c[0], c[2]) + BALL_R * 0.8;
      v[1] -= (lane && c[2] < PIN_Z + 8 && c[1] > floor + 0.25 ? 48 : 20) * h;
      c[0] += v[0] * h; c[1] += v[1] * h; c[2] += v[2] * h;
      // the walls: as wide as the rack, up to the head pin
      const lim = LANE_HALF - BALL_R;
      if (lane && Math.abs(c[0]) > lim) { c[0] = Math.sign(c[0]) * lim; v[0] = -v[0] * 0.6; b.w[1] += U.rand(-3, 3); }
      floor = this._ground(c[0], c[2]) + BALL_R * 0.8;
      if (c[1] <= floor) {
        c[1] = floor;
        if (v[1] < -2.5) {
          // bounce, with a new tumble each time
          v[1] = -v[1] * 0.42;
          v[0] = v[0] * 0.8 + U.rand(-1.2, 1.2);
          v[2] *= 0.9;
          b.w = [-U.rand(6, 12), U.rand(-5, 5), U.rand(-6, 6)];
        } else {
          // rolling: friction slows her (much more once she is in the pins)
          v[1] = 0;
          const sp = Math.hypot(v[0], v[2]), k = Math.max(0, sp - (b.firstHit ? 14 : 1.6) * h) / (sp || 1);
          v[0] *= k; v[2] *= k;
          b.w[0] = (v[2] / BALL_R) * 0.8;
          b.w[1] *= 1 - 3 * h; b.w[2] *= 1 - 3 * h;
        }
      }
      if (lane && v[2] > -8) v[2] = -8;   // she always reaches the pins
      rig.rotation[0] += b.w[0] * h; rig.rotation[1] += b.w[1] * h; rig.rotation[2] += b.w[2] * h;

      // Grandma against the pins
      const sp = Math.hypot(v[0], v[2]);
      for (const p of this.pins) {
        const dx = p.c[0] - c[0], dz = p.c[2] - c[2], d = Math.hypot(dx, dz);
        if (d > BALL_R + PIN_R || Math.abs(p.c[1] - c[1]) > 0.95) continue;
        const away = d > 1e-4 ? [dx / d, 0, dz / d] : [0, 0, -1];
        if (!p.down) {
          const mx = away[0] + (v[0] / (sp || 1)) * 0.8, mz = away[2] + (v[2] / (sp || 1)) * 0.8, ml = Math.hypot(mx, mz) || 1;
          this._knockPin(p, [mx / ml, 0, mz / ml], U.clamp(sp * U.rand(0.35, 0.55), 3, 8), U.rand(2, 4.5));
          if (!b.firstHit) b.firstHit = b.t;
          v[0] = v[0] * 0.85 - away[0] * 0.8; v[2] *= 0.85;
        } else if (sp > 2) {
          // pins already down get pushed out of her way
          const along = p.v[0] * away[0] + p.v[2] * away[2], want = Math.min(4, sp * 0.4);
          if (along < want) { p.v[0] += away[0] * (want - along); p.v[2] += away[2] * (want - along); p.rest = false; }
        }
      }
      // She passed the back row without touching a pin (the walls should make that impossible): knock the nearest.
      if (!b.firstHit && c[2] < PIN_Z - 3 * PIN_ROW - 0.2) {
        let best = null, bd = Infinity;
        for (const p of this.pins) { const d = Math.hypot(p.c[0] - c[0], p.c[2] - c[2]); if (d < bd) { bd = d; best = p; } }
        this._knockPin(best, [0, 0, -1], Math.max(3, sp * 0.7), 2);
        b.firstHit = b.t;
      }

      // the pins: fly, tip over until they lie flat, and knock down the pins they fall against
      for (const p of this.pins) {
        if (!p.down || p.rest) continue;
        p.v[1] -= 14 * h;
        p.c[0] += p.v[0] * h; p.c[1] += p.v[1] * h; p.c[2] += p.v[2] * h;
        p.pitch += p.wp * h; p.yaw += p.wy * h;
        const ay = Math.cos(p.pitch), s = Math.abs(Math.sin(p.pitch));
        const low = p.c[1] + Math.min(-PIN_CM * ay - 0.09 * s, (0.39 - PIN_CM) * ay - PIN_R * s, (M.PIN_H - PIN_CM) * ay - 0.07 * s);
        const g = this._ground(p.c[0], p.c[2]);
        if (low < g) {
          p.c[1] += g - low;
          if (p.v[1] < 0) p.v[1] *= -0.3;
          const f = Math.max(0, 1 - 4 * h);
          p.v[0] *= f; p.v[2] *= f; p.wy *= f;
          // gravity tips it over until it lies flat
          const flat = PI / 2 + Math.round((p.pitch - PI / 2) / PI) * PI, dp = flat - p.pitch;
          if (Math.abs(dp) < 0.05 && Math.abs(p.wp) < 1.5) { p.pitch = flat; p.wp = 0; }
          else p.wp = p.wp * Math.max(0, 1 - 3 * h) + Math.sign(dp) * 30 * h;
          if (p.wp === 0 && Math.hypot(p.v[0], p.v[1], p.v[2]) < 0.15 && Math.abs(p.wy) < 0.2) p.rest = true;
        }
        // its axis (base to head) against the pins still standing
        const sn = Math.sin(p.pitch), a = [sn * Math.sin(p.yaw), Math.cos(p.pitch), sn * Math.cos(p.yaw)];
        const bx = p.c[0] - a[0] * PIN_CM, by = p.c[1] - a[1] * PIN_CM, bz = p.c[2] - a[2] * PIN_CM;
        const ex = a[0] * M.PIN_H, ey = a[1] * M.PIN_H, ez = a[2] * M.PIN_H;
        const tip = Math.hypot(p.v[0], p.v[2]) + Math.abs(p.wp) * 0.8;
        for (const q of this.pins) {
          if (q.down) continue;
          const len2 = ex * ex + ez * ez;
          const t = len2 > 1e-6 ? U.clamp(((q.c[0] - bx) * ex + (q.c[2] - bz) * ez) / len2, 0, 1) : 0;
          const px = bx + ex * t, py = by + ey * t, pz = bz + ez * t;
          const dx = q.c[0] - px, dz = q.c[2] - pz, d = Math.hypot(dx, dz);
          if (d > PIN_R * 1.8 || py > DECK_TOP + M.PIN_H || tip < 1) continue;
          const vl = Math.hypot(p.v[0], p.v[2]) || 1;
          const mx = dx / (d || 1) + (p.v[0] / vl) * 0.6, mz = dz / (d || 1) + (p.v[2] / vl) * 0.6, ml = Math.hypot(mx, mz) || 1;
          this._knockPin(q, [mx / ml, 0, mz / ml], U.clamp(tip * U.rand(0.3, 0.5), 1.2, 4.5), U.rand(0.3, 1.5));
          p.v[0] *= 0.7; p.v[2] *= 0.7;
        }
      }
    }

    // ---------------------------------------------------------------------------
    // per-frame update
    // ---------------------------------------------------------------------------
    update(dt) {
      if (!this.ready) return;
      // Paused (the Arena's pause button): the scene holds still, but the camera can still be moved.
      const camDt = dt;
      if (this.paused) dt = 0;
      this.panel.rig.visible = this.panelWanted && !this.frameHidePanel;
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
      if (this.bowl) this._updateBowl(dt);
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
      this.camera.shake = this.paused ? 0 : Math.max(this.camera.shakeImpulse || 0, shake);
      this.camera.update(camDt);
    }

    _updateTrain(dt, sdt) {
      const tr = this.train;
      const prevZ = tr.root.position[2];
      const z = this.frameTrain != null ? this.frameTrain : this.trainDist;   // framing mode places it by hand
      tr.root.position[0] = 0;
      tr.root.position[1] = 0.3;
      tr.root.position[2] = z;
      // A jump of more than 20 m in one frame is a teleport (reset, replay start), not speed.
      const jump = Math.abs(prevZ - z);
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
      if (this.braking && dt > 0) {
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
      else if (talk) yawTarget = grannyTalkYaw(this.station) + Math.sin(this.st * 3) * 0.08;
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
      if (this.robotLook === 'granny') {
        const gp = this.granny.head.worldPosition();
        const hp = r.head.worldPosition();
        yaw = Math.atan2(gp[0] - hp[0], gp[2] - hp[2]) - PI / 2;
      } else if (this.robotLook === 'camera') {
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
      if (this.frameHeadYaw != null) { r.head.rotation[0] = 0; r.head.rotation[1] = this.frameHeadYaw; r.head.rotation[2] = 0; }
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
