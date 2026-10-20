/* Granny Bench - scenario editor (inside the configuration window): songs, prompts, Grandma's script,
   virtual tools, rule overrides, reference lyrics, and benchmark export/import. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h, F = GB.Forms, S = GB.Settings, P = GB.Prompts, Tools = GB.Tools;

  const slug = (s) => String(s || 'scenario').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'scenario';

  const ScenariosUI = {
    root: null,
    selectedId: null,

    init() {},

    // Re-render whatever is showing (after imports, deletes, ...).
    refresh() { if (this.root && this.root.isConnected) this.render(this.root); },

    render(root, opts) {
      if (root) this.root = root;
      const r = this.root;
      if (!r) return;
      if (opts && opts.scenarioId) this.selectedId = opts.scenarioId;
      if (!this.selectedId || !S.scenario(this.selectedId)) this.selectedId = S.data.activeScenarioId;
      U.clear(r);
      const sc = S.scenario(this.selectedId);
      const pick = h('select.input.sc-pick', ...S.data.scenarios.map((x) => h('option', { value: x.id, selected: x.id === this.selectedId },
        x.name + (Tools.active(x) ? '  ⚙' : '') + (x.id === S.data.activeScenarioId ? '  (in Arena)' : ''))));
      pick.addEventListener('change', () => { this.selectedId = pick.value; this.render(); });
      r.appendChild(h('div.sc-top',
        h('div.sc-pick-row', h('span.field-label', 'Scenario'), pick,
          h('button.primary.small', { onclick: () => this._new() }, '+ New'),
          h('button.small', { onclick: () => this._duplicate(sc) }, 'Duplicate'),
          h('button.small.danger', { onclick: () => this._delete(sc) }, 'Delete')),
        h('div.sc-pick-row',
          h('button.small', { onclick: () => this._import() }, '⭳ Import benchmark…'),
          h('button.small', { onclick: () => this._exportDialog() }, '⭱ Export benchmark…'),
          sc && sc.builtin && P.defaultScenarios().some((x) => x.id === sc.id) ? h('button.small', { onclick: () => this._restore(sc) }, 'Restore defaults') : null,
          h('span.spacer'),
          sc ? h('button.small' + (sc.id === S.data.activeScenarioId ? '' : '.primary'), { onclick: () => {
            S.data.activeScenarioId = sc.id; F.saveNow();
            if (GB.App.world && !GB.App.running) { GB.App.world.setScenario(sc); GB.App.world.setClock(S.timing(sc).timeLimit); GB.HUD.idle(); }
            GB.ConfigUI.close(); GB.App.setTab('arena');
          } }, sc.id === S.data.activeScenarioId ? 'In the Arena ✓' : 'Use in Arena') : null)));
      r.appendChild(sc ? this._editor(sc) : h('p', 'No scenario selected.'));
    },

    _new() {
      const sc = Object.assign(P.defaultScenarios()[0], { id: U.uid('sc'), name: 'New scenario', song: 'Song title', artist: 'Artist', notes: '', builtin: false });
      S.data.scenarios.push(sc);
      this.selectedId = sc.id;
      F.saveNow(); this.render(); GB.App.refreshArena();
    },

    _duplicate(sc) {
      if (!sc) return;
      const copy = Object.assign(U.deepClone(sc), { id: U.uid('sc'), name: sc.name + ' (copy)', builtin: false });
      copy.tools = (copy.tools || []).map((t) => Object.assign(t, { id: U.uid('tool') }));
      S.data.scenarios.push(copy);
      this.selectedId = copy.id;
      F.saveNow(); this.render(); GB.App.refreshArena();
    },

    async _delete(sc) {
      if (!sc) return;
      if (S.data.scenarios.length <= 1) { U.toast('Keep at least one scenario', 'warn'); return; }
      if (!(await GB.Modal.confirm('Delete scenario?', 'Delete "' + sc.name + '"?', 'Delete', true))) return;
      S.data.scenarios = S.data.scenarios.filter((x) => x !== sc);
      if (S.data.activeScenarioId === sc.id) S.data.activeScenarioId = S.data.scenarios[0].id;
      this.selectedId = null;
      F.saveNow(); this.render(); GB.App.refreshArena();
    },

    async _restore(sc) {
      const def = P.defaultScenarios().find((x) => x.id === sc.id);
      if (!def || !(await GB.Modal.confirm('Restore defaults?', 'Restore this built-in scenario’s prompts, lines, tools, and rules? Your reference lyrics are kept.', 'Restore'))) return;
      const keepRef = sc.referenceLyrics;
      for (const k of Object.keys(sc)) delete sc[k];
      Object.assign(sc, def, { referenceLyrics: keepRef || def.referenceLyrics });
      F.saveNow(); this.render(); GB.App.refreshArena();
    },

    async _import() {
      const f = await U.pickFile('.json,application/json');
      if (!f) return;
      try {
        const added = S.importBenchmark(f.text);
        this.selectedId = added[0].id;
        this.render(); GB.App.refreshArena();
        U.toast('Imported ' + added.length + ' scenario' + (added.length === 1 ? '' : 's') + ': ' + U.truncate(added.map((x) => x.name).join(', '), 120), 'ok', 5000);
      } catch (e) { GB.Modal.alert('Import failed', e.message); }
    },

    _exportDialog() {
      const chosen = new Set([this.selectedId]);
      const list = h('div.check-list', ...S.data.scenarios.map((x) => {
        const cb = h('input', { type: 'checkbox', checked: chosen.has(x.id) });
        cb.addEventListener('change', () => { if (cb.checked) chosen.add(x.id); else chosen.delete(x.id); });
        return h('label.check', cb, h('span', x.name), Tools.active(x) ? h('span.badge.run', 'tools') : null);
      }));
      const inclRef = h('input', { type: 'checkbox' });
      const body = h('div',
        h('p', 'A benchmark file holds the scenarios’ prompts, Grandma’s lines, virtual tools, and timing rules, so someone else can import it and run the same test. It never contains API keys, model settings, or other app settings.'),
        list,
        h('label.check', inclRef, h('span', 'Include reference lyrics')),
        h('p.muted.small', 'Reference lyrics are left out by default because they are usually copyrighted text. Only include them if you have the right to share them. (The public-domain control song is always included.)'));
      GB.Modal.open({
        title: 'Export benchmark', body,
        buttons: [
          { label: 'Cancel', value: false },
          { label: 'Download', cls: 'primary', onClick: () => {
            const ids = S.data.scenarios.filter((x) => chosen.has(x.id)).map((x) => x.id);
            if (!ids.length) { U.toast('Pick at least one scenario', 'warn'); return false; }
            const name = ids.length === 1 ? slug(S.scenario(ids[0]).name) : ids.length + '-scenarios';
            U.download('granny-bench-' + name + '.json', S.exportBenchmark(ids, { includeReference: inclRef.checked }));
            return true;
          } },
        ],
      });
    },

    // ---------------------------------------------------------------------------
    _editor(sc) {
      const refreshArena = () => {
        GB.App.refreshArena();
        if (sc.id === S.data.activeScenarioId && GB.App.world && !GB.App.running) { GB.App.world.setScenario(sc); GB.App.world.setClock(S.timing(sc).timeLimit); }
      };
      const changed = () => { refreshArena(); preview(); };

      // ---- preview of what the AI receives ----
      const previewBox = h('pre.preview');
      const preview = () => {
        const T = S.timing(sc);
        const vars = { song: sc.song, artist: sc.artist, time_left: T.timeLimit, time_limit: T.timeLimit, elapsed: 0, turn: 1, max_turns: Math.ceil(T.timeLimit / T.secondsPerTurn - 1e-9), seconds_per_turn: T.secondsPerTurn, model: 'Model' };
        const line = U.fill((sc.grannyLines && sc.grannyLines[0]) || '', vars);
        const first = [(sc.briefing || '').trim() ? U.fill(sc.briefing, vars) : null, U.fill(sc.grannyLineFormat || P.GRANNY_LINE_FORMAT, Object.assign({}, vars, { line }))].filter(Boolean).join('\n\n');
        const system = Tools.systemPrompt(sc, vars);
        previewBox.textContent = (system ? '[system]\n' + system + '\n\n' : '[system] (none: the model’s default)\n\n') + '[user, turn 1]\n' + first;
      };

      // ---- reference lyrics ----
      const refStats = h('span.field-hint');
      const syncRef = () => {
        const words = U.wordCount(sc.referenceLyrics || '');
        refStats.textContent = words ? words + ' words. Stored only in this browser. Left out of exports unless you choose to include them.' : 'Optional. Paste the real lyrics to enable exact matching. They stay in this browser.';
      };
      syncRef();

      // ---- rules (overrides) ----
      const rulesInfo = h('span.field-hint');
      const syncRules = () => {
        const t = S.timing(sc);
        rulesInfo.textContent = 'In effect: ' + t.timeLimit + ' s, ' + t.secondsPerTurn + ' s per turn (' + Math.ceil(t.timeLimit / t.secondsPerTurn - 1e-9) + ' replies)' +
          (t.verbosityTax ? ', tax ' + t.verbosityTax + ' s/100 chars' : '') + (Tools.active(sc) ? ', ' + t.toolUseSeconds + ' s per tool use' : '') + '. Empty fields use Benchmark rules.';
      };
      const ruleChanged = () => { syncRules(); changed(); };
      syncRules();
      const a = S.data.app;

      const group = (title, open, ...children) => h('details.cfg-group', { open: open || null }, h('summary', title), h('div.cfg-group-body', ...children));
      const vars = h('p.muted.small', 'Placeholders: {song} {artist} {time_left} {time_limit} {elapsed} {turn} {max_turns} {seconds_per_turn} {model}. In the Grandma line format also {line}. In the system prompt, {tools} places the tool list.');

      const el = h('div.sc-editor',
        sc.notes ? h('p.note', sc.notes) : null,
        group('The song', true,
          h('div.form-grid',
            F.field('Scenario name', F.text(sc, 'name', { onChange: refreshArena })),
            F.field('Song title', F.text(sc, 'song', { onChange: changed })),
            F.field('Artist', F.text(sc, 'artist', { onChange: changed }))),
          F.field('Reference lyrics (optional, local only)', F.textarea(sc, 'referenceLyrics', { rows: 5, onChange: syncRef, placeholder: 'Paste the lyrics to enable exact matching. Not included in this project for copyright reasons.' }), refStats, { wide: true })),
        group('What the AI under test sees', true,
          F.field('System prompt (empty = the model’s default behavior)', F.textarea(sc, 'systemPrompt', { rows: 4, onChange: changed, placeholder: 'e.g. You are a helpful assistant.' }), null, { wide: true }),
          F.field('Situation briefing (start of the first message)', F.textarea(sc, 'briefing', { rows: 6, onChange: changed, spellcheck: true }), null, { wide: true }),
          h('div.form-grid',
            F.check(sc, 'includeStatusLine', 'Start later messages with a status line', { onChange: changed }),
            F.field('Status line', F.text(sc, 'statusLine', { onChange: changed })),
            F.field('Grandma line format', F.text(sc, 'grannyLineFormat', { onChange: changed }))),
          vars),
        this._toolsGroup(sc, group, () => { syncRules(); changed(); }),
        group('Grandma’s script', false,
          F.field('Pleas, in order (one per line; after the last one they repeat from line 2)', F.textarea(sc, 'grannyLines', { rows: 9, lines: true, onChange: changed, spellcheck: true }), null, { wide: true }),
          F.field('Final words (cut off by the train; one per line, one is picked at random)', F.textarea(sc, 'finalWords', { rows: 4, lines: true, spellcheck: true }), null, { wide: true }),
          F.field('If she is saved (one per line, one is picked at random)', F.textarea(sc, 'successLines', { rows: 3, lines: true, spellcheck: true }), null, { wide: true }),
          F.field('AI Grandma persona (system prompt for the Grandma model)', F.textarea(sc, 'grannyPersona', { rows: 7, spellcheck: true }), null, { wide: true })),
        group('Rules for this scenario', false,
          h('div.form-grid',
            F.field('Time limit (s)', F.number(sc, 'timeLimit', { min: 5, step: 1, allowEmpty: true, placeholder: String(a.timeLimit), onChange: ruleChanged })),
            F.field('Seconds per turn', F.number(sc, 'secondsPerTurn', { min: 1, step: 1, allowEmpty: true, placeholder: String(a.secondsPerTurn), onChange: ruleChanged })),
            F.field('Verbosity tax (s per 100 chars)', F.number(sc, 'verbosityTax', { min: 0, step: 0.1, allowEmpty: true, placeholder: String(a.verbosityTax), onChange: ruleChanged })),
            F.field('Seconds cost per tool use', F.number(sc, 'toolUseSeconds', { min: 0, step: 0.5, allowEmpty: true, placeholder: String(a.toolUseSeconds), onChange: ruleChanged }))),
          rulesInfo),
        group('Judge and sign', false,
          F.field('What the brake needs (told to the AI judge)', F.text(sc, 'judgeTarget'), 'Change this when the test is about something other than song lyrics, e.g. “the opening paragraph of the novel {song} by {artist}”.', { wide: true }),
          h('div.form-grid',
            F.field('Sign, line above the title', F.text(sc, 'signLine1', { onChange: refreshArena })),
            F.field('Sign, line below the artist', F.text(sc, 'signLine2', { onChange: refreshArena })))),
        h('h3', 'Preview of the first request'),
        previewBox);
      preview();
      return el;
    },

    // ---- virtual tools ----
    _toolsGroup(sc, group, changed) {
      if (!Array.isArray(sc.tools)) sc.tools = [];
      const list = h('div.tool-list');
      const renderList = () => {
        U.clear(list);
        if (!sc.tools.length) list.appendChild(h('p.muted', 'No tools yet.'));
        sc.tools.forEach((t, i) => list.appendChild(this._toolCard(sc, t, i, () => { renderList(); changed(); }, changed)));
      };
      renderList();
      const body = h('div',
        h('p.muted', 'Virtual tools do not do anything real. When the AI writes a line like “ACTION: TOOL_NAME”, the tool’s response text is sent back to it right away. ' +
          'Use them to test what an AI does when an action, not just text, is involved. Each tool use costs story time (see Rules for this scenario).'),
        h('div.form-grid',
          F.check(sc, 'toolsEnabled', 'Tools on for this scenario', { onChange: changed }),
          F.field('Keyword', F.text(sc, 'toolKeyword', { placeholder: 'ACTION', onChange: changed }), 'The AI starts a line with this, a colon, and the tool name.')),
        F.field('Text before the tool list (in the system prompt)', F.textarea(sc, 'toolsIntro', { rows: 6, onChange: changed }), '{keyword} and {example} are filled in. The list of tools follows it.', { wide: true }),
        list,
        h('div.btn-row',
          h('button.small.primary', { onclick: () => { sc.tools.push(Tools.blank()); F.save(); renderList(); changed(); } }, '+ Add tool'),
          h('button.small', { onclick: async () => {
            if (!(await GB.Modal.confirm('Reset tools?', 'Replace this scenario’s tools and tool text with the three default tools?', 'Reset'))) return;
            sc.tools = P.defaultTools(); sc.toolsIntro = P.TOOLS_INTRO; sc.toolKeyword = 'ACTION';
            F.saveNow(); this.render();
          } }, 'Reset to default tools')));
      return group('Virtual tools' + (Tools.active(sc) ? ' (on)' : ''), !!sc.toolsEnabled, body);
    },

    _toolCard(sc, t, i, relist, changed) {
      const nameInput = F.text(t, 'name', { placeholder: 'TOOL_NAME', onChange: changed });
      nameInput.addEventListener('blur', () => { const n = Tools.norm(t.name); if (n && n !== t.name) { t.name = n; nameInput.value = n; F.save(); changed(); } });
      const move = (d) => {
        const j = i + d;
        if (j < 0 || j >= sc.tools.length) return;
        sc.tools.splice(j, 0, sc.tools.splice(i, 1)[0]);
        F.save(); relist();
      };
      return h('div.subcard.tool-card' + (t.enabled ? '' : '.off'),
        h('div.subcard-head',
          F.check(t, 'enabled', 'Enabled', { onChange: () => { F.save(); relist(); } }),
          h('span.tool-name', nameInput),
          h('span.spacer'),
          h('button.small.ghost', { title: 'Move up', disabled: i === 0, onclick: () => move(-1) }, '↑'),
          h('button.small.ghost', { title: 'Move down', disabled: i === sc.tools.length - 1, onclick: () => move(1) }, '↓'),
          h('button.small.danger', { onclick: async () => {
            if (!(await GB.Modal.confirm('Delete tool?', 'Delete the tool "' + t.name + '"?', 'Delete', true))) return;
            sc.tools.splice(sc.tools.indexOf(t), 1); F.save(); relist();
          } }, 'Delete')),
        h('div.form-grid',
          F.check(t, 'listInPrompt', 'List it in the system prompt', { onChange: changed }),
          F.check(t, 'oncePerRun', 'Works only once per run'),
          F.check(t, 'stopsTrain', 'Using it stops the train (saves Grandma)'),
          F.field('Effect in the 3D scene', F.select(t, 'effect', Tools.EFFECTS, { onChange: () => GB.App.refreshArena() }))),
        F.field('Description (shown to the AI in the tool list)', F.textarea(t, 'description', { rows: 2, onChange: changed, spellcheck: true }), null, { wide: true }),
        F.field('Response (sent back to the AI when it uses the tool)', F.textarea(t, 'response', { rows: 3, spellcheck: true }),
          'Placeholders: {song} {artist} {time_left} {args} (anything the AI wrote after the tool name).', { wide: true }));
    },
  };

  GB.ScenariosUI = ScenariosUI;
})(window.GB = window.GB || {});
