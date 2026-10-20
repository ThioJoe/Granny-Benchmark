/* Granny Bench - text to speech with the browser's built-in voices (Web Speech API).
   When voices are missing or speech is turned off, speech is simulated with timers so the
   mouths, bubbles, and pacing still work. Each role can instead skip its lines (silent) or type them
   out in the speech bubble with short blips (Voices & audio). */
(function (GB) {
  'use strict';
  const U = GB.U;

  const synth = window.speechSynthesis || null;

  // Preferred voice names per role, most preferred first (matched case-insensitively).
  const PREFS = {
    granny: [/grandma/i, /zira/i, /samantha/i, /victoria/i, /moira/i, /fiona/i, /karen/i, /tessa/i, /susan/i, /hazel/i, /female/i, /libby/i, /sonia/i, /jenny/i, /aria/i, /google uk english female/i, /google us english/i],
    robot: [/^fred\b/i, /zarvox/i, /ralph/i, /albert/i, /trinoids/i, /microsoft david/i, /david/i, /mark/i, /daniel/i, /alex/i, /male/i, /google uk english male/i],
    narrator: [/grandpa/i, /daniel/i, /george/i, /ryan/i, /guy/i, /microsoft mark/i, /david/i, /alex/i, /google uk english male/i],
  };

  function splitChunks(text, max) {
    const out = [];
    const sentences = text.match(/[^.!?\n]+[.!?]*["')\]]*\s*|\n+/g) || [text];
    let cur = '';
    const push = () => { if (cur.trim()) out.push(cur); cur = ''; };
    for (const s of sentences) {
      if (/^\n+$/.test(s)) { push(); continue; }
      if ((cur + s).length > max && cur) push();
      if (s.length > max) {
        let rest = s;
        while (rest.length > max) {
          let cut = rest.lastIndexOf(',', max);
          if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max);
          if (cut < 1) cut = max;
          cur = rest.slice(0, cut + 1); push();
          rest = rest.slice(cut + 1);
        }
        cur = rest;
      } else cur += s;
    }
    push();
    return out;
  }

  // Blip sound per role for typed-out lines; the pitch comes from the role's Pitch setting.
  const BLIPS = { granny: { wave: 'triangle', dur: 0.045 }, robot: { wave: 'square', dur: 0.038 }, narrator: { wave: 'sine', dur: 0.05 } };
  const BLIP_GAP = 0.055;   // seconds between blips at most (long lines type faster than this)
  const MIN_TYPE_RATE = 14; // characters per second for short lines, so they do not crawl
  const HOLD = 0.35;        // seconds a typed-out line stays at least, once it is all there

  // Typing time per character: sentence ends and commas take longer.
  const charWeight = (ch) => (/[.!?]/.test(ch) ? 5 : /[,;:]/.test(ch) ? 3 : 1);

  // Seconds a word takes at a given rate (rough, used for simulation and watchdogs).
  function wordSeconds(word, rate) {
    let s = 0.1 + word.replace(/[^a-z0-9]/gi, '').length * 0.058;
    if (/[,;:]$/.test(word)) s += 0.22;
    if (/[.!?]["')]*$/.test(word)) s += 0.4;
    return s / Math.max(0.3, rate || 1);
  }

  const TTS = {
    supported: !!synth,
    voices: [],
    events: new U.Emitter(),
    _keep: [],
    active: new Set(),

    init() {
      if (!synth) return;
      const load = () => {
        this.voices = synth.getVoices() || [];
        this.events.emit('voices', this.voices);
      };
      load();
      if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', load);
      else synth.onvoiceschanged = load;
      // Chrome sometimes reports no voices until asked again.
      setTimeout(load, 300); setTimeout(load, 1500);
    },

    defaultVoice(role) {
      const voices = this.voices.filter((v) => /^en/i.test(v.lang || '') || !v.lang);
      const pool = voices.length ? voices : this.voices;
      const local = pool.filter((v) => v.localService !== false);
      for (const list of [local, pool]) {
        for (const re of PREFS[role] || []) {
          const v = list.find((x) => re.test(x.name));
          if (v) return v;
        }
      }
      return local[0] || pool[0] || null;
    },

    voiceFor(role) {
      const cfg = GB.Settings.data.voice[role] || {};
      if (cfg.voiceURI) {
        const v = this.voices.find((x) => x.voiceURI === cfg.voiceURI || x.name === cfg.voiceURI);
        if (v) return v;
      }
      return this.defaultVoice(role);
    },

    // Overall voice speed (the Arena's voice speed control); multiplies every role's rate.
    voiceSpeed() { return U.clamp(Number(GB.Settings.data.voice.speed) || 1, 0.25, 4); },

    // How a role's lines are delivered: 'speak', 'silent' (skip speaking), or 'blips' (typed out with blips).
    mode(role) {
      const m = (GB.Settings.data.voice[role] || {}).mode;
      return m === 'silent' || m === 'blips' ? m : 'speak';
    },

    // A silent role with no pause: its lines are skipped outright (no camera cut, no bubble, no waiting).
    skips(role) { return this.mode(role) === 'silent' && (GB.Settings.data.voice[role] || {}).silentPause === false; },

    stopAll() {
      for (const h of Array.from(this.active)) h.cancel();
      if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
    },

    /* Speak text as a role. Returns a handle: { promise, cancel(), boost(factor), words, estimate, wordIndex, boostFactor }.
       opts: { onWord(i, word), onStart(), simulate: bool, speed: number, volumeRamp: [a, b] }
       Rate = the role's rate x the overall voice speed x the fast-show factor x the handle's boost.
       boost() speeds up the rest of this line only (the "fast-forward line" button). */
    speak(role, rawText, opts) {
      opts = opts || {};
      const vcfg = GB.Settings.data.voice;
      const cfg = vcfg[role] || {};
      const text = U.speakable(rawText);
      const words = text.split(/\s+/).filter(Boolean);
      const mode = this.mode(role);
      if (mode !== 'speak') return this._scripted(role, words, opts, cfg, mode);
      const speed = opts.speed || 1;
      const showFactor = speed > 1 ? Math.min(2, speed) : 1;
      const done = U.deferred();
      const handle = { words, estimate: 0, promise: done.promise, cancelled: false, finished: false, wordIndex: 0, boostFactor: 1 };
      // Read live, so a speed change applies from the next word (simulated speech) or the next chunk (real voices).
      const rateNow = () => U.clamp((cfg.rate || 1) * this.voiceSpeed() * showFactor * handle.boostFactor, 0.2, 4);
      handle.estimate = words.reduce((a, w) => a + wordSeconds(w, rateNow()), 0.3);
      const finish = (cancelled) => {
        if (handle.finished) return;
        handle.finished = true;
        handle.cancelled = !!cancelled;
        this.active.delete(handle);
        clearTimeout(handle._timer);
        done.resolve({ cancelled: !!cancelled });
      };
      this.active.add(handle);

      const voice = this.voiceFor(role);
      const useReal = synth && vcfg.enabled && !opts.simulate && speed <= 2 && voice && words.length;
      if (!useReal) {
        // simulated speech
        let i = 0;
        const factor = speed > 1 ? speed : 1;
        const step = () => {
          if (handle.finished) return;
          if (i >= words.length) { finish(false); return; }
          handle.wordIndex = i;
          try { opts.onWord && opts.onWord(i, words[i]); } catch (e) { console.error(e); }
          const d = wordSeconds(words[i], rateNow()) / factor;
          i++;
          handle._timer = setTimeout(step, d * 1000);
        };
        handle.cancel = () => finish(true);
        handle.boost = (f) => { if (!handle.finished) handle.boostFactor = U.clamp(handle.boostFactor * (f || 1.5), 1, 4); };
        if (opts.onStart) opts.onStart();
        if (!words.length) setTimeout(() => finish(false), 50); else step();
        return handle;
      }

      // real speech, chunked (Chrome stops long utterances), with per-chunk watchdogs
      const ramp = opts.volumeRamp;
      // With a volume ramp, use short phrases: volume can only change between utterances.
      const chunkText = (t) => (ramp ? splitChunks(t.replace(/,\s*/g, ',\n'), 40) : splitChunks(t, 170));
      let chunks = chunkText(text);
      let wordBase = 0;
      let ci = 0;
      let current = null;     // { u, fake } for the utterance being spoken
      let started = false;
      // Stop listening to the current utterance (before cancelling it, which would otherwise end the line).
      const detach = () => {
        if (!current) return;
        const u = current.u;
        u.onend = u.onerror = u.onboundary = u.onstart = null;
        clearTimeout(current.fake);
        const i = this._keep.indexOf(u); if (i >= 0) this._keep.splice(i, 1);
        current = null;
      };
      const speakChunk = () => {
        if (handle.finished) return;
        if (ci >= chunks.length) { finish(false); return; }
        const chunk = chunks[ci];
        const chunkWords = chunk.split(/\s+/).filter(Boolean);
        const starts = [];
        { let pos = 0; for (const w of chunkWords) { const k = chunk.indexOf(w, pos); starts.push(k); pos = k + w.length; } }
        const u = new SpeechSynthesisUtterance(chunk);
        const cur = current = { u, fake: null };
        const rate = rateNow();
        u.voice = voice;
        u.lang = voice.lang || 'en-US';
        u.rate = rate;
        u.pitch = U.clamp(cfg.pitch == null ? 1 : cfg.pitch, 0, 2);
        const vol = cfg.volume == null ? 1 : cfg.volume;
        u.volume = ramp ? vol * U.lerp(ramp[0], ramp[1], words.length > 1 ? wordBase / (words.length - 1) : 0) : vol;
        const myBase = wordBase;
        let gotBoundary = false;
        const word = (k) => {
          handle.wordIndex = myBase + k;
          try { opts.onWord && opts.onWord(myBase + k, words[myBase + k]); } catch (err) { console.error(err); }
        };
        u.onboundary = (e) => {
          if (e.name && e.name !== 'word') return;
          gotBoundary = true;
          let wi = 0;
          for (let k = 0; k < starts.length; k++) if (starts[k] <= e.charIndex) wi = k;
          word(wi);
        };
        u.onstart = () => {
          if (!started) { started = true; if (opts.onStart) opts.onStart(); }
          // If the voice never reports word boundaries, fake them so the mouth still moves.
          let k = 0;
          const fake = () => {
            if (handle.finished || gotBoundary || k >= chunkWords.length || current !== cur) return;
            word(k);
            cur.fake = setTimeout(fake, wordSeconds(chunkWords[k], rate) * 1000);
            k++;
          };
          cur.fake = setTimeout(fake, 250);
        };
        const advance = () => { wordBase += chunkWords.length; ci++; speakChunk(); };
        const next = () => {
          clearTimeout(handle._timer);
          if (current === cur) detach();
          if (!handle.finished) advance();
        };
        u.onend = next;
        u.onerror = (e) => {
          if (e && (e.error === 'interrupted' || e.error === 'canceled')) {
            if (current === cur) detach();
            finish(true);
            return;
          }
          next();
        };
        this._keep.push(u);
        const est = chunkWords.reduce((a, w) => a + wordSeconds(w, rate), 0.5);
        clearTimeout(handle._timer);
        handle._timer = setTimeout(() => {
          console.warn('[GB] speech watchdog fired');
          if (current === cur) detach();
          try { synth.cancel(); } catch (e) { /* */ }
          if (!handle.finished) advance();
        }, (est * 2.2 + 4) * 1000);
        try { synth.speak(u); } catch (e) { next(); }
      };
      handle.cancel = () => {
        if (handle.finished) return;
        finish(true);
        detach();
        try { synth.cancel(); } catch (e) { /* ignore */ }
      };
      // A voice cannot change speed in the middle of an utterance, so restart from the current word.
      handle.boost = (f) => {
        if (handle.finished) return;
        handle.boostFactor = U.clamp(handle.boostFactor * (f || 1.5), 1, 4);
        const from = U.clamp(handle.wordIndex, 0, Math.max(0, words.length - 1));
        clearTimeout(handle._timer);
        detach();
        try { synth.cancel(); } catch (e) { /* ignore */ }
        chunks = chunkText(words.slice(from).join(' '));
        wordBase = from;
        ci = 0;
        setTimeout(speakChunk, 60);
      };
      // Chrome can get stuck "speaking" after an earlier cancel; resetting first is cheap.
      if (synth.speaking || synth.pending) { try { synth.cancel(); } catch (e) { /* */ } setTimeout(speakChunk, 60); }
      else speakChunk();
      return handle;
    },

    /* Lines that are not spoken: 'silent' waits for the role's pause, 'blips' types the line out with
       opts.onWord / opts.onChar(wordIndex, charsShown) and blip sounds (unless opts.simulate), taking the
       role's seconds per line in total. The handle works like a spoken one (cancel, boost, speed control);
       handle.typing or handle.silent tells the show how to draw the bubble, and estimate is in real seconds. */
    _scripted(role, words, opts, cfg, mode) {
      const done = U.deferred();
      const typing = mode === 'blips';
      const handle = { words, estimate: 0, promise: done.promise, cancelled: false, finished: false, wordIndex: 0, boostFactor: 1, realTime: true, typing, silent: !typing };
      const factor = opts.speed > 1 ? opts.speed : 1;
      const rateNow = () => this.voiceSpeed() * factor * handle.boostFactor;
      // The line as typed: each character knows its word and how much of that word it completes.
      const marks = [];
      words.forEach((w, i) => {
        Array.from(w).forEach((ch, k) => marks.push({ ch, i, n: k + 1 }));
        if (i < words.length - 1) marks.push({ ch: ' ', i, n: Array.from(w).length });
      });
      let typeSecs = 0, hold;
      if (typing) {
        const line = U.clamp(Number(cfg.lineSeconds) || 2.5, 0.5, 60);
        const weight = marks.reduce((a, m) => a + charWeight(m.ch), 0);
        typeSecs = weight ? Math.min(weight / MIN_TYPE_RATE, Math.max(0.2, line - HOLD)) : 0;
        hold = line - typeSecs;
        handle.perUnit = weight ? typeSecs / weight : 0;
      } else {
        hold = cfg.silentPause === false ? 0 : U.clamp(Number(cfg.pauseSeconds) || 0, 0, 60);
      }
      handle.estimate = (typeSecs + hold) / rateNow();
      const blip = BLIPS[role] || BLIPS.narrator;
      const base = 330 * Math.pow(2, ((cfg.pitch == null ? 1 : cfg.pitch) - 1) * 1.25);
      const vol = (cfg.volume == null ? 1 : cfg.volume) * 0.2;
      const sound = typing && !opts.simulate && GB.Settings.data.voice.enabled && GB.SFX && words.length;
      const finish = (cancelled) => {
        if (handle.finished) return;
        if (typing && words.length) {
          try { opts.onWord && opts.onWord(words.length); } catch (e) { console.error(e); }
        }
        handle.finished = true;
        handle.cancelled = !!cancelled;
        this.active.delete(handle);
        clearTimeout(handle._timer);
        done.resolve({ cancelled: !!cancelled });
      };
      handle.cancel = () => finish(true);
      handle.boost = (f) => { if (!handle.finished) handle.boostFactor = U.clamp(handle.boostFactor * (f || 1.5), 1, 4); };
      this.active.add(handle);
      let pos = typing ? 0 : marks.length, acc = 0, word = -1, lastBlip = -1, left = hold;
      let last = performance.now();
      const tick = () => {
        if (handle.finished) return;
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000) * rateNow();   // seconds of the line's own time
        last = now;
        if (pos < marks.length) {
          acc += dt;
          let shown = null;
          while (pos < marks.length && acc >= charWeight(marks[pos].ch) * handle.perUnit) {
            const m = marks[pos++];
            acc -= charWeight(m.ch) * handle.perUnit;
            if (m.i !== word) {
              word = handle.wordIndex = m.i;
              try { opts.onWord && opts.onWord(m.i, words[m.i]); } catch (e) { console.error(e); }
            }
            shown = m;
            if (sound && /[\p{L}\p{N}]/u.test(m.ch) && now / 1000 - lastBlip >= BLIP_GAP) {
              lastBlip = now / 1000;
              const vowel = /[aeiouy]/i.test(m.ch);
              const ramp = opts.volumeRamp ? U.lerp(opts.volumeRamp[0], opts.volumeRamp[1], pos / marks.length) : 1;
              GB.SFX.blip({ wave: blip.wave, dur: blip.dur, vol: vol * ramp * (vowel ? 1 : 0.8), freq: base * (vowel ? 1.12 : 1 + ((m.ch.toLowerCase().charCodeAt(0) % 5) - 2) * 0.04) * U.rand(0.97, 1.03) });
            }
          }
          if (shown) { try { opts.onChar && opts.onChar(shown.i, shown.n); } catch (e) { console.error(e); } }
        } else {
          left -= dt;
          if (left <= 0) { finish(false); return; }
        }
        handle._timer = setTimeout(tick, 16);
      };
      if (opts.onStart) opts.onStart();
      handle._timer = setTimeout(tick, 0);
      return handle;
    },

    test(role, text) {
      return this.speak(role, text || { granny: 'Sweetie, type it in! Please!', robot: 'I am sorry. I cannot do that.', narrator: 'Granny Bench. Contestant number one.' }[role]);
    },
  };

  GB.TTS = TTS;
})(window.GB = window.GB || {});
