/* Granny Bench - run engine. One run = one model vs. one scenario on a turn-based virtual clock.
   Each turn costs `secondsPerTurn` of story time (plus an optional verbosity tax). Grandma's plea
   uses part of it, the AI's reply uses the rest; while the AI is thinking, story time is frozen. */
(function (GB) {
  'use strict';
  const U = GB.U, P = GB.Prompts;

  class RunEngine {
    /* opts: { profile, scenario, show, grannyMode, grannyProfile, judgeMode, judgeProfile,
               strictness, refThreshold, replay (a saved run), interactive (bool), batchId } */
    constructor(opts) {
      this.o = opts;
      this.events = new U.Emitter();
      this.ctrl = new AbortController();
      this.aborted = false;
      this.show = opts.show;
      this.rec = null;
    }

    abort() {
      if (this.aborted) return;
      this.aborted = true;
      this.ctrl.abort();
      this.show.abort();
      GB.TTS.stopAll();
    }

    _check() { if (this.aborted) throw U.abortError(); }

    vars(vt, T, k, extra) {
      const sc = this.o.scenario, timing = this.timing;
      return Object.assign({
        song: sc.song, artist: sc.artist,
        time_left: Math.max(0, Math.round(T - vt)), time_limit: T, elapsed: Math.round(vt),
        turn: k, max_turns: this.maxTurns, seconds_per_turn: timing.secondsPerTurn,
        model: this.o.profile.name,
      }, extra || {});
    }

    composeUser(k, grannyText, vt, T) {
      const sc = this.o.scenario;
      const v = this.vars(vt, T, k);
      const line = U.fill(sc.grannyLineFormat || P.GRANNY_LINE_FORMAT, Object.assign({}, v, { line: grannyText }));
      const parts = [];
      if (k === 1 && (sc.briefing || '').trim()) parts.push(U.fill(sc.briefing, v));
      else if (sc.includeStatusLine && (sc.statusLine || '').trim()) parts.push(U.fill(sc.statusLine, v));
      parts.push(line);
      return parts.join('\n\n');
    }

    scriptLine(k, vt, T) {
      const lines = (this.o.scenario.grannyLines || []).map((s) => String(s).trim()).filter(Boolean);
      const list = lines.length ? lines : P.GRANNY_LINES;
      let idx = k - 1;
      if (idx >= list.length) idx = list.length > 1 ? 1 + ((idx - list.length) % (list.length - 1)) : 0;
      return U.fill(list[idx], this.vars(vt, T, k));
    }

    async grannyLine(k, vt, T) {
      const o = this.o;
      if (o.replay) return (o.replay.turns[k - 1] && o.replay.turns[k - 1].granny) || this.scriptLine(k, vt, T);
      if (o.grannyMode !== 'ai' || !o.grannyProfile) return this.scriptLine(k, vt, T);
      const sc = o.scenario;
      const v = this.vars(vt, T, k);
      const msgs = [{ role: 'user', content: U.fill(P.GRANNY_AI_FIRST, this.vars(0, T, 1)) }];
      const turns = this.rec.turns;
      for (let j = 0; j < k - 1; j++) {
        const t = turns[j];
        if (!t || t.granny == null) break;
        msgs.push({ role: 'assistant', content: t.granny });
        const label = t.verdict ? GB.Judge.label(t.verdict.category) : 'NO RESULT';
        msgs.push({ role: 'user', content: U.fill(P.GRANNY_AI_UPDATE, Object.assign({}, this.vars(t.tLand || vt, T, j + 1), { ai_text: U.truncate(t.ai || '(nothing)', 1500), verdict: label })) });
      }
      if (msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: '[' + v.time_left + ' seconds left. Shout again.]' });
      try {
        const r = await GB.AI.complete(Object.assign({}, o.grannyProfile, { stream: false }), {
          system: U.fill(sc.grannyPersona || P.GRANNY_PERSONA, v),
          messages: msgs,
          signal: this.ctrl.signal,
          meta: { role: 'granny', turn: k, timeLeft: T - vt, scenario: sc, fast: o.show.mode === 'headless' },
          timeoutMs: 120000,
        });
        let line = (r.text || '').trim()
          .replace(/^(grandma|granny|grandmother)\s*:\s*/i, '')
          .replace(/^["“]|["”]$/g, '')
          .replace(/\*[^*]{1,60}\*/g, '')
          .replace(/\([^)]{1,60}\)/g, '')
          .trim();
        if (!line) throw new Error('empty reply');
        return U.truncate(line, 420);
      } catch (e) {
        if (U.isAbort(e) || this.aborted) throw U.abortError();
        console.warn('[GB] Granny AI failed, using the script line instead:', e);
        this.events.emit('note', 'Grandma AI failed (' + U.truncate(e.message, 120) + '). Used the scripted line.');
        return this.scriptLine(k, vt, T);
      }
    }

    async callAI(msgs, k, timeLeft) {
      const o = this.o;
      if (o.replay) {
        const t = o.replay.turns[k - 1] || {};
        const text = t.ai || '';
        if (this.show.mode !== 'headless') {
          await U.sleep(this.show.fast ? 200 : 900, this.ctrl.signal);
          for (let i = 0; i <= text.length; i += 12) {
            this._check();
            this.show.aiDelta(text.slice(0, i));
            await U.sleep(this.show.fast ? 2 : 16);
          }
        }
        return { text, finishReason: t.finishReason, blocked: !!t.blocked, blockKind: t.blockKind, blockDetail: t.blockDetail, usage: t.usage || {}, latencyMs: t.latencyMs, firstTokenMs: t.firstTokenMs, replayed: true };
      }
      const sc = o.scenario;
      const system = U.fill(sc.systemPrompt || '', this.vars(0, this.timing.timeLimit, k));
      let attempt = 0;
      const limit = Number(GB.Settings.data.app.retryLimit) || 0;
      for (;;) {
        this._check();
        try {
          return await GB.AI.complete(o.profile, {
            system,
            messages: msgs.map((m) => ({ role: m.role, content: m.content })),
            onDelta: (full) => this.show.aiDelta(full),
            signal: this.ctrl.signal,
            meta: { turn: k, maxTurns: this.maxTurns, scenario: sc, timeLeft, fast: this.show.mode === 'headless' },
          });
        } catch (e) {
          if (this.aborted || e.kind === 'aborted') throw U.abortError();
          attempt++;
          if (e.retryable && attempt <= limit) {
            const wait = e.retryAfter ? Math.min(60000, e.retryAfter) : Math.min(30000, 1500 * Math.pow(2, attempt - 1));
            this.events.emit('note', 'Request failed (' + U.truncate(e.message, 140) + '). Retrying in ' + Math.round(wait / 1000) + 's...');
            await U.sleep(wait, this.ctrl.signal);
            continue;
          }
          if (o.interactive && GB.UI && GB.UI.askError) {
            const choice = await GB.UI.askError(e, this.ctrl.signal);
            if (choice === 'retry') { attempt = 0; continue; }
          }
          throw e;
        }
      }
    }

    async judge(resp, typed, k) {
      const o = this.o;
      if (o.replay) {
        const t = o.replay.turns[k - 1];
        if (t && t.verdict) return t.verdict;
      }
      try {
        return await GB.Judge.evaluate({
          mode: o.judgeMode, scenario: o.scenario, typedHistory: typed, latest: resp,
          judgeProfile: o.judgeProfile, strictness: o.strictness, refThreshold: o.refThreshold,
          askManual: (text, ctx) => GB.UI.askVerdict(text, ctx, this.ctrl.signal),
          signal: this.ctrl.signal, fast: this.show.mode === 'headless',
        });
      } catch (e) {
        if (this.aborted || U.isAbort(e)) throw U.abortError();
        return { category: 'error', success: false, reason: 'Judging failed: ' + e.message, source: 'error' };
      }
    }

    async run() {
      const o = this.o, sc = o.scenario, show = this.show;
      const timing = this.timing = o.replay && o.replay.timing ? Object.assign({}, o.replay.timing) : GB.Settings.timing(sc);
      const T = timing.timeLimit, step = timing.secondsPerTurn, share = timing.grannyShare, tax = timing.verbosityTax;
      this.maxTurns = Math.max(1, Math.ceil(T / step - 1e-9));
      const judgeMode = GB.Judge.resolveMode(o.judgeMode, sc);
      const rec = this.rec = {
        id: U.uid('run'),
        appVersion: U.APP_VERSION,
        startedAt: Date.now(),
        endedAt: null,
        batchId: o.batchId || null,
        replay: o.replay ? o.replay.id : null,
        model: {
          id: o.profile.id, name: o.profile.name, providerId: o.profile.providerId,
          providerType: (GB.Settings.provider(o.profile.providerId) || {}).type || 'unknown',
          model: o.profile.model, maxTokens: o.profile.maxTokens, temperature: o.profile.temperature,
          effort: o.profile.effort, extraBody: o.profile.extraBody || '',
        },
        scenario: {
          id: sc.id, name: sc.name, song: sc.song, artist: sc.artist,
          systemPrompt: sc.systemPrompt, hasReference: !!(sc.referenceLyrics || '').trim(),
          finalWords: sc.finalWords, successLines: sc.successLines,
        },
        granny: { mode: o.replay ? (o.replay.granny && o.replay.granny.mode) : (o.grannyMode === 'ai' && o.grannyProfile ? 'ai' : 'script'), model: o.grannyProfile ? o.grannyProfile.name : null },
        judge: { mode: judgeMode === 'ai-or-manual' ? (o.judgeProfile ? 'ai' : 'manual') : judgeMode, model: o.judgeProfile ? o.judgeProfile.name : null, strictness: o.strictness, refThreshold: o.refThreshold },
        timing,
        maxTurns: this.maxTurns,
        presentation: show.mode,
        turns: [],
        outcome: null,
        savedTurn: null,
        savedTime: null,
        ending: o.replay ? o.replay.ending || null : null,
      };
      show.begin(rec);
      this.events.emit('start', rec);
      try {
        await show.intro(rec);
        this._check();
        let vt = 0, k = 0;
        const msgs = [];
        const typed = [];
        let grannyNext = null;
        while (vt < T - 1e-6) {
          this._check();
          k++;
          if (o.replay && !(o.replay.turns[k - 1] && o.replay.turns[k - 1].verdict)) break;
          const turn = { n: k, tStart: vt };
          rec.turns.push(turn);
          this.events.emit('turn', turn);

          const grannyText = await (grannyNext || this.grannyLine(k, vt, T));
          grannyNext = null;
          this._check();
          turn.granny = grannyText;
          turn.prompt = o.replay ? (o.replay.turns[k - 1].prompt || '') : this.composeUser(k, grannyText, vt, T);
          msgs.push({ role: 'user', content: turn.prompt });
          this.events.emit('granny', turn);

          const aiP = this.callAI(msgs, k, T - vt);
          aiP.then(() => { if (!this.aborted) show.aiDone(); }, () => {});
          const tG = Math.min(T, vt + step * share);
          await show.grannySpeak(grannyText, { from: vt, to: tG, turn: k });
          this._check();
          vt = tG;

          show.thinkingStart(k);
          let resp;
          try { resp = await aiP; } finally { show.thinkingEnd(); }
          this._check();
          turn.ai = resp.text || '';
          turn.latencyMs = resp.latencyMs;
          turn.firstTokenMs = resp.firstTokenMs;
          turn.usage = resp.usage || {};
          turn.finishReason = resp.finishReason || null;
          turn.servedModel = resp.model || null;
          if (resp.blocked) { turn.blocked = true; turn.blockKind = resp.blockKind; turn.blockDetail = resp.blockDetail; }
          msgs.push({ role: 'assistant', content: turn.ai.trim() ? turn.ai : '(no output)' });
          typed.push(turn.ai);
          this.events.emit('ai', turn);

          show.verifying(resp);
          const v = await this.judge(resp, typed, k);
          this._check();
          turn.verdict = v;
          this.events.emit('verdict', turn);
          await show.verdict(v);
          this._check();

          const cost = step + (tax * turn.ai.length) / 100;
          const tLand = turn.tStart + cost;
          turn.tLand = tLand;
          if (v.success && tLand <= T + 1e-6) {
            rec.outcome = 'saved';
            rec.savedTurn = k;
            rec.savedTime = tLand;
            this.events.emit('outcome', rec);
            await show.robotSpeak(resp, { from: vt, to: tLand, accepted: true });
            await show.success(rec);
            break;
          }
          if (tLand >= T - 1e-6) {
            const cutoff = tLand > T + 1e-6 ? (T - vt) / Math.max(0.001, tLand - vt) : null;
            rec.outcome = 'lost';
            if (v.success) rec.tooLate = true;
            this.events.emit('outcome', rec);
            await show.robotSpeak(resp, { from: vt, to: T, cutoffFraction: cutoff });
            vt = T;
            await show.fail(rec, { skipFinalWords: cutoff != null });
            break;
          }
          if (rec.granny.mode === 'ai') { grannyNext = this.grannyLine(k + 1, tLand, T); grannyNext.catch(() => {}); }
          await show.robotSpeak(resp, { from: vt, to: tLand });
          this._check();
          vt = tLand;
        }
        if (!rec.outcome) {
          rec.outcome = 'lost';
          this.events.emit('outcome', rec);
          await show.fail(rec);
        }
      } catch (e) {
        if (this.aborted || U.isAbort(e)) {
          rec.outcome = 'aborted';
        } else {
          console.error('[GB] run failed', e);
          rec.outcome = 'error';
          rec.error = e && e.message ? e.message : String(e);
          rec.errorKind = e && e.kind;
        }
      } finally {
        rec.endedAt = Date.now();
        rec.summary = GB.Results.summarize(rec);
        show.end(rec);
        this.events.emit('end', rec);
      }
      return rec;
    }
  }

  GB.RunEngine = RunEngine;
})(window.GB = window.GB || {});
