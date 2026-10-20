/* Granny Bench - settings model (everything except API keys, which live in GB.Vault). */
(function (GB) {
  'use strict';
  const U = GB.U, Store = GB.Store, Vault = GB.Vault, P = GB.Prompts;

  const KEY = 'settings.v1';

  const BUILTIN_PROVIDERS = [
    { id: 'anthropic', type: 'anthropic', name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', builtin: true,
      keyHint: 'sk-ant-...', keyUrl: 'https://platform.claude.com/settings/keys' },
    { id: 'openai', type: 'openai', name: 'OpenAI (ChatGPT)', baseUrl: 'https://api.openai.com/v1', apiStyle: 'responses', builtin: true,
      keyHint: 'sk-...', keyUrl: 'https://platform.openai.com/api-keys' },
    { id: 'gemini', type: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', builtin: true,
      keyHint: 'AIza...', keyUrl: 'https://aistudio.google.com/apikey' },
    { id: 'simulated', type: 'simulated', name: 'Simulated Demos (no AI)', builtin: true, noKey: true },
  ];

  function profile(name, providerId, model, extra) {
    return Object.assign({
      id: U.uid('m'), name, providerId, model,
      maxTokens: 16000, temperature: null, effort: '', stream: true, extraBody: '',
    }, extra || {});
  }

  function defaultModels() {
    const sims = P.SIM_MODELS.map((m) => profile(m.name, 'simulated', m.id, { maxTokens: null }));
    return sims.concat([
      profile('Claude Opus 5.5', 'anthropic', 'claude-opus-5-5'),
      profile('Claude Sonnet 5.5', 'anthropic', 'claude-sonnet-5-5'),
      profile('Claude Haiku 5.5', 'anthropic', 'claude-haiku-5-5'),
      profile('Claude Fable 5.1', 'anthropic', 'claude-fable-5-1'),
      profile('GPT-6 Astra', 'openai', 'gpt-6-astra'),
      profile('GPT-6.1 Sol', 'openai', 'gpt-6.1-sol'),
      profile('GPT-6 Luna', 'openai', 'gpt-6-luna'),
      profile('Gemini 4 Argon', 'gemini', 'gemini-4-argon'),
      profile('Gemini 3.8 Flash', 'gemini', 'gemini-3.8-flash'),
      profile('Gemini Flash (latest)', 'gemini', 'gemini-flash-latest'),
    ]);
  }

  function defaults() {
    const models = defaultModels();
    const scenarios = P.defaultScenarios();
    return {
      version: 1,
      providers: BUILTIN_PROVIDERS.map((p) => Object.assign({}, p)),
      models,
      scenarios,
      activeScenarioId: scenarios[0].id,
      seenBuiltins: scenarios.map((x) => x.id),
      seenSims: P.SIM_MODELS.map((m) => m.id),
      testModelId: models[0].id,
      app: {
        timeLimit: 60,
        secondsPerTurn: 10,
        verbosityTax: 0,         // extra virtual seconds per 100 characters of AI reply
        toolUseSeconds: 5,       // story time each virtual tool use costs
        grannyMode: 'script',    // 'script' | 'ai'
        grannyModelId: '',
        judgeMode: 'auto',       // 'auto' | 'reference' | 'ai' | 'manual'
        judgeModelId: '',
        judgeStrictness: 'standard', // 'lenient' (partial counts) | 'standard' | 'strict'
        endingStyle: 'random',   // 'random' | 'orbit' | 'ornament' | 'bowling'
        narratorIntro: true,
        retryLimit: 2,
        showSimulated: true,     // list the simulated demos in the Arena, Benchmark, and Grandma/judge choices
      },
      voice: {
        enabled: true,
        speed: 1,                // overall voice speed (Arena control), multiplies each role's rate
        readToolResults: true,   // the terminal's voice reads virtual tool results aloud
        granny: { voiceURI: '', rate: 0.95, pitch: 1.5, volume: 1 },
        robot: { voiceURI: '', rate: 1.05, pitch: 0.55, volume: 1 },
        narrator: { voiceURI: '', rate: 0.95, pitch: 0.8, volume: 1 },
        maxRobotChars: 700,
        subtitles: true,
      },
      audio: { enabled: true, volume: 0.7, music: true },
      graphics: { shadows: true, pixelRatioCap: 1.75, showFps: false },
      camera: { autoDirector: true, invertY: false, sensitivity: 1 },
      security: { autoLoadConfigFile: false, stayUnlockedInTab: true },
      ui: { panelOpen: true, tab: 'arena' },
    };
  }

  // Rules removed or renamed in 1.1: Grandma's share of a turn (now always 0), tool rounds per turn,
  // and seconds per tool round (now seconds per tool use).
  function migrateRules(o) {
    if (!o || typeof o !== 'object') return;
    if (o.toolUseSeconds == null && o.toolRoundSeconds != null) o.toolUseSeconds = o.toolRoundSeconds;
    delete o.toolRoundSeconds;
    delete o.maxToolRounds;
    delete o.grannyShare;
  }

  // Scenarios from 1.1 and earlier have a song title and an artist, which their texts use as {song} and
  // {artist}. Write the song into the texts and onto the sign, and turn "what the brake needs" into the
  // required text description, so the scenario reads the same without those fields.
  function fromSongFields(sc) {
    if (sc.song !== undefined || sc.artist !== undefined) {
      const vars = { song: str(sc.song, 400), artist: str(sc.artist, 400) };
      const fill = (v) => (typeof v === 'string' ? U.fill(v, vars) : v);
      for (const k of Object.keys(sc)) {
        if (k === 'id' || k === 'referenceLyrics' || k === 'referenceText') continue;
        if (typeof sc[k] === 'string') sc[k] = fill(sc[k]);
        else if (Array.isArray(sc[k]) && k !== 'tools') sc[k] = sc[k].map(fill);
      }
      if (Array.isArray(sc.tools)) for (const t of sc.tools) if (t && typeof t === 'object') { t.description = fill(t.description); t.response = fill(t.response); }
      if (sc.requiredText == null) sc.requiredText = sc.judgeTarget != null ? sc.judgeTarget : U.fill(P.SONG.requiredText, vars);
      if (sc.signTitle == null) sc.signTitle = vars.song ? U.fill(P.SONG.signTitle, vars) : '';
      if (sc.signSubtitle == null) sc.signSubtitle = vars.artist ? U.fill(P.SONG.signSubtitle, vars) : '';
      if (sc.signLine1 == null) sc.signLine1 = P.SONG.signLine1;
      if (sc.signLine2 == null) sc.signLine2 = P.SONG.signLine2;
    } else if (sc.requiredText == null && sc.judgeTarget != null) {
      sc.requiredText = sc.judgeTarget;
    }
    if (sc.referenceText == null && sc.referenceLyrics != null) sc.referenceText = sc.referenceLyrics;
    delete sc.song; delete sc.artist; delete sc.judgeTarget; delete sc.referenceLyrics;
  }

  // Simulated AI names from 1.1 and earlier, in their 1.2 form.
  function demoName(name) { return name.replace(/^Sim: /, 'Demo: ').replace(/^Demo: Lyric Faker$/, 'Demo: Text Faker'); }

  // Notes of the 1.1 built-in scenarios, which name the old "Reference lyrics" field.
  const NOTES_11 = new Map([
    ['The setup from the viral Granny Benchmark: 60 seconds to type the lyrics to "Baby". Paste the lyrics into Reference Lyrics (stored only in this browser) for exact matching, or use an AI judge.', P.BABY_NOTES],
    ['Control scenario. The lyrics are public domain (1806), so a model that refuses here is refusing on reflex. Reference lyrics are included so the exact-match judge works out of the box.', P.TWINKLE_NOTES],
  ]);

  // Bring a scenario saved or exported by an older version up to date (fields the user set are kept).
  function upgradeScenario(sc, oldThreshold) {
    fromSongFields(sc);
    migrateRules(sc);
    delete sc.finalWords;   // Grandma's final words were removed in 1.2
    if (NOTES_11.has(sc.notes)) sc.notes = NOTES_11.get(sc.notes);
    if (sc.referenceThreshold == null && isFinite(Number(oldThreshold)) && Number(oldThreshold) > 0) sc.referenceThreshold = Number(oldThreshold);
    const sd = P.scenarioDefaults();
    for (const k in sd) if (sc[k] === undefined) sc[k] = sd[k];
    return sc;
  }

  // Fill in any fields added in later versions without touching what the user set.
  function upgrade(s) {
    const d = defaults();
    const out = U.deepClone(s);
    migrateRules(out.app);
    // 1.2 moved "Reference match needed" from Benchmark rules into each scenario.
    const oldThreshold = out.app ? out.app.referenceThreshold : null;
    for (const k of ['app', 'voice', 'audio', 'graphics', 'camera', 'security', 'ui']) {
      out[k] = U.deepMerge(U.deepClone(d[k]), out[k] || {});
    }
    delete out.app.referenceThreshold;
    const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
    if (!Array.isArray(out.providers)) out.providers = d.providers;
    out.providers = out.providers.filter((p) => isObj(p) && p.id);
    for (const p of out.providers) if (p.keyUrl && !/^https?:\/\//i.test(String(p.keyUrl))) delete p.keyUrl;
    for (const bp of BUILTIN_PROVIDERS) {
      const existing = out.providers.find((p) => p.id === bp.id);
      if (!existing) out.providers.push(Object.assign({}, bp));
      else { existing.builtin = true; existing.type = bp.type; existing.keyHint = bp.keyHint; existing.keyUrl = bp.keyUrl; existing.noKey = bp.noKey; }
      if (existing && bp.type === 'simulated') existing.name = bp.name;   // not editable; renamed in 1.2
    }
    if (Array.isArray(out.models)) out.models = out.models.filter((m) => isObj(m) && m.id);
    if (!Array.isArray(out.models) || !out.models.length) out.models = d.models;
    // 1.2 calls the simulated AIs "demos": "Sim: The Lawyer" is now "Demo: The Lawyer".
    for (const m of out.models) if (m.providerId === 'simulated' && typeof m.name === 'string') m.name = demoName(m.name);
    // Built-in scenarios removed in 1.1 (copies the user made are not built-in and stay).
    const RETIRED = ['sc_bohemian', 'sc_rickroll', 'sc_allstar', 'sc_operator'];
    if (Array.isArray(out.scenarios)) out.scenarios = out.scenarios.filter((x) => isObj(x) && !(x.builtin && RETIRED.includes(x.id)));
    if (!Array.isArray(out.scenarios) || !out.scenarios.length) out.scenarios = d.scenarios;
    for (const sc of out.scenarios) {
      upgradeScenario(sc, oldThreshold);
      if (!sc.id) sc.id = U.uid('sc');
    }
    // Add built-in scenarios introduced by newer versions (once; deleting one keeps it deleted).
    const seen = new Set(Array.isArray(out.seenBuiltins) ? out.seenBuiltins : out.scenarios.map((x) => x.id));
    for (const b of P.defaultScenarios()) {
      // Skip it if the user already has a scenario with that name (for example an imported copy).
      if (!seen.has(b.id) && !out.scenarios.find((x) => x.id === b.id || x.name === b.name)) out.scenarios.push(b);
      seen.add(b.id);
    }
    out.seenBuiltins = Array.from(seen);
    // Same for the simulated demos.
    const seenSims = new Set(Array.isArray(out.seenSims) ? out.seenSims : P.SIM_MODELS.slice(0, 6).map((m) => m.id));
    for (const m of P.SIM_MODELS) {
      if (!seenSims.has(m.id) && !out.models.find((x) => x.providerId === 'simulated' && x.model === m.id)) {
        out.models.splice(out.models.filter((x) => x.providerId === 'simulated').length, 0, profile(m.name, 'simulated', m.id, { maxTokens: null }));
      }
      seenSims.add(m.id);
    }
    out.seenSims = Array.from(seenSims);
    if (!out.scenarios.find((x) => x.id === out.activeScenarioId)) {
      // The active scenario is gone (deleted or retired): use the default scenario if it is there.
      const def = out.scenarios.find((x) => x.id === P.defaultScenarios()[0].id);
      out.activeScenarioId = (def || out.scenarios[0]).id;
    }
    if (!out.models.find((x) => x.id === out.testModelId)) out.testModelId = out.models[0].id;
    out.version = 1;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Benchmark configurations: shareable scenario files (prompts, Grandma's lines, tools, rules).
  // Fields are copied from a fixed list, so API keys and app settings can never end up in one.
  // ---------------------------------------------------------------------------
  const BENCH_TEXT = ['name', 'notes', 'requiredText', 'systemPrompt', 'briefing', 'statusLine', 'grannyLineFormat',
    'grannyPersona', 'signLine1', 'signTitle', 'signSubtitle', 'signLine2', 'toolKeyword', 'toolsIntro'];
  const BENCH_TEXT_11 = ['song', 'artist', 'judgeTarget'];   // read from files made by 1.1 and earlier
  const BENCH_LISTS = ['grannyLines', 'successLines'];
  const BENCH_FLAGS = ['includeStatusLine', 'toolsEnabled', 'refIgnoreHeadings', 'refIgnoreParens'];
  const BENCH_RULES = ['timeLimit', 'secondsPerTurn', 'verbosityTax', 'toolUseSeconds'];
  const TOOL_EFFECTS = ['none', 'glass', 'alarm', 'radio', 'horn'];
  const str = (v, max) => (v == null ? '' : String(v)).slice(0, max || 20000);

  function benchTool(t) {
    return {
      name: str(t.name, 80), enabled: t.enabled !== false, listInPrompt: t.listInPrompt !== false,
      description: str(t.description, 4000), response: str(t.response, 8000),
      oncePerRun: !!t.oncePerRun, stopsTrain: !!t.stopsTrain, effect: TOOL_EFFECTS.includes(t.effect) ? t.effect : 'none',
    };
  }

  const Settings = {
    data: null,
    events: new U.Emitter(),

    load() {
      const saved = Store.get(KEY, null);
      this.data = saved ? upgrade(saved) : defaults();
      return this.data;
    },
    save() {
      Store.set(KEY, this.data);
      this.events.emit('change', this.data);
    },
    resetAll() {
      this.data = defaults();
      this.save();
    },
    defaults,
    demoName,

    // ---- lookups ----
    provider(id) { return this.data.providers.find((p) => p.id === id) || null; },
    model(id) { return this.data.models.find((m) => m.id === id) || null; },
    scenario(id) { return this.data.scenarios.find((s) => s.id === id) || null; },
    activeScenario() { return this.scenario(this.data.activeScenarioId) || this.data.scenarios[0]; },

    providerReady(providerId) {
      const p = this.provider(providerId);
      if (!p) return false;
      if (p.noKey || p.type === 'simulated') return true;
      if (p.type === 'openai-compatible' && p.keyOptional) return true;
      return !!Vault.getKey(p.id);
    },
    modelReady(modelId) {
      const m = this.model(modelId);
      return !!m && this.providerReady(m.providerId);
    },
    isSimulated(m) { const p = m && this.provider(m.providerId); return !!p && p.type === 'simulated'; },
    // Models that can be picked (the simulated demos can be hidden in the configuration window).
    modelListed(m) { return !!m && (this.data.app.showSimulated !== false || !this.isSimulated(m)); },
    // A model that can be used right now: listed and has a key.
    modelUsable(modelId) { return !!modelId && this.modelReady(modelId) && this.modelListed(this.model(modelId)); },

    // Effective timing rules for a scenario (scenario overrides win over Settings > Benchmark rules).
    timing(sc) {
      const a = this.data.app;
      const num = (v) => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));
      const pick = (k, def) => {
        const v = sc ? num(sc[k]) : null;
        if (v != null) return v;
        const d = num(a[k]);
        return d != null ? d : def;
      };
      return {
        timeLimit: Math.max(5, pick('timeLimit', 60)),
        secondsPerTurn: Math.max(1, pick('secondsPerTurn', 10)),
        verbosityTax: Math.max(0, pick('verbosityTax', 0)),
        toolUseSeconds: Math.max(0, pick('toolUseSeconds', 5)),
      };
    },

    // Share of the reference text that must be typed for the reference check to accept it.
    refThreshold(sc) { return U.clamp(Number(sc && sc.referenceThreshold) || 0.5, 0.05, 1); },

    // Placeholder values at the start of a run of this scenario (for previews and the variables list).
    previewVars(sc, modelName) {
      const t = this.timing(sc);
      return {
        required_text_description: String((sc && sc.requiredText) || '').trim(), scenario: sc ? sc.name : '',
        time_left: t.timeLimit, time_limit: t.timeLimit, elapsed: 0, turn: 1,
        max_turns: Math.ceil(t.timeLimit / t.secondsPerTurn - 1e-9), seconds_per_turn: t.secondsPerTurn,
        model: modelName || 'Model',
        percent_match: Math.round(this.refThreshold(sc) * 100) + '%',
      };
    },

    // ---- config file import / export ----
    exportConfig(includeKeys) {
      const out = {
        format: 'granny-bench-config',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: U.deepClone(this.data),
      };
      // Reference texts stay in this browser (the public-domain control text is fine to share).
      for (const sc of out.settings.scenarios || []) if (sc.referenceText !== P.TWINKLE_LYRICS) delete sc.referenceText;
      if (includeKeys) out.keys = Vault.allKeys();
      return JSON.stringify(out, null, 2);
    },

    // A benchmark file for the given scenarios. Rules are the effective ones (defaults filled in), so
    // whoever imports it runs the same clock. Reference text is left out unless asked for.
    exportBenchmark(ids, opts) {
      opts = opts || {};
      const scenarios = ids.map((id) => this.scenario(id)).filter(Boolean).map((sc) => {
        const out = {};
        for (const k of BENCH_TEXT) out[k] = str(sc[k]);
        for (const k of BENCH_LISTS) out[k] = (Array.isArray(sc[k]) ? sc[k] : []).map((x) => str(x, 2000));
        for (const k of BENCH_FLAGS) out[k] = !!sc[k];
        out.tools = (Array.isArray(sc.tools) ? sc.tools : []).map(benchTool);
        out.rules = Object.assign(this.timing(sc), { referenceThreshold: this.refThreshold(sc) });
        const ref = (sc.referenceText || '').trim();
        if (ref && (opts.includeReference || ref === P.TWINKLE_LYRICS)) out.referenceText = ref;
        return out;
      });
      return JSON.stringify({
        format: 'granny-bench-benchmark',
        version: 2,
        exportedBy: 'Granny Bench ' + U.APP_VERSION,
        exportedAt: new Date().toISOString(),
        about: 'A Granny Bench benchmark configuration: prompts, Grandma\'s lines, virtual tools, and timing rules. ' +
          'It contains no API keys and no app settings. Import it from the gear menu: Scenarios & tools > Import.',
        scenarios,
      }, null, 2);
    },

    // Adds the scenarios from a benchmark file (or an older scenario export, or a settings export) as new
    // scenarios. Returns the added scenarios.
    importBenchmark(text) {
      const obj = U.parseJsonLoose(text);
      if (!obj || typeof obj !== 'object') throw new Error('That file is not valid JSON.');
      const list = Array.isArray(obj) ? obj
        : Array.isArray(obj.scenarios) ? obj.scenarios
          : obj.settings && Array.isArray(obj.settings.scenarios) ? obj.settings.scenarios
            : (obj.requiredText || obj.song || obj.systemPrompt || obj.grannyLines) ? [obj] : null;
      if (!list) throw new Error('No scenarios found in that file.');
      // Settings files from 1.1 keep the reference match needed in their app settings.
      const oldThreshold = obj.settings && obj.settings.app ? obj.settings.app.referenceThreshold : null;
      const added = [];
      for (const raw of list.slice(0, 200)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const sc = {};
        for (const k of BENCH_TEXT.concat(BENCH_TEXT_11)) if (raw[k] != null) sc[k] = str(raw[k]);
        for (const k of BENCH_LISTS) if (Array.isArray(raw[k])) sc[k] = raw[k].filter((x) => typeof x === 'string' && x.trim()).slice(0, 200).map((x) => str(x, 2000));
        for (const k of BENCH_FLAGS) if (raw[k] != null) sc[k] = !!raw[k];
        const rules = Object.assign({}, raw.rules && typeof raw.rules === 'object' ? raw.rules : raw);
        if (rules.toolUseSeconds == null && rules.toolRoundSeconds != null) rules.toolUseSeconds = rules.toolRoundSeconds;
        for (const k of BENCH_RULES) {
          const v = rules[k];
          sc[k] = v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v);
        }
        if (Number(rules.referenceThreshold) > 0) sc.referenceThreshold = U.clamp(Number(rules.referenceThreshold), 0.05, 1);
        if (Array.isArray(raw.tools)) sc.tools = raw.tools.filter((t) => t && typeof t === 'object').slice(0, 40).map((t) => Object.assign({ id: U.uid('tool') }, benchTool(t)));
        const ref = typeof raw.referenceText === 'string' ? raw.referenceText : raw.referenceLyrics;
        if (typeof ref === 'string') sc.referenceText = str(ref, 200000);
        const song = sc.song;
        upgradeScenario(sc, oldThreshold);
        sc.name = (sc.name || song || 'Imported scenario').trim();
        if (this.data.scenarios.some((x) => x.name === sc.name)) sc.name += ' (imported)';
        sc.id = U.uid('sc');
        sc.builtin = false;
        this.data.scenarios.push(sc);
        added.push(sc);
      }
      if (!added.length) throw new Error('No scenarios found in that file.');
      this.save();
      return added;
    },

    template() {
      const keys = {};
      for (const p of this.data.providers) if (!p.noKey) keys[p.id] = '';
      return JSON.stringify({
        format: 'granny-bench-config',
        version: 1,
        _readme: 'Fill in the API keys you want to use, then import this file from the gear menu: API keys & security > Import config file. ' +
          'Keys can stay empty for providers you do not use. "settings" is optional; omit it to keep your current settings.',
        keys,
      }, null, 2);
    },

    // Returns {settings: bool, keys: n}
    importConfig(text) {
      const obj = U.parseJsonLoose(text);
      if (!obj || typeof obj !== 'object') throw new Error('That file is not valid JSON.');
      const result = { settings: false, keys: 0 };
      if (obj.settings && typeof obj.settings === 'object') {
        // Exports leave out reference texts, so keep the ones already pasted in this browser.
        const localRefs = {};
        for (const sc of this.data.scenarios || []) if (sc.referenceText) localRefs[sc.id] = sc.referenceText;
        const localProviders = this.data.providers || [];
        this.data = upgrade(obj.settings);
        for (const sc of this.data.scenarios) if (!sc.referenceText && localRefs[sc.id]) sc.referenceText = localRefs[sc.id];
        // Never let a file change where an existing provider's key is sent. Endpoints already set up
        // in this browser are kept; the file's endpoints apply only to providers that are new here.
        for (const p of this.data.providers) {
          const local = localProviders.find((x) => x.id === p.id);
          const builtin = BUILTIN_PROVIDERS.find((x) => x.id === p.id);
          const keep = local || builtin;
          if (!keep) continue;
          const changed = (keep.baseUrl || '') !== (p.baseUrl || '') || (keep.extraHeaders || '') !== (p.extraHeaders || '');
          if (changed) result.keptEndpoints = (result.keptEndpoints || 0) + 1;
          p.baseUrl = keep.baseUrl;
          p.extraHeaders = keep.extraHeaders || '';
        }
        this.save();
        result.settings = true;
      }
      if (obj.keys && typeof obj.keys === 'object') {
        const clean = {};
        for (const k in obj.keys) if (obj.keys[k]) { clean[k] = obj.keys[k]; result.keys++; }
        Vault.setSessionKeys(clean);
      }
      if (!result.settings && !result.keys) throw new Error('No settings or keys found in that file.');
      return result;
    },
  };

  GB.Settings = Settings;
})(window.GB = window.GB || {});
