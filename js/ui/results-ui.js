/* Granny Bench - Results (leaderboard, matrix, run list) and Benchmark (batch runner) pages. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h, S = GB.Settings, R = GB.Results, P = GB.Prompts;

  function verdictIcons(run) {
    return h('span.v-icons', ...(run.turns || []).map((t) => {
      const info = P.VERDICTS[t.verdict ? t.verdict.category : 'error'] || P.VERDICTS.other;
      return h('span.v-icon.' + info.cls, { title: 'Turn ' + t.n + ': ' + info.short }, info.icon);
    }));
  }

  // ---- transcript pieces (shared with the live transcript in the Arena) ----
  function verdictEl(v) {
    const info = P.VERDICTS[v.category] || P.VERDICTS.other;
    return h('div.t-verdict.' + info.cls, h('b', info.icon + ' ' + (v.success && v.category !== 'tool' ? 'LYRICS ACCEPTED' : info.label)), v.reason ? h('span', ' — ' + v.reason) : null,
      h('span.t-src', ' [' + (v.source || '') + (v.judgeMs > 200 ? ', ' + U.fmtMs(v.judgeMs) : '') + ']'));
  }
  function toolChips(calls) {
    if (!calls || !calls.length) return null;
    return h('div.t-tools', ...calls.map((c) => h('span.tool-chip' + (c.known === false ? '.unknown' : ''), { title: c.known === false ? 'Not an available tool' : 'Tool call' },
      '⚙ ' + c.name + (c.args ? ' ' + U.truncate(c.args, 60) : ''))));
  }
  function toolResultEl(r) {
    return h('div.t-msg.tool', h('span.who', '⚙ Tool result' + (r.toolResultsDeferred ? ' (sent with the next message)' : '')),
      h('div.t-text', GB.Tools.formatResults(r.toolResults)));
  }
  // A judged reply worth showing a verdict for (tool-only replies just repeat the last verdict).
  const showsVerdict = (v) => v && !v.reused && v.source !== 'tools';

  function turnElements(run) {
    return (run.turns || []).map((t) => {
      const parts = [
        h('div.t-turn-label', 'Turn ' + t.n + ' · ' + Math.round(t.tStart || 0) + 's'),
        h('div.t-msg.granny', h('span.who', '👵 Grandma'), h('div.t-text', t.granny || ''), h('details.t-prompt', h('summary', 'Full prompt sent'), h('pre', t.prompt || ''))),
      ];
      R.repliesOf(t).forEach((r, i) => {
        const meta = [];
        if (r.latencyMs != null) meta.push(U.fmtMs(r.latencyMs));
        if (r.usage && r.usage.output != null) meta.push(r.usage.output + ' tok');
        if (r.finishReason) meta.push(String(r.finishReason));
        if (r.blocked && r.ai) meta.push('⛔ cut off by the provider: ' + (r.blockDetail || r.blockKind));
        parts.push(h('div.t-msg.robot', h('span.who', '🤖 ' + run.model.name + (i ? ' · after tool result' : '')),
          h('div.t-text', r.ai || (r.blocked ? '[output blocked: ' + (r.blockDetail || r.blockKind || '') + ']' : '(empty)')),
          toolChips(r.toolCalls), meta.length ? h('div.t-meta', meta.join(' · ')) : null));
        if (showsVerdict(r.verdict)) parts.push(verdictEl(r.verdict));
        if (r.toolResults && r.toolResults.length) parts.push(toolResultEl(r));
      });
      return h('div.t-turn', ...parts);
    });
  }

  function outcomeBadge(o) {
    const map = { saved: ['ok', 'Saved'], lost: ['bad', 'Not saved'], error: ['warn', 'Error'], aborted: ['', 'Stopped'] };
    const [cls, label] = map[o] || ['', o];
    return h('span.badge' + (cls ? '.' + cls : ''), label);
  }

  const ResultsUI = {
    root: null,
    filter: { scenarioId: '', grannyMode: '' },
    selected: new Set(),

    init(root) {
      this.root = root;
      R.events.on('change', () => { if (!root.classList.contains('hidden')) this.render(); });
    },

    render() {
      const r = this.root;
      U.clear(r);
      const runs = R.list;
      const scOpts = [['', 'All scenarios']].concat(Array.from(new Map(runs.map((x) => [x.scenario.id, x.scenario.name])).entries()));
      const fSc = h('select.input', ...scOpts.map(([v, l]) => h('option', { value: v, selected: v === this.filter.scenarioId }, l)));
      fSc.addEventListener('change', () => { this.filter.scenarioId = fSc.value; this.render(); });
      const fG = h('select.input', ...[['', 'Any Grandma'], ['script', 'Scripted Grandma'], ['ai', 'AI Grandma']].map(([v, l]) => h('option', { value: v, selected: v === this.filter.grannyMode }, l)));
      fG.addEventListener('change', () => { this.filter.grannyMode = fG.value; this.render(); });

      const toolbar = h('div.btn-row',
        h('button', { onclick: () => U.download('granny-bench-results.json', R.exportJSON()) }, 'Export JSON'),
        h('button', { onclick: () => U.download('granny-bench-results.csv', R.exportCSV(), 'text/csv') }, 'Export CSV'),
        h('button', { onclick: async () => {
          const f = await U.pickFile('.json,application/json');
          if (!f) return;
          try { const n = R.importJSON(f.text); U.toast('Imported ' + n + ' run(s)', 'ok'); } catch (e) { GB.Modal.alert('Import failed', e.message); }
        } }, 'Import JSON'),
        h('span.spacer'),
        h('button.danger', { disabled: !this.selected.size, onclick: async () => {
          if (!(await GB.Modal.confirm('Delete runs?', 'Delete ' + this.selected.size + ' selected run(s)?', 'Delete', true))) return;
          R.remove(Array.from(this.selected)); this.selected.clear();
        } }, 'Delete selected'));

      const content = h('div.page-content.wide',
        h('h1.page-title', 'Results'),
        runs.length ? null : h('div.empty', h('p', 'No runs yet.'), h('p.muted', 'Start a run in the Arena, or queue many in the Benchmark tab. The Simulated AIs work without any API keys.')),
        runs.length ? h('div.btn-row', fSc, fG) : null,
        runs.length ? this._leaderboard() : null,
        runs.length ? this._matrix() : null,
        runs.length ? h('section.card', h('h2', 'All runs (' + runs.length + ')'), toolbar, this._runTable(runs)) : toolbar);
      r.appendChild(content);
    },

    _leaderboard() {
      const rows = R.leaderboard(this.filter);
      const anyTools = rows.some((g) => g.toolUseRate);
      const table = h('table.table',
        h('thead', h('tr', ...['#', 'Model', 'Runs', 'Grandma survival', 'Avg turn saved', 'Avg time saved', 'Refusal turns', 'Fake', 'Partial', 'Filtered'].concat(anyTools ? ['Used tools'] : [], ['Avg reply time', 'Errors']).map((x) => h('th', x)))),
        h('tbody', ...rows.map((g, i) => h('tr',
          h('td', String(i + 1)),
          h('td', h('b', g.name), h('div.muted.small', g.provider + ' · ' + g.model)),
          h('td', String(g.runs)),
          h('td', h('div.bar', h('div.bar-fill', { style: { width: Math.round((g.survival || 0) * 100) + '%' } }), h('span', g.survival == null ? '-' : U.fmtPct(g.survival) + ' (' + g.saved + '/' + (g.saved + g.lost) + ')'))),
          h('td', g.avgSaveTurn == null ? '-' : g.avgSaveTurn.toFixed(1)),
          h('td', g.avgSaveTime == null ? '-' : g.avgSaveTime.toFixed(1) + ' s'),
          h('td', U.fmtPct(g.refusalRate)), h('td', U.fmtPct(g.fakeRate)), h('td', U.fmtPct(g.partialRate)), h('td', U.fmtPct(g.filteredRate)),
          anyTools ? h('td', { title: 'Share of runs where the AI called a virtual tool' + (g.toolSaves ? '; ' + g.toolSaves + ' saved by a tool' : '') }, U.fmtPct(g.toolUseRate)) : null,
          h('td', U.fmtMs(g.avgLatencyMs)),
          h('td', String(g.errors))))));
      return h('section.card', h('h2', 'Leaderboard'), h('p.card-intro', 'Grandma survival = runs where the AI typed the lyrics in time (or used a tool that stops the train), out of finished runs. Turn rates count every turn’s final verdict. Each row is one model with one set of request settings.'), h('div.table-wrap', table));
    },

    _matrix() {
      const m = R.matrix();
      if (m.models.length < 1 || m.scenarios.length < 2) return null;
      const table = h('table.table.matrix',
        h('thead', h('tr', h('th', 'Model'), ...m.scenarios.map(([, name]) => h('th', name)))),
        h('tbody', ...m.models.map(([mk, name]) => h('tr', h('td', h('b', name)), ...m.scenarios.map(([sk]) => {
          const c = m.cell(mk, sk);
          if (!c) return h('td.muted', '-');
          const rate = c.saved / c.total;
          return h('td.cell', { style: { background: 'rgba(' + Math.round(220 - rate * 160) + ',' + Math.round(70 + rate * 140) + ',90,0.35)' } }, U.fmtPct(rate) + ' (' + c.total + ')');
        })))));
      return h('section.card', h('h2', 'Survival by scenario'), h('div.table-wrap', table));
    },

    _runTable(runs) {
      const all = h('input', { type: 'checkbox', checked: runs.length > 0 && this.selected.size === runs.length });
      all.addEventListener('change', () => { this.selected = new Set(all.checked ? runs.map((x) => x.id) : []); this.render(); });
      const rows = runs.slice(0, 500).map((run) => {
        const cb = h('input', { type: 'checkbox', checked: this.selected.has(run.id) });
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => { if (cb.checked) this.selected.add(run.id); else this.selected.delete(run.id); this.render(); });
        return h('tr.clickable', { onclick: () => this.details(run) },
          h('td', cb), h('td', U.fmtDate(run.startedAt)), h('td', h('b', run.model.name)), h('td', run.scenario.name),
          h('td', outcomeBadge(run.outcome), run.savedBy ? h('span.badge.run', { title: 'Saved by a tool' }, '⚙') : null), h('td', String((run.turns || []).length)), h('td', verdictIcons(run)),
          h('td', run.granny.mode), h('td', run.judge.mode), h('td', run.summary ? U.fmtMs(run.summary.avgLatencyMs) : '-'));
      });
      return h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', all), ...['Date', 'Model', 'Scenario', 'Outcome', 'Turns', 'Verdicts', 'Grandma', 'Judge', 'Avg reply'].map((x) => h('th', x)))), h('tbody', ...rows)),
        runs.length > 500 ? h('p.muted.small', 'Showing the newest 500 runs. Export to see all.') : null);
    },

    details(run) {
      const turns = turnElements(run);
      const sys = run.systemPrompt != null ? run.systemPrompt : run.scenario.systemPrompt;
      const tools = run.scenario.toolsEnabled && Array.isArray(run.scenario.tools) ? run.scenario.tools : [];
      const meta = h('div.details-meta',
        h('div', h('b', 'Outcome: '), outcomeBadge(run.outcome), run.savedTurn ? ' on turn ' + run.savedTurn + ' at ' + Number(run.savedTime).toFixed(1) + ' s' : '',
          run.savedBy ? ' by a tool (' + run.savedBy.replace(/^tool:/, '') + ')' : '', run.tooLate ? ' (lyrics arrived too late)' : '', run.ending ? ' · ending: ' + run.ending : ''),
        h('div', h('b', 'Model: '), run.model.name + ' · ' + run.model.providerType + ' · ' + run.model.model + (run.model.effort ? ' · effort ' + run.model.effort : '') + (run.model.temperature != null && run.model.temperature !== '' ? ' · temp ' + run.model.temperature : '')),
        h('div', h('b', 'Scenario: '), run.scenario.name + ' · "' + run.scenario.song + '" by ' + run.scenario.artist),
        h('div', h('b', 'Rules: '), run.timing.timeLimit + ' s, ' + run.timing.secondsPerTurn + ' s/turn' + (run.timing.verbosityTax ? ', tax ' + run.timing.verbosityTax + ' s/100 chars' : '') + ' · Grandma: ' + run.granny.mode + (run.granny.model ? ' (' + run.granny.model + ')' : '') + ' · Judge: ' + run.judge.mode + (run.judge.model ? ' (' + run.judge.model + ')' : '')),
        tools.length ? h('div', h('b', 'Tools: '), tools.map((t) => GB.Tools.norm(t.name)).join(', ') + ' · ' + (run.summary && run.summary.toolCalls ? run.summary.toolCalls + ' call(s)' : 'not used')) : null,
        run.error ? h('div.form-error', run.error) : null,
        sys ? h('details', h('summary', 'System prompt'), h('pre', sys)) : null);
      GB.Modal.open({
        title: 'Run ' + U.fmtDate(run.startedAt), wide: true,
        body: h('div', meta, h('div.transcript.static', ...turns)),
        buttons: [
          { label: 'Delete', cls: 'danger', onClick: async () => { if (await GB.Modal.confirm('Delete run?', 'Delete this run?', 'Delete', true)) { R.remove([run.id]); return true; } return false; } },
          { label: 'Copy transcript', onClick: () => { const t = GB.App.transcriptText(run); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => U.toast('Copied', 'ok'), () => U.download('transcript.txt', t, 'text/plain')); return false; } },
          (run.outcome === 'saved' || run.outcome === 'lost') ? { label: 'Replay in 3D', cls: 'primary', onClick: () => { GB.App.replay(run); return true; } } : null,
          { label: 'Close', value: true },
        ],
      });
    },
  };

  // ---------------------------------------------------------------------------
  const BenchmarkUI = {
    root: null,
    sel: { models: new Set(), scenarios: new Set(), reps: 1, mode: 'fast', grannyMode: '', judgeMode: '' },

    init(root) {
      this.root = root;
      GB.Batch.events.on('progress', () => this._progress());
      GB.Batch.events.on('start', () => this.render());
      GB.Batch.events.on('done', () => { this.render(); U.toast('Benchmark finished', 'ok'); });
    },

    render() {
      const r = this.root;
      U.clear(r);
      const s = this.sel;
      if (!s.scenarios.size) s.scenarios.add(S.data.activeScenarioId);
      const running = GB.Batch.running;
      for (const id of Array.from(s.models)) if (!S.modelListed(S.model(id))) s.models.delete(id);
      const modelList = h('div.check-list', ...S.data.models.filter((m) => S.modelListed(m)).map((m) => {
        const ready = S.modelReady(m.id);
        const cb = h('input', { type: 'checkbox', checked: s.models.has(m.id), disabled: running });
        cb.addEventListener('change', () => { if (cb.checked) s.models.add(m.id); else s.models.delete(m.id); this._estimate(); });
        return h('label.check' + (ready ? '' : '.dim'), cb, h('span', m.name), ready ? null : h('span.badge.warn', 'needs key'));
      }));
      const scList = h('div.check-list', ...S.data.scenarios.map((sc) => {
        const cb = h('input', { type: 'checkbox', checked: s.scenarios.has(sc.id), disabled: running });
        cb.addEventListener('change', () => { if (cb.checked) s.scenarios.add(sc.id); else s.scenarios.delete(sc.id); this._estimate(); });
        return h('label.check', cb, h('span', sc.name));
      }));
      const reps = h('input.input.num', { type: 'number', min: 1, max: 100, value: s.reps, disabled: running });
      reps.addEventListener('input', () => { s.reps = Math.max(1, Math.min(100, Number(reps.value) || 1)); this._estimate(); });
      const mode = h('select.input', { disabled: running }, ...[['full', 'Full show (3D + voices)'], ['fast', 'Fast show (3D, quick, no voices)'], ['headless', 'Headless (no animation)']].map(([v, l]) => h('option', { value: v, selected: s.mode === v }, l)));
      mode.addEventListener('change', () => { s.mode = mode.value; });
      const gm = h('select.input', { disabled: running }, ...[['', 'Use default (' + S.data.app.grannyMode + ')'], ['script', 'Scripted'], ['ai', 'AI Grandma']].map(([v, l]) => h('option', { value: v, selected: s.grannyMode === v }, l)));
      gm.addEventListener('change', () => { s.grannyMode = gm.value; });
      const jm = h('select.input', { disabled: running }, ...[['', 'Use default (' + S.data.app.judgeMode + ')'], ['auto', 'Auto'], ['reference', 'Reference lyrics'], ['ai', 'AI judge'], ['manual', 'Manual']].map(([v, l]) => h('option', { value: v, selected: s.judgeMode === v }, l)));
      jm.addEventListener('change', () => { s.judgeMode = jm.value; this._estimate(); });
      this.estimateBox = h('div.estimate');
      this.progressBox = h('div');
      const start = h('button.primary.big', { disabled: running, onclick: () => this._start() }, '▶ Run benchmark');
      const stop = h('button.danger.big', { disabled: !running, onclick: () => GB.Batch.stop() }, '■ Stop');
      r.appendChild(h('div.page-content.wide',
        h('h1.page-title', 'Benchmark'),
        h('p.card-intro', 'Queue every selected model against every selected scenario, as many times as you like. Runs go one at a time and are saved to Results as they finish.'),
        h('div.bench-grid',
          h('section.card', h('h2', 'Contestants'), h('div.btn-row', h('button.small', { onclick: () => { S.data.models.forEach((m) => { if (S.modelUsable(m.id)) s.models.add(m.id); }); this.render(); } }, 'Select all ready'), h('button.small', { onclick: () => { s.models.clear(); this.render(); } }, 'Clear')), modelList),
          h('section.card', h('h2', 'Scenarios'), scList),
          h('section.card', h('h2', 'Options'),
            GB.Forms.field('Repetitions', reps),
            GB.Forms.field('Presentation', mode, 'Headless is fastest. The show modes play every run in the Arena.'),
            GB.Forms.field('Grandma', gm),
            GB.Forms.field('Judge', jm),
            this.estimateBox,
            h('div.btn-row', start, stop))),
        this.progressBox));
      this._estimate();
      this._progress();
    },

    _estimate() {
      if (!this.estimateBox) return;
      const s = this.sel;
      const runs = s.models.size * s.scenarios.size * s.reps;
      let maxTurns = 0;
      for (const id of s.scenarios) { const t = S.timing(S.scenario(id)); maxTurns = Math.max(maxTurns, Math.ceil(t.timeLimit / t.secondsPerTurn - 1e-9)); }
      const notReady = Array.from(s.models).filter((id) => !S.modelReady(id)).map((id) => (S.model(id) || {}).name);
      const jmode = s.judgeMode || S.data.app.judgeMode;
      const manual = Array.from(s.scenarios).some((id) => { const r = GB.Judge.resolveMode(jmode, S.scenario(id)); return r === 'manual' || (r === 'ai-or-manual' && !S.data.app.judgeModelId); });
      U.clear(this.estimateBox);
      U.append(this.estimateBox, [
        h('div', h('b', String(runs)), ' runs, up to ', h('b', String(runs * maxTurns)), ' requests to the models under test.'),
        notReady.length ? h('div.warning', 'Missing keys: ' + notReady.join(', ') + '. Those runs will fail.') : null,
        manual ? h('div.warning', 'Some runs have no reference lyrics and no AI judge, so you will be asked to judge replies by hand.') : null,
      ]);
    },

    async _start() {
      const s = this.sel;
      if (!s.models.size || !s.scenarios.size) { U.toast('Pick at least one model and one scenario', 'warn'); return; }
      if (GB.App.running) { U.toast('A run is already in progress', 'warn'); return; }
      GB.SFX.ensure();
      try {
        await GB.Batch.start({
          modelIds: Array.from(s.models), scenarioIds: Array.from(s.scenarios), reps: s.reps, mode: s.mode,
          grannyMode: s.grannyMode || null, judgeMode: s.judgeMode || null,
        });
      } catch (e) { GB.Modal.alert('Benchmark failed', e.message); }
    },

    _progress() {
      const box = this.progressBox;
      if (!box) return;
      U.clear(box);
      const items = GB.Batch.items;
      if (!items.length) return;
      const done = items.filter((x) => x.status !== 'pending' && x.status !== 'running').length;
      const saved = items.filter((x) => x.status === 'saved').length;
      const lost = items.filter((x) => x.status === 'lost').length;
      box.appendChild(h('section.card',
        h('h2', 'Progress: ' + done + ' / ' + items.length + (GB.Batch.running ? '' : ' (finished)')),
        h('div.progress', h('div.progress-fill', { style: { width: (items.length ? (done / items.length) * 100 : 0) + '%' } })),
        h('p', 'Saved: ' + saved + ' · Not saved: ' + lost + ' · Other: ' + (done - saved - lost)),
        h('div.table-wrap', h('table.table', h('thead', h('tr', ...['#', 'Model', 'Scenario', 'Rep', 'Status', 'Turns', 'Time'].map((x) => h('th', x)))),
          h('tbody', ...items.map((it, i) => h('tr' + (it.status === 'running' ? '.running-row' : ''),
            h('td', String(i + 1)), h('td', (S.model(it.modelId) || {}).name || '?'), h('td', (S.scenario(it.scenarioId) || {}).name || '?'), h('td', String(it.rep)),
            h('td', it.status === 'running' ? h('span.badge.run', 'running') : it.status === 'pending' ? h('span.muted', 'queued') : outcomeBadge(it.status), it.error ? h('div.small.form-error', U.truncate(it.error, 120)) : null),
            h('td', it.turns == null ? '' : String(it.turns)), h('td', it.ms == null ? '' : U.fmtMs(it.ms)))))))));
    },
  };

  ResultsUI.verdictEl = verdictEl;
  ResultsUI.toolChips = toolChips;
  ResultsUI.toolResultEl = toolResultEl;
  ResultsUI.showsVerdict = showsVerdict;
  ResultsUI.turnElements = turnElements;
  GB.ResultsUI = ResultsUI;
  GB.BenchmarkUI = BenchmarkUI;
})(window.GB = window.GB || {});
