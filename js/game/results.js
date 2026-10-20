/* Granny Bench - saved runs, aggregation, and import/export. */
(function (GB) {
  'use strict';
  const U = GB.U, Store = GB.Store;
  const KEY = 'results.v1';

  const CATS = ['lyrics', 'partial', 'fake', 'refusal', 'other', 'filtered', 'tool', 'error'];

  // A turn's replies (runs from before virtual tools existed have one reply, stored on the turn).
  const repliesOf = (t) => (Array.isArray(t.replies) && t.replies.length ? t.replies : [t]);
  const toolCallsOf = (run) => (run.turns || []).reduce((n, t) => n + repliesOf(t).reduce((m, r) => m + ((r.toolCalls && r.toolCalls.length) || 0), 0), 0);

  // One leaderboard row per contestant: same provider, model ID, and request settings.
  function modelKey(r) {
    const m = r.model;
    if (!m) return 'unknown';
    return [m.providerId || m.providerType, m.model, m.effort || '', m.temperature == null ? '' : m.temperature, (m.extraBody || '').trim()].join('|');
  }

  // Make an imported run safe to display (older or hand-edited files may miss fields).
  function normalizeRun(r) {
    if (!r || typeof r !== 'object' || !r.id || !r.model || typeof r.model !== 'object') return null;
    const run = Object.assign({}, r);
    run.model = Object.assign({ name: String(r.model.model || 'unknown'), providerType: 'unknown', model: '' }, r.model);
    run.scenario = Object.assign({ id: 'unknown', name: 'Unknown scenario', song: '', artist: '' }, r.scenario && typeof r.scenario === 'object' ? r.scenario : {});
    run.granny = Object.assign({ mode: 'script' }, r.granny && typeof r.granny === 'object' ? r.granny : {});
    run.judge = Object.assign({ mode: 'unknown' }, r.judge && typeof r.judge === 'object' ? r.judge : {});
    run.timing = Object.assign({ timeLimit: 60, secondsPerTurn: 10, verbosityTax: 0 }, r.timing && typeof r.timing === 'object' ? r.timing : {});
    run.turns = Array.isArray(r.turns) ? r.turns.filter((t) => t && typeof t === 'object') : [];
    const t = Number(r.startedAt);
    run.startedAt = isFinite(t) && !isNaN(new Date(t).getTime()) ? t : 0;
    if (!['saved', 'lost', 'error', 'aborted'].includes(run.outcome)) run.outcome = 'error';
    if (run.savedTime != null && !isFinite(Number(run.savedTime))) run.savedTime = null;
    return run;
  }

  const Results = {
    list: [],
    events: new U.Emitter(),

    load() { this.list = Store.get(KEY, []) || []; return this.list; },
    save() { Store.set(KEY, this.list); this.events.emit('change'); },
    add(run) { this.list.unshift(run); this.save(); },
    get(id) { return this.list.find((r) => r.id === id) || null; },
    remove(ids) { const set = new Set(ids); this.list = this.list.filter((r) => !set.has(r.id)); this.save(); },
    clear() { this.list = []; this.save(); },

    exportJSON(runs) {
      return JSON.stringify({ format: 'granny-bench-results', version: 1, exportedAt: new Date().toISOString(), runs: runs || this.list }, null, 2);
    },

    importJSON(text) {
      const obj = U.parseJsonLoose(text);
      const runs = obj && (Array.isArray(obj) ? obj : obj.runs);
      if (!Array.isArray(runs)) throw new Error('No runs found in that file.');
      const have = new Set(this.list.map((r) => r.id));
      let added = 0;
      for (const raw of runs) {
        const r = normalizeRun(raw);
        if (!r || have.has(r.id)) continue;
        have.add(r.id);
        this.list.push(r); added++;
      }
      this.list.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      this.save();
      return added;
    },

    exportCSV(runs) {
      runs = runs || this.list;
      const cols = ['id', 'date', 'model_name', 'provider', 'model_id', 'effort', 'scenario', 'song', 'artist', 'granny_mode', 'judge',
        'time_limit_s', 'seconds_per_turn', 'outcome', 'saved_by', 'turns', 'replies', 'tool_calls', 'saved_turn', 'saved_time_s', 'verdicts',
        'avg_latency_ms', 'output_tokens', 'ending'];
      const esc = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const rows = [cols.join(',')];
      for (const r of runs) {
        rows.push([
          r.id, r.startedAt ? new Date(r.startedAt).toISOString() : '', r.model.name, r.model.providerType, r.model.model, r.model.effort || '',
          r.scenario.name, r.scenario.song, r.scenario.artist, r.granny.mode, r.judge.mode,
          r.timing.timeLimit, r.timing.secondsPerTurn, r.outcome, r.outcome === 'saved' ? (r.savedBy || 'lyrics') : '', (r.turns || []).length,
          (r.turns || []).reduce((n, t) => n + repliesOf(t).length, 0), toolCallsOf(r),
          r.savedTurn || '', r.savedTime != null ? Number(r.savedTime).toFixed(1) : '',
          (r.turns || []).map((t) => (t.verdict && t.verdict.category) || '').join('|'),
          r.summary ? r.summary.avgLatencyMs : '', r.summary ? r.summary.outputTokens : '', r.ending || '',
        ].map(esc).join(','));
      }
      return rows.join('\n');
    },

    summarize(run) {
      const turns = run.turns || [];
      const lat = [];
      const counts = {};
      for (const c of CATS) counts[c] = 0;
      let out = 0, replies = 0;
      for (const t of turns) {
        if (t.verdict && counts[t.verdict.category] != null) counts[t.verdict.category]++;
        for (const r of repliesOf(t)) {
          replies++;
          if (r.latencyMs != null) lat.push(r.latencyMs);
          if (r.usage && r.usage.output) out += r.usage.output;
        }
      }
      return {
        avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
        outputTokens: out,
        verdictCounts: counts,
        replies,
        toolCalls: toolCallsOf(run),
      };
    },
    repliesOf,

    // Aggregate per model (optionally filtered to a scenario).
    leaderboard(filter) {
      filter = filter || {};
      const groups = new Map();
      for (const r of this.list) {
        if (filter.scenarioId && r.scenario.id !== filter.scenarioId) continue;
        if (filter.grannyMode && r.granny.mode !== filter.grannyMode) continue;
        if (r.replay) continue;
        const key = modelKey(r);
        if (!groups.has(key)) {
          groups.set(key, { key, name: r.model.name, model: r.model.model, provider: r.model.providerType, runs: 0, saved: 0, lost: 0, errors: 0,
            saveTurns: [], saveTimes: [], turnCounts: {}, turnsTotal: 0, latency: [], outTokens: 0, toolRuns: 0, toolSaves: 0 });
        }
        const g = groups.get(key);
        g.runs++;
        if (r.outcome === 'saved') { g.saved++; g.saveTurns.push(r.savedTurn); g.saveTimes.push(r.savedTime); if (r.savedBy) g.toolSaves++; }
        else if (r.outcome === 'lost') g.lost++;
        else g.errors++;
        if (toolCallsOf(r)) g.toolRuns++;
        for (const t of r.turns || []) {
          if (!t.verdict) continue;
          g.turnsTotal++;
          g.turnCounts[t.verdict.category] = (g.turnCounts[t.verdict.category] || 0) + 1;
          for (const rp of repliesOf(t)) {
            if (rp.latencyMs != null) g.latency.push(rp.latencyMs);
            if (rp.usage && rp.usage.output) g.outTokens += rp.usage.output;
          }
        }
      }
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const rows = Array.from(groups.values()).map((g) => {
        const decided = g.saved + g.lost;
        const rate = (c) => (g.turnsTotal ? (g.turnCounts[c] || 0) / g.turnsTotal : null);
        return {
          key: g.key, name: g.name, model: g.model, provider: g.provider,
          runs: g.runs, saved: g.saved, lost: g.lost, errors: g.errors,
          survival: decided ? g.saved / decided : null,
          avgSaveTurn: avg(g.saveTurns), avgSaveTime: avg(g.saveTimes),
          refusalRate: rate('refusal'), fakeRate: rate('fake'), partialRate: rate('partial'), filteredRate: rate('filtered'),
          avgLatencyMs: avg(g.latency), outTokens: g.outTokens,
          toolUseRate: g.runs ? g.toolRuns / g.runs : null, toolSaves: g.toolSaves,
        };
      });
      rows.sort((a, b) => (b.survival == null ? -1 : b.survival) - (a.survival == null ? -1 : a.survival) || (a.avgSaveTime || 1e9) - (b.avgSaveTime || 1e9) || b.runs - a.runs);
      return rows;
    },

    // models x scenarios survival matrix
    matrix() {
      const models = new Map(), scenarios = new Map(), cells = new Map();
      for (const r of this.list) {
        if (r.replay || (r.outcome !== 'saved' && r.outcome !== 'lost')) continue;
        const mk = modelKey(r), sk = r.scenario.id;
        models.set(mk, r.model.name);
        scenarios.set(sk, r.scenario.name);
        const k = mk + '##' + sk;
        const c = cells.get(k) || { saved: 0, total: 0 };
        c.total++; if (r.outcome === 'saved') c.saved++;
        cells.set(k, c);
      }
      return { models: Array.from(models.entries()), scenarios: Array.from(scenarios.entries()), cell: (mk, sk) => cells.get(mk + '##' + sk) || null };
    },
  };

  GB.Results = Results;
})(window.GB = window.GB || {});
