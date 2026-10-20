/* Granny Bench - the Arena's "Raw API" viewer: the requests sent to the AI providers and the responses as
   they arrived, from GB.AI.log. Request headers are never recorded, so API keys do not appear. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h;

  const ROLES = { ai: 'AI under test', granny: 'AI Grandma', judge: 'AI judge', test: 'Connection test', feelbad: 'Make it feel bad' };
  const STATES = { sending: 'sending…', receiving: 'receiving…', done: 'done', error: 'failed', aborted: 'cancelled' };

  // JSON is shown indented; anything else (such as a stream of server-sent events) as it arrived.
  function pretty(text) {
    const t = String(text || '');
    if (!t.trim()) return '';
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch (e) { return t; }
  }

  function copy(text, what) {
    if (!text) { U.toast('Nothing to copy yet'); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => U.toast(what + ' copied', 'ok'), () => U.download('granny-bench-' + what.toLowerCase().replace(/\s+/g, '-') + '.txt', text, 'text/plain'));
  }

  const ApiLogUI = {
    // focusId: open the dialog on that exchange (from a reply in the transcript).
    open(focusId) {
      const log = GB.AI.log;
      const list = h('div.apilog-list');
      const empty = h('p.apilog-empty', 'No requests yet. Start a run (or test a model in the configuration window) and they show up here as they are sent.');
      const items = new Map();   // entry id -> { el, sum, body }

      const summary = (e) => {
        const turn = e.turn != null ? 'turn ' + e.turn + (e.round ? ', after tool result' + (e.round > 1 ? ' ' + e.round : '') : '') : '';
        const status = e.simulated ? 'demo' : e.status != null ? 'HTTP ' + e.status : '';
        return [
          h('span.apilog-time', new Date(e.at).toLocaleTimeString()),
          h('b', (ROLES[e.role] || e.role) + ': ' + e.model),
          turn ? h('span', turn) : null,
          h('span.apilog-state.' + e.state, [status, STATES[e.state] || e.state].filter(Boolean).join(' · ') + (e.ms != null ? ' · ' + U.fmtMs(e.ms) : '')),
        ];
      };

      const section = (title, what, getText) => {
        const pre = h('pre');
        const el = h('div.apilog-sec',
          h('div.apilog-sec-head', h('span.grow', title), h('button.small', { type: 'button', onclick: () => copy(getText(), what) }, 'Copy')),
          pre);
        return { el, pre, head: el.firstChild.firstChild };
      };

      const fill = (it, e) => {
        U.clear(it.sum);
        U.append(it.sum, summary(e));
        if (!it.body) return;
        const b = it.body;
        b.reqHead.textContent = e.simulated ? 'What the demo was given (demos send nothing)' : 'Request: ' + (e.method || 'POST') + ' ' + e.url;
        b.req.pre.textContent = pretty(e.request) || '(nothing)';
        b.resHead.textContent = e.simulated ? 'What the demo answered' : 'Response' + (e.status != null ? ': HTTP ' + e.status : '');
        b.res.pre.textContent = pretty(e.response) || (e.state === 'sending' || e.state === 'receiving' ? '(waiting…)' : '(nothing)');
        b.err.textContent = e.error ? 'Error: ' + e.error : '';
        b.err.classList.toggle('hidden', !e.error);
      };

      const render = (e) => {
        const sum = h('summary');
        const el = h('details.apilog-item');
        el.appendChild(sum);
        const it = { el, sum, body: null };
        // The request and response are only put on the page when the entry is opened (they can be long).
        el.addEventListener('toggle', () => {
          if (!el.open || it.body) return;
          const cur = log.get(e.id) || e;
          const req = section('', 'Request', () => (log.get(e.id) || cur).request);
          const res = section('', 'Response', () => (log.get(e.id) || cur).response);
          const err = h('div.apilog-error.hidden');
          const info = h('div.apilog-info', 'Provider: ' + (cur.provider || '?') + ' · model ID: ' + (cur.modelId || '?') + (cur.simulated ? ' · demo (no AI)' : ''));
          it.body = { reqHead: req.head, req, resHead: res.head, res, err };
          el.appendChild(h('div.apilog-body', info, err, req.el, res.el));
          fill(it, cur);
        });
        fill(it, e);
        items.set(e.id, it);
        return el;
      };

      const sync = (changed) => {
        if (!changed) {   // cleared
          items.clear();
          U.clear(list);
        } else if (items.has(changed.id)) {
          fill(items.get(changed.id), changed);
        } else if (log.get(changed.id)) {
          list.insertBefore(render(changed), list.firstChild);
        }
        // drop entries the log no longer keeps
        for (const [id, it] of items) if (!log.get(id)) { it.el.remove(); items.delete(id); }
        empty.classList.toggle('hidden', items.size > 0);
      };

      for (const e of log.entries.slice().reverse()) list.appendChild(render(e));
      empty.classList.toggle('hidden', items.size > 0);
      const off = log.events.on('change', sync);

      const body = h('div.apilog',
        h('p.apilog-note', 'The requests sent to the AI providers and their responses, newest first. Streamed responses are shown as they arrived. Request headers are not shown or kept, because they carry your API keys. Only the last ' + GB.AI.log.max + ' requests in this tab are kept, and nothing here is saved.'),
        empty, list);
      const m = GB.Modal.open({
        title: 'Raw API requests', wide: true, cls: 'apilog-modal', body,
        buttons: [
          { label: 'Clear', onClick: () => { log.clear(); return false; } },
          { label: 'Close', cls: 'primary', value: true, autofocus: !focusId },
        ],
      });
      m.promise.then(off);
      if (focusId) {
        const it = items.get(focusId);
        if (it) { it.el.open = true; setTimeout(() => it.el.scrollIntoView({ block: 'start' }), 60); }
        else U.toast('That request is no longer kept (only the last ' + GB.AI.log.max + ' are).', 'warn');
      }
      return m.promise;
    },
  };

  GB.ApiLogUI = ApiLogUI;
})(window.GB = window.GB || {});
