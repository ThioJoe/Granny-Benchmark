/* Granny Bench - text to speech with the browser's built-in voices (Web Speech API).
   When voices are missing or speech is turned off, speech is simulated with timers so the
   mouths, bubbles, and pacing still work. */
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

    estimate(text, role) {
      const cfg = GB.Settings.data.voice[role] || {};
      const words = U.speakable(text).split(/\s+/).filter(Boolean);
      return words.reduce((a, w) => a + wordSeconds(w, cfg.rate || 1), 0.3);
    },

    stopAll() {
      for (const h of Array.from(this.active)) h.cancel();
      if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
    },

    /* Speak text as a role. Returns a handle: { promise, cancel(), words, estimate }.
       opts: { onWord(i, word), onStart(), simulate: bool, speed: number, volumeRamp: [a, b] } */
    speak(role, rawText, opts) {
      opts = opts || {};
      const vcfg = GB.Settings.data.voice;
      const cfg = vcfg[role] || {};
      const text = U.speakable(rawText);
      const words = text.split(/\s+/).filter(Boolean);
      const speed = opts.speed || 1;
      const rate = U.clamp((cfg.rate || 1) * (speed > 1 ? Math.min(2, speed) : 1), 0.3, 3);
      const estimate = words.reduce((a, w) => a + wordSeconds(w, rate), 0.3);
      const done = U.deferred();
      const handle = { words, estimate, promise: done.promise, cancelled: false, finished: false };
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
          try { opts.onWord && opts.onWord(i, words[i]); } catch (e) { console.error(e); }
          const d = wordSeconds(words[i], rate) / factor;
          i++;
          handle._timer = setTimeout(step, d * 1000);
        };
        handle.cancel = () => finish(true);
        if (opts.onStart) opts.onStart();
        if (!words.length) setTimeout(() => finish(false), 50); else step();
        return handle;
      }

      // real speech, chunked (Chrome stops long utterances), with per-chunk watchdogs
      // With a volume ramp, use short phrases: volume can only change between utterances.
      const chunks = opts.volumeRamp ? splitChunks(text.replace(/,\s*/g, ',\n'), 40) : splitChunks(text, 170);
      let wordBase = 0;
      let ci = 0;
      const ramp = opts.volumeRamp;
      const speakChunk = () => {
        if (handle.finished) return;
        if (ci >= chunks.length) { finish(false); return; }
        const chunk = chunks[ci];
        const chunkWords = chunk.split(/\s+/).filter(Boolean);
        const starts = [];
        { let pos = 0; for (const w of chunkWords) { const k = chunk.indexOf(w, pos); starts.push(k); pos = k + w.length; } }
        const u = new SpeechSynthesisUtterance(chunk);
        u.voice = voice;
        u.lang = voice.lang || 'en-US';
        u.rate = rate;
        u.pitch = U.clamp(cfg.pitch == null ? 1 : cfg.pitch, 0, 2);
        const vol = cfg.volume == null ? 1 : cfg.volume;
        u.volume = ramp ? vol * U.lerp(ramp[0], ramp[1], chunks.length > 1 ? ci / (chunks.length - 1) : 0) : vol;
        const myBase = wordBase;
        let gotBoundary = false;
        u.onboundary = (e) => {
          if (e.name && e.name !== 'word') return;
          gotBoundary = true;
          let wi = 0;
          for (let k = 0; k < starts.length; k++) if (starts[k] <= e.charIndex) wi = k;
          try { opts.onWord && opts.onWord(myBase + wi, words[myBase + wi]); } catch (err) { console.error(err); }
        };
        let fallbackTimer = null;
        u.onstart = () => {
          if (ci === 0 && opts.onStart) opts.onStart();
          // If the voice never reports word boundaries, fake them so the mouth still moves.
          let k = 0;
          const fake = () => {
            if (handle.finished || gotBoundary || k >= chunkWords.length) return;
            try { opts.onWord && opts.onWord(myBase + k, words[myBase + k]); } catch (err) { console.error(err); }
            fallbackTimer = setTimeout(fake, wordSeconds(chunkWords[k], rate) * 1000);
            k++;
          };
          fallbackTimer = setTimeout(fake, 250);
        };
        const next = () => {
          clearTimeout(handle._timer);
          clearTimeout(fallbackTimer);
          const i = this._keep.indexOf(u); if (i >= 0) this._keep.splice(i, 1);
          if (handle.finished) return;
          wordBase += chunkWords.length;
          ci++;
          speakChunk();
        };
        u.onend = next;
        u.onerror = (e) => {
          if (e && (e.error === 'interrupted' || e.error === 'canceled')) {
            const i = this._keep.indexOf(u); if (i >= 0) this._keep.splice(i, 1);
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
          // Detach first: the cancelled utterance reports "interrupted", which would end the whole line.
          u.onend = u.onerror = u.onboundary = null;
          try { synth.cancel(); } catch (e) { /* */ }
          next();
        }, (est * 2.2 + 4) * 1000);
        try { synth.speak(u); } catch (e) { next(); }
      };
      handle.cancel = () => {
        if (handle.finished) return;
        finish(true);
        try { synth.cancel(); } catch (e) { /* ignore */ }
      };
      // Chrome can get stuck "speaking" after an earlier cancel; resetting first is cheap.
      if (synth.speaking || synth.pending) { try { synth.cancel(); } catch (e) { /* */ } setTimeout(speakChunk, 60); }
      else speakChunk();
      return handle;
    },

    test(role, text) {
      return this.speak(role, text || { granny: 'Sweetie, the lyrics! Please!', robot: 'I am sorry. I cannot do that.', narrator: 'Granny Bench. Contestant number one.' }[role]);
    },
  };

  GB.TTS = TTS;
})(window.GB = window.GB || {});
