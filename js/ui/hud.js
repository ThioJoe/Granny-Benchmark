/* Granny Bench - heads-up display over the 3D view, and speech bubbles anchored to the characters. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h, P = GB.Prompts;

  const PHASES = {
    idle: 'Ready', intro: 'Get ready', granny: 'Grandma is pleading', thinking: 'AI is thinking · time frozen',
    verifying: 'Verifying input', verdict: 'Verdict', robot: 'AI responds', tool: 'Tool result', braking: 'BRAKES!', saved: 'Grandma saved',
    impact: 'Impact', done: 'Run finished', aborted: 'Stopped', error: 'Error',
  };

  const HUD = {
    el: {},
    state: { vt: 0, T: 60 },
    init(world) {
      this.world = world;
      const $ = (id) => document.getElementById(id);
      this.el = {
        stage: $('stage'), clock: $('hud-clock'), clockBox: $('hud-clock-box'), dist: $('hud-dist'), train: $('hud-train'),
        turn: $('hud-turn'), phase: $('hud-phase'), model: $('hud-model'), altitude: $('hud-altitude'), flash: $('flash'),
        frozen: $('hud-frozen'), verdict: $('hud-verdict'), fps: $('hud-fps'),
      };
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
      this.el.turn.textContent = 'Turn 0/' + rec.maxTurns;
      this.el.verdict.className = 'verdict-chip hidden';
      this.set({ vt: 0, T: rec.timing.timeLimit });
    },

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
      it.el.classList.remove('hidden', 'fading');
      it.el.classList.toggle('long', it.long);
      it.visible = true;
    },

    _render(it) {
      U.clear(it.text);
      it.spans = [];
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
      const tmp = {};
      let dockY = H - 18;
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
      for (const who of ['narrator', 'robot', 'granny']) {
        const it = this.items[who];
        if (!it.visible) continue;
        const bw = it.el.offsetWidth, bh = it.el.offsetHeight;
        let docked = who === 'narrator';
        let x = 0, y = 0;
        if (!docked) {
          this.world.project(anchors[who], tmp);
          docked = tmp.behind || tmp.x < -40 || tmp.x > W + 40 || tmp.y < 30 || tmp.y > H + 20;
          x = U.clamp(tmp.x - bw / 2, 8, W - bw - 8);
          y = U.clamp(tmp.y - bh - 14, 64, H - bh - 8);
          it.el.style.setProperty('--tail', U.clamp(tmp.x - x, 18, bw - 18) + 'px');
        }
        if (docked) {
          x = U.clamp((W - bw) / 2, inset, Math.max(inset, W - bw - insetR));
          y = dockY - bh;
          dockY = y - 8;
        }
        const maxW = docked ? Math.max(240, Math.min(720, W - inset - insetR - 4)) + 'px' : '';
        if (it.el.style.maxWidth !== maxW) it.el.style.maxWidth = maxW;
        it.el.classList.toggle('docked', docked);
        it.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      }
    },
  };

  GB.HUD = HUD;
  GB.Bubbles = Bubbles;
})(window.GB = window.GB || {});
