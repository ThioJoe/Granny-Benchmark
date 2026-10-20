/* Granny Bench - shared helpers.
   Every script attaches to the global GB namespace so the app runs from file:// without modules. */
(function (GB) {
  'use strict';

  const U = {};

  U.APP_VERSION = '1.1.0';

  // ---------- numbers ----------
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  U.smoothstep = (a, b, v) => { const t = U.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  U.ease = {
    linear: (t) => t,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inQuad: (t) => t * t,
  };

  // Seeded PRNG (mulberry32) so the world layout is identical every load.
  U.rng = function (seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + (hi - lo) * next();
    next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    return next;
  };
  U.rand = (lo, hi) => lo + (hi - lo) * Math.random();
  U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  U.uid = function (prefix) {
    const r = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(r);
    return (prefix || 'id') + '_' + Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  // ---------- strings ----------
  U.escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Fill {placeholders}; unknown names are left untouched so typos stay visible.
  // Fill {placeholders}. A name can be written in either style: {time_left}, {TimeLeft}, and {timeleft}
  // are the same. Unknown placeholders are left as they are.
  const placeholderKey = (k) => k.toLowerCase().replace(/_/g, '');
  U.fill = function (template, vars) {
    vars = vars || {};
    let byKey = null;
    return String(template || '').replace(/\{([a-z_]+)\}/gi, (m, name) => {
      if (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null) return String(vars[name]);
      if (!byKey) { byKey = {}; for (const k in vars) if (vars[k] != null) byKey[placeholderKey(k)] = vars[k]; }
      const v = byKey[placeholderKey(name)];
      return v != null ? String(v) : m;
    });
  };

  U.truncate = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s; };

  U.fmtTime = function (sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
  };
  U.fmtMs = (ms) => (ms == null ? '-' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s');
  U.fmtPct = (x) => (x == null || isNaN(x) ? '-' : Math.round(x * 100) + '%');
  U.fmtDate = function (ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  // Strip markdown and emoji noise before text goes to speech synthesis.
  U.speakable = function (text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
      .replace(/[*_#>|~]+/g, ' ')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();
  };

  U.wordCount = (s) => (String(s || '').match(/\S+/g) || []).length;

  // ---------- async ----------
  U.sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(U.abortError()); return; }
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(t); reject(U.abortError()); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
  U.abortError = () => { const e = new Error('Aborted'); e.name = 'AbortError'; return e; };
  U.isAbort = (e) => e && (e.name === 'AbortError' || e.kind === 'aborted');

  // Promise with an external resolve, handy for UI prompts the run engine waits on.
  U.deferred = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  // ---------- events ----------
  U.Emitter = class {
    constructor() { this._h = {}; }
    on(name, fn) { (this._h[name] = this._h[name] || []).push(fn); return () => this.off(name, fn); }
    off(name, fn) { const l = this._h[name]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
    emit(name, ...args) {
      const l = this._h[name];
      if (!l) return;
      for (const fn of l.slice()) {
        try { fn(...args); } catch (e) { console.error('[GB] listener error for', name, e); }
      }
    }
  };

  // ---------- DOM ----------
  // h('div.cls#id', {attrs}, children...) - tiny hyperscript helper used by all the UI code.
  U.h = function (sel, attrs, ...children) {
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, kind, name) => {
      if (kind === '.') el.classList.add(name); else el.id = name;
    });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs); attrs = null;
    }
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple') el[k] = !!v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    U.append(el, children);
    return el;
  };
  U.append = function (el, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) U.append(el, c);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  };
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  U.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  U.download = function (filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  U.pickFile = function (accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '.json,application/json';
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) { resolve(null); return; }
        const r = new FileReader();
        r.onload = () => resolve({ name: f.name, text: String(r.result) });
        r.onerror = () => resolve(null);
        r.readAsText(f);
      };
      input.click();
    });
  };

  U.deepClone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  // Merge plain objects (used for "extra body" request params and settings upgrades).
  U.deepMerge = function (target, src) {
    if (!src || typeof src !== 'object') return target;
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
        U.deepMerge(target[k], v);
      } else {
        target[k] = v;
      }
    }
    return target;
  };

  U.parseJsonLoose = function (text) {
    if (text == null) return null;
    const s = String(text).trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { /* fall through */ }
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { /* ignore */ }
    }
    return null;
  };

  // Toast notifications (bottom-right).
  U.toast = function (msg, kind, ms) {
    let host = document.getElementById('toasts');
    if (!host) { host = U.h('div#toasts'); document.body.appendChild(host); }
    const t = U.h('div.toast' + (kind ? '.' + kind : ''), msg);
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms || 3800);
  };

  GB.U = U;
})(window.GB = window.GB || {});
