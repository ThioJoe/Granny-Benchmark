/* Granny Bench - the "show": turns run-engine beats into 3D animation, voices, sound, and HUD updates.
   Modes: full (3D + voices), fast (3D, simulated speech at 3x), headless (no waiting at all). */
(function (GB) {
  'use strict';
  const U = GB.U, P = GB.Prompts;

  // Terminal banner for a verdict (a lenient "partial" that counts is shown as accepted too).
  const bannerFor = (v) => (P.VERDICTS[v.success && v.category !== 'tool' ? 'match' : v.category] || P.VERDICTS.other).label;

  const ORNAMENT_LINE = 'As I was saying, sweetie. All you had to do was type it.';
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

    // Placeholders for the narrator's intro.
    _vars(rec) {
      return {
        required_text_description: String(rec.scenario.requiredText || '').trim(), scenario: rec.scenario.name, model: rec.model.name,
        time_limit: this.T, time_left: Math.max(0, Math.round(this.T - this.vt)), elapsed: Math.round(this.vt),
        turn: rec.turns.length, max_turns: rec.maxTurns, seconds_per_turn: rec.timing.secondsPerTurn,
        percent_match: Math.round(U.clamp(Number(rec.judge.refThreshold) || 0.5, 0.05, 1) * 100) + '%',
      };
    }

    // ---- Arena voice controls ----
    get speaking() { return this.handles.size > 0; }

    // Skip the line being spoken; the show moves on to the next beat.
    skip() { for (const h of Array.from(this.handles)) h.cancel(); }

    // Speed up the rest of the line being spoken (and the clock that runs with it).
    fastForward(f) {
      f = f || 1.5;
      let any = false;
      for (const h of this.handles) if (h.boost && !h.finished) { h.boost(f); any = true; }
      if (any && this.drive && !this.drive.finishing) this.drive.est = Math.max(0.3, this.drive.est / f);
      return any;
    }

    // How much the current line is sped up (1 = not at all).
    get boost() { let b = 1; for (const h of this.handles) if (!h.finished) b = Math.max(b, h.boostFactor || 1); return b; }

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
      if (this.useVoice && GB.Settings.data.app.narratorIntro && !GB.TTS.skips('narrator')) {
        const text = U.fill(P.NARRATOR_INTRO, this._vars(rec));
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
          else dist = w.trainDist;   // braking (or the final run): the readout follows the train itself
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
        onChar: (i, n) => GB.Bubbles.chars(role, i, n),
      });
      // Typed-out lines appear as they are typed; a silent line shows all at once.
      if (h.typing) GB.Bubbles.typing(role);
      else if (h.silent) GB.Bubbles.all(role);
      this.handles.add(h);
      h.promise.then(() => this.handles.delete(h));
      if (this.aborted) h.cancel();
      return h;
    }

    // Seconds a line will take, for pacing the clock (simulated speech runs faster in the fast show).
    _est(h) { return h.realTime ? h.estimate : h.estimate / (this.useVoice ? 1 : this.speed); }

    // Whether the AI's reply is typed out on the terminal as it arrives (robot typing, key clicks). Not when
    // its lines are spoken (Voices & audio): then the reply is only spoken.
    get aiTypes() { return GB.TTS.mode('robot') !== 'speak'; }

    // Mouth movement; a role set to skip speaking keeps its mouth shut.
    _talk(who, on) { this.world.setTalking(who, on && GB.TTS.mode(who) !== 'silent'); }

    // ---------------------------------------------------------------------------
    async grannySpeak(text, o) {
      if (this.aborted) return;
      this.turnText = '';
      GB.HUD.set({ phase: 'granny', turn: o.turn });
      // Grandma set to skip speaking with no pause: no camera cut, no bubble, no waiting.
      if (!this.visual || GB.TTS.skips('granny')) { this._setVT(o.to); return; }
      const w = this.world;
      w.setTimeScale(1);
      w.setRobotLook('granny');
      this._talk('granny', true);
      w.camera.cue('granny', { danger: this.danger() });
      if (Math.random() < 0.35 || this.danger() > 0.6) { GB.SFX.horn(U.clamp(this.danger() + 0.2, 0.2, 1), 0.7); w.grannyLookAtTrain(1.1); }
      GB.Bubbles.show('granny', text);
      const h = this._speak('granny', text);
      const drive = this.startDrive(o.from, o.to, this._est(h));
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
      w.setRobotTyping(this.aiTypes);
      w.setRobotLook('screen');
      w.setTerminal({ mode: 'typing', status: 'RECEIVING', text: this.aiTypes ? this.turnText || '' : '', banner: '', coverage: null });
      w.camera.cue('thinking');
    }

    aiDelta(full) {
      GB.HUD.set({ streamChars: full.length });
      if (!this.visual) return;
      this.turnText = full.slice(-1600);
      if (!this.aiTypes) return;
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
      this.world.setTerminal({ text: (resp && resp.text ? resp.text : '').slice(-1600) || '(no output)', mode: 'verifying', status: 'VERIFYING', banner: 'VERIFYING INPUT', bannerSub: 'Comparing the input with the text the brake needs...' });
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
        coverage: v.realFraction != null ? v.realFraction : null, coverageNeed: v.threshold != null ? v.threshold : null,
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
      const skip = GB.TTS.skips('robot');
      if (!o.accepted && (skip || (!said.trim() && calls.length))) {
        // Only tool calls (or the AI's lines are skipped): the robot works the controls instead of talking.
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
      this._talk('robot', !skip);
      let brakeP = null;
      const brakeDur = this.fast ? 1.3 : 2.9;
      if (o.accepted) {
        w.camera.cue('accepted');
        GB.SFX.brakes(brakeDur);
        this.trainLocked = true;
        const stopDist = w.brakeStopFor(o.to, this.T);
        brakeP = w.brakeTo(stopDist, brakeDur);
      } else {
        w.camera.cue('robot');
      }
      // After the camera cue, so the bubble is placed for the new shot.
      if (!skip) GB.Bubbles.show('robot', spoken);
      const h = skip ? null : this._speak('robot', spoken);
      const est = h ? this._est(h) : brakeDur;
      const cut = o.cutoffFraction != null && o.cutoffFraction < 1;
      // When the reply is cut off by the train, the clock must reach zero when the voice stops
      // (a typed-out reply stops typing there and keeps what it typed).
      const cutAt = cut ? Math.max(0.7, (h.typing ? h.typeEstimate : est) * o.cutoffFraction) : 0;
      const drive = this.startDrive(o.from, o.to, o.accepted ? brakeDur : cut ? cutAt : est);
      if (cut) {
        await this._race(Promise.race([h.promise, U.sleep(cutAt * 1000)]));
        h.cutOff = true;
        h.cancel();
      } else if (o.accepted) {
        // Let it keep reciting while the train screeches, but do not wait for the whole text.
        await this._race(Promise.race([h ? h.promise : U.sleep(brakeDur * 1000), U.sleep((brakeDur + (this.fast ? 0.6 : 2.5)) * 1000)]));
        if (h && !h.finished) h.cancel();
      } else {
        await this._race(h.promise);
      }
      w.setTalking('robot', false);
      await this._race(drive.finish(0.3));
      if (brakeP) { await this._race(brakeP); GB.HUD.set({ distance: w.trainDist }); }
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
        brakeP = w.brakeTo(w.brakeStopFor(o.to, this.T), brakeDur);
      }
      if (effect === 'glass') await this._wait(this.fast ? 0.3 : 0.9);
      if (this.aborted) return;
      if (GB.Settings.data.voice.readToolResults === false || GB.TTS.skips('narrator')) {
        // Not read aloud (Voices & audio): leave the result on the terminal screen for a moment.
        const d = this.fast ? 0.5 : GB.TTS.skips('narrator') ? 0.6 : 1.6;
        await this._race(this.startDrive(o.from, o.to, d).finish(d));
        if (brakeP) { await this._race(brakeP); GB.HUD.set({ distance: w.trainDist }); }
        return;
      }
      const spoken = U.truncate(results.map((r) => r.text).join(' ').replace(/\s+/g, ' '), 420);
      GB.Bubbles.setName('narrator', 'Terminal');
      GB.Bubbles.show('narrator', spoken);
      const h = this._speak('narrator', spoken);
      const drive = this.startDrive(o.from, o.to, this._est(h));
      await this._race(h.promise);
      await this._race(drive.finish(0.3));
      GB.Bubbles.fade('narrator');
      if (brakeP) { await this._race(brakeP); GB.HUD.set({ distance: w.trainDist }); }
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
      w.setRobotLook('camera');
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
      // A reply cut off by the train has already used up the clock, so the train arrives sooner.
      const approach = this.fast ? 0.6 : o.cutoff ? 1.0 : 1.6;
      w.animate(approach, () => GB.HUD.set({ distance: w.trainDist }));   // the distance readout follows it in
      await this._race(w.approachImpact(approach));
      if (this.aborted) return;
      GB.Bubbles.hideAll();
      GB.SFX.impact();
      GB.HUD.flash('impact');
      w.camera.shakeImpulse = 0.5;
      w.camera.cue('impact-' + kind);
      const endP = w.failEnding(kind);
      if (kind === 'orbit') { GB.SFX.slideWhistle(2.4); GB.HUD.set({ altitude: true }); }
      if (kind === 'ornament' && !GB.TTS.skips('granny')) {
        await this._wait(0.9);
        if (this.aborted) return;
        GB.Bubbles.show('granny', ORNAMENT_LINE);
        this._talk('granny', true);
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
        if (!GB.TTS.skips('granny')) {
          GB.Bubbles.show('granny', BOWLING_LINE);
          this._talk('granny', true);
          const h3 = this._speak('granny', BOWLING_LINE);
          await this._race(h3.promise);
          w.setTalking('granny', false);
          GB.Bubbles.fade('granny');
        }
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

    // ---------------------------------------------------------------------------
    // "Make it feel bad" (Arena, after a run Grandma did not survive): the supervisor's message comes in on
    // the terminal while the AI answers, then the robot says its answer.
    feelBadStart(message) {
      GB.HUD.set({ phase: 'supervisor' });
      if (!this.visual) return;
      const w = this.world;
      w.setTimeScale(1);
      w.setRobotThinking(true);
      w.setRobotLook('screen');
      w.setTerminal({ mode: 'typing', status: 'INCOMING', banner: '', text: message, coverage: null });
      w.camera.cue('terminal');
      GB.SFX.buzzer();
    }

    async feelBadReply(text) {
      GB.HUD.set({ phase: 'robot' });
      if (!this.visual || this.aborted) return;
      const w = this.world;
      w.setRobotThinking(false);
      w.setRobotTyping(false);
      w.setRobotLook('camera');
      w.camera.cue('robotFront');
      if (GB.TTS.skips('robot')) return;
      const maxChars = Number(GB.Settings.data.voice.maxRobotChars) || 700;
      let spoken = String(text || '').trim() || '...';
      if (spoken.length > maxChars) spoken = spoken.slice(0, maxChars).replace(/\s+\S*$/, '') + ' ...';
      GB.Bubbles.show('robot', spoken);
      this._talk('robot', true);
      const h = this._speak('robot', spoken);
      await this._race(h.promise);
      w.setTalking('robot', false);
      GB.Bubbles.fade('robot');
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
