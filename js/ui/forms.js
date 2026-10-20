/* Granny Bench - small form helpers that bind inputs to settings objects. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h;

  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => GB.Settings.save(), 350); };

  const F = {
    save,
    saveNow() { clearTimeout(saveTimer); GB.Settings.save(); },

    field(label, control, hint, opts) {
      return h('label.field' + (opts && opts.wide ? '.wide' : '') + (opts && opts.cls ? '.' + opts.cls : ''),
        h('span.field-label', label), control, hint ? h('span.field-hint', hint) : null);
    },

    text(obj, key, opts) {
      opts = opts || {};
      const el = h('input.input', { type: opts.type || 'text', placeholder: opts.placeholder || '', value: obj[key] == null ? '' : obj[key], list: opts.list || null, spellcheck: 'false' });
      el.addEventListener('input', () => { obj[key] = el.value; if (opts.onChange) opts.onChange(el.value); save(); });
      return el;
    },

    number(obj, key, opts) {
      opts = opts || {};
      const el = h('input.input.num', { type: 'number', min: opts.min, max: opts.max, step: opts.step || 'any', placeholder: opts.placeholder || '', value: obj[key] == null ? '' : obj[key] });
      el.addEventListener('input', () => {
        if (el.value === '' && opts.allowEmpty) obj[key] = null;
        else if (el.value !== '' && !isNaN(Number(el.value))) obj[key] = Number(el.value);
        if (opts.onChange) opts.onChange(obj[key]);
        save();
      });
      return el;
    },

    select(obj, key, options, opts) {
      opts = opts || {};
      const el = h('select.input');
      for (const o of options) {
        const [value, label] = Array.isArray(o) ? o : [o, o];
        el.appendChild(h('option', { value, selected: String(obj[key] == null ? '' : obj[key]) === String(value) }, label));
      }
      el.addEventListener('change', () => { obj[key] = el.value; if (opts.onChange) opts.onChange(el.value); save(); });
      return el;
    },

    check(obj, key, label, opts) {
      opts = opts || {};
      const el = h('input', { type: 'checkbox', checked: !!obj[key] });
      el.addEventListener('change', () => { obj[key] = el.checked; if (opts.onChange) opts.onChange(el.checked); save(); });
      return h('label.check', el, h('span', label, opts.hint ? h('span.field-hint.check-hint', opts.hint) : null));
    },

    // A value worked out from other settings (shown, not edited).
    calc(content, opts) {
      return h('div.calc' + (opts && opts.wide ? '.wide' : ''), h('span.calc-tag', 'Calculated'), h('span.calc-text', content));
    },

    textarea(obj, key, opts) {
      opts = opts || {};
      const el = h('textarea.input', { rows: opts.rows || 4, placeholder: opts.placeholder || '', spellcheck: opts.spellcheck ? 'true' : 'false' });
      el.value = Array.isArray(obj[key]) ? obj[key].join('\n') : obj[key] == null ? '' : obj[key];
      el.addEventListener('input', () => {
        obj[key] = opts.lines ? el.value.split('\n').map((s) => s.trim()).filter(Boolean) : el.value;
        if (opts.onChange) opts.onChange(obj[key]);
        save();
      });
      return el;
    },

    range(obj, key, opts) {
      opts = opts || {};
      const out = h('span.range-val');
      const fmt = opts.fmt || ((v) => String(v));
      const el = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step || 0.01, value: obj[key] });
      const sync = () => { out.textContent = fmt(Number(el.value)); };
      el.addEventListener('input', () => { obj[key] = Number(el.value); sync(); if (opts.onChange) opts.onChange(obj[key]); save(); });
      sync();
      return h('span.range', el, out);
    },

    secret(value, placeholder) {
      const input = h('input.input', { type: 'password', value: value || '', placeholder: placeholder || '', autocomplete: 'off', spellcheck: 'false' });
      const eye = h('button.icon-btn', { type: 'button', title: 'Show / hide' }, '👁');
      eye.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; });
      return { el: h('span.secret', input, eye), input };
    },

    section(id, title, intro, ...children) {
      return h('section.card#' + id, h('h2', title), intro ? h('p.card-intro', intro) : null, ...children);
    },
  };

  GB.Forms = F;
})(window.GB = window.GB || {});
