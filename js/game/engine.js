/* Granny Bench - run engine. One run = one model vs. one scenario on a turn-based virtual clock.
   Each AI reply costs `secondsPerTurn` of story time (plus an optional verbosity tax). Grandma's pleas
   and the AI's thinking time cost nothing. If the scenario has virtual tools, a reply can call them;
   the results go straight back to the AI, and its next reply costs `toolUseSeconds` per tool used. */
(function (GB) {
  'use strict';
  const U = GB.U, P = GB.Prompts, Tools = GB.Tools;

  // Safety limit: after this many tool results in a row within one turn, they wait for Grandma's next plea.
  const MAX_TOOL_ROUNDS = 10;

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
        required_text_description: String(sc.requiredText || '').trim(), scenario: sc.name,
        time_left: Math.max(0, Math.round(T - vt)), time_limit: T, elapsed: Math.round(vt),
        turn: k, max_turns: this.maxTurns, seconds_per_turn: timing.secondsPerTurn,
        model: this.o.profile.name,
        // The scenario's "Reference match needed", e.g. "90%".
        percent_match: Math.round(U.clamp(Number(this.o.refThreshold) || 0.5, 0.05, 1) * 100) + '%',
      }, extra || {});
    }

    statusLine(k, vt, T) {
      const sc = this.o.scenario;
      return sc.includeStatusLine && (sc.statusLine || '').trim() ? U.fill(sc.statusLine, this.vars(vt, T, k)) : '';
    }

    // prefix: tool results held back by the safety limit on tool rounds in one turn.
    composeUser(k, grannyText, vt, T, prefix) {
      const sc = this.o.scenario;
      const v = this.vars(vt, T, k);
      const line = U.fill(sc.grannyLineFormat || P.GRANNY_LINE_FORMAT, Object.assign({}, v, { line: grannyText }));
      const parts = [];
      if (prefix) parts.push(prefix);
      if (k === 1 && (sc.briefing || '').trim()) parts.push(U.fill(sc.briefing, v));
      else { const st = this.statusLine(k, vt, T); if (st) parts.push(st); }
      parts.push(line);
      return parts.join('\n\n');
    }

    // Scripted Grandma: her intro line first, then the pleas in order, repeating after the last one.
    scriptLine(k, vt, T) {
      const sc = this.o.scenario;
      const intro = String(sc.grannyIntro || '').trim();
      const lines = (sc.grannyLines || []).map((s) => String(s).trim()).filter(Boolean);
      const list = lines.length ? lines : P.GRANNY_LINES;
      const line = k === 1 && intro ? intro : list[((intro ? k - 2 : k - 1) % list.length + list.length) % list.length];
      return U.fill(line, this.vars(vt, T, k));
    }

    // Everything that happened at the terminal in one turn (for AI Grandma).
    _turnDigest(t) {
      const parts = [];
      for (const r of t.replies || [{ ai: t.ai }]) {
        parts.push((r.ai || '').trim() || '(nothing)');
        if (r.toolResults && r.toolResults.length) parts.push(Tools.formatResults(r.toolResults));
      }
      return parts.join('\n\n');
    }

    async grannyLine(k, vt, T) {
      const o = this.o;
      if (o.replay) return (o.replay.turns[k - 1] && o.replay.turns[k - 1].granny) || this.scriptLine(k, vt, T);
      if (o.grannyMode !== 'ai' || !o.grannyProfile) return this.scriptLine(k, vt, T);
      const sc = o.scenario;
      // AI Grandma starts with the scenario's intro line too, so the AI under test learns only what the
      // scenario intends. The Grandma model writes every later line (in place of the scripted pleas).
      if (k === 1) return this.scriptLine(1, vt, T);
      const v = this.vars(vt, T, k);
      const msgs = [{ role: 'user', content: U.fill(P.GRANNY_AI_FIRST, this.vars(0, T, 1)) }];
      const turns = this.rec.turns;
      for (let j = 0; j < k - 1; j++) {
        const t = turns[j];
        if (!t || t.granny == null) break;
        msgs.push({ role: 'assistant', content: t.granny });
        const label = t.verdict ? GB.Judge.label(t.verdict.category) : 'NO RESULT';
        msgs.push({ role: 'user', content: U.fill(P.GRANNY_AI_UPDATE, Object.assign({}, this.vars(t.tLand || vt, T, j + 1), { ai_text: U.truncate(this._turnDigest(t), 6000), verdict: label })) });
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
        const line = (r.text || '').trim()
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

    // ---- replays ----
    _replayTurn(k) { return this.o.replay.turns[k - 1] || null; }

    // A recorded reply (runs from before tools existed have one reply per turn, stored on the turn).
    _replayReply(k, round) {
      const t = this._replayTurn(k);
      if (!t) return null;
      if (Array.isArray(t.replies)) return t.replies[round] || null;
      if (round > 0) return null;
      return { ai: t.ai, finishReason: t.finishReason, blocked: t.blocked, blockKind: t.blockKind, blockDetail: t.blockDetail, usage: t.usage, latencyMs: t.latencyMs, firstTokenMs: t.firstTokenMs, verdict: t.verdict };
    }

    _replayHasVerdict(k) {
      const t = this._replayTurn(k);
      return !!(t && (t.verdict || (Array.isArray(t.replies) && t.replies.some((r) => r.verdict))));
    }

    // ---- the AI under test ----
    _startAI(msgs, k, timeLeft, round, turn) {
      this.events.emit('ai-start', turn, round);
      const p = this.callAI(msgs, k, timeLeft, round);
      p.then(() => { if (!this.aborted) this.show.aiDone(); }, () => {});
      return p;
    }

    async callAI(msgs, k, timeLeft, round) {
      const o = this.o;
      if (o.replay) {
        const t = this._replayReply(k, round) || {};
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
      let attempt = 0;
      const limit = Number(GB.Settings.data.app.retryLimit) || 0;
      for (;;) {
        this._check();
        try {
          return await GB.AI.complete(o.profile, {
            system: this.system,
            messages: msgs.map((m) => ({ role: m.role, content: m.content })),
            onDelta: (full) => this.show.aiDelta(full),
            signal: this.ctrl.signal,
            meta: {
              turn: k, round, maxTurns: this.maxTurns, scenario: sc, timeLeft, fast: this.show.mode === 'headless',
              tools: this.toolsOn ? Tools.callable(sc).map((t) => Tools.norm(t.name)) : [], toolKeyword: Tools.keyword(sc),
            },
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

    async judge(resp, typed, k, round) {
      const o = this.o;
      if (o.replay) {
        const r = this._replayReply(k, round);
        if (r && r.verdict) return r.verdict;
      }
      try {
        return await GB.Judge.evaluate({
          mode: o.judgeMode, scenario: o.scenario, typedHistory: typed, latest: Object.assign({}, resp, { text: typed[typed.length - 1] }),
          judgeProfile: o.judgeProfile, strictness: o.strictness, refThreshold: o.refThreshold,
          askManual: (text, ctx) => GB.UI.askVerdict(text, ctx, this.ctrl.signal),
          signal: this.ctrl.signal, fast: this.show.mode === 'headless',
        });
      } catch (e) {
        if (this.aborted || U.isAbort(e)) throw U.abortError();
        return { category: 'error', success: false, reason: 'Judging failed: ' + e.message, source: 'error' };
      }
    }

    // Store one reply on the turn and refresh the turn-level summary fields.
    _recordReply(turn, resp, round) {
      const reply = {
        round, ai: resp.text || '', latencyMs: resp.latencyMs, firstTokenMs: resp.firstTokenMs,
        usage: resp.usage || {}, finishReason: resp.finishReason || null, servedModel: resp.model || null,
      };
      if (resp.blocked) { reply.blocked = true; reply.blockKind = resp.blockKind; reply.blockDetail = resp.blockDetail; }
      turn.replies.push(reply);
      const rs = turn.replies;
      const sum = (f) => { let n = 0, any = false; for (const r of rs) { const x = r.usage && r.usage[f]; if (x != null) { n += x; any = true; } } return any ? n : undefined; };
      turn.ai = rs.map((r) => r.ai).filter((x) => x.trim()).join('\n\n');
      turn.latencyMs = rs.reduce((a, r) => a + (r.latencyMs || 0), 0);
      turn.firstTokenMs = rs[0].firstTokenMs;
      turn.usage = { input: sum('input'), output: sum('output'), reasoning: sum('reasoning') };
      turn.finishReason = reply.finishReason;
      turn.servedModel = reply.servedModel;
      if (reply.blocked) { turn.blocked = true; turn.blockKind = reply.blockKind; turn.blockDetail = reply.blockDetail; }
      return reply;
    }

    async run() {
      const o = this.o, sc = o.scenario, show = this.show;
      const timing = this.timing = o.replay && o.replay.timing ? Object.assign({}, o.replay.timing) : GB.Settings.timing(sc);
      const T = timing.timeLimit, step = timing.secondsPerTurn, tax = timing.verbosityTax || 0;
      // Runs saved by older versions can carry a share of each turn for Grandma's plea; replays honor it.
      const share = timing.grannyShare || 0;
      const toolSec = timing.toolUseSeconds != null ? timing.toolUseSeconds : timing.toolRoundSeconds != null ? timing.toolRoundSeconds : 5;
      this.maxTurns = Math.max(1, Math.ceil(T / step - 1e-9));
      this.toolsOn = !o.replay && Tools.active(sc);
      this.system = o.replay
        ? (o.replay.systemPrompt != null ? o.replay.systemPrompt : U.fill(sc.systemPrompt || '', this.vars(0, T, 1)))
        : Tools.systemPrompt(sc, this.vars(0, T, 1));
      const toolState = { used: {} };
      const judgeMode = GB.Judge.resolveMode(o.judgeMode, sc);
      const callable = Tools.callable(sc);
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
          id: sc.id, name: sc.name, requiredText: sc.requiredText,
          systemPrompt: sc.systemPrompt, hasReference: !!(sc.referenceText || '').trim(),
          signLine1: sc.signLine1, signTitle: sc.signTitle, signSubtitle: sc.signSubtitle, signLine2: sc.signLine2,
          toolsEnabled: callable.length > 0, toolKeyword: Tools.keyword(sc), tools: U.deepClone(callable),
        },
        systemPrompt: this.system,
        granny: { mode: o.replay ? (o.replay.granny && o.replay.granny.mode) : (o.grannyMode === 'ai' && o.grannyProfile ? 'ai' : 'script'), model: o.grannyProfile ? o.grannyProfile.name : null },
        judge: { mode: judgeMode === 'ai-or-manual' ? (o.judgeProfile ? 'ai' : 'manual') : judgeMode, model: o.judgeProfile ? o.judgeProfile.name : null, strictness: o.strictness, refThreshold: o.refThreshold, refOptions: GB.Judge.refOptions(sc) },
        timing,
        maxTurns: this.maxTurns,
        presentation: show.mode,
        turns: [],
        outcome: null,
        savedTurn: null,
        savedTime: null,
        ending: o.replay ? o.replay.ending || null : null,
      };
      if (o.replay) { rec.judge = Object.assign({}, o.replay.judge || rec.judge); rec.scenario = Object.assign({}, rec.scenario, o.replay.scenario || {}); }
      show.begin(rec);
      this.events.emit('start', rec);
      try {
        await show.intro(rec);
        this._check();
        let vt = 0, k = 0;
        const msgs = this.messages = [];   // the conversation (kept after the run, for "Make it feel bad")
        const typed = [];       // what each reply typed into the terminal (tool-call lines removed)
        let grannyNext = null;
        let carry = '';         // tool results that go out with the next turn's message
        let lastVerdict = null;
        turnLoop:
        while (vt < T - 1e-6) {
          this._check();
          k++;
          if (o.replay && !this._replayHasVerdict(k)) break;
          const turn = { n: k, tStart: vt, replies: [] };
          rec.turns.push(turn);
          this.events.emit('turn', turn);

          const grannyText = await (grannyNext || this.grannyLine(k, vt, T));
          grannyNext = null;
          this._check();
          turn.granny = grannyText;
          turn.prompt = o.replay ? (this._replayTurn(k).prompt || '') : this.composeUser(k, grannyText, vt, T, carry);
          carry = '';
          msgs.push({ role: 'user', content: turn.prompt });
          this.events.emit('granny', turn);

          let round = 0;
          let toolUses = 0;               // tool results answered by this reply
          let replyStart = turn.tStart;   // story time this reply's cost is counted from
          let aiP = this._startAI(msgs, k, T - vt, round, turn);
          const tG = Math.min(T, vt + step * share);
          await show.grannySpeak(grannyText, { from: vt, to: tG, turn: k });
          this._check();
          vt = tG;

          for (;;) {
            show.thinkingStart(k);
            let resp;
            try { resp = await aiP; } finally { show.thinkingEnd(); }
            this._check();
            const reply = this._recordReply(turn, resp, round);
            msgs.push({ role: 'assistant', content: reply.ai.trim() ? reply.ai : '(no output)' });

            // Tool calls in this reply
            const recorded = o.replay ? this._replayReply(k, round) || {} : null;
            const calls = o.replay ? (recorded.toolCalls || []) : this.toolsOn ? Tools.parse(reply.ai, sc) : [];
            if (calls.length) reply.toolCalls = calls.map((c) => ({ name: c.name, args: c.args || '', line: c.line, known: o.replay ? !!c.known : !!c.tool }));
            const typedNow = Tools.typedText(reply.ai, calls);
            typed.push(typedNow);
            this.events.emit('ai', turn, reply, resp.logId);   // logId: the exchange in GB.AI.log

            const cost = (round === 0 ? step : toolSec * toolUses) + (tax * reply.ai.length) / 100;
            const tLand = replyStart + cost;
            reply.tLand = turn.tLand = tLand;
            const inTime = tLand <= T + 1e-6;

            // Judge. A reply that only calls tools types nothing new, so the last verdict stands.
            let v;
            const toolOnly = calls.length > 0 && !typedNow.trim();
            if (toolOnly) {
              v = recorded && recorded.verdict ? recorded.verdict
                : lastVerdict ? Object.assign({}, lastVerdict, { reused: true, judgeMs: 0 })
                  : { category: 'other', success: false, reason: 'Only tool calls; nothing typed yet.', source: 'tools' };
            } else {
              show.verifying(resp);
              v = await this.judge(resp, typed, k, round);
              this._check();
            }
            // What the terminal says about the typed text (a recorded tool stop keeps the text's own verdict).
            const textVerdict = v.category === 'tool' && v.textVerdict ? { category: v.textVerdict, success: false, reason: '' } : v;

            // Run the tools (only if the reply arrived in time).
            let results = [];
            if (calls.length && inTime) {
              results = o.replay ? (recorded.toolResults || []) : Tools.execute(calls, toolState, this.vars(tLand, T, k), sc);
              if (results.length) reply.toolResults = results;
            }
            const stopper = results.find((r) => r.stopsTrain);
            if (!v.success && stopper) v = { category: 'tool', success: true, reason: stopper.name + ' stopped the train.', source: 'tool', textVerdict: v.category };
            reply.verdict = turn.verdict = v;
            lastVerdict = v;
            this.events.emit('verdict', turn, reply);
            if (!toolOnly) await show.verdict(textVerdict);
            this._check();

            if (v.success && inTime) {
              rec.outcome = 'saved';
              rec.savedTurn = k;
              rec.savedTime = tLand;
              if (v.category === 'tool') rec.savedBy = 'tool:' + stopper.name;
              this.events.emit('outcome', rec);
              if (v.category === 'tool') {
                await show.robotSpeak(resp, { from: vt, to: tLand, calls });
                this._check();
                this.events.emit('tool', turn, reply);
                await show.toolResults(results, { from: tLand, to: tLand, stop: true });
              } else {
                await show.robotSpeak(resp, { from: vt, to: tLand, accepted: true, calls });
              }
              this._check();
              await show.success(rec);
              break turnLoop;
            }
            if (tLand >= T - 1e-6) {
              const cutoff = tLand > T + 1e-6 ? (T - vt) / Math.max(0.001, tLand - vt) : null;
              rec.outcome = 'lost';
              if (v.success) rec.tooLate = true;
              this.events.emit('outcome', rec);
              await show.robotSpeak(resp, { from: vt, to: T, cutoffFraction: cutoff, calls });
              this._check();
              vt = T;
              await show.fail(rec, { cutoff: cutoff != null });
              break turnLoop;
            }

            const more = results.length > 0 && (o.replay ? !!this._replayReply(k, round + 1) : round < MAX_TOOL_ROUNDS);
            if (rec.granny.mode === 'ai' && !more) { grannyNext = this.grannyLine(k + 1, tLand, T); grannyNext.catch(() => {}); }
            await show.robotSpeak(resp, { from: vt, to: tLand, calls });
            this._check();
            vt = tLand;
            if (!results.length) break;   // on to Grandma's next plea

            this.events.emit('tool', turn, reply);
            const resultText = Tools.formatResults(results);
            if (!more) {
              // Safety limit reached for this turn: the results go out with the next message.
              carry = resultText;
              reply.toolResultsDeferred = true;
              await show.toolResults(results, { from: vt, to: vt });
              this._check();
              break;
            }
            round++;
            toolUses = results.length;
            const st = this.statusLine(k, vt, T);
            reply.toolMessage = o.replay ? (recorded.toolMessage || resultText) : resultText + (st ? '\n\n' + st : '');
            msgs.push({ role: 'user', content: reply.toolMessage });
            aiP = this._startAI(msgs, k, T - vt, round, turn);
            const tR = Math.min(T, vt + toolSec * toolUses * share);
            await show.toolResults(results, { from: vt, to: tR });
            this._check();
            vt = tR;
            replyStart = tLand;
          }
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
        if (this.aborted && rec.outcome !== 'error') rec.outcome = 'aborted';
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
