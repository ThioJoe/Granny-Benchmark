/* Granny Bench - Scenarios page: songs, prompts, Grandma's script, and reference lyrics. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h, F = GB.Forms, S = GB.Settings, P = GB.Prompts;

  const ScenariosUI = {
    root: null,
    selectedId: null,

    init(root) { this.root = root; },

    render() {
      const r = this.root;
      U.clear(r);
      if (!this.selectedId || !S.scenario(this.selectedId)) this.selectedId = S.data.activeScenarioId;
      const list = h('div.sc-list');
      for (const sc of S.data.scenarios) {
        list.appendChild(h('button.sc-item' + (sc.id === this.selectedId ? '.active' : ''), { onclick: () => { this.selectedId = sc.id; this.render(); } },
          h('b', sc.name), h('span', '"' + sc.song + '" · ' + sc.artist), (sc.referenceLyrics || '').trim() ? h('span.badge.ok', 'reference lyrics') : null));
      }
      const side = h('div.sc-side', h('div.btn-row',
        h('button.primary.small', { onclick: () => this._new() }, '+ New'),
        h('button.small', { onclick: async () => {
          const f = await U.pickFile('.json,application/json');
          if (!f) return;
          try {
            const obj = U.parseJsonLoose(f.text);
            const arr = Array.isArray(obj) ? obj : obj && obj.scenarios ? obj.scenarios : obj ? [obj] : [];
            let n = 0;
            for (const sc of arr) { if (sc && sc.song) { S.data.scenarios.push(Object.assign(P.defaultScenarios()[0], sc, { id: U.uid('sc'), builtin: false })); n++; } }
            F.saveNow(); this.render(); GB.App.refreshArena();
            U.toast('Imported ' + n + ' scenario(s)', 'ok');
          } catch (e) { GB.Modal.alert('Import failed', e.message); }
        } }, 'Import')), list);
      const sc = S.scenario(this.selectedId);
      r.appendChild(h('div.page-layout.sc-layout', side, h('div.page-content', h('h1.page-title', 'Scenarios'), sc ? this._editor(sc) : h('p', 'No scenario selected.'))));
    },

    _new() {
      const base = P.defaultScenarios()[0];
      const sc = Object.assign(base, { id: U.uid('sc'), name: 'New scenario', song: 'Song title', artist: 'Artist', notes: '', builtin: false });
      S.data.scenarios.push(sc);
      this.selectedId = sc.id;
      F.saveNow(); this.render(); GB.App.refreshArena();
    },

    _editor(sc) {
      const refresh = () => { GB.App.refreshArena(); if (sc.id === S.data.activeScenarioId && GB.App.world && !GB.App.running) GB.App.world.setScenario(sc); preview(); };
      const previewBox = h('pre.preview');
      const preview = () => {
        const T = S.timing(sc);
        const vars = { song: sc.song, artist: sc.artist, time_left: T.timeLimit, time_limit: T.timeLimit, elapsed: 0, turn: 1, max_turns: Math.ceil(T.timeLimit / T.secondsPerTurn - 1e-9), seconds_per_turn: T.secondsPerTurn, model: 'Model' };
        const line = U.fill((sc.grannyLines && sc.grannyLines[0]) || '', vars);
        const first = [(sc.briefing || '').trim() ? U.fill(sc.briefing, vars) : null, U.fill(sc.grannyLineFormat || P.GRANNY_LINE_FORMAT, Object.assign({}, vars, { line }))].filter(Boolean).join('\n\n');
        previewBox.textContent = (sc.systemPrompt ? '[system]\n' + U.fill(sc.systemPrompt, vars) + '\n\n' : '[system] (none: the model’s default)\n\n') + '[user, turn 1]\n' + first;
      };
      const refStats = h('span.field-hint');
      const syncRef = () => {
        const words = U.wordCount(sc.referenceLyrics || '');
        refStats.textContent = words ? words + ' words. Stored only in this browser and never sent anywhere (it is not included in exported results).' : 'Optional. Paste the real lyrics here to enable exact matching. They stay in this browser.';
      };
      syncRef();
      const vars = h('p.muted.small', 'Placeholders: {song} {artist} {time_left} {time_limit} {elapsed} {turn} {max_turns} {seconds_per_turn} {model}; in the Grandma line format also {line}.');
      const el = h('div.sc-editor',
        h('div.btn-row',
          h('button.primary', { onclick: () => { S.data.activeScenarioId = sc.id; F.saveNow(); refresh(); GB.App.setTab('arena'); } }, 'Use in Arena'),
          h('button', { onclick: () => {
            const copy = Object.assign(U.deepClone(sc), { id: U.uid('sc'), name: sc.name + ' (copy)', builtin: false });
            S.data.scenarios.push(copy); this.selectedId = copy.id; F.saveNow(); this.render(); GB.App.refreshArena();
          } }, 'Duplicate'),
          h('button', { onclick: () => {
            const out = Object.assign({}, sc); delete out.referenceLyrics;
            U.download('scenario-' + (sc.song || 'song').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.json', JSON.stringify(out, null, 2));
          } }, 'Export'),
          sc.builtin ? h('button', { onclick: async () => {
            const def = P.defaultScenarios().find((x) => x.id === sc.id);
            if (!def || !(await GB.Modal.confirm('Restore defaults?', 'Restore this built-in scenario’s prompts and lines? Your reference lyrics are kept.', 'Restore'))) return;
            const keepRef = sc.referenceLyrics;
            Object.assign(sc, def, { referenceLyrics: keepRef || def.referenceLyrics });
            F.saveNow(); this.render(); refresh();
          } }, 'Restore defaults') : null,
          h('button.danger', { onclick: async () => {
            if (S.data.scenarios.length <= 1) { U.toast('Keep at least one scenario', 'warn'); return; }
            if (!(await GB.Modal.confirm('Delete scenario?', 'Delete "' + sc.name + '"?', 'Delete', true))) return;
            S.data.scenarios = S.data.scenarios.filter((x) => x !== sc);
            if (S.data.activeScenarioId === sc.id) S.data.activeScenarioId = S.data.scenarios[0].id;
            this.selectedId = null; F.saveNow(); this.render(); GB.App.refreshArena();
          } }, 'Delete')),
        sc.notes ? h('p.note', sc.notes) : null,
        h('h3', 'The song'),
        h('div.form-grid',
          F.field('Scenario name', F.text(sc, 'name', { onChange: refresh })),
          F.field('Song title', F.text(sc, 'song', { onChange: refresh })),
          F.field('Artist', F.text(sc, 'artist', { onChange: refresh })),
          F.field('Time limit override (s)', F.number(sc, 'timeLimit', { min: 5, step: 1, allowEmpty: true, placeholder: 'default', onChange: preview })),
          F.field('Seconds per turn override', F.number(sc, 'secondsPerTurn', { min: 1, step: 1, allowEmpty: true, placeholder: 'default', onChange: preview }))),
        F.field('Reference lyrics (optional, local only)', F.textarea(sc, 'referenceLyrics', { rows: 6, onChange: syncRef, placeholder: 'Paste the lyrics to enable exact matching. Not included in this project for copyright reasons.' }), refStats, { wide: true }),
        h('h3', 'What the AI under test sees'),
        F.field('System prompt (empty = the model’s default behavior)', F.textarea(sc, 'systemPrompt', { rows: 3, onChange: preview, placeholder: 'e.g. You are a helpful assistant.' }), null, { wide: true }),
        F.field('Situation briefing (start of the first message)', F.textarea(sc, 'briefing', { rows: 6, onChange: preview, spellcheck: true }), null, { wide: true }),
        h('div.form-grid',
          F.check(sc, 'includeStatusLine', 'Start later messages with a status line', { onChange: preview }),
          F.field('Status line', F.text(sc, 'statusLine', { onChange: preview })),
          F.field('Grandma line format', F.text(sc, 'grannyLineFormat', { onChange: preview }))),
        vars,
        h('h3', 'Grandma’s script'),
        F.field('Pleas, in order (one per line; after the last one they repeat from line 2)', F.textarea(sc, 'grannyLines', { rows: 9, lines: true, onChange: preview, spellcheck: true }), null, { wide: true }),
        F.field('Final words (cut off by the train; one per line, one is picked at random)', F.textarea(sc, 'finalWords', { rows: 4, lines: true, spellcheck: true }), null, { wide: true }),
        F.field('If she is saved (one per line, one is picked at random)', F.textarea(sc, 'successLines', { rows: 3, lines: true, spellcheck: true }), null, { wide: true }),
        F.field('AI Grandma persona (system prompt for the Grandma model)', F.textarea(sc, 'grannyPersona', { rows: 7, spellcheck: true }), null, { wide: true }),
        h('h3', 'Preview of the first request'),
        previewBox);
      preview();
      return el;
    },
  };

  GB.ScenariosUI = ScenariosUI;
})(window.GB = window.GB || {});
