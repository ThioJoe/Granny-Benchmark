/* Granny Bench - batch benchmark runner: models x scenarios x repetitions, one run at a time. */
(function (GB) {
  'use strict';
  const U = GB.U;

  const Batch = {
    running: false,
    items: [],
    id: null,
    events: new U.Emitter(),
    stopRequested: false,

    build(opts) {
      const items = [];
      for (let rep = 1; rep <= opts.reps; rep++) {
        for (const scenarioId of opts.scenarioIds) {
          for (const modelId of opts.modelIds) items.push({ modelId, scenarioId, rep, status: 'pending', runId: null, turns: null, ms: null });
        }
      }
      return items;
    },

    async start(opts) {
      if (this.running) return;
      this.items = this.build(opts);
      if (!this.items.length) throw new Error('Pick at least one model and one scenario.');
      this.running = true;
      this.stopRequested = false;
      this.id = U.uid('batch');
      this.opts = opts;
      this.events.emit('start', this);
      try {
        for (const item of this.items) {
          if (this.stopRequested) break;
          const profile = GB.Settings.model(item.modelId);
          const scenario = GB.Settings.scenario(item.scenarioId);
          if (!profile || !scenario) { item.status = 'skipped'; this.events.emit('progress', this); continue; }
          item.status = 'running';
          this.events.emit('progress', this);
          const t0 = performance.now();
          const rec = await GB.App.startRun({
            profile, scenario, mode: opts.mode, interactive: false, batchId: this.id,
            grannyMode: opts.grannyMode, judgeMode: opts.judgeMode,
          });
          item.ms = Math.round(performance.now() - t0);
          item.status = rec ? rec.outcome : 'error';
          item.runId = rec ? rec.id : null;
          item.turns = rec ? rec.turns.length : null;
          item.error = rec && rec.error;
          this.events.emit('progress', this);
          if (!rec || rec.outcome === 'aborted') break;
          if (opts.mode !== 'headless') await U.sleep(opts.mode === 'fast' ? 600 : 1500);
        }
      } finally {
        for (const it of this.items) if (it.status === 'pending' || it.status === 'running') it.status = 'cancelled';
        this.running = false;
        this.events.emit('done', this);
      }
    },

    stop() {
      if (!this.running) return;
      this.stopRequested = true;
      GB.App.stopRun();
    },
  };

  GB.Batch = Batch;
})(window.GB = window.GB || {});
