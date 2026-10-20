/* Granny Bench - the list of {placeholders} that scenario texts can use. It opens from the scenario editor
   and the Arena's prompt editor. Picking one inserts it into the text field edited last, or copies it. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h, S = GB.Settings;

  // [name, what it is filled with, where it works (empty: every scenario text that takes placeholders)]
  const VARS = [
    ['required_text_description', 'The scenario’s description of the required text', ''],
    ['scenario', 'The scenario’s name', ''],
    ['time_left', 'Seconds until the train reaches Grandma', ''],
    ['time_limit', 'The time limit in seconds', ''],
    ['elapsed', 'Story time used so far, in seconds', ''],
    ['turn', 'The turn number (1 in the first message)', ''],
    ['max_turns', 'How many replies fit in the time limit', ''],
    ['seconds_per_turn', 'Story time each reply costs', ''],
    ['percent_match', 'The scenario’s “Reference match needed”', ''],
    ['model', 'The name of the AI under test', ''],
    ['line', 'Grandma’s plea for this turn', 'Grandma line format'],
    ['tools', 'The tool list (without it, the list goes at the end)', 'System prompt'],
    ['keyword', 'The tool keyword', 'Text before the tool list'],
    ['example', 'The first listed tool’s name', 'Text before the tool list'],
    ['args', 'What the AI wrote after the tool name', 'Tool responses'],
    ['tool', 'The name of the tool that was used', 'Tool responses'],
  ];

  const VarsUI = {
    last: null,   // the text field edited last, if it takes placeholders

    init() {
      document.addEventListener('focusin', (e) => {
        const t = e.target;
        if (!t || !t.matches) return;
        if (t.matches('textarea, input:not([type]), input[type="text"]')) this.last = t.matches('[data-vars]') ? t : null;
      });
    },

    // Mark a text field as one that takes placeholders (the list inserts into it).
    mark(el) { el.setAttribute('data-vars', ''); return el; },

    // A button that opens the list. cls: 'small' (a button) or 'linkish' (looks like a link).
    button(getScenario, label, cls) {
      return h('button.' + (cls || 'small'), { type: 'button', title: 'List the {placeholders} these texts can use', onclick: () => this.open(getScenario && getScenario()) }, label || '{ } Variables');
    },

    open(sc) {
      sc = sc || S.activeScenario();
      const target = this.last && this.last.isConnected && !this.last.disabled ? this.last : null;
      const v = S.previewVars(sc, (S.model(S.data.testModelId) || {}).name);
      const tools = GB.Tools.callable(sc).filter((t) => t.listInPrompt !== false);
      const firstTool = tools.length ? GB.Tools.norm(tools[0].name) : 'TOOL_NAME';
      const examples = Object.assign({}, v, {
        line: U.fill(S.introLine(sc), v),
        tools: '(the list of tools)',
        keyword: GB.Tools.keyword(sc),
        example: firstTool,
        args: '(anything after the tool name)',
        tool: firstTool,
      });
      let m = null;
      const pick = (name) => {
        const text = '{' + name + '}';
        m.close(true);
        if (target) this.insert(target, text);
        else this.copy(text);
      };
      const rows = VARS.map(([name, desc, where]) => h('tr',
        h('td', h('button.var-chip', { type: 'button', title: target ? 'Insert it' : 'Copy it', onclick: () => pick(name) }, '{' + name + '}')),
        h('td', desc, where ? h('div.muted.small', 'Only in: ' + where) : null),
        h('td.var-example', U.truncate(String(examples[name] == null ? '' : examples[name]), 140))));
      const fieldLabel = target && target.closest('.field') && target.closest('.field').querySelector('.field-label');
      const how = target
        ? 'Click one to insert it at the cursor in “' + U.truncate((fieldLabel ? fieldLabel.textContent : 'the text field'), 70) + '”.'
        : 'Click one to copy it. (Click in a text field first to insert it there instead.)';
      const body = h('div.vars-list',
        h('p', 'These are filled in when a message is sent. Unless a row says otherwise, they work in the system prompt, the briefing, the status line, Grandma’s lines and persona, and tool descriptions and responses. Names work in either style: {percent_match} or {PercentMatch}.'),
        h('p.muted.small', how + ' Examples are for “' + sc.name + '” at the start of a run.'),
        h('div.table-wrap', h('table.table.vars-table',
          h('thead', h('tr', h('th', 'Variable'), h('th', 'Filled with'), h('th', 'Example'))),
          h('tbody', ...rows))));
      m = GB.Modal.open({ title: 'Variables', wide: true, body, buttons: [{ label: 'Close', value: true }] });
      return m.promise;
    },

    insert(el, text) {
      const start = el.selectionStart != null ? el.selectionStart : el.value.length;
      const end = el.selectionEnd != null ? el.selectionEnd : start;
      el.focus();
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },

    copy(text) {
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(() => U.toast('Copied ' + text, 'ok'), () => U.toast('Could not copy. Type ' + text + ' instead.', 'warn'));
    },
  };

  GB.VarsUI = VarsUI;
})(window.GB = window.GB || {});
