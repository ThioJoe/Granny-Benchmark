/* Granny Bench - modal dialogs. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h;

  const Modal = {
    stack: [],

    open(opts) {
      const root = document.getElementById('modal-root') || document.body;
      const done = U.deferred();
      const backdrop = h('div.modal-backdrop');
      const box = h('div.modal' + (opts.wide ? '.wide' : '') + (opts.cls ? '.' + opts.cls : ''), { role: 'dialog', 'aria-modal': 'true' });
      if (opts.title) box.appendChild(h('h3.modal-title', opts.title));
      const body = h('div.modal-body');
      if (opts.body) U.append(body, [opts.body]);
      box.appendChild(body);
      const footer = h('div.modal-footer');
      let closed = false;
      const close = (value) => {
        if (closed) return;
        closed = true;
        backdrop.classList.remove('show');
        setTimeout(() => backdrop.remove(), 180);
        const i = this.stack.indexOf(api); if (i >= 0) this.stack.splice(i, 1);
        document.removeEventListener('keydown', onKey, true);
        done.resolve(value);
      };
      for (const b of (opts.buttons || []).filter(Boolean)) {
        const btn = h('button' + (b.cls ? '.' + b.cls.split(' ').join('.') : ''), { type: 'button', onclick: async () => {
          if (b.onClick) {
            const r = await b.onClick(api);
            if (r === false) return;
            if (r !== undefined) { close(r); return; }
          }
          close(b.value);
        } }, b.label);
        footer.appendChild(btn);
        if (b.autofocus) setTimeout(() => btn.focus(), 30);
      }
      if ((opts.buttons || []).filter(Boolean).length) box.appendChild(footer);
      backdrop.appendChild(box);
      if (opts.dismissible !== false) backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(opts.dismissValue); });
      const onKey = (e) => {
        if (this.stack[this.stack.length - 1] !== api) return;
        if (e.key === 'Escape' && opts.dismissible !== false) { e.stopPropagation(); close(opts.dismissValue); }
        if (opts.onKey) opts.onKey(e, api);
      };
      document.addEventListener('keydown', onKey, true);
      root.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('show'));
      const api = { el: box, body, close, promise: done.promise };
      this.stack.push(api);
      return api;
    },

    confirm(title, message, okLabel, danger) {
      return this.open({
        title, body: h('p', message), dismissValue: false,
        buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', cls: danger ? 'danger' : 'primary', value: true, autofocus: true }],
      }).promise;
    },

    prompt(title, message, opts) {
      opts = opts || {};
      const input = h('input.input', { type: opts.type || 'text', placeholder: opts.placeholder || '', value: opts.value || '', autocomplete: opts.type === 'password' ? 'off' : null });
      const err = h('div.form-error');
      const body = h('div', message ? h('p', message) : null, input, err);
      const m = this.open({
        title, body, dismissValue: null,
        buttons: [{ label: 'Cancel', value: null }, { label: opts.okLabel || 'OK', cls: 'primary', onClick: () => input.value }],
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.close(input.value); });
      setTimeout(() => input.focus(), 40);
      return m.promise;
    },

    alert(title, message) {
      return this.open({ title, body: typeof message === 'string' ? h('p', message) : message, buttons: [{ label: 'OK', cls: 'primary', value: true, autofocus: true }] }).promise;
    },
  };

  GB.Modal = Modal;
})(window.GB = window.GB || {});
