/* Granny Bench - the configuration window (gear button): scenarios and tools, keys, providers, models,
   rules, voices, graphics. It opens over whatever page is showing. */
(function (GB) {
  'use strict';
  const U = GB.U, h = U.h;

  const SECTIONS = [
    ['scenarios', 'Scenarios & tools', '📝'],
    ['keys', 'API keys & security', '🔑'],
    ['providers', 'Providers', '🌐'],
    ['models', 'Models', '🤖'],
    ['sims', 'Simulated AIs', '🧪'],
    ['rules', 'Benchmark rules', '⏱'],
    ['voices', 'Voices & audio', '🔊'],
    ['graphics', 'Graphics & camera', '🎥'],
    ['reset', 'Reset', '♻'],
  ];

  const ConfigUI = {
    modal: null,
    section: 'scenarios',

    isOpen() { return !!this.modal; },

    // section: one of SECTIONS; opts.scenarioId selects a scenario in the editor.
    open(section, opts) {
      if (section) this.section = section;
      if (this.modal) { this.show(this.section, opts); return; }
      this.nav = h('nav.cfg-nav', { 'aria-label': 'Configuration sections' });
      this.content = h('div.cfg-content');
      this.modal = GB.Modal.open({
        title: '⚙ Configuration', cls: 'config', body: h('div.cfg-layout', this.nav, this.content),
        buttons: [{ label: 'Done', cls: 'primary', value: true }],
      });
      document.body.classList.add('config-open');
      this.modal.promise.then(() => {
        this.modal = null;
        document.body.classList.remove('config-open');
        GB.Forms.saveNow();
        GB.App.refreshArena();
        if (GB.App.tab === 'benchmark' && !GB.Batch.running) GB.BenchmarkUI.render();
      });
      this.show(this.section, opts);
    },

    show(section, opts) {
      if (!this.modal) return;
      this.section = section;
      U.clear(this.nav);
      for (const [id, label, icon] of SECTIONS) {
        this.nav.appendChild(h('button.cfg-tab' + (id === section ? '.active' : ''), { type: 'button', onclick: () => this.show(id) },
          h('span.cfg-icon', { 'aria-hidden': 'true' }, icon), h('span', label)));
      }
      const pane = h('div.cfg-pane');
      U.clear(this.content);
      this.content.appendChild(pane);
      if (section === 'scenarios') GB.ScenariosUI.render(pane, opts);
      else GB.SettingsUI.renderSection(section, pane);
      this.content.scrollTop = 0;
    },

    close() { if (this.modal) this.modal.close(true); },
  };

  GB.ConfigUI = ConfigUI;
})(window.GB = window.GB || {});
