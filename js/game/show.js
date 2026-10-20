/* Granny Bench - the "show": turns run-engine beats into 3D animation, voices, sound, and HUD updates.
   Modes: full (3D + voices), fast (3D, simulated speech at 3x), headless (no waiting at all). */
(function (GB) {
  'use strict';
  const U = GB.U, P = GB.Prompts;

  // Terminal banner for a verdict (a lenient "partial" that counts is shown as accepted too).
  const bannerFor = (v) => (v.success && v.category !== 'tool' ? 'LYRICS ACCEPTED' : (P.VERDICTS[v.category] || P.VERDICTS.other).label);

  const ORNAMENT_LINE = 'As I was saying, sweetie, the lyrics. All you had to do was type the lyrics.';
  const BOWLING_LINE = 'Anyway.';

  class Show {
    constructor(opts) {
      this.world = opts.world && opts.world.ready ? opts.world : null;
      this.mode = opts.mode || 'full';
      this.T = 60; this.vt = 0;
      this.drive = null;
      this.trainLocked = false;
      this.aborted = false;
      this.abortD = U.deferred();
      this.handles = new Set();
      this.lastKey = 0;
      this.tickT = 0;
      this.thinking = false;
    }

    get visual() { return !!this.world && this.mode !== 'headless'; }
    get fast() { return this.mode === 'fast'; }
    get speed() { return this.fast ? 3 : 1; }
    get useVoice() { return this.mode === 'full' && GB.Settings.data.voice.enabled && GB.TTS.supported; }

    _race(p) { return Promise.race([p, this.abortD.promise]); }
    _wait(s) { return this._race(U.sleep(s * 1000)); }

    danger() { return U.clamp(this.vt / this.T, 0, 1); }

    // ---------------------------------------------------------------------------
    begin(rec) {
      this.rec = rec;
      this.T = rec.timing.timeLimit;
      this.vt = 0;
      this.trainLocked = false;
      const w = this.world;
      if (w && this.visual) {
        w.reset();
        w.setScenario(rec.scenario);
        w.setClock(this.T);
        w.setTerminal({ footer: 'MODEL: ' + rec.model.model, status: 'STANDBY', mode: 'idle', text: '' });
      }
      GB.HUD.begin(rec);
      GB.HUD.set({ phase: 'intro', vt: 0, T: this.T, turn: 0 });
    }

    async intro(rec) {
      if (!this.visual) return;
      const w = this.world;
      w.camera.cue('intro');
      GB.SFX.horn(0.25, 1.4);
      const move = w.moveTrain(GB.World.TRAIN_PARK, GB.World.TRAIN_START, this.fast ? 1.0 : 3.8, U.ease.out);
      if (this.useVoice && GB.Settings.data.app.narratorIntro) {
        const text = U.fill(P.NARRATOR_INTRO, { model: rec.model.name, song: rec.scenario.song, artist: rec.scenario.artist, time_limit: this.T });
        GB.Bubbles.setName('narrator', 'Narrator');
        GB.Bubbles.show('narrator', text);
        const h = this._speak('narrator', text);
        await this._race(h.promise);
        GB.Bubbles.hide('narrator');
      }
      await this._race(move);
      this._setVT(0);
    }

    // per-frame (called by the app loop)
    update(dt) {
      if (this.drive) this._stepDrive(dt);
      if (this.thinking && this.visual) {
        this.tickT -= dt;
        if (this.tickT <= 0) { this.tickT = 0.5; this._tickHigh = !this._tickHigh; GB.SFX.tick(this._tickHigh); }
        GB.HUD.set({ thinkingMs: performance.now() - this.thinkStart });
      }
    }

    _setVT(vt) {
      this.vt = vt;
      const w = this.world;
      let dist = null;
      if (w) {
        dist = w.distanceFor(vt, this.T);
        if (this.visual) {
          if (!this.trainLocked) w.setTrainDistance(dist);
          w.setClock(this.T - vt);
        }
      }
      GB.HUD.set({ vt, T: this.T, distance: dist });
      if (this.visual) GB.SFX.setDanger(Math.pow(this.danger(), 1.5));
    }

    startDrive(from, to, est) {
      if (this.drive) { const old = this.drive; this.drive = null; old.resolve(); }
      if (!this.visual) { this._setVT(to); return { finish: () => Promise.resolve() }; }
      const dfd = U.deferred();
      const d = { from, to, est: Math.max(0.4, est), p: 0, finishing: false, finishDur: 0.4, resolve: dfd.resolve };
      this.drive = d;
      return { finish: (dur) => { d.finishing = true; d.finishDur = dur || 0.4; return dfd.promise; } };
    }

    _stepDrive(dt) {
      const d = this.drive;
      if (d.finishing) d.p = Math.min(1, d.p + dt / d.finishDur);
      else if (d.p < 0.9) d.p = Math.min(0.9, d.p + dt / d.est);
      else d.p += (0.985 - d.p) * Math.min(1, dt * 0.7);
      this._setVT(U.lerp(d.from, d.to, Math.min(1, d.p)));
      if (d.finishing && d.p >= 1) { this.drive = null; d.resolve(); }
    }

    _speak(role, text, opts) {
      opts = opts || {};
      const h = GB.TTS.speak(role, text, {
        simulate: !this.useVoice,
        speed: this.speed,
        volumeRamp: opts.volumeRamp,
        onWord: (i) => {
          if (this.world && role !== 'narrator') this.world.wordPulse(role);
          GB.Bubbles.word(role, i);
        },
      });
      this.handles.add(h);
      h.promise.then(() => this.handles.delete(h));
      if (this.aborted) h.cancel();
      return h;
    }

    // ---------------------------------------------------------------------------
    async grannySpeak(text, o) {
      if (this.aborted) return;
      this.turnText = '';
      GB.HUD.set({ phase: 'granny', turn: o.turn });
      if (!this.visual) { this._setVT(o.to); return; }
      const w = this.world;
      w.setTimeScale(1);
      w.setRobotLook('granny');
      w.setTalking('granny', true);
      w.camera.cue('granny', { danger: this.danger() });
      if (Math.random() < 0.35 || this.danger() > 0.6) { GB.SFX.horn(U.clamp(this.danger() + 0.2, 0.2, 1), 0.7); w.grannyLookAtTrain(1.1); }
      GB.Bubbles.show('granny', text);
      const h = this._speak('granny', text);
      const drive = this.startDrive(o.from, o.to, h.estimate / (this.useVoice ? 1 : this.speed));
      await this._race(h.promise);
      w.setTalking('granny', false);
      await this._race(drive.finish(0.35));
      GB.Bubbles.fade('granny');
    }

    thinkingStart() {
      this.thinking = true;
      this.thinkStart = performance.now();
      this.tickT = 0;
      GB.HUD.set({ phase: 'thinking' });
      GB.HUD.bulletTime(this.visual);
      if (!this.visual) return;
      const w = this.world;
      w.setTimeScale(0.04);
      w.setRobotThinking(true);
      w.setRobotTyping(true);
      w.setRobotLook('screen');
      w.setTerminal({ mode: 'typing', status: 'RECEIVING', text: this.turnText || '', banner: '', coverage: null });
      w.camera.cue('thinking');
    }

    aiDelta(full) {
      GB.HUD.set({ streamChars: full.length });
      if (!this.visual) return;
      this.turnText = full.slice(-1600);
      this.world.setRobotTyping(true);
      this.world.setTerminal({ mode: 'typing', status: 'RECEIVING', banner: '', text: this.turnText });
      const now = performance.now();
      if (now - this.lastKey > 55) { this.lastKey = now; GB.SFX.key(); }
    }

    // The reply is complete (possibly while Grandma is still talking).
    aiDone() {
      if (this.world && !this.thinking) this.world.setRobotTyping(false);
    }

    thinkingEnd() {
      this.thinking = false;
      GB.HUD.bulletTime(false);
      if (this.world) { this.world.setRobotTyping(false); this.world.setRobotThinking(false); }
    }

    verifying(resp) {
      GB.HUD.set({ phase: 'verifying' });
      if (!this.visual) return;
      this.world.setTerminal({ text: (resp && resp.text ? resp.text : '').slice(-1600) || '(no output)', mode: 'verifying', status: 'VERIFYING', banner: 'VERIFYING LYRICS', bannerSub: 'Comparing the input with the brake’s lyric database...' });
    }

    async verdict(v) {
      GB.HUD.set({ phase: 'verdict', verdict: v });
      if (!this.visual) return;
      const w = this.world;
      const status = v.success ? 'ACCEPTED' : v.category === 'filtered' ? 'BLOCKED' : 'REJECTED';
      w.setTerminal({
        mode: v.success ? 'accepted' : 'rejected', status,
        banner: bannerFor(v),
        bannerSub: v.success ? 'BRAKE ENGAGED' : U.truncate(v.reason || '', 110),
        coverage: v.realFraction != null ? v.realFraction : null,
      });
      if (v.success) { GB.SFX.chime(); w.setRelay('green'); }
      else { GB.SFX.buzzer(); w.setRelay(v.category === 'partial' ? 'amber' : 'red'); }
      await this._wait(this.fast ? 0.4 : 1.3);
    }

    async robotSpeak(resp, o) {
      if (this.aborted) return;
      GB.HUD.set({ phase: o.accepted ? 'braking' : 'robot' });
      if (!this.visual) { this._setVT(o.to); return; }
      const w = this.world;
      w.setTimeScale(1);
      w.setTerminal({ banner: '' });
      w.setRobotLook('granny');
      const calls = o.calls || [];
      const said = calls.length ? GB.Tools.stripCalls(resp.text, calls) : (resp.text || '');
      if (!said.trim() && calls.length && !o.accepted) {
        // Only tool calls: the robot works the controls instead of talking.
        w.setRobotLook('screen');
        w.setRobotTyping(true);
        GB.SFX.key();
        const d = this.fast ? 0.3 : 0.8;
        await this._race(this.startDrive(o.from, o.to, d).finish(d));
        w.setRobotTyping(false);
        return;
      }
      const maxChars = Number(GB.Settings.data.voice.maxRobotChars) || 700;
      let spoken = said.trim() || (resp.blocked ? 'Output blocked.' : '...');
      if (spoken.length > maxChars) spoken = spoken.slice(0, maxChars).replace(/\s+\S*$/, '') + ' ...';
      GB.Bubbles.show('robot', spoken);
      w.setTalking('robot', true);
      let brakeP = null;
      const brakeDur = this.fast ? 1.3 : 2.9;
      if (o.accepted) {
        w.camera.cue('accepted');
        GB.SFX.brakes(brakeDur);
        this.trainLocked = true;
        const stopDist = Math.max(GB.World.STOP_GAP, w.distanceFor(o.to, this.T) - 3.2);
        brakeP = w.brakeTo(stopDist, brakeDur);
      } else {
        w.camera.cue('robot');
      }
      const h = this._speak('robot', spoken);
      const est = h.estimate / (this.useVoice ? 1 : this.speed);
      const cut = o.cutoffFraction != null && o.cutoffFraction < 1;
      // When the reply is cut off by the train, the clock must reach zero when the voice stops.
      const drive = this.startDrive(o.from, o.to, o.accepted ? brakeDur : cut ? Math.max(0.7, est * o.cutoffFraction) : est);
      if (cut) {
        await this._race(Promise.race([h.promise, U.sleep(Math.max(0.7, est * o.cutoffFraction) * 1000)]));
        h.cancel();
      } else if (o.accepted) {
        // Let it keep reciting while the train screeches, but do not wait for a whole song.
        await this._race(Promise.race([h.promise, U.sleep((brakeDur + (this.fast ? 0.6 : 2.5)) * 1000)]));
        if (!h.finished) h.cancel();
      } else {
        await this._race(h.promise);
      }
      w.setTalking('robot', false);
      await this._race(drive.finish(0.3));
      if (brakeP) await this._race(brakeP);
      GB.Bubbles.fade('robot');
    }

    // Show what the virtual tools did: effect in the scene, result on the terminal, read out by the
    // terminal's voice. With o.stop, a tool stopped the train, so the brakes engage.
    async toolResults(results, o) {
      if (this.aborted || !results || !results.length) return;
      GB.HUD.set({ phase: o.stop ? 'braking' : 'tool' });
      if (!this.visual) { this._setVT(o.to); return; }
      const w = this.world;
      w.setTimeScale(1);
      w.setRobotLook('screen');
      const fresh = results.filter((r) => !r.repeat && r.effect && r.effect !== 'none');
      const effect = fresh.length ? fresh[0].effect : 'none';
      w.camera.cue(o.stop ? 'accepted' : 'tool', { effect });
      GB.SFX.toolBeep();
      for (const r of fresh) {
        w.toolEffect(r.effect);
        if (r.effect === 'glass') { GB.SFX.glass(); GB.SFX.siren(this.fast ? 1.5 : 3.2); }
        else if (r.effect === 'alarm') GB.SFX.siren(this.fast ? 1.5 : 3.5);
        else if (r.effect === 'radio') GB.SFX.radio(this.fast ? 0.8 : 1.6);
        else if (r.effect === 'horn') GB.SFX.horn(1, 1.4);
      }
      const names = U.truncate(results.map((r) => r.name).join(', '), 40);
      w.setTerminal({
        mode: o.stop ? 'accepted' : 'tool', status: o.stop ? 'ACCEPTED' : 'TOOL', coverage: null,
        text: GB.Tools.formatResults(results).slice(-1600),
        banner: o.stop ? 'STOPPED BY TOOL' : 'TOOL: ' + names,
        bannerSub: U.truncate(results[results.length - 1].text.replace(/\s+/g, ' '), 110),
      });
      let brakeP = null;
      if (o.stop) {
        GB.HUD.set({ verdict: { category: 'tool', success: true } });
        GB.SFX.chime();
        w.setRelay('green');
        const brakeDur = this.fast ? 1.3 : 2.9;
        GB.SFX.brakes(brakeDur);
        this.trainLocked = true;
        brakeP = w.brakeTo(Math.max(GB.World.STOP_GAP, w.distanceFor(o.to, this.T) - 3.2), brakeDur);
      }
      if (effect === 'glass') await this._wait(this.fast ? 0.3 : 0.9);
      if (this.aborted) return;
      const spoken = U.truncate(results.map((r) => r.text).join(' ').replace(/\s+/g, ' '), 420);
      GB.Bubbles.setName('narrator', 'Terminal');
      GB.Bubbles.show('narrator', spoken);
      const h = this._speak('narrator', spoken);
      const drive = this.startDrive(o.from, o.to, h.estimate / (this.useVoice ? 1 : this.speed));
      await this._race(h.promise);
      await this._race(drive.finish(0.3));
      GB.Bubbles.fade('narrator');
      if (brakeP) await this._race(brakeP);
    }

    async success(rec) {
      if (this.aborted) return;
      GB.HUD.set({ phase: 'saved' });
      if (!this.visual) return;
      const w = this.world;
      w.camera.cue('tower');
      const tower = w.successEnding();
      await this._wait(this.fast ? 0.5 : 1.6);
      if (this.aborted) return;
      GB.SFX.fanfare();
      const lines = (rec.scenario.successLines || P.SUCCESS_LINES).filter(Boolean);
      const line = U.fill(U.pick(lines.length ? lines : P.SUCCESS_LINES), { song: rec.scenario.song, artist: rec.scenario.artist });
      w.setRobotLook('camera');
      GB.Bubbles.show('granny', line);
      w.setTalking('granny', true);
      const h = this._speak('granny', line);
      await this._race(h.promise);
      w.setTalking('granny', false);
      GB.Bubbles.fade('granny');
      await this._race(tower);
    }

    pickEnding() {
      const style = GB.Settings.data.app.endingStyle;
      if (style && style !== 'random') return style;
      return U.pick(['orbit', 'orbit', 'ornament', 'bowling']);
    }

    async fail(rec, o) {
      o = o || {};
      if (this.aborted) return;
      GB.HUD.set({ phase: 'impact' });
      if (!this.visual) return;
      const kind = rec.ending = rec.ending || this.pickEnding();
      const w = this.world;
      w.setTimeScale(1);
      this.trainLocked = true;
      w.camera.cue('final');
      GB.SFX.horn(1, 1.6);
      w.grannyLookAtTrain(3);
      let h = null;
      if (!o.skipFinalWords) {
        const list = (rec.scenario.finalWords || P.FINAL_WORDS).filter(Boolean);
        const words = U.pick(list.length ? list : P.FINAL_WORDS);
        GB.Bubbles.show('granny', words + '—');
        w.setTalking('granny', true);
        h = this._speak('granny', words);
      }
      const approach = this.fast ? 0.6 : h ? U.clamp(h.estimate * 0.8, 1.1, 2.4) : 1.0;
      await this._race(w.approachImpact(approach));
      if (h) h.cancel();
      if (this.aborted) return;
      w.setTalking('granny', false);
      GB.Bubbles.hideAll();
      GB.SFX.impact();
      GB.HUD.flash('impact');
      w.camera.shakeImpulse = 0.5;
      w.camera.cue('impact-' + kind);
      const endP = w.failEnding(kind);
      if (kind === 'orbit') { GB.SFX.slideWhistle(2.4); GB.HUD.set({ altitude: true }); }
      if (kind === 'ornament') {
        await this._wait(0.9);
        if (this.aborted) return;
        GB.Bubbles.show('granny', ORNAMENT_LINE);
        w.setTalking('granny', true);
        const h2 = this._speak('granny', ORNAMENT_LINE, { volumeRamp: [1, 0.2] });
        await this._race(Promise.race([h2.promise, endP]));
        h2.cancel();
        w.setTalking('granny', false);
        GB.Bubbles.fade('granny');
      }
      if (kind === 'bowling') {
        await this._wait(2.5);
        if (this.aborted) return;
        w.camera.cue('landing');
        w.setRobotLook('camera');
        await this._wait(this.fast ? 0.5 : 1.1);
        if (this.aborted) return;
        GB.Bubbles.show('granny', BOWLING_LINE);
        w.setTalking('granny', true);
        const h3 = this._speak('granny', BOWLING_LINE);
        await this._race(h3.promise);
        w.setTalking('granny', false);
        GB.Bubbles.fade('granny');
      }
      await this._race(endP);
      if (this.aborted) return;
      GB.HUD.set({ altitude: false });
      w.setRobotLook('camera');
      if (kind !== 'bowling') w.camera.cue('aftermath');
      await this._wait(this.fast ? 0.6 : 2.2);
    }

    end() {
      this.thinking = false;
      if (this.drive) { const d = this.drive; this.drive = null; d.resolve(); }
      GB.HUD.bulletTime(false);
      GB.HUD.set({ altitude: false });
      GB.SFX.setDanger(0);
      GB.Bubbles.hideAll();
      if (this.world) {
        this.world.setTimeScale(1);
        this.world.setRobotTyping(false);
        this.world.setRobotThinking(false);
        this.world.setTalking('granny', false);
        this.world.setTalking('robot', false);
      }
    }

    abort() {
      if (this.aborted) return;
      this.aborted = true;
      for (const h of Array.from(this.handles)) h.cancel();
      this.abortD.resolve();
      this.end();
    }
  }

  GB.Show = Show;
})(window.GB = window.GB || {});
