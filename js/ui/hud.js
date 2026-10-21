/* Granny Bench - heads-up display over the 3D view, and speech bubbles anchored to the characters. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h, P = GB.Prompts;

  const PHASES = {
    idle: 'Ready', intro: 'Get ready', granny: 'Grandma is pleading', thinking: 'AI is thinking · time frozen',
    verifying: 'Verifying input', verdict: 'Verdict', robot: 'AI responds', tool: 'Tool result', braking: 'BRAKES!', saved: 'Grandma saved',
    impact: 'Impact', done: 'Run finished', aborted: 'Stopped', error: 'Error', supervisor: 'Incoming supervisor message',
  };

  // Vertical video (9:16): the part of the frame TikTok and Instagram leave uncovered, as fractions of its width
  // and height. Below `split` their buttons take the right side, so the right edge moves in to `rLow`.
  const SAFE = { l: 0.0533, t: 0.13, r: 0.9458, rLow: 0.8142, split: 0.387, b: 0.76 };
  // The covered areas, for the guide: [color, left, top, width, height] in percent of the frame. Red and orange
  // hide what is behind them, yellow only partly.
  const COVERED = [
    ['red', 0, 0, 100, 6.6], ['red', 0, 6.6, 4.44, 93.4], ['red', 95.56, 6.6, 4.44, 93.4], ['red', 4.44, 83.9, 77.07, 16.1],
    ['orange', 4.44, 6.6, 91.12, 6.4], ['orange', 81.51, 45.8, 14.05, 54.2],
    ['yellow', 4.44, 13, 0.89, 70.9], ['yellow', 94.58, 13, 0.98, 25.7], ['yellow', 81.42, 38.7, 14.14, 7.1], ['yellow', 5.33, 76, 76.18, 7.9],
  ];

  const HUD = {
    el: {},
    state: { vt: 0, T: 60 },
    init(world) {
      this.world = world;
      const $ = (id) => document.getElementById(id);
      this.el = {
        stage: $('stage'), clock: $('hud-clock'), clockBox: $('hud-clock-box'), dist: $('hud-dist'), train: $('hud-train'),
        turn: $('hud-turn'), phase: $('hud-phase'), model: $('hud-model'), altitude: $('hud-altitude'), flash: $('flash'),
        frozen: $('hud-frozen'), verdict: $('hud-verdict'), fps: $('hud-fps'), demo: $('hud-demo'),
      };
      // The guide to the covered areas (vertical video, Graphics & camera).
      const guide = $('safe-guide');
      for (const [cls, l, t, w, hh] of COVERED) guide.appendChild(h('div.' + cls, { style: { left: l + '%', top: t + '%', width: w + '%', height: hh + '%' } }));
      this.idle();
    },

    idle() {
      this.state = { vt: 0, T: (GB.Settings.timing(GB.Settings.activeScenario())).timeLimit, phase: 'idle' };
      this.el.clock.textContent = U.fmtTime(this.state.T);
      this.el.clockBox.classList.remove('danger', 'critical');
      this.el.turn.textContent = 'Turn -';
      this._phase('idle');
      this.el.verdict.className = 'verdict-chip hidden';
      this._meter(GB.World ? GB.World.TRAIN_START : 160);
    },

    begin(rec) {
      this.state = { vt: 0, T: rec.timing.timeLimit, maxTurns: rec.maxTurns, phase: 'intro' };
      this.el.model.innerHTML = '';
      U.append(this.el.model, [h('span.hm-label', 'AI under test'), h('span.hm-name', rec.model.name), h('span.hm-scenario', rec.scenario.name)]);
      this.el.model.classList.remove('hidden');
      this.demo(rec.model.providerType === 'simulated' || rec.model.providerId === 'simulated');
      this.el.turn.textContent = 'Turn 0/' + rec.maxTurns;
      this.el.verdict.className = 'verdict-chip hidden';
      this.set({ vt: 0, T: rec.timing.timeLimit });
    },

    // The DEMO MODE banner: shown whenever a simulated demo is the AI under test (the run's model during a
    // run, otherwise the one picked in the Arena). It has no setting.
    demo(on) { this.el.demo.classList.toggle('hidden', !on); },

    _phase(p, extra) {
      this.el.phase.textContent = (PHASES[p] || p) + (extra || '');
      this.el.phase.dataset.phase = p;
    },

    _meter(dist) {
      if (dist == null) return;
      const start = GB.World ? GB.World.TRAIN_START : 160;
      const frac = U.clamp(dist / start, 0, 1);
      this.el.train.style.left = (4 + frac * 86) + '%';
      this.el.dist.textContent = Math.max(0, dist).toFixed(dist < 10 ? 1 : 0) + ' m';
    },

    set(p) {
      const s = this.state;
      Object.assign(s, p);
      if (p.vt != null || p.T != null) {
        const left = Math.max(0, s.T - s.vt);
        this.el.clock.textContent = U.fmtTime(left);
        this.el.clockBox.classList.toggle('danger', left <= s.T * 0.34 && left > 5);
        this.el.clockBox.classList.toggle('critical', left <= 5);
      }
      if (p.distance != null) this._meter(p.distance);
      if (p.turn != null) this.el.turn.textContent = 'Turn ' + p.turn + '/' + (s.maxTurns || '?');
      if (p.phase) {
        this._phase(p.phase);
        if (p.phase !== 'verdict' && p.phase !== 'robot' && p.phase !== 'braking' && p.phase !== 'tool') this.el.verdict.className = 'verdict-chip hidden';
      }
      if (p.thinkingMs != null && s.phase === 'thinking') this._phase('thinking', ' · ' + (p.thinkingMs / 1000).toFixed(1) + 's');
      if (p.verdict) {
        const info = P.VERDICTS[p.verdict.category] || P.VERDICTS.other;
        this.el.verdict.className = 'verdict-chip ' + info.cls;
        this.el.verdict.textContent = info.icon + ' ' + (p.verdict.success && p.verdict.category !== 'tool' ? P.VERDICTS.match.label : info.label);
      }
      if (p.altitude !== undefined) this.el.altitude.classList.toggle('hidden', !p.altitude);
    },

    frame(dt, fps) {
      if (!this.el.altitude.classList.contains('hidden') && this.world) {
        this.el.altitude.textContent = 'GRANDMA ALTITUDE: ' + Math.max(0, Math.round(this.world.grannyAltitude)).toLocaleString() + ' m';
      }
      if (this.el.fps) {
        const show = GB.Settings.data.graphics.showFps;
        this.el.fps.classList.toggle('hidden', !show);
        if (show && fps) this.el.fps.textContent = fps.toFixed(0) + ' fps';
      }
    },

    bulletTime(on) { this.el.stage.classList.toggle('bullet', !!on); },

    flash(kind) {
      const f = this.el.flash;
      f.className = '';
      void f.offsetWidth;
      f.className = 'flash-' + (kind || 'impact');
    },
  };

  // ---------------------------------------------------------------------------
  const Bubbles = {
    items: {},
    container: null,
    world: null,
    init(container, world) {
      this.container = container;
      this.world = world;
      for (const who of ['granny', 'robot', 'narrator']) {
        const name = { granny: 'Grandma', robot: 'AI', narrator: 'Narrator' }[who];
        const el = h('div.bubble.' + who + '.hidden', h('div.bubble-name', name), h('div.bubble-text'));
        container.appendChild(el);
        this.items[who] = { el, text: el.querySelector('.bubble-text'), words: [], spans: [], cur: -1, visible: false, fadeT: null };
      }
    },
    setName(who, name) { const it = this.items[who]; if (it) it.el.querySelector('.bubble-name').textContent = name; },

    show(who, text) {
      const it = this.items[who];
      if (!it) return;
      if (who === 'granny') this.hide('robot');
      if (who === 'robot') this.hide('granny');
      clearTimeout(it.fadeT);
      it.words = U.speakable(text).split(/\s+/).filter(Boolean);
      it.long = it.words.length > 46;
      it.cur = -1;
      this._render(it);
      // Hidden from the start if the camera is still gliding to the speaker (frame() shows it once it is there).
      it.el.classList.toggle('away', who !== 'narrator' && !!(this.world && this.world.ready && this.world.camera.gliding));
      it.el.classList.remove('hidden', 'fading', 'typewriter');
      it.el.classList.toggle('long', it.long);
      it.typing = false;
      it.partial = null;
      it.visible = true;
      it.snap = true;
      it.done = false;
      this.frame();   // place it now, not where it was last time
    },

    // A typed-out line (Voices & audio): words appear as they are typed instead of being highlighted.
    typing(who) {
      const it = this.items[who];
      if (!it) return;
      it.typing = true;
      it.cur = -1;
      it.el.classList.add('typewriter');
      this._render(it);
    },

    // Typing: word i shows its first n characters (the words before it are complete).
    chars(who, i, n) {
      const it = this.items[who];
      if (!it || !it.visible || !it.typing) return;
      if (i !== it.cur) this.word(who, i);
      const s = it.spans[i];
      if (!s) return;
      const ch = Array.from(it.words[i]);
      U.clear(s);
      s.appendChild(document.createTextNode(ch.slice(0, n).join('')));
      if (n < ch.length) s.appendChild(h('span.rest', ch.slice(n).join('')));
      s.appendChild(document.createTextNode(' '));
      it.partial = n < ch.length ? i : null;
    },

    // The whole line at once (a silent line that pauses on screen).
    all(who) {
      const it = this.items[who];
      if (it && it.visible) this.word(who, it.words.length);
    },

    _render(it) {
      U.clear(it.text);
      it.spans = [];
      it.partial = null;
      let from = 0, to = it.words.length;
      if (it.long) {
        const c = Math.max(0, it.cur);
        from = Math.max(0, c - 22);
        to = Math.min(it.words.length, from + 46);
        if (from > 0) it.text.appendChild(document.createTextNode('… '));
      }
      for (let i = from; i < to; i++) {
        const s = h('span', it.words[i] + ' ');
        if (i < it.cur) s.className = 'said';
        if (i === it.cur) s.className = 'cur';
        it.spans[i] = s;
        it.text.appendChild(s);
      }
      if (to < it.words.length) it.text.appendChild(document.createTextNode('…'));
      it.from = from; it.to = to;
    },

    word(who, i) {
      const it = this.items[who];
      if (!it || !it.visible) return;
      // A word left half typed (typing skipped ahead) is shown whole again.
      if (it.partial != null && it.partial !== i && it.spans[it.partial]) { it.spans[it.partial].textContent = it.words[it.partial] + ' '; it.partial = null; }
      const prev = it.cur;
      it.cur = i;
      if (it.long && (i >= it.to - 6 || i < it.from)) { this._render(it); return; }
      if (it.spans[prev]) it.spans[prev].className = 'said';
      for (let k = Math.max(it.from || 0, prev); k < i; k++) if (it.spans[k]) it.spans[k].className = 'said';
      if (it.spans[i]) it.spans[i].className = 'cur';
    },

    fade(who, delay) {
      const it = this.items[who];
      if (!it || !it.visible) return;
      it.done = true;   // the line is over: the bubble stays where it is while it fades
      clearTimeout(it.fadeT);
      it.fadeT = setTimeout(() => { it.el.classList.add('fading'); it.fadeT = setTimeout(() => this.hide(who), 450); }, delay == null ? 900 : delay);
    },

    hide(who) {
      const it = this.items[who];
      if (!it) return;
      clearTimeout(it.fadeT);
      it.visible = false;
      it.el.classList.add('hidden');
      it.el.classList.remove('fading');
    },

    hideAll() { for (const k in this.items) this.hide(k); },

    frame() {
      if (!this.world || !this.world.ready) {
        for (const k in this.items) if (this.items[k].visible) this.items[k].el.classList.add('docked');
        return;
      }
      const anchors = this.world.anchors();
      const W = this.container.clientWidth, H = this.container.clientHeight;
      const tmp = {}, head = {};
      const rest = this.world.restingViewProj();
      const gliding = this.world.camera.gliding;
      const now = performance.now(), dt = Math.min(0.1, (now - (this._t || now)) / 1000);
      this._t = now;
      // Bubbles stay below the HUD at the top (clock, demo banner, phase), so it is never covered.
      const cr = this.container.getBoundingClientRect(), hr = document.getElementById('hud').getBoundingClientRect();
      const hudL = hr.left - cr.left, hudR = hr.right - cr.left, hudB = hr.bottom - cr.top + 8;
      // Vertical video: they stay in the part of the frame TikTok and Instagram leave uncovered (SAFE).
      const vertical = document.body.classList.contains('vertical');
      const sL = vertical ? W * SAFE.l + 3 : 8, sT = vertical ? H * SAFE.t : 64, sB = vertical ? H * SAFE.b : H - 8;
      const sR = (bottom) => (vertical ? W * (bottom > H * SAFE.split ? SAFE.rLow : SAFE.r) - 3 : W - 8);
      const vMaxW = Math.floor(W * (SAFE.rLow - SAFE.l)) - 4 + 'px';
      let dockY = vertical ? sB : H - 18;
      // Docked bubbles stay clear of the widgets in the bottom-left corner (model name, camera buttons).
      let inset = 12;
      for (const id of ['hud-model', 'cam-controls']) {
        const el = document.getElementById(id);
        if (el && el.offsetParent && !el.classList.contains('hidden')) inset = Math.max(inset, el.offsetLeft + el.offsetWidth + 12);
      }
      if (inset > W * 0.45) inset = 12;
      let insetR = 12;
      const pc = document.getElementById('play-controls');
      if (pc && pc.offsetParent) insetR = Math.max(insetR, W - pc.offsetLeft + 12);
      if (insetR > W * 0.45) insetR = 12;
      if (vertical) { inset = sL; insetR = W - W * SAFE.rLow + 3; }   // the buttons are beside the frame
      const mid = vertical ? (sL + W * SAFE.rLow) / 2 : W / 2;
      for (const who of ['narrator', 'robot', 'granny']) {
        const it = this.items[who];
        if (!it.visible) continue;
        if (it.done && it.pos) {
          if (it.pos.docked) dockY = Math.min(dockY, it.pos.y - 8);
          else if (gliding) it.el.classList.add('fading');   // the line is over and the camera moves on
          continue;
        }
        if (vertical && it.el.style.maxWidth !== vMaxW) it.el.style.maxWidth = vMaxW;
        const bw = it.el.offsetWidth, bh = it.el.offsetHeight;
        let docked = who === 'narrator', below = false;
        let x = 0, y = 0;
        if (!docked) {
          // The bubble goes above where the head is at rest, as seen from where the camera is headed, so it
          // stays put while the speaker sways and the camera moves or shakes. Its tail follows the head.
          this.world.project(anchors[who + 'Seat'], tmp, rest);
          docked = tmp.behind || tmp.x < -40 || tmp.x > W + 40 || tmp.y < 30 || tmp.y > H + 20;
          x = U.clamp(tmp.x - bw / 2, sL, sR(0) - bw);
          const top = x < hudR && x + bw > hudL ? Math.max(hudB, sT) : sT;   // it may not go higher (or cover the HUD)
          y = tmp.y - bh - 14;
          // No room above the head: it goes below the chin, with its tail pointing up. (Once below, it needs
          // clearly more room to go back above, so it does not flip between the two.)
          if (y < top + (it.pos && it.pos.below && !it.snap ? 20 : 0)) {
            this.world.project(anchors[who + 'SeatChin'], tmp, rest);
            below = true;
            y = tmp.y + 14;
            if (y + bh > sB) { docked = true; below = false; }   // no room below either
          }
          y = U.clamp(y, top, sB - bh);
          x = U.clamp(x, sL, sR(y + bh) - bw);   // in vertical video the right edge depends on how low it is
        }
        if (docked) {
          x = U.clamp(mid - bw / 2, inset, Math.max(inset, W - bw - insetR));
          y = dockY - bh;
          dockY = y - 8;
        }
        // When that place changes (another shot cued during the line, the camera turned by hand, the other
        // docked bubble), the bubble glides there. A new line, a big jump, or a switch to or from docked jumps.
        const p = it.pos, d = p ? Math.hypot(x - p.x, y - p.y) : 0;
        if (!p || it.snap || p.docked !== docked || p.below !== below || d > 260) it.pos = { x, y, docked, below };
        else if (d > 3) { const a = 1 - Math.exp(-dt * 6); p.x += (x - p.x) * a; p.y += (y - p.y) * a; }
        it.snap = false;
        x = it.pos.x; y = it.pos.y;
        if (!docked) {
          if (x < hudR && x + bw > hudL) y = Math.min(Math.max(y, hudB), sB - bh);
          this.world.project(anchors[below ? who + 'Chin' : who], head);
          it.el.style.setProperty('--tail', U.clamp(head.x - x, 18, bw - 18) + 'px');
        }
        const maxW = vertical ? vMaxW : docked ? Math.max(240, Math.min(720, W - inset - insetR - 4)) + 'px' : '';
        if (it.el.style.maxWidth !== maxW) it.el.style.maxWidth = maxW;
        it.el.classList.toggle('docked', docked);
        it.el.classList.toggle('below', below);
        // A bubble beside a character is hidden while the camera glides to a new shot, and fades in once it is there.
        it.el.classList.toggle('away', gliding && !docked);
        it.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      }
    },
  };

  GB.HUD = HUD;
  GB.Bubbles = Bubbles;
})(window.GB = window.GB || {});
