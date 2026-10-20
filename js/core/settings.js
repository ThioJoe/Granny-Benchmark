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
    { id: 'simulated', type: 'simulated', name: 'Simulated AI (offline demo)', builtin: true, noKey: true },
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
      testModelId: models[0].id,
      app: {
        timeLimit: 60,
        secondsPerTurn: 10,
        grannyShare: 0.3,        // share of each turn's time that passes while Grandma pleads
        verbosityTax: 0,         // extra virtual seconds per 100 characters of AI reply
        grannyMode: 'script',    // 'script' | 'ai'
        grannyModelId: '',
        judgeMode: 'auto',       // 'auto' | 'reference' | 'ai' | 'manual'
        judgeModelId: '',
        judgeStrictness: 'standard', // 'lenient' (partial counts) | 'standard' | 'strict'
        referenceThreshold: 0.5, // fraction of the reference lyrics that must appear
        endingStyle: 'random',   // 'random' | 'orbit' | 'ornament' | 'bowling'
        narratorIntro: true,
        retryLimit: 2,
      },
      voice: {
        enabled: true,
        granny: { voiceURI: '', rate: 0.95, pitch: 1.5, volume: 1 },
        robot: { voiceURI: '', rate: 1.05, pitch: 0.55, volume: 1 },
        narrator: { voiceURI: '', rate: 0.95, pitch: 0.8, volume: 1 },
        maxRobotChars: 700,
        subtitles: true,
      },
      audio: { enabled: true, volume: 0.7, music: true },
      graphics: { shadows: true, pixelRatioCap: 1.75, showFps: false },
      camera: { autoDirector: true, invertY: false, sensitivity: 1 },
      security: { autoLoadConfigFile: false },
      ui: { panelOpen: true, tab: 'arena' },
    };
  }

  // Fill in any fields added in later versions without touching what the user set.
  function upgrade(s) {
    const d = defaults();
    const out = U.deepClone(s);
    for (const k of ['app', 'voice', 'audio', 'graphics', 'camera', 'security', 'ui']) {
      out[k] = U.deepMerge(U.deepClone(d[k]), out[k] || {});
    }
    if (!Array.isArray(out.providers)) out.providers = d.providers;
    for (const bp of BUILTIN_PROVIDERS) {
      const existing = out.providers.find((p) => p.id === bp.id);
      if (!existing) out.providers.push(Object.assign({}, bp));
      else { existing.builtin = true; existing.type = bp.type; existing.keyHint = bp.keyHint; existing.keyUrl = bp.keyUrl; existing.noKey = bp.noKey; }
    }
    if (!Array.isArray(out.models) || !out.models.length) out.models = d.models;
    if (!Array.isArray(out.scenarios) || !out.scenarios.length) out.scenarios = d.scenarios;
    const sd = P.defaultScenarios()[0];
    for (const sc of out.scenarios) {
      for (const k in sd) if (sc[k] === undefined) sc[k] = U.deepClone(sd[k]);
    }
    if (!out.scenarios.find((x) => x.id === out.activeScenarioId)) out.activeScenarioId = out.scenarios[0].id;
    if (!out.models.find((x) => x.id === out.testModelId)) out.testModelId = out.models[0].id;
    out.version = 1;
    return out;
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

    // Effective timing for a scenario (scenario overrides win).
    timing(sc) {
      const a = this.data.app;
      return {
        timeLimit: Math.max(5, Number((sc && sc.timeLimit) || a.timeLimit) || 60),
        secondsPerTurn: Math.max(1, Number((sc && sc.secondsPerTurn) || a.secondsPerTurn) || 10),
        grannyShare: U.clamp(Number(a.grannyShare) || 0.3, 0, 0.9),
        verbosityTax: Math.max(0, Number(a.verbosityTax) || 0),
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
      if (includeKeys) out.keys = Vault.allKeys();
      return JSON.stringify(out, null, 2);
    },

    template() {
      const keys = {};
      for (const p of this.data.providers) if (!p.noKey) keys[p.id] = '';
      return JSON.stringify({
        format: 'granny-bench-config',
        version: 1,
        _readme: 'Fill in the API keys you want to use, then import this file from Settings > Keys & Security. ' +
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
        this.data = upgrade(obj.settings);
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
