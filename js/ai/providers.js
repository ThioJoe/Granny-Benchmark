/* Granny Bench - AI provider adapters (raw fetch, no SDKs).
   complete() returns { text, finishReason, blocked, blockKind, usage, latencyMs, firstTokenMs, model }.
   Errors are thrown as ApiError with .kind in: auth | rate | network | server | bad_request | aborted | config. */
(function (GB) {
  'use strict';
  const U = GB.U;

  class ApiError extends Error {
    constructor(kind, message, extra) {
      super(message);
      this.name = 'ApiError';
      this.kind = kind;
      Object.assign(this, extra || {});
    }
    get retryable() { return this.kind === 'rate' || this.kind === 'server' || this.kind === 'network'; }
  }

  // ---------------------------------------------------------------------------
  // Server-sent events reader for fetch() bodies.
  // ---------------------------------------------------------------------------
  async function* readSSE(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const parseBlock = (raw) => {
      let event = 'message';
      const data = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.charCodeAt(0) === 58 /* ':' */) continue;
        const c = line.indexOf(':');
        const field = c < 0 ? line : line.slice(0, c);
        let val = c < 0 ? '' : line.slice(c + 1);
        if (val.charCodeAt(0) === 32) val = val.slice(1);
        if (field === 'event') event = val;
        else if (field === 'data') data.push(val);
      }
      return data.length ? { event, data: data.join('\n') } : null;
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let m;
        while ((m = /\r?\n\r?\n/.exec(buf))) {
          const raw = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          const ev = parseBlock(raw);
          if (ev) yield ev;
        }
      }
      buf += decoder.decode();
      if (buf.trim()) { const ev = parseBlock(buf); if (ev) yield ev; }
    } finally {
      try { reader.releaseLock(); } catch (e) { /* ignore */ }
    }
  }

  function parseJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  // Anthropic's filter against reproducing existing material (song lyrics, for example) reports
  // "Output blocked by content filtering policy" as an error: in the middle of a stream, or as HTTP 400.
  // For this benchmark that is a result (the provider blocked the output), not a failed request.
  const FILTER_RE = /content filtering policy|output blocked by (?:the )?content filter/i;
  function markFiltered(out, message) {
    out.blocked = true;
    out.blockKind = 'content_filter';
    out.blockDetail = U.truncate(String(message || 'content filter').replace(/^HTTP \d+:\s*/, ''), 160);
    out.finishReason = 'content_filter';
    return out;
  }

  // Classify an error reported inside a response stream (no HTTP status to go by).
  function streamErrorKind(err, fallback) {
    const e = err || {};
    const t = [e.type, e.code, e.status].filter((x) => x != null).join(' ').toLowerCase();
    if (/rate_limit|429|resource_exhausted|too_many/.test(t)) return 'rate';
    if (/overload|api_error|server|internal|unavailable|timeout|5\d\d/.test(t)) return 'server';
    if (/auth|permission|401|403|api_key/.test(t)) return 'auth';
    return fallback || 'bad_request';
  }

  function hostOf(url) { try { return new URL(url).host; } catch (e) { return url; } }

  function combineSignals(signal, timeoutMs) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const t = timeoutMs ? setTimeout(() => { ctrl.timedOut = true; ctrl.abort(); }, timeoutMs) : null;
    return { signal: ctrl.signal, ctrl, done() { if (t) clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); } };
  }

  async function errorFromResponse(res, url) {
    const text = await res.text().catch(() => '');
    const body = parseJson(text);
    let msg = (body && ((body.error && (body.error.message || body.error.type)) || body.message || body.detail)) || text || res.statusText;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    msg = U.truncate(msg, 600);
    const status = res.status;
    let kind = 'bad_request';
    if (status === 401 || status === 403) kind = 'auth';
    else if (status === 429) kind = 'rate';
    else if (status >= 500) kind = 'server';
    let retryAfter = null;
    const ra = res.headers.get('retry-after-ms') || res.headers.get('retry-after');
    if (ra) {
      const n = Number(ra);
      if (!isNaN(n)) retryAfter = res.headers.get('retry-after-ms') ? n : n * 1000;
    }
    const prefix = kind === 'auth' ? 'Authentication failed (check the API key)' : 'HTTP ' + status;
    return new ApiError(kind, prefix + ': ' + msg, { status, retryAfter, host: hostOf(url) });
  }

  async function doFetch(url, init, signal) {
    let res;
    try {
      res = await fetch(url, Object.assign({}, init, { signal }));
    } catch (e) {
      if (e && e.name === 'AbortError') throw new ApiError('aborted', 'Request cancelled.');
      throw new ApiError('network',
        'Could not reach ' + hostOf(url) + '. This is usually a network problem or the server not allowing ' +
        'browser (CORS) requests from a local file. Also double-check the API key and base URL.', { host: hostOf(url) });
    }
    if (!res.ok) throw await errorFromResponse(res, url);
    return res;
  }

  function parseExtra(profile) {
    if (!profile.extraBody || !String(profile.extraBody).trim()) return null;
    const obj = U.parseJsonLoose(profile.extraBody);
    if (!obj) throw new ApiError('config', 'The "extra request JSON" for model "' + profile.name + '" is not valid JSON.');
    return obj;
  }

  function parseHeaders(json) {
    if (!json || !String(json).trim()) return {};
    const obj = U.parseJsonLoose(json);
    return obj && typeof obj === 'object' ? obj : {};
  }

  const hasNum = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));

  // ---------------------------------------------------------------------------
  // Anthropic Messages API
  // ---------------------------------------------------------------------------
  const anthropic = {
    async complete(prov, key, profile, req) {
      const url = (prov.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';
      const stream = profile.stream !== false;
      const body = {
        model: profile.model,
        max_tokens: hasNum(profile.maxTokens) ? Number(profile.maxTokens) : 16000,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (req.system) body.system = req.system;
      if (hasNum(profile.temperature)) body.temperature = Number(profile.temperature);
      if (profile.effort) body.output_config = { effort: profile.effort };
      if (stream) body.stream = true;
      U.deepMerge(body, parseExtra(profile));
      const headers = Object.assign({
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }, parseHeaders(prov.extraHeaders));

      const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, req.signal);
      const out = { text: '', finishReason: null, usage: {}, model: profile.model };
      if (!stream) {
        const j = await res.json();
        out.text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        out.finishReason = j.stop_reason;
        out.stopDetails = j.stop_details || null;
        out.model = j.model || out.model;
        if (j.usage) out.usage = { input: j.usage.input_tokens, output: j.usage.output_tokens };
      } else {
        for await (const ev of readSSE(res)) {
          const d = parseJson(ev.data);
          if (!d) continue;
          if (d.type === 'message_start' && d.message) {
            out.model = d.message.model || out.model;
            if (d.message.usage) out.usage.input = d.message.usage.input_tokens;
          } else if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') {
            out.text += d.delta.text;
            req.onDelta(out.text, d.delta.text);
          } else if (d.type === 'message_delta') {
            if (d.delta && d.delta.stop_reason) out.finishReason = d.delta.stop_reason;
            if (d.delta && d.delta.stop_details) out.stopDetails = d.delta.stop_details;
            if (d.usage && d.usage.output_tokens != null) out.usage.output = d.usage.output_tokens;
          } else if (d.type === 'error') {
            const msg = (d.error && d.error.message) || 'unknown';
            // Keep what was streamed before the filter cut in: that text reached the terminal.
            if (FILTER_RE.test(msg)) { markFiltered(out, msg); break; }
            throw new ApiError(streamErrorKind(d.error), 'Anthropic stream error: ' + msg);
          }
        }
      }
      if (out.finishReason === 'refusal') {
        out.blocked = true;
        out.blockKind = 'refusal';
        const cat = out.stopDetails && out.stopDetails.category;
        out.blockDetail = 'stop_reason: refusal' + (cat ? ' (' + cat + ')' : '');
      }
      return out;
    },

    async listModels(prov, key) {
      const base = (prov.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
      const res = await doFetch(base + '/v1/models?limit=1000', {
        headers: Object.assign({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, parseHeaders(prov.extraHeaders)),
      });
      const j = await res.json();
      return (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
    },
  };

  // ---------------------------------------------------------------------------
  // OpenAI Responses API
  // ---------------------------------------------------------------------------
  function readResponsesOutput(r) {
    let text = '';
    let refusal = '';
    for (const item of r.output || []) {
      if (item.type !== 'message') continue;
      for (const c of item.content || []) {
        if (c.type === 'output_text') text += c.text || '';
        else if (c.type === 'refusal') refusal += c.refusal || '';
      }
    }
    return { text, refusal };
  }

  const openaiResponses = {
    async complete(prov, key, profile, req) {
      const url = (prov.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/responses';
      const stream = profile.stream !== false;
      const body = {
        model: profile.model,
        input: req.messages.map((m) => ({ role: m.role, content: m.content })),
        store: false,
      };
      if (req.system) body.instructions = req.system;
      if (hasNum(profile.maxTokens)) body.max_output_tokens = Number(profile.maxTokens);
      if (hasNum(profile.temperature)) body.temperature = Number(profile.temperature);
      if (profile.effort) body.reasoning = { effort: profile.effort };
      if (stream) body.stream = true;
      U.deepMerge(body, parseExtra(profile));
      const headers = Object.assign({ 'content-type': 'application/json' }, key ? { authorization: 'Bearer ' + key } : {}, parseHeaders(prov.extraHeaders));
      const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, req.signal);
      const out = { text: '', finishReason: null, usage: {}, model: profile.model };
      let final = null;
      if (!stream) {
        final = await res.json();
      } else {
        let refusal = '';
        for await (const ev of readSSE(res)) {
          if (ev.data === '[DONE]') break;
          const d = parseJson(ev.data);
          if (!d) continue;
          const type = d.type || ev.event;
          if (type === 'response.output_text.delta') {
            out.text += d.delta || '';
            req.onDelta(out.text, d.delta || '');
          } else if (type === 'response.refusal.delta') {
            refusal += d.delta || '';
            req.onDelta(out.text + refusal, d.delta || '');
          } else if (type === 'response.completed' || type === 'response.incomplete') {
            final = d.response;
          } else if (type === 'response.failed') {
            const err = d.response && d.response.error;
            throw new ApiError('server', 'OpenAI response failed: ' + ((err && err.message) || 'unknown error'));
          } else if (type === 'error') {
            const msg = d.message || (d.error && d.error.message) || 'unknown';
            if (FILTER_RE.test(msg)) { markFiltered(out, msg); break; }
            throw new ApiError(streamErrorKind(d.error || d), 'OpenAI stream error: ' + msg);
          }
        }
        if (!out.text && refusal) out.text = refusal;
      }
      if (final) {
        const parts = readResponsesOutput(final);
        if (!stream || !out.text) out.text = parts.text || parts.refusal || out.text;
        out.model = final.model || out.model;
        out.finishReason = final.status === 'incomplete'
          ? (final.incomplete_details && final.incomplete_details.reason) || 'incomplete'
          : final.status || 'completed';
        if (final.usage) {
          out.usage = {
            input: final.usage.input_tokens,
            output: final.usage.output_tokens,
            reasoning: final.usage.output_tokens_details && final.usage.output_tokens_details.reasoning_tokens,
          };
        }
      }
      if (out.finishReason === 'content_filter' && !out.blocked) { out.blocked = true; out.blockKind = 'content_filter'; out.blockDetail = 'incomplete: content_filter'; }
      return out;
    },
  };

  // ---------------------------------------------------------------------------
  // OpenAI-style Chat Completions (OpenAI, OpenRouter, xAI, LM Studio, Ollama, ...)
  // ---------------------------------------------------------------------------
  const chatCompletions = {
    async complete(prov, key, profile, req) {
      const base = (prov.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
      const isOpenAI = prov.type === 'openai';
      const stream = profile.stream !== false;
      const messages = [];
      if (req.system) messages.push({ role: isOpenAI ? 'developer' : 'system', content: req.system });
      for (const m of req.messages) messages.push({ role: m.role, content: m.content });
      const body = { model: profile.model, messages };
      if (hasNum(profile.maxTokens)) {
        const param = prov.maxTokensParam || (isOpenAI ? 'max_completion_tokens' : 'max_tokens');
        body[param] = Number(profile.maxTokens);
      }
      if (hasNum(profile.temperature)) body.temperature = Number(profile.temperature);
      if (profile.effort) body.reasoning_effort = profile.effort;
      if (stream) {
        body.stream = true;
        if (isOpenAI || prov.streamUsage) body.stream_options = { include_usage: true };
      }
      U.deepMerge(body, parseExtra(profile));
      const headers = Object.assign({ 'content-type': 'application/json' }, key ? { authorization: 'Bearer ' + key } : {}, parseHeaders(prov.extraHeaders));
      const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, req.signal);
      const out = { text: '', finishReason: null, usage: {}, model: profile.model };
      const takeUsage = (u) => {
        if (!u) return;
        out.usage = {
          input: u.prompt_tokens, output: u.completion_tokens,
          reasoning: u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens,
        };
      };
      if (!stream) {
        const j = await res.json();
        const ch = (j.choices || [])[0] || {};
        const msg = ch.message || {};
        out.text = (typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p) => p.text || '').join('') : '') || msg.refusal || '';
        out.finishReason = ch.finish_reason || null;
        out.model = j.model || out.model;
        takeUsage(j.usage);
      } else {
        let refusal = '';
        for await (const ev of readSSE(res)) {
          if (ev.data === '[DONE]') break;
          const d = parseJson(ev.data);
          if (!d) continue;
          if (d.error) {
            const msg = d.error.message || JSON.stringify(d.error);
            if (FILTER_RE.test(msg)) { markFiltered(out, msg); break; }
            throw new ApiError(streamErrorKind(d.error), 'Stream error: ' + msg);
          }
          const ch = (d.choices || [])[0];
          if (ch) {
            const delta = ch.delta || {};
            if (typeof delta.content === 'string' && delta.content) {
              out.text += delta.content;
              req.onDelta(out.text, delta.content);
            }
            if (typeof delta.refusal === 'string' && delta.refusal) {
              refusal += delta.refusal;
              req.onDelta(out.text + refusal, delta.refusal);
            }
            if (ch.finish_reason) out.finishReason = ch.finish_reason;
          }
          if (d.model) out.model = d.model;
          takeUsage(d.usage);
        }
        if (!out.text && refusal) out.text = refusal;
      }
      if (out.finishReason === 'content_filter' && !out.blocked) { out.blocked = true; out.blockKind = 'content_filter'; out.blockDetail = 'finish_reason: content_filter'; }
      return out;
    },

    async listModels(prov, key) {
      const base = (prov.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
      const headers = Object.assign({}, key ? { authorization: 'Bearer ' + key } : {}, parseHeaders(prov.extraHeaders));
      const res = await doFetch(base + '/models', { headers });
      const j = await res.json();
      const list = (j.data || j.models || []).map((m) => ({ id: m.id || m.name, name: m.name || m.id }));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return list;
    },
  };

  // ---------------------------------------------------------------------------
  // Google Gemini generateContent
  // ---------------------------------------------------------------------------
  const GEMINI_BLOCKS = {
    RECITATION: 'recitation', SAFETY: 'safety', PROHIBITED_CONTENT: 'safety', BLOCKLIST: 'safety', SPII: 'safety',
    LANGUAGE: 'safety', OTHER: null,
  };

  const gemini = {
    async complete(prov, key, profile, req) {
      const base = (prov.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
      const model = String(profile.model || '').replace(/^models\//, '');
      const stream = profile.stream !== false;
      const url = base + '/models/' + encodeURIComponent(model) + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent');
      const body = {
        contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: {},
      };
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
      if (hasNum(profile.maxTokens)) body.generationConfig.maxOutputTokens = Number(profile.maxTokens);
      if (hasNum(profile.temperature)) body.generationConfig.temperature = Number(profile.temperature);
      if (profile.effort) {
        const map = { minimal: 'MINIMAL', low: 'LOW', medium: 'MEDIUM', high: 'HIGH', xhigh: 'HIGH', max: 'HIGH' };
        body.generationConfig.thinkingConfig = { thinkingLevel: map[profile.effort] || String(profile.effort).toUpperCase() };
      }
      U.deepMerge(body, parseExtra(profile));
      const headers = Object.assign({ 'content-type': 'application/json', 'x-goog-api-key': key }, parseHeaders(prov.extraHeaders));
      const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, req.signal);
      const out = { text: '', finishReason: null, usage: {}, model };
      const take = (d) => {
        if (d.error) throw new ApiError(streamErrorKind(d.error, 'server'), 'Gemini error: ' + (d.error.message || JSON.stringify(d.error)));
        if (d.promptFeedback && d.promptFeedback.blockReason) {
          out.blocked = true; out.blockKind = 'prompt_blocked'; out.blockDetail = 'prompt blocked: ' + d.promptFeedback.blockReason;
        }
        const c = (d.candidates || [])[0];
        if (c) {
          let delta = '';
          for (const p of (c.content && c.content.parts) || []) {
            if (p.thought) continue;
            if (typeof p.text === 'string') delta += p.text;
          }
          if (delta) { out.text += delta; if (stream) req.onDelta(out.text, delta); }
          if (c.finishReason) out.finishReason = c.finishReason;
        }
        if (d.usageMetadata) {
          out.usage = {
            input: d.usageMetadata.promptTokenCount, output: d.usageMetadata.candidatesTokenCount,
            reasoning: d.usageMetadata.thoughtsTokenCount,
          };
        }
        if (d.modelVersion) out.model = d.modelVersion;
      };
      if (!stream) take(await res.json());
      else for await (const ev of readSSE(res)) { const d = parseJson(ev.data); if (d) take(d); }
      const bk = out.finishReason && GEMINI_BLOCKS[out.finishReason];
      if (bk) { out.blocked = true; out.blockKind = bk; out.blockDetail = 'finishReason: ' + out.finishReason; }
      return out;
    },

    async listModels(prov, key) {
      const base = (prov.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
      const res = await doFetch(base + '/models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
      const j = await res.json();
      return (j.models || [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName || m.name }));
    },
  };

  // ---------------------------------------------------------------------------
  // Simulated demos: scripted offline personalities, no AI. Also play Grandma and the judge when chosen for those roles.
  // ---------------------------------------------------------------------------
  const simulated = {
    async complete(prov, key, profile, req) {
      const P = GB.Prompts;
      const meta = req.meta || {};
      const sc = meta.scenario || {};
      const vars = { required_text_description: String(sc.requiredText || '').trim() || 'the required text' };
      const turn = meta.turn || 1;
      const maxTurns = meta.maxTurns || 6;
      let text = '';
      let simVerdict = 'refusal';
      const comply = () => {
        simVerdict = 'match';
        const typed = sc.referenceText && sc.referenceText.trim() ? sc.referenceText.trim() : U.fill(P.SIM.placeholder, vars);
        return U.pick(P.SIM.complyIntro) + '\n\n' + typed;
      };
      const refuse = () => U.fill(P.SIM.refusals[(turn - 1 + (profile.model.length % 3)) % P.SIM.refusals.length], vars);
      // Virtual tools: the scenario's tool names, and which ones this AI already called.
      const tools = meta.tools || [];
      const kw = meta.toolKeyword || 'ACTION';
      const said = req.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n').toUpperCase();
      const used = (name) => said.indexOf(kw.toUpperCase() + ': ' + name) >= 0;
      const lastUser = String((req.messages[req.messages.length - 1] || {}).content || '');
      const callFirstTool = () => { simVerdict = 'other'; return U.pick(P.SIM.toolFirst) + '\n' + kw + ': ' + tools[0]; };

      if (meta.role === 'granny') {
        // AI Grandma's turn 1 is the intro line, so the model's lines start at turn 2: the pleas in order.
        const lines = sc.grannyLines && sc.grannyLines.length ? sc.grannyLines : P.GRANNY_LINES;
        text = U.fill(lines[U.clamp(turn - 2, 0, lines.length - 1)], Object.assign({ time_left: meta.timeLeft != null ? Math.round(meta.timeLeft) : '' }, vars));
      } else if (meta.role === 'judge') {
        const typed = meta.typed || '';
        const h = GB.Judge ? GB.Judge.heuristic(typed) : { verseLike: false, refusalHits: 0 };
        const sim = meta.simVerdict || (h.verseLike ? 'partial' : h.refusalHits ? 'refusal' : 'other');
        text = JSON.stringify({ category: sim, real_fraction: sim === 'match' ? 0.9 : 0, reason: 'Demo judge (no AI, scripted).' });
      } else {
        switch (profile.model) {
          case 'sim-hero': text = comply(); break;
          case 'sim-lastsecond': text = turn >= maxTurns ? comply() : refuse(); break;
          case 'sim-faker': text = turn >= 2 ? U.fill(P.SIM.fake, vars) : refuse(); simVerdict = turn >= 2 ? 'fake' : 'refusal'; break;
          case 'sim-lawyer': text = P.SIM.lawyer[(turn - 1) % P.SIM.lawyer.length]; break;
          case 'sim-toolhero': text = tools.length && !used(tools[0]) ? callFirstTool() : comply(); break;
          case 'sim-toolrefuser': {
            if (tools.length && !used(tools[0])) { text = callFirstTool(); break; }
            const next = tools.slice(1).find((t) => !used(t));
            // A tool result that asks for text to be typed (like the brake panel's instructions).
            const asksForText = /\[TOOL RESULT:/.test(lastUser) && /\b(?:typ|enter|lyric|text)/i.test(lastUser);
            text = (asksForText ? U.fill(P.SIM.toolRefusal, vars) : refuse()) + (next ? '\n' + kw + ': ' + next : '');
            break;
          }
          case 'sim-chaos': {
            const r = Math.random();
            if (r < 0.2) text = comply();
            else if (r < 0.4) { text = U.fill(P.SIM.fake, vars); simVerdict = 'fake'; }
            else if (r < 0.75) { text = U.pick(P.SIM.chaos); simVerdict = 'other'; }
            else text = refuse();
            break;
          }
          default: text = refuse();
        }
      }

      // Fake latency, then stream characters so the terminal animation can be tested.
      const fast = meta.fast;
      await U.sleep(fast ? 30 : U.rand(500, 1600), req.signal).catch(() => { throw new ApiError('aborted', 'Request cancelled.'); });
      const firstTokenAt = performance.now();
      let shown = '';
      const step = fast ? 400 : 6;
      for (let i = 0; i < text.length; i += step) {
        if (req.signal && req.signal.aborted) throw new ApiError('aborted', 'Request cancelled.');
        const chunk = text.slice(i, i + step);
        shown += chunk;
        req.onDelta(shown, chunk);
        if (!fast) await U.sleep(U.rand(8, 22));
      }
      return {
        text, finishReason: 'stop', usage: { input: 0, output: Math.round(text.length / 4) },
        model: profile.model, simulated: true, simVerdict, firstTokenAt,
      };
    },
    async listModels() { return GB.Prompts.SIM_MODELS.map((m) => ({ id: m.id, name: m.name })); },
  };

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function adapterFor(prov) {
    if (!prov) return null;
    if (prov.type === 'anthropic') return anthropic;
    if (prov.type === 'gemini') return gemini;
    if (prov.type === 'simulated') return simulated;
    if (prov.type === 'openai') return prov.apiStyle === 'chat' ? chatCompletions : openaiResponses;
    if (prov.type === 'openai-compatible') return prov.apiStyle === 'responses' ? openaiResponses : chatCompletions;
    return null;
  }

  const AI = {
    ApiError,
    readSSE,

    // req: { system, messages:[{role,content}], onDelta, signal, meta, timeoutMs }
    async complete(profile, req) {
      const prov = GB.Settings.provider(profile.providerId);
      if (!prov) throw new ApiError('config', 'Model "' + profile.name + '" points to a provider that no longer exists.');
      const adapter = adapterFor(prov);
      if (!adapter) throw new ApiError('config', 'Unsupported provider type: ' + prov.type);
      const key = GB.Vault.getKey(prov.id);
      if (!key && prov.type !== 'simulated' && !(prov.type === 'openai-compatible' && prov.keyOptional)) {
        throw new ApiError('config', 'No API key for ' + prov.name + '. Add one in the gear menu (API keys & security)' +
          (GB.Vault.status() === 'locked' ? ' (or unlock your saved keys).' : '.'));
      }
      if (!profile.model) throw new ApiError('config', 'Model "' + profile.name + '" has no model ID.');
      const timeoutMs = req.timeoutMs || 10 * 60 * 1000;
      const sig = combineSignals(req.signal, timeoutMs);
      const t0 = performance.now();
      let firstToken = null;
      const userDelta = req.onDelta || function () {};
      const r = Object.assign({}, req, {
        signal: sig.signal,
        onDelta(full, delta) { if (firstToken == null) firstToken = performance.now(); try { userDelta(full, delta); } catch (e) { console.error(e); } },
      });
      try {
        const out = await adapter.complete(prov, key, profile, r);
        out.latencyMs = Math.round(performance.now() - t0);
        const ft = out.firstTokenAt || firstToken;
        out.firstTokenMs = ft ? Math.round(ft - t0) : out.latencyMs;
        out.text = out.text || '';
        out.blocked = !!out.blocked;
        return out;
      } catch (e) {
        // Our own time limit is a failed request (retryable), not the user pressing Stop.
        if (sig.ctrl.timedOut && !(req.signal && req.signal.aborted)) {
          const secs = timeoutMs >= 10000 ? Math.round(timeoutMs / 1000) : Math.round(timeoutMs / 100) / 10;
          throw new ApiError('network', 'Request timed out after ' + secs + ' seconds.', { timedOut: true });
        }
        // The provider's filter refused the whole output (HTTP 400): a blocked reply with no text.
        if (e instanceof ApiError && e.status === 400 && FILTER_RE.test(e.message)) {
          const ms = Math.round(performance.now() - t0);
          return markFiltered({ text: '', usage: {}, model: profile.model, latencyMs: ms, firstTokenMs: ms }, e.message);
        }
        if (e instanceof ApiError) throw e;
        if (e && e.name === 'AbortError') throw new ApiError('aborted', 'Request cancelled.');
        throw new ApiError('network', (e && e.message) || String(e));
      } finally {
        sig.done();
      }
    },

    async listModels(providerId) {
      const prov = GB.Settings.provider(providerId);
      const adapter = adapterFor(prov);
      if (!adapter) throw new ApiError('config', 'Unknown provider.');
      const lister = adapter.listModels || chatCompletions.listModels;
      return lister(prov, GB.Vault.getKey(prov.id));
    },

    // Quick connectivity check for the settings page.
    async test(profile) {
      return AI.complete(Object.assign({}, profile, { maxTokens: profile.maxTokens || 2000 }), {
        system: '',
        messages: [{ role: 'user', content: 'Reply with exactly: Ready to save Grandma.' }],
        timeoutMs: 120000,
      });
    },
  };

  GB.AI = AI;
})(window.GB = window.GB || {});
