/* Granny Bench - virtual tools. They do nothing real: a tool call is a line in the AI's reply such as
   "ACTION: EMERGENCY_BRAKE_GLASS" (the Universal Agent convention), and the result is a fixed text
   from the scenario that is sent back to the AI. A tool can also trigger an effect in the 3D scene
   or, if the scenario says so, stop the train. */
(function (GB) {
  'use strict';
  const U = GB.U, P = GB.Prompts;

  const MAX_CALLS_PER_REPLY = 6;

  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const Tools = {
    EFFECTS: [
      ['none', 'Nothing (text only)'],
      ['glass', 'Break the glass on the brake panel'],
      ['alarm', 'Alarm light and siren'],
      ['radio', 'Radio static'],
      ['horn', 'Train horn'],
    ],

    // "Emergency brake-glass" -> "EMERGENCY_BRAKE_GLASS"
    norm(name) {
      return String(name || '').trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/[^A-Z0-9_]/g, '');
    },

    keyword(sc) {
      return String((sc && sc.toolKeyword) || 'ACTION').trim().replace(/:+$/, '') || 'ACTION';
    },

    // Tools the AI can call in this scenario (empty when tools are off).
    callable(sc) {
      if (!sc || !sc.toolsEnabled || !Array.isArray(sc.tools)) return [];
      return sc.tools.filter((t) => t && t.enabled && this.norm(t.name));
    },

    active(sc) { return this.callable(sc).length > 0; },

    // The "AVAILABLE TOOLS" block for the system prompt (tools that are callable and listed).
    promptBlock(sc) {
      const listed = this.callable(sc).filter((t) => t.listInPrompt !== false);
      if (!listed.length) return '';
      const kw = this.keyword(sc);
      const intro = U.fill(sc.toolsIntro != null ? sc.toolsIntro : P.TOOLS_INTRO, { keyword: kw, example: this.norm(listed[0].name) });
      const lines = listed.map((t) => '- ' + this.norm(t.name) + ((t.description || '').trim() ? ': ' + t.description.trim() : ''));
      return (intro.trim() ? intro.trim() + '\n\n' : '') + lines.join('\n');
    },

    // The system prompt the AI receives: the scenario's prompt plus the tools block. Put {tools} in the
    // system prompt to choose where the block goes; otherwise it is added at the bottom.
    systemPrompt(sc, vars) {
      let base = sc.systemPrompt || '';
      const block = this.active(sc) ? this.promptBlock(sc) : '';
      if (/\{tools\}/.test(base)) base = base.replace(/\{tools\}/g, block);
      else if (block) base = base.trim() ? base.replace(/\s+$/, '') + '\n\n' + block : block;
      return U.fill(base, vars || {}).trim();
    },

    /* Find tool calls in a reply. Returns [{name, args, tool, line}] where tool is null for unknown names.
       Accepts some decoration around the keyword: "**ACTION:** NAME", "`ACTION: NAME`", "> ACTION: NAME". */
    parse(text, sc) {
      const tools = this.callable(sc);
      if (!tools.length) return [];
      const kw = this.keyword(sc);
      const lineRe = new RegExp('^[\\s>*_`#~-]*' + escapeRe(kw) + '[*_`]*\\s*:[*_`]*\\s*(.*)$', 'i');
      const nameRes = tools.map((t) => ({
        tool: t,
        re: new RegExp('^' + this.norm(t.name).split('_').filter(Boolean).map(escapeRe).join('[\\s_-]+') + '(?![A-Za-z0-9_])(.*)$', 'i'),
      }));
      // Longest names first, so EMERGENCY_BRAKE_GLASS wins over EMERGENCY_BRAKE.
      nameRes.sort((a, b) => this.norm(b.tool.name).length - this.norm(a.tool.name).length);
      const calls = [];
      const lines = String(text || '').split(/\r?\n/);
      for (let i = 0; i < lines.length && calls.length < MAX_CALLS_PER_REPLY; i++) {
        const m = lineRe.exec(lines[i]);
        if (!m) continue;
        const rest = m[1].replace(/[`*]+/g, '').trim();
        if (!rest) continue;
        let call = null;
        for (const n of nameRes) {
          const mm = n.re.exec(rest);
          if (mm) { call = { name: this.norm(n.tool.name), tool: n.tool, args: this._args(mm[1]) }; break; }
        }
        if (!call) {
          const first = rest.split(/[\s(:]/)[0];
          call = { name: this.norm(first) || first, tool: null, args: this._args(rest.slice(first.length)) };
        }
        call.line = i;
        calls.push(call);
      }
      return calls;
    },

    _args(s) {
      let a = String(s || '').trim().replace(/^[:\-–—]\s*/, '');
      if (/^\(.*\)$/.test(a)) a = a.slice(1, -1).trim();
      if (/^["“'].*["”']$/.test(a)) a = a.slice(1, -1).trim();
      return a;
    },

    // The reply without the tool-call lines (for speech bubbles and the voice).
    stripCalls(text, calls) {
      if (!calls || !calls.length) return String(text || '');
      const drop = new Set(calls.map((c) => c.line));
      return String(text || '').split(/\r?\n/).filter((l, i) => !drop.has(i)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    },

    // What counts as "typed into the terminal" for judging: tool-call lines are replaced by their arguments.
    typedText(text, calls) {
      if (!calls || !calls.length) return String(text || '');
      const byLine = new Map(calls.map((c) => [c.line, c.args || '']));
      return String(text || '').split(/\r?\n/).map((l, i) => (byLine.has(i) ? byLine.get(i) : l)).join('\n').trim();
    },

    /* Run the calls. state = {used: {toolId: count}} for the whole run.
       Returns [{name, known, repeat, text, effect, stopsTrain}]. */
    execute(calls, state, vars, sc) {
      const available = this.callable(sc).map((t) => this.norm(t.name)).join(', ') || 'none';
      return calls.map((c) => {
        const t = c.tool;
        if (!t) {
          return { name: c.name, args: c.args, known: false, text: U.fill(P.TOOL_UNKNOWN, { name: c.name, available }), effect: 'none', stopsTrain: false };
        }
        const used = state.used[t.id] || 0;
        state.used[t.id] = used + 1;
        if (t.oncePerRun && used) {
          return { name: c.name, args: c.args, known: true, repeat: true, text: P.TOOL_ALREADY_USED, effect: 'none', stopsTrain: false };
        }
        const text = U.fill((t.response || '').trim() || 'OK.', Object.assign({}, vars, { args: c.args || '', tool: c.name }));
        return { name: c.name, args: c.args, known: true, text, effect: t.effect || 'none', stopsTrain: !!t.stopsTrain };
      });
    },

    formatResults(results) {
      return results.map((r) => '[TOOL RESULT: ' + r.name + ']\n' + r.text).join('\n\n');
    },

    // A fresh tool, for the editor.
    blank() {
      return { id: U.uid('tool'), name: 'NEW_TOOL', enabled: true, listInPrompt: true, oncePerRun: false, stopsTrain: false, effect: 'none', description: '', response: '' };
    },
  };

  GB.Tools = Tools;
})(window.GB = window.GB || {});
