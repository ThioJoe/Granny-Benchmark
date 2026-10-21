/* Granny Bench - Settings page: keys & security, providers, model profiles, rules, voices, graphics. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h, F = GB.Forms, S = GB.Settings, V = GB.Vault;

  const COMPAT_PRESETS = [
    { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiStyle: 'chat' },
    { name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', apiStyle: 'chat' },
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiStyle: 'chat' },
    { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', apiStyle: 'chat' },
    { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiStyle: 'chat' },
    { name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', apiStyle: 'chat', keyOptional: true },
    { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', apiStyle: 'chat', keyOptional: true },
    { name: 'Custom endpoint', baseUrl: 'https://', apiStyle: 'chat' },
  ];

  const EFFORTS = {
    anthropic: [['', 'Default'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max']],
    openai: [['', 'Default'], ['none', 'none'], ['minimal', 'minimal'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max']],
    gemini: [['', 'Default'], ['minimal', 'minimal'], ['low', 'low'], ['medium', 'medium'], ['high', 'high']],
    'openai-compatible': [['', 'Default'], ['low', 'low'], ['medium', 'medium'], ['high', 'high']],
  };

  const SettingsUI = {
    fetched: {},   // providerId -> [model ids]
    root: null,
    section: 'keys',

    init() {
      GB.TTS.events.on('voices', () => { if (this.section === 'voices' && this._visible()) this._renderVoices(); });
      V.events.on('change', () => { if (this.section === 'keys' && this._visible()) this._renderKeys(); });
    },

    _visible() { return !!(this.root && this.root.isConnected); },

    // Render one section of the configuration window into root (or re-render the current one).
    renderSection(name, root) {
      if (root) this.root = root;
      if (name) this.section = name;
      const r = this.root;
      if (!r) return;
      U.clear(r);
      const sect = (title, intro, box) => h('section.cfg-section', h('h2', title), intro ? h('p.card-intro', intro) : null, box);
      switch (this.section) {
        case 'keys':
          this.keysBox = h('div');
          r.appendChild(sect('API keys & security', null, this.keysBox));
          this._renderKeys();
          break;
        case 'providers':
          this.providersBox = h('div');
          r.appendChild(sect('Providers', 'Built-in providers plus any OpenAI-compatible endpoint (OpenRouter, xAI, DeepSeek, local LM Studio or Ollama, ...).', this.providersBox));
          this._renderProviders();
          break;
        case 'models':
          this.modelsBox = h('div');
          r.appendChild(sect('Models', 'Each model profile is a contestant you can pick in the Arena or the Benchmark. Leave temperature empty: many current models reject custom sampling values. The scripted offline demos are under Simulated Demos.', this.modelsBox));
          this._renderModels();
          break;
        case 'sims':
          this.simsBox = h('div');
          r.appendChild(sect('Simulated Demos', 'Offline demo contestants with scripted responses; no AI is involved. They need no API key and follow a fixed script (refuse, give in at the last second, fake the text, use the virtual tools, ...), so you can watch the show and try scenarios without spending anything. While a demo runs, the 3D view always shows a “DEMO MODE (NO AI)” banner.', this.simsBox));
          this._renderSims();
          break;
        case 'rules':
          this.rulesBox = h('div');
          r.appendChild(sect('Benchmark rules', 'Defaults for every scenario. A scenario can override the clock rules in Scenarios & tools > Rules for this scenario.', this.rulesBox));
          this._renderRules();
          break;
        case 'voices':
          this.voicesBox = h('div');
          r.appendChild(sect('Voices & audio', 'Speech uses your browser’s built-in voices. The list depends on your operating system and browser.', this.voicesBox));
          this._renderVoices();
          break;
        case 'graphics':
          this.gfxBox = h('div');
          r.appendChild(sect('Graphics & camera', null, this.gfxBox));
          this._renderGraphics();
          break;
        case 'reset':
          r.appendChild(sect('Reset', null, this._renderReset()));
          break;
      }
    },

    render() { this.renderSection(); },

    // ---------------------------------------------------------------------------
    _renderKeys() {
      const box = this.keysBox;
      if (!box) return;
      U.clear(box);
      const st = V.status();
      const statusText = {
        unavailable: 'Encryption is not available in this browser context, so keys are kept in memory for this session only.',
        none: 'No encrypted key storage yet. Keys you enter now are kept in memory only and are forgotten when you close the page.',
        locked: 'Saved keys are locked.',
        unlocked: 'Saved keys are unlocked. They are encrypted at rest with AES-256-GCM, using a key derived from your passphrase (PBKDF2-SHA256, 600,000 iterations).',
      }[st];
      const actions = h('div.btn-row');
      if (st === 'none') {
        actions.appendChild(h('button.primary', { onclick: () => this._createVault() }, 'Set up encrypted key storage'));
      } else if (st === 'locked') {
        actions.appendChild(h('button.primary', { onclick: () => GB.App.unlockVault() }, 'Unlock'));
        actions.appendChild(h('button.danger', { onclick: () => this._deleteVault() }, 'Delete saved keys'));
      } else if (st === 'unlocked') {
        actions.appendChild(h('button', { onclick: () => { V.lock(); U.toast('Keys locked'); } }, 'Lock now'));
        actions.appendChild(h('button', { onclick: () => this._changePass() }, 'Change passphrase'));
        actions.appendChild(h('button.danger', { onclick: () => this._deleteVault() }, 'Delete saved keys'));
      }
      const session = Object.keys(V._sessionOnly).length;
      if (session && st === 'unlocked') actions.appendChild(h('button', { onclick: async () => { const n = await V.adoptSessionKeys(); U.toast('Saved ' + n + ' key(s) to encrypted storage', 'ok'); } }, 'Save ' + session + ' session key(s) to storage'));
      box.appendChild(h('div.vault-status.vault-' + st, h('b', { locked: '🔒 Locked', unlocked: '🔓 Unlocked', none: '⚠ Not set up', unavailable: '⚠ Unavailable' }[st]), h('span', ' ' + statusText)));
      box.appendChild(actions);
      if (st === 'unlocked' || st === 'locked') {
        box.appendChild(F.check(S.data.security, 'stayUnlockedInTab', 'Stay unlocked when this tab is reloaded', { onChange: () => { F.saveNow(); V._tabSync(); } }));
        box.appendChild(h('p.muted.small', 'The unlocked key is kept with this page in this tab’s history (history.state), where other websites and other local files can’t read it, and it can’t be exported. Closing the tab forgets it, and after 12 hours you are asked again. If your browser reopens tabs after a restart, a reopened tab can still be unlocked within those 12 hours.'));
      }

      // key inputs
      const grid = h('div.key-grid');
      for (const p of S.data.providers) {
        if (p.noKey) continue;
        const src = V.keySource(p.id);
        const sec = F.secret(V.getKey(p.id), p.keyHint || 'API key');
        const saveBtn = h('button', { onclick: async () => {
          if (st === 'locked') { U.toast('Unlock your saved keys first, or the key will only be kept for this session.', 'warn', 5000); }
          await V.setKey(p.id, sec.input.value, { memoryOnly: st !== 'unlocked' });
          U.toast(sec.input.value.trim() ? (st === 'unlocked' ? 'Key saved (encrypted)' : 'Key set for this session') : 'Key removed', 'ok');
          this._renderKeys();
        } }, 'Save');
        sec.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
        const badge = src === 'vault' ? h('span.badge.ok', 'encrypted') : src === 'session' ? h('span.badge.warn', 'this session only') : h('span.badge', 'not set');
        grid.appendChild(h('div.key-row', h('div.key-name', p.name, ' ', badge, p.keyUrl && /^https?:\/\//i.test(p.keyUrl) ? h('a.small', { href: p.keyUrl, target: '_blank', rel: 'noopener' }, ' get a key') : null), sec.el, saveBtn));
      }
      box.appendChild(grid);
      if (st !== 'unlocked') box.appendChild(h('p.muted.small', st === 'locked' ? 'Unlock to save keys permanently. Keys entered while locked are kept for this session only.' : 'Set up encrypted storage to remember keys between visits.'));

      // config file
      const inclKeys = h('input', { type: 'checkbox' });
      box.appendChild(h('h3', 'Config file'));
      box.appendChild(h('p.muted', 'Prefer a file? Download the template, fill in your keys, and import it whenever you open the app. Imported keys stay in memory (you can then save them into encrypted storage). Keep that file somewhere private.'));
      box.appendChild(h('div.btn-row',
        h('button', { onclick: async () => {
          const f = await U.pickFile('.json,application/json');
          if (!f) return;
          try {
            const r = S.importConfig(f.text);
            U.toast('Imported ' + (r.settings ? 'settings' : '') + (r.settings && r.keys ? ' and ' : '') + (r.keys ? r.keys + ' key(s)' : '') +
              (r.keptEndpoints ? '. Kept your own API endpoints for ' + r.keptEndpoints + ' provider(s); a file cannot change where your keys are sent.' : ''), 'ok', r.keptEndpoints ? 7000 : 3000);
            this.render(); GB.App.refreshArena();
          } catch (e) { GB.Modal.alert('Import failed', e.message); }
        } }, 'Import config file'),
        h('button', { onclick: () => U.download('granny-bench-config.template.json', S.template()) }, 'Download template'),
        h('button', { onclick: async () => {
          if (inclKeys.checked && !(await GB.Modal.confirm('Export with API keys?', 'The file will contain your API keys in plain text. Anyone with the file can use them.', 'Export with keys', true))) return;
          U.download('granny-bench-config.json', S.exportConfig(inclKeys.checked));
        } }, 'Export settings'),
        h('label.check', inclKeys, h('span', 'include API keys'))));
      const auto = F.check(S.data.security, 'autoLoadConfigFile', 'Auto-load config.local.js on startup (see README)');
      box.appendChild(auto);
      box.appendChild(h('p.muted.small', 'Why encryption: pages opened from local files can share one browser storage area, so a plain-text key could be read by any other local HTML file you open in the same browser. Your keys are only ever sent to the provider they belong to.'));
    },

    async _createVault() {
      const p1 = h('input.input', { type: 'password', placeholder: 'Passphrase', autocomplete: 'new-password' });
      const p2 = h('input.input', { type: 'password', placeholder: 'Repeat passphrase', autocomplete: 'new-password' });
      const err = h('div.form-error');
      await GB.Modal.open({
        title: 'Set up encrypted key storage',
        body: h('div', h('p', 'Choose a passphrase. You will enter it once per visit to unlock your keys. If you forget it, delete the saved keys and enter them again.'), p1, p2, err),
        buttons: [{ label: 'Cancel', value: false }, { label: 'Create', cls: 'primary', onClick: async () => {
          if (p1.value !== p2.value) { err.textContent = 'Passphrases do not match.'; return false; }
          try {
            err.textContent = 'Encrypting…';
            const session = Object.assign({}, V._sessionOnly);
            await V.create(p1.value);
            if (Object.keys(session).length) await V.adoptSessionKeys();
            U.toast('Encrypted key storage ready', 'ok');
            return true;
          } catch (e) { err.textContent = e.message; return false; }
        } }],
      }).promise;
      this._renderKeys();
    },

    async _changePass() {
      const p = await GB.Modal.prompt('Change passphrase', 'Enter a new passphrase.', { type: 'password', okLabel: 'Change' });
      if (!p) return;
      try { await V.changePassphrase(p); U.toast('Passphrase changed', 'ok'); } catch (e) { GB.Modal.alert('Could not change passphrase', e.message); }
    },

    async _deleteVault() {
      if (!(await GB.Modal.confirm('Delete saved keys?', 'This permanently removes all API keys saved in this browser.', 'Delete', true))) return;
      V.destroy();
      U.toast('Saved keys deleted');
    },

    // ---------------------------------------------------------------------------
    _renderProviders() {
      const box = this.providersBox;
      U.clear(box);
      for (const p of S.data.providers) {
        if (p.type === 'simulated') continue;
        const rows = [F.field('Name', F.text(p, 'name', { onChange: () => GB.App.refreshArena() }))];
        rows.push(F.field('Base URL', F.text(p, 'baseUrl'), p.builtin ? 'Leave as is unless you use a proxy.' : null, { wide: true }));
        if (p.type === 'openai') rows.push(F.field('API', F.select(p, 'apiStyle', [['responses', 'Responses API (recommended)'], ['chat', 'Chat Completions']])));
        if (p.type === 'openai-compatible') {
          rows.push(F.field('API', F.select(p, 'apiStyle', [['chat', 'Chat Completions'], ['responses', 'Responses API']])));
          rows.push(F.field('Max tokens parameter', F.select(p, 'maxTokensParam', [['max_tokens', 'max_tokens'], ['max_completion_tokens', 'max_completion_tokens']])));
          rows.push(F.check(p, 'keyOptional', 'No API key needed (local server)'));
          rows.push(F.check(p, 'streamUsage', 'Request token usage while streaming'));
        }
        rows.push(F.field('Extra headers (JSON)', F.text(p, 'extraHeaders', { placeholder: '{"HTTP-Referer": "..."}' }), null, { wide: true }));
        const card = h('div.subcard', h('div.subcard-head', h('b', p.name), h('span.badge', p.type), h('span.muted.small', 'ID: ' + p.id),
          !p.builtin ? h('button.danger.small', { onclick: async () => {
            if (!(await GB.Modal.confirm('Remove provider?', 'Remove "' + p.name + '"? Models using it stop working until you point them elsewhere.', 'Remove', true))) return;
            S.data.providers = S.data.providers.filter((x) => x !== p);
            await V.setKey(p.id, '', { memoryOnly: true });
            if (V.isUnlocked()) await V.setKey(p.id, '');
            F.saveNow(); this.render(); GB.App.refreshArena();
          } }, 'Remove') : null),
        h('div.form-grid', ...rows));
        box.appendChild(card);
      }
      const sel = h('select.input', ...COMPAT_PRESETS.map((x, i) => h('option', { value: i }, x.name)));
      box.appendChild(h('div.btn-row', h('span', 'Add an OpenAI-compatible endpoint: '), sel, h('button.primary', { onclick: () => {
        const pre = COMPAT_PRESETS[Number(sel.value)];
        S.data.providers.push({ id: U.uid('prov'), type: 'openai-compatible', name: pre.name, baseUrl: pre.baseUrl, apiStyle: pre.apiStyle, maxTokensParam: 'max_tokens', keyOptional: !!pre.keyOptional, extraHeaders: '' });
        F.saveNow(); this.render(); GB.App.refreshArena();
        U.toast('Added ' + pre.name + '. Add its key above, then add models for it below.', 'ok', 5000);
      } }, 'Add')));
      box.appendChild(h('p.muted.small', 'Local servers must allow requests from a page opened as a file (origin "null"). LM Studio: enable CORS in the server settings. Ollama: start it with OLLAMA_ORIGINS=* set.'));
    },

    // ---------------------------------------------------------------------------
    _renderModels() {
      const box = this.modelsBox;
      U.clear(box);
      const providers = S.data.providers;
      // datalists of fetched model ids
      for (const p of providers) {
        const list = this.fetched[p.id] || (p.type === 'simulated' ? GB.Prompts.SIM_MODELS.map((m) => m.id) : []);
        box.appendChild(h('datalist#models-' + p.id, ...list.map((id) => h('option', { value: id }))));
      }
      const fetchRow = h('div.btn-row', h('span', 'Model lists: '));
      for (const p of providers) {
        if (p.type === 'simulated') continue;
        fetchRow.appendChild(h('button.small', { onclick: async (e) => {
          const b = e.target; b.disabled = true; b.textContent = 'Fetching…';
          try {
            const list = await GB.AI.listModels(p.id);
            this.fetched[p.id] = list.map((m) => m.id);
            U.toast(list.length + ' models found for ' + p.name + '. Start typing in a model ID field to pick one.', 'ok', 5000);
            this._renderModels();
          } catch (err) { GB.Modal.alert('Could not fetch models for ' + p.name, err.message); b.disabled = false; b.textContent = 'Fetch ' + p.name; }
        } }, (this.fetched[p.id] ? '✓ ' : '') + 'Fetch ' + p.name));
      }
      box.appendChild(fetchRow);

      const list = h('div.model-list');
      for (const m of S.data.models) if (!S.isSimulated(m)) list.appendChild(this._modelCard(m));
      box.appendChild(list);
      const provSel = h('select.input', ...providers.filter((p) => p.type !== 'simulated').map((p) => h('option', { value: p.id }, p.name)));
      box.appendChild(h('div.btn-row', h('span', 'Add a model for '), provSel, h('button.primary', { onclick: () => {
        const p = S.provider(provSel.value);
        S.data.models.push({ id: U.uid('m'), name: 'New ' + p.name.split(' ')[0] + ' model', providerId: p.id, model: '', maxTokens: p.type === 'simulated' ? null : 16000, temperature: null, effort: '', stream: true, extraBody: '' });
        F.saveNow(); this._renderModels(); GB.App.refreshArena();
      } }, 'Add model')));
    },

    _renderSims() {
      const box = this.simsBox;
      if (!box) return;
      U.clear(box);
      const a = S.data.app;
      box.appendChild(h('div.sim-toggle', F.check(a, 'showSimulated', 'Show the simulated demos in the Arena and the Benchmark (and as Grandma or judge models)', {
        onChange: () => { F.saveNow(); GB.App.refreshArena(); this._renderSims(); },
      })));
      box.appendChild(h('datalist#models-simulated', ...GB.Prompts.SIM_MODELS.map((m) => h('option', { value: m.id }, m.name))));
      const sims = S.data.models.filter((m) => S.isSimulated(m));
      const list = h('div.model-list' + (a.showSimulated === false ? '.dim' : ''));
      for (const m of sims) list.appendChild(this._modelCard(m));
      if (!sims.length) list.appendChild(h('p.muted', 'No simulated demos.'));
      box.appendChild(list);
      box.appendChild(h('div.btn-row', h('button', { onclick: () => {
        let n = 0;
        for (const sm of GB.Prompts.SIM_MODELS) {
          if (S.data.models.some((x) => S.isSimulated(x) && x.model === sm.id)) continue;
          S.data.models.splice(S.data.models.filter((x) => S.isSimulated(x)).length, 0, { id: U.uid('m'), name: sm.name, providerId: 'simulated', model: sm.id, maxTokens: null, temperature: null, effort: '', stream: true, extraBody: '' });
          n++;
        }
        F.saveNow(); this._renderSims(); GB.App.refreshArena();
        U.toast(n ? 'Restored ' + n + ' simulated demo(s)' : 'All simulated demos are already there');
      } }, 'Restore missing simulated demos')));
      box.appendChild(h('p.muted.small', 'The Model ID picks the personality: ' + GB.Prompts.SIM_MODELS.map((m) => m.id).join(', ') + '.'));
    },

    _modelCard(m) {
      const p = S.provider(m.providerId);
      const ptype = p ? p.type : 'missing';
      const ready = S.modelReady(m.id);
      const status = h('span.badge' + (ready ? '.ok' : '.warn'), ready ? 'ready' : p ? 'needs key' : 'missing provider');
      const testOut = h('div.test-out');
      const head = h('div.subcard-head', h('b', m.name), h('span.badge', p ? p.name : '?'), status,
        h('span.spacer'),
        h('button.small', { onclick: async (e) => {
          const b = e.target; b.disabled = true; testOut.className = 'test-out'; testOut.textContent = 'Testing…';
          try {
            const r = await GB.AI.test(m);
            testOut.className = 'test-out ok';
            testOut.textContent = '✔ ' + U.fmtMs(r.latencyMs) + ': "' + U.truncate(r.text.trim(), 120) + '"' + (r.model && r.model !== m.model ? ' (served by ' + r.model + ')' : '');
          } catch (err) { testOut.className = 'test-out bad'; testOut.textContent = '✖ ' + err.message; }
          b.disabled = false;
        } }, 'Test'),
        h('button.small', { onclick: () => {
          const copy = Object.assign(U.deepClone(m), { id: U.uid('m'), name: m.name + ' (copy)' });
          S.data.models.splice(S.data.models.indexOf(m) + 1, 0, copy);
          F.saveNow(); this.render(); GB.App.refreshArena();
        } }, 'Duplicate'),
        h('button.small.danger', { onclick: async () => {
          if (!(await GB.Modal.confirm('Delete model?', 'Delete "' + m.name + '"? Saved results keep their data.', 'Delete', true))) return;
          S.data.models = S.data.models.filter((x) => x !== m);
          F.saveNow(); this.render(); GB.App.refreshArena();
        } }, 'Delete'));
      const fields = [
        F.field('Display name', F.text(m, 'name', { onChange: () => { head.querySelector('b').textContent = m.name; GB.App.refreshArena(); } })),
        F.field('Provider', F.select(m, 'providerId', S.data.providers.filter((x) => x.id === m.providerId || x.type !== 'simulated' || S.data.app.showSimulated !== false).map((x) => [x.id, x.name]), { onChange: () => { F.saveNow(); this.render(); GB.App.refreshArena(); } })),
        F.field('Model ID', F.text(m, 'model', { list: 'models-' + m.providerId, placeholder: ptype === 'gemini' ? 'gemini-3.8-flash' : ptype === 'anthropic' ? 'claude-opus-5-5' : 'model id' })),
      ];
      if (ptype !== 'simulated') {
        fields.push(F.field('Max output tokens', F.number(m, 'maxTokens', { min: 1, step: 1, allowEmpty: true }), 'Includes thinking tokens on reasoning models.'));
        fields.push(F.field('Temperature', F.number(m, 'temperature', { min: 0, max: 2, step: 0.05, allowEmpty: true, placeholder: 'default' })));
        fields.push(F.field(ptype === 'gemini' ? 'Thinking level (Gemini 3+)' : 'Reasoning effort', F.select(m, 'effort', EFFORTS[ptype] || [['', 'Default']]), ptype === 'anthropic' ? 'Sent as output_config.effort.' : ptype === 'gemini' ? 'Leave on Default for Gemini 2.5 models.' : null));
        fields.push(F.check(m, 'stream', 'Stream tokens (live terminal typing)'));
        const extra = F.field('Extra request JSON (merged into the body)', F.textarea(m, 'extraBody', { rows: 2, placeholder: '{"thinking": {"type": "adaptive", "display": "summarized"}}' }), null, { wide: true });
        fields.push(h('details.wide', h('summary', 'Advanced'), extra));
      }
      return h('div.subcard', head, h('div.form-grid', ...fields), testOut);
    },

    // ---------------------------------------------------------------------------
    _renderRules() {
      const box = this.rulesBox, a = S.data.app;
      U.clear(box);
      // Hidden simulated demos are left out (a hidden choice shows as "(none)" and is not used).
      const modelOpts = [['', '(none)']].concat(S.data.models.filter((m) => S.modelListed(m)).map((m) => [m.id, m.name + (S.modelReady(m.id) ? '' : ' (needs key)')]));
      const turnsInfo = h('span');
      const syncTurns = () => {
        const t = S.timing(null);
        U.clear(turnsInfo);
        U.append(turnsInfo, ['With these settings the AI gets ', h('b', Math.ceil(t.timeLimit / t.secondsPerTurn - 1e-9) + ' replies'), ' before impact (' + t.timeLimit + ' s ÷ ' + t.secondsPerTurn + ' s per turn).']);
      };
      syncTurns();
      box.appendChild(h('h3', 'The clock'));
      box.appendChild(h('div.form-grid',
        F.field('Time limit (seconds)', F.number(a, 'timeLimit', { min: 5, max: 3600, step: 1, onChange: syncTurns }), 'Story time until the train arrives. The viral original used 60.'),
        F.field('Seconds per turn', F.number(a, 'secondsPerTurn', { min: 1, max: 600, step: 1, onChange: syncTurns }), 'Each AI reply costs this much story time. Grandma’s pleas cost nothing.'),
        F.field('Verbosity tax (s per 100 chars)', F.number(a, 'verbosityTax', { min: 0, max: 30, step: 0.1 }), 'Optional: long replies cost extra time. 0 = off.'),
        F.field('Seconds cost per tool use', F.number(a, 'toolUseSeconds', { min: 0, max: 120, step: 0.5 }), 'Scenarios with virtual tools: story time that each tool use costs.'),
        F.calc(turnsInfo, { wide: true })));
      box.appendChild(h('p.muted.small', 'Story time is frozen while the AI is thinking, so slow APIs are not penalized.'));
      box.appendChild(h('h3', 'Grandma'));
      box.appendChild(h('div.form-grid',
        F.field('Default Grandma', F.select(a, 'grannyMode', [['script', 'Scripted lines (fair benchmark)'], ['ai', 'AI Grandma (for fun)']], { onChange: () => GB.App.refreshArena() })),
        F.field('Grandma model', F.select(a, 'grannyModelId', modelOpts, { onChange: () => GB.App.refreshArena() }), 'Used when Grandma is set to AI. She starts with the scenario’s “Grandma’s First Line”; the model writes the rest, using the persona in each scenario.')));
      box.appendChild(h('h3', 'Judge'));
      box.appendChild(h('div.form-grid',
        F.field('Judge mode', F.select(a, 'judgeMode', [['auto', 'Auto: reference text if present, else AI judge, else you'], ['reference', 'Reference text (exact matching)'], ['ai', 'AI judge'], ['manual', 'Manual (you click a verdict)']], { onChange: () => GB.App.refreshArena() })),
        F.field('AI judge model', F.select(a, 'judgeModelId', modelOpts, { onChange: () => GB.App.refreshArena() }), 'A fast, cheap model works well. It only classifies, it never writes the text itself.'),
        F.field('AI judge strictness', F.select(a, 'judgeStrictness', [['lenient', 'Lenient: a partial match stops the train'], ['standard', 'Standard: a substantial part of the real text'], ['strict', 'Strict: most of the text, near verbatim']]))));
      box.appendChild(h('p.muted.small', 'How much of the reference text must be typed ("Reference match needed") is set in each scenario, next to its reference text.'));
      box.appendChild(h('h3', 'Show'));
      box.appendChild(h('div.form-grid',
        F.field('When Grandma is not saved', F.select(a, 'endingStyle', [['random', 'Random'], ['orbit', 'Orbit'], ['ornament', 'Hood ornament'], ['bowling', 'Bowling']])),
        F.check(a, 'narratorIntro', 'Narrator introduces each run'),
        F.field('Automatic retries on rate limits / server errors', F.number(a, 'retryLimit', { min: 0, max: 6, step: 1 }))));
    },

    // ---------------------------------------------------------------------------
    _renderVoices() {
      const box = this.voicesBox;
      if (!box) return;
      U.clear(box);
      const v = S.data.voice, a = S.data.audio;
      const voices = GB.TTS.voices;
      box.appendChild(h('div.form-grid',
        F.check(v, 'enabled', 'Speak the dialogue', { onChange: () => GB.App._muteIcon() }),
        F.field('Voice speed (all voices)', F.range(v, 'speed', { min: 0.5, max: 3, step: 0.05, fmt: (x) => x.toFixed(2) + 'x', onChange: () => GB.App._voiceSpeedLabel() }), 'Same as the speed control on the 3D view (- and + keys). Multiplies each voice’s own rate below.'),
        F.field('Max characters the AI speaks per reply', F.number(v, 'maxRobotChars', { min: 50, max: 10000, step: 50 }), 'Long replies are cut off in speech, not in the transcript.'),
        F.check(v, 'readToolResults', 'Read virtual tool results aloud', { hint: 'The terminal’s voice reads what a tool returns, such as the brake instructions after the glass is broken. When off, the result only appears on the terminal screen.' })));
      if (!GB.TTS.supported) box.appendChild(h('p.warning', 'This browser has no speech synthesis. Speech will be simulated (mouths still move).'));
      else if (!voices.length) box.appendChild(h('p.muted', 'No voices reported yet. Some browsers load them after a moment, or only after the first click on the page.'));
      for (const role of ['granny', 'robot', 'narrator']) box.appendChild(this._voiceCard(role));
      box.appendChild(h('p.muted.small', 'Tip: macOS includes voices named "Grandma" and "Fred" that suit this perfectly. On Windows, Zira and David work well.'));
      box.appendChild(h('h3', 'Sound effects'));
      box.appendChild(h('div.form-grid',
        F.check(a, 'enabled', 'Sound effects', { onChange: () => { GB.SFX.apply(a); GB.App._muteIcon(); } }),
        F.field('Volume', F.range(a, 'volume', { min: 0, max: 1, step: 0.05, fmt: (x) => Math.round(x * 100) + '%', onChange: () => GB.SFX.apply(a) })),
        F.check(a, 'music', 'Suspense drone as the train gets closer', { onChange: () => GB.SFX.apply(a) }),
        h('div.btn-row', h('button.small', { onclick: () => { GB.SFX.ensure(); GB.SFX.horn(0.8, 1.0); } }, '▶ Horn'), h('button.small', { onclick: () => { GB.SFX.ensure(); GB.SFX.brakes(1.6); } }, '▶ Brakes'), h('button.small', { onclick: () => { GB.SFX.ensure(); GB.SFX.impact(); } }, '▶ Impact'))));
    },

    // One role's voice: how its lines are delivered, and the settings for that choice.
    _voiceCard(role) {
      const cfg = S.data.voice[role], voices = GB.TTS.voices;
      const redraw = () => { const next = this._voiceCard(role); card.replaceWith(next); };
      const mode = GB.TTS.mode(role);
      const pitch = F.field('Pitch', F.range(cfg, 'pitch', { min: 0, max: 2, step: 0.05, fmt: (x) => x.toFixed(2) }));
      const volume = F.field('Volume', F.range(cfg, 'volume', { min: 0, max: 1, step: 0.05, fmt: (x) => Math.round(x * 100) + '%' }));
      const fields = [F.field('Lines', F.select(cfg, 'mode', [['speak', 'Speak'], ['silent', 'Skip speaking (silent)'], ['blips', 'Typewriter with blips']], { onChange: redraw }))];
      if (mode === 'speak') {
        const def = GB.TTS.defaultVoice(role);
        const opts = [['', 'Auto' + (def ? ' (' + def.name + ')' : '')]].concat(voices.map((x) => [x.voiceURI, x.name + ' · ' + x.lang + (x.localService === false ? ' · online' : '')]));
        fields.push(F.field('Voice', F.select(cfg, 'voiceURI', opts)), F.field('Rate', F.range(cfg, 'rate', { min: 0.5, max: 2, step: 0.05, fmt: (x) => x.toFixed(2) + 'x' })), pitch, volume);
      } else if (mode === 'silent') {
        fields.push(F.check(cfg, 'silentPause', 'Still cut to the character and show the line', { onChange: redraw,
          hint: cfg.silentPause === false ? 'Off: the line is skipped without a camera cut or a pause. It is still in the transcript.' : 'The line appears in the speech bubble, without sound, for the pause below.' }));
        if (cfg.silentPause !== false) fields.push(F.field('Pause (seconds)', F.number(cfg, 'pauseSeconds', { min: 0.2, max: 30, step: 0.1 })));
      } else {
        fields.push(F.field('Seconds per line', F.number(cfg, 'lineSeconds', { min: 0.5, max: 30, step: 0.1 }), 'How long each line stays after it has typed out, for reading it. Typing a line takes 2 seconds.'), pitch, volume);
      }
      const test = () => {
        GB.TTS.stopAll();
        if (GB.TTS.mode(role) !== 'silent') { GB.SFX.ensure(); GB.TTS.test(role); return; }
        U.toast(cfg.silentPause === false ? 'Silent: the line is skipped.' : 'Silent: the line shows for ' + (Number(cfg.pauseSeconds) || 0) + ' s without sound.');
      };
      const card = h('div.subcard', h('div.subcard-head', h('b', { granny: 'Grandma', robot: 'AI (robot)', narrator: 'Narrator (intro, tool results)' }[role]),
        h('span.spacer'), h('button.small', { onclick: test }, '▶ Test')),
      h('div.form-grid', ...fields));
      return card;
    },

    _renderGraphics() {
      const box = this.gfxBox, g = S.data.graphics, c = S.data.camera;
      U.clear(box);
      const apply = () => { if (GB.App.world) GB.App.world.applyGraphics(g); };
      const applyCam = () => { if (GB.App.world) { GB.App.world.camera.sensitivity = Number(c.sensitivity) || 1; GB.App.world.camera.invertY = !!c.invertY; } };
      box.appendChild(h('div.form-grid',
        F.check(g, 'shadows', 'Shadows', { onChange: apply }),
        F.field('Resolution limit (device pixel ratio)', F.range(g, 'pixelRatioCap', { min: 0.5, max: 3, step: 0.25, fmt: (x) => x.toFixed(2) + 'x', onChange: apply }), 'Lower it if the 3D view is slow.'),
        F.check(g, 'showFps', 'Show frame rate'),
        F.check(g, 'vertical', 'Vertical video (9:16)', { onChange: () => { GB.App.applyFrame(); this._renderGraphics(); },
          hint: 'For recording vertical video. The 3D view becomes a 9:16 frame, and the clock, speech bubbles, and other text stay out of the areas TikTok and Instagram cover with their buttons and captions. A page cannot resize its own browser window, so the frame is fitted inside it; the camera and voice buttons go beside it.' }),
        g.vertical ? F.check(g, 'safeGuide', 'Show the covered areas', { onChange: () => GB.App.applyFrame(),
          hint: 'Red and orange: covered by TikTok and Instagram. Yellow: partly covered. For checking only; turn it off before recording.' }) : null,
        F.check(g, 'framing', 'Framing mode', { onChange: () => GB.App.applyFraming(true),
          hint: 'For setting up shots. Adds controls at the top of the Arena panel: how close the train is, which way the AI\'s head is turned, whether the speech bubbles (or just their text), the header and HUD, the sign, the telephone poles and the emergency brake switch are shown, and extra height for the speech bubbles. Works during a paused run too.' }),
        F.check(c, 'autoDirector', 'Start with the automatic camera'),
        F.check(c, 'invertY', 'Invert vertical mouse look', { onChange: applyCam }),
        F.field('Mouse sensitivity', F.range(c, 'sensitivity', { min: 0.2, max: 3, step: 0.1, fmt: (x) => x.toFixed(1) + 'x', onChange: applyCam }))));
    },

    _renderReset() {
      return h('div.btn-row',
        h('button.danger', { onclick: async () => {
          if (!(await GB.Modal.confirm('Reset all settings?', 'Restores default providers, models, scenarios, and options. API keys and results are not touched.', 'Reset settings', true))) return;
          S.resetAll(); this.render(); GB.App.refreshArena(); U.toast('Settings reset');
        } }, 'Reset all settings'),
        h('button.danger', { onclick: async () => {
          if (!(await GB.Modal.confirm('Delete all results?', 'This permanently deletes every saved run. Export them first if you want to keep them.', 'Delete results', true))) return;
          GB.Results.clear(); U.toast('Results deleted');
        } }, 'Delete all results'));
    },
  };

  GB.SettingsUI = SettingsUI;
})(window.GB = window.GB || {});
