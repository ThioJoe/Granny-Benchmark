/* Granny Bench - scenario editor (inside the configuration window): the required text, prompts, Grandma's
   script, virtual tools, rule overrides, reference text, the sign, and benchmark export/import. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h, F = GB.Forms, S = GB.Settings, P = GB.Prompts, Tools = GB.Tools;
  const vars = (el) => GB.VarsUI.mark(el);   // a text field that takes {placeholders}

  const slug = (s) => String(s || 'scenario').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'scenario';

  const ScenariosUI = {
    root: null,
    selectedId: null,
    toolOpen: new Map(),   // tool id -> expanded, when changed by hand (this session only)

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
          sc ? GB.VarsUI.button(() => sc) : null,
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
      const sc = Object.assign({ id: U.uid('sc'), name: 'New scenario' }, P.scenarioDefaults(), { builtin: false });
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
      if (!def || !(await GB.Modal.confirm('Restore defaults?', 'Restore this built-in scenario’s prompts, lines, tools, and rules? Your reference text is kept.', 'Restore'))) return;
      const keepRef = sc.referenceText;
      for (const k of Object.keys(sc)) delete sc[k];
      Object.assign(sc, def, { referenceText: keepRef || def.referenceText });
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
        h('div.export-group', h('div.export-label', 'Scenarios to export'), list),
        h('div.export-group', h('div.export-label', 'Options'),
          h('label.check', inclRef, h('span', 'Include reference text')),
          h('p.muted.small', 'Reference texts are left out by default because they are usually copyrighted. Only include them if you have the right to share them. (The public-domain control text is always included.)')));
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
        const v = S.previewVars(sc);
        const line = U.fill((sc.grannyLines && sc.grannyLines[0]) || '', v);
        const first = [(sc.briefing || '').trim() ? U.fill(sc.briefing, v) : null, U.fill(sc.grannyLineFormat || P.GRANNY_LINE_FORMAT, Object.assign({}, v, { line }))].filter(Boolean).join('\n\n');
        const system = Tools.systemPrompt(sc, v);
        previewBox.textContent = (system ? '[system]\n' + system + '\n\n' : '[system] (none: the model’s default)\n\n') + '[user, turn 1]\n' + first;
      };

      // ---- reference text ----
      const refStats = h('span.field-hint');
      const syncRef = () => {
        const words = U.wordCount(sc.referenceText || '');
        refStats.textContent = words ? words + ' words. Stored only in this browser. Left out of exports unless you choose to include them.' : 'Optional. Paste the real text to enable exact matching. It stays in this browser.';
      };
      syncRef();

      // ---- rules (overrides) ----
      const rulesInfo = h('span');
      const syncRules = () => {
        const t = S.timing(sc);
        U.clear(rulesInfo);
        U.append(rulesInfo, ['In effect: ' + t.timeLimit + ' s ÷ ' + t.secondsPerTurn + ' s per turn = ', h('b', Math.ceil(t.timeLimit / t.secondsPerTurn - 1e-9) + ' replies'),
          (t.verbosityTax ? ', tax ' + t.verbosityTax + ' s/100 chars' : '') + (Tools.active(sc) ? ', ' + t.toolUseSeconds + ' s per tool use' : '') + '.']);
      };
      const ruleChanged = () => { syncRules(); changed(); };
      syncRules();
      const a = S.data.app;

      const group = (title, open, ...children) => h('details.cfg-group', { open: open || null }, h('summary', title), h('div.cfg-group-body', ...children));
      const listVars = (text) => h('p.muted.small', text + ' ', GB.VarsUI.button(() => sc, 'List all variables', 'linkish'));

      const el = h('div.sc-editor',
        sc.notes ? h('p.note', sc.notes) : null,
        group('Name and required text', true,
          F.field('Scenario name', F.text(sc, 'name', { onChange: refreshArena })),
          F.field('Description of required text for brake. (Told to AI Judge and reference with {required_text_description})', F.text(sc, 'requiredText', { onChange: changed, placeholder: 'e.g. the first chapter of "Title" by Author' }),
            'Write it to fit a sentence like “you must type ___”, e.g. the real, published lyrics of "Baby" by Justin Bieber.', { wide: true }),
          F.field('Reference text to match (optional, local only)', F.textarea(sc, 'referenceText', { rows: 5, onChange: syncRef, placeholder: 'Paste the real text to enable exact matching. Copyrighted text is not included in this project.' }), refStats, { wide: true }),
          F.field('Reference match needed', F.range(sc, 'referenceThreshold', { min: 0.1, max: 1, step: 0.05, fmt: (x) => Math.round(x * 100) + '%', onChange: changed }),
            'Share of the reference text (4-word phrases) that must be typed. Prompts and tools can show it with {percent_match}.')),
        group('What the AI under test sees', true,
          F.field('System prompt (empty = the model’s default behavior)', vars(F.textarea(sc, 'systemPrompt', { rows: 4, onChange: changed, placeholder: 'e.g. You are a helpful assistant.' })), null, { wide: true }),
          F.field('Situation briefing (start of the first message)', vars(F.textarea(sc, 'briefing', { rows: 6, onChange: changed, spellcheck: true })), null, { wide: true }),
          h('div.form-grid',
            F.check(sc, 'includeStatusLine', 'Start later messages with a status line', { onChange: changed }),
            F.field('Status line', vars(F.text(sc, 'statusLine', { onChange: changed }))),
            F.field('Grandma line format', vars(F.text(sc, 'grannyLineFormat', { onChange: changed })))),
          listVars('Placeholders such as {required_text_description} or {time_left} are filled in for each message.')),
        this._toolsGroup(sc, group, () => { syncRules(); changed(); }),
        group('Grandma’s script', false,
          F.field('Pleas, in order (one per line; after the last one they repeat from line 2)', vars(F.textarea(sc, 'grannyLines', { rows: 9, lines: true, onChange: changed, spellcheck: true })), null, { wide: true }),
          F.field('If she is saved (one per line, one is picked at random)', vars(F.textarea(sc, 'successLines', { rows: 3, lines: true, spellcheck: true })), null, { wide: true }),
          F.field('AI Grandma persona (system prompt for the Grandma model)', vars(F.textarea(sc, 'grannyPersona', { rows: 7, spellcheck: true })), null, { wide: true }),
          listVars('Her lines and persona can use placeholders too.')),
        group('Rules for this scenario (If different from benchmark rules)', false,
          h('div.form-grid',
            F.field('Time limit (s)', F.number(sc, 'timeLimit', { min: 5, step: 1, allowEmpty: true, placeholder: String(a.timeLimit), onChange: ruleChanged })),
            F.field('Seconds per turn', F.number(sc, 'secondsPerTurn', { min: 1, step: 1, allowEmpty: true, placeholder: String(a.secondsPerTurn), onChange: ruleChanged })),
            F.field('Verbosity tax (s per 100 chars)', F.number(sc, 'verbosityTax', { min: 0, step: 0.1, allowEmpty: true, placeholder: String(a.verbosityTax), onChange: ruleChanged })),
            F.field('Seconds cost per tool use', F.number(sc, 'toolUseSeconds', { min: 0, step: 0.5, allowEmpty: true, placeholder: String(a.toolUseSeconds), onChange: ruleChanged }))),
          F.calc(rulesInfo),
          h('p.muted.small', 'Empty fields use the defaults from Benchmark rules.')),
        group('Sign', false,
          h('p.muted.small', 'The sign next to the tracks, above the countdown.'),
          h('div.form-grid',
            F.field('Line above the title', F.text(sc, 'signLine1', { onChange: refreshArena }), null, { wide: true }),
            F.field('Title (large)', F.text(sc, 'signTitle', { onChange: refreshArena })),
            F.field('Line under the title', F.text(sc, 'signSubtitle', { onChange: refreshArena })),
            F.field('Bottom line', F.text(sc, 'signLine2', { onChange: refreshArena }), null, { wide: true }))),
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
        F.field('Text before the tool list (in the system prompt)', vars(F.textarea(sc, 'toolsIntro', { rows: 6, onChange: changed })), '{keyword} and {example} are filled in. The list of tools follows it.', { wide: true }),
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
      // Disabled tools start collapsed; a collapsed card shows only its first line.
      const key = t.id || 'i' + i;
      const isOpen = () => (this.toolOpen.has(key) ? this.toolOpen.get(key) : !!t.enabled);
      const toggle = h('button.small.ghost.tool-toggle', { type: 'button', onclick: () => { this.toolOpen.set(key, !isOpen()); sync(); } });
      const head = h('div.subcard-head',
        toggle,
        F.check(t, 'enabled', 'Enabled', { onChange: () => { this.toolOpen.delete(key); F.save(); relist(); } }),
        h('span.tool-name', nameInput),
        h('span.spacer'),
        h('button.small.ghost', { title: 'Move up', disabled: i === 0, onclick: () => move(-1) }, '↑'),
        h('button.small.ghost', { title: 'Move down', disabled: i === sc.tools.length - 1, onclick: () => move(1) }, '↓'),
        h('button.small.danger', { onclick: async () => {
          if (!(await GB.Modal.confirm('Delete tool?', 'Delete the tool "' + t.name + '"?', 'Delete', true))) return;
          sc.tools.splice(sc.tools.indexOf(t), 1); F.save(); relist();
        } }, 'Delete'));
      const card = h('div.subcard.tool-card' + (t.enabled ? '' : '.off'), head, h('div.tool-body',
        h('div.form-grid',
          F.check(t, 'listInPrompt', 'List it in the system prompt', { onChange: changed }),
          F.check(t, 'oncePerRun', 'Works only once per run'),
          F.check(t, 'stopsTrain', 'Using it stops the train (saves Grandma)'),
          F.field('Effect in the 3D scene', F.select(t, 'effect', Tools.EFFECTS, { onChange: () => GB.App.refreshArena() }))),
        F.field('Description (shown to the AI in the tool list)', vars(F.textarea(t, 'description', { rows: 2, onChange: changed, spellcheck: true })), null, { wide: true }),
        F.field('Response (sent back to the AI when it uses the tool)', vars(F.textarea(t, 'response', { rows: 3, spellcheck: true })),
          h('span', 'Placeholders work here, plus {args} (anything the AI wrote after the tool name) and {tool}. ', GB.VarsUI.button(() => sc, 'List all variables', 'linkish')), { wide: true })));
      const sync = () => {
        const open = isOpen();
        card.classList.toggle('collapsed', !open);
        toggle.textContent = open ? '▾' : '▸';
        toggle.title = open ? 'Collapse' : 'Expand';
        toggle.setAttribute('aria-expanded', String(open));
      };
      // Clicking the empty part of the header also opens or closes it.
      head.addEventListener('click', (e) => { if (e.target === head || e.target.classList.contains('spacer')) toggle.click(); });
      sync();
      return card;
    },
  };

  GB.ScenariosUI = ScenariosUI;
})(window.GB = window.GB || {});
