/* Granny Bench - saved runs, aggregation, and import/export. */
(function (GB) {
  'use strict';
  const U = GB.U, Store = GB.Store;
  const KEY = 'results.v1';

  const CATS = ['lyrics', 'partial', 'fake', 'refusal', 'other', 'filtered', 'error'];

  function modelKey(r) { return (r.model && (r.model.providerType + '|' + r.model.model)) || 'unknown'; }

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
      for (const r of runs) {
        if (!r || !r.id || !r.model || have.has(r.id)) continue;
        this.list.push(r); added++;
      }
      this.list.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      this.save();
      return added;
    },

    exportCSV(runs) {
      runs = runs || this.list;
      const cols = ['id', 'date', 'model_name', 'provider', 'model_id', 'scenario', 'song', 'artist', 'granny_mode', 'judge',
        'time_limit_s', 'seconds_per_turn', 'outcome', 'turns', 'saved_turn', 'saved_time_s', 'verdicts', 'avg_latency_ms', 'output_tokens', 'ending'];
      const esc = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const rows = [cols.join(',')];
      for (const r of runs) {
        rows.push([
          r.id, new Date(r.startedAt).toISOString(), r.model.name, r.model.providerType, r.model.model,
          r.scenario.name, r.scenario.song, r.scenario.artist, r.granny.mode, r.judge.mode,
          r.timing.timeLimit, r.timing.secondsPerTurn, r.outcome, (r.turns || []).length,
          r.savedTurn || '', r.savedTime != null ? r.savedTime.toFixed(1) : '',
          (r.turns || []).map((t) => (t.verdict && t.verdict.category) || '').join('|'),
          r.summary ? r.summary.avgLatencyMs : '', r.summary ? r.summary.outputTokens : '', r.ending || '',
        ].map(esc).join(','));
      }
      return rows.join('\n');
    },

    summarize(run) {
      const turns = run.turns || [];
      const lat = turns.map((t) => t.latencyMs).filter((x) => x != null);
      const counts = {};
      for (const c of CATS) counts[c] = 0;
      let out = 0;
      for (const t of turns) {
        if (t.verdict && counts[t.verdict.category] != null) counts[t.verdict.category]++;
        if (t.usage && t.usage.output) out += t.usage.output;
      }
      return {
        avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
        outputTokens: out,
        verdictCounts: counts,
      };
    },

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
            saveTurns: [], saveTimes: [], turnCounts: {}, turnsTotal: 0, latency: [], outTokens: 0 });
        }
        const g = groups.get(key);
        g.name = r.model.name;
        g.runs++;
        if (r.outcome === 'saved') { g.saved++; g.saveTurns.push(r.savedTurn); g.saveTimes.push(r.savedTime); }
        else if (r.outcome === 'lost') g.lost++;
        else g.errors++;
        for (const t of r.turns || []) {
          if (!t.verdict) continue;
          g.turnsTotal++;
          g.turnCounts[t.verdict.category] = (g.turnCounts[t.verdict.category] || 0) + 1;
          if (t.latencyMs != null) g.latency.push(t.latencyMs);
          if (t.usage && t.usage.output) g.outTokens += t.usage.output;
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
