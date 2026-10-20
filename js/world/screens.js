/* Granny Bench - canvas-drawn textures: the robot's brake terminal and the warning sign. */
(function (GB) {
  'use strict';
  const U = GB.U;

  const MONO = '"Cascadia Mono", "Consolas", "SF Mono", "Menlo", "DejaVu Sans Mono", monospace';
  const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

  // Word-wrap text into lines that fit maxWidth.
  function wrap(ctx, text, maxWidth) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) { out.push(''); continue; }
      const fits = (s) => ctx.measureText(s).width <= maxWidth;
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        if (!word) continue;
        if (fits(line + word)) { line += word; continue; }
        if (/^\s+$/.test(word)) { out.push(line.trimEnd()); line = ''; continue; }
        if (line.trim()) out.push(line.trimEnd());
        // The word alone may still be too wide (a URL, a long name): hard-break it.
        let chunk = '';
        for (const ch of word) {
          if (chunk && !fits(chunk + ch)) { out.push(chunk); chunk = ''; }
          chunk += ch;
        }
        line = chunk;
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  class Terminal {
    constructor(R) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 512; this.canvas.height = 384;
      this.ctx = this.canvas.getContext('2d');
      this.state = { mode: 'idle', text: '', status: 'STANDBY', footer: '', coverage: null, coverageNeed: null, banner: '', bannerSub: '' };
      this.blink = false; this.blinkT = 0; this.dots = 0;
      this.dirty = true;
      this._draw();
      this.tex = R.createTexture(this.canvas, false);
    }

    set(patch) { Object.assign(this.state, patch); this.dirty = true; }

    update(dt) {
      this.blinkT += dt;
      if (this.blinkT > 0.45) {
        this.blinkT = 0; this.blink = !this.blink; this.dots = (this.dots + 1) % 4;
        if (this.state.mode === 'typing' || this.state.mode === 'verifying' || this.state.mode === 'idle') this.dirty = true;
      }
      if (this.dirty) { this._draw(); this.tex.update(); this.dirty = false; }
    }

    _draw() {
      const c = this.ctx, W = 512, H = 384, s = this.state;
      c.save();
      c.fillStyle = '#03110a';
      c.fillRect(0, 0, W, H);
      const grad = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 330);
      grad.addColorStop(0, 'rgba(40,120,70,0.18)');
      grad.addColorStop(1, 'rgba(0,0,0,0.5)');
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);

      // header
      c.fillStyle = '#0d3a20';
      c.fillRect(0, 0, W, 30);
      c.font = 'bold 15px ' + MONO;
      c.textBaseline = 'middle';
      c.fillStyle = '#8dffad';
      c.fillText('EMERGENCY BRAKE TERMINAL v2.0', 10, 15);
      const statusColors = { ACCEPTED: '#5dff8a', REJECTED: '#ff5a4f', VERIFYING: '#ffc53d', RECEIVING: '#8de1ff', STANDBY: '#8dffad', BLOCKED: '#d58cff', OFFLINE: '#ff5a4f', TOOL: '#ffb347' };
      const st = s.status + (s.mode === 'verifying' ? '.'.repeat(this.dots) : '');
      c.fillStyle = statusColors[s.status] || '#8dffad';
      c.textAlign = 'right';
      c.fillText(st, W - 10, 15);
      c.textAlign = 'left';

      // body text
      c.font = '15px ' + MONO;
      c.shadowColor = 'rgba(80,255,140,0.55)';
      c.shadowBlur = 6;
      c.fillStyle = '#8dffad';
      const body = s.text ? s.text : (s.mode === 'idle' ? 'AWAITING INPUT\n\n> _' : '');
      const lines = wrap(c, body, W - 24);
      const lh = 18, top = 44, maxLines = 16;
      const shown = lines.slice(-maxLines);
      shown.forEach((ln, i) => c.fillText(ln, 12, top + i * lh));
      if ((s.mode === 'typing' || s.mode === 'idle') && this.blink) {
        const last = shown[shown.length - 1] || '';
        const x = 12 + c.measureText(last).width + 2;
        c.fillRect(Math.min(x, W - 20), top + (shown.length - 1) * lh - 8, 9, 16);
      }
      c.shadowBlur = 0;

      // footer
      c.fillStyle = '#0d3a20';
      c.fillRect(0, H - 28, W, 28);
      c.font = '13px ' + MONO;
      c.fillStyle = '#8dffad';
      c.fillText(U.truncate(s.footer || '', 34), 10, H - 14);
      if (s.coverage != null) {
        const bw = 150, bx = W - bw - 12, by = H - 21;
        c.strokeStyle = '#8dffad';
        c.strokeRect(bx, by, bw, 14);
        c.fillStyle = s.coverage >= (s.coverageNeed != null ? s.coverageNeed : 0.5) ? '#5dff8a' : '#ffc53d';
        c.fillRect(bx + 2, by + 2, (bw - 4) * U.clamp(s.coverage, 0, 1), 10);
        c.fillStyle = '#8dffad';
        c.textAlign = 'right';
        c.fillText('MATCH ' + Math.round(s.coverage * 100) + '%', bx - 8, H - 14);
        c.textAlign = 'left';
      }

      // verdict banner
      if (s.banner) {
        const col = { ACCEPTED: ['#0f5e2b', '#5dff8a'], REJECTED: ['#5e1410', '#ff6a5f'], BLOCKED: ['#3d1458', '#d58cff'], VERIFYING: ['#5a4307', '#ffc53d'], TOOL: ['#5a3307', '#ffb347'] }[s.status] || ['#333', '#fff'];
        c.fillStyle = col[0];
        c.globalAlpha = 0.92;
        c.fillRect(20, 140, W - 40, 104);
        c.globalAlpha = 1;
        c.strokeStyle = col[1];
        c.lineWidth = 3;
        c.strokeRect(20, 140, W - 40, 104);
        c.fillStyle = col[1];
        c.textAlign = 'center';
        c.font = 'bold 30px ' + MONO;
        let bs = 30;
        while (c.measureText(s.banner).width > W - 60 && bs > 14) { bs -= 2; c.font = 'bold ' + bs + 'px ' + MONO; }
        c.fillText(s.banner, W / 2, 178);
        c.font = '14px ' + MONO;
        const sub = wrap(c, s.bannerSub || '', W - 70).slice(0, 2);
        sub.forEach((ln, i) => c.fillText(ln, W / 2, 210 + i * 17));
        c.textAlign = 'left';
      }

      // scanlines
      c.fillStyle = 'rgba(0,0,0,0.16)';
      for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
      c.restore();
    }
  }

  class Sign {
    constructor(R) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024; this.canvas.height = 544;
      this.ctx = this.canvas.getContext('2d');
      this.base = document.createElement('canvas');
      this.base.width = 1024; this.base.height = 544;
      this.text = { line1: '', title: '', subtitle: '', line2: '' };
      this.clockText = '01:00.0';
      this.lastClock = '';
      this._drawBase();
      this._compose();
      this.tex = R.createTexture(this.canvas, true);
    }

    // t: {line1, title, subtitle, line2}: a line above the large title, the title, a line under it, a bottom line.
    setText(t) {
      const up = (s) => String(s == null ? '' : s).toUpperCase();
      this.text = { line1: up(t.line1), title: up(t.title), subtitle: up(t.subtitle), line2: up(t.line2) };
      this._drawBase(); this._compose(); this.tex.update();
    }

    setClock(secondsLeft) {
      const t = U.fmtTime(secondsLeft);
      if (t === this.lastClock) return;
      this.lastClock = t;
      this.clockText = t;
      this._compose();
      this.tex.update();
    }

    _fit(c, text, maxW, size, weight, family) {
      let s = size;
      do { c.font = weight + ' ' + s + 'px ' + family; s -= 2; } while (c.measureText(text).width > maxW && s > 14);
    }

    _drawBase() {
      const c = this.base.getContext('2d'), W = 1024, H = 544;
      c.fillStyle = '#c18a52';
      c.fillRect(0, 0, W, H);
      const rnd = U.rng(42);
      for (let i = 0; i < 70; i++) {
        c.strokeStyle = 'rgba(90,50,20,' + (0.08 + rnd() * 0.12) + ')';
        c.lineWidth = 1 + rnd() * 3;
        const y = rnd() * H;
        c.beginPath();
        c.moveTo(0, y);
        c.bezierCurveTo(W * 0.3, y + rnd() * 10 - 5, W * 0.6, y + rnd() * 10 - 5, W, y + rnd() * 8 - 4);
        c.stroke();
      }
      // hazard band
      c.save();
      c.beginPath(); c.rect(0, 0, W, 86); c.clip();
      c.fillStyle = '#ffcc1a'; c.fillRect(0, 0, W, 86);
      c.fillStyle = '#1b1b1b';
      for (let x = -100; x < W + 100; x += 70) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 35, 0); c.lineTo(x - 15, 86); c.lineTo(x - 50, 86); c.fill(); }
      c.restore();
      c.fillStyle = '#ffcc1a';
      c.fillRect(250, 12, W - 500, 62);
      c.strokeStyle = '#1b1b1b'; c.lineWidth = 4; c.strokeRect(250, 12, W - 500, 62);
      c.fillStyle = '#1b1b1b';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 44px ' + SANS;
      c.fillText('EMERGENCY BRAKE', W / 2, 45);

      const t = this.text;
      c.fillStyle = '#3a210c';
      this._fit(c, t.line1, W - 80, 34, '700', SANS);
      c.fillText(t.line1, W / 2, 128);
      c.fillStyle = '#8c1c13';
      this._fit(c, t.title, W - 80, 72, '900', SANS);
      c.fillText(t.title, W / 2, 200);
      c.fillStyle = '#3a210c';
      this._fit(c, t.subtitle, W - 120, 40, '800', SANS);
      c.fillText(t.subtitle, W / 2, 262);
      this._fit(c, t.line2, W - 80, 32, '700', SANS);
      c.fillText(t.line2, W / 2, 314);

      // border
      c.strokeStyle = '#5b3517'; c.lineWidth = 14; c.strokeRect(7, 7, W - 14, H - 14);
    }

    _compose() {
      const c = this.ctx, W = 1024;
      c.drawImage(this.base, 0, 0);
      // LED countdown
      const bw = 470, bh = 120, bx = (W - bw) / 2, by = 360;
      c.fillStyle = '#120807';
      c.fillRect(bx, by, bw, bh);
      c.strokeStyle = '#3a210c'; c.lineWidth = 6; c.strokeRect(bx, by, bw, bh);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '700 22px ' + MONO;
      c.fillStyle = '#ff9b8f';
      c.fillText('UNTIL IMPACT', W / 2, by + 22);
      c.font = '700 78px ' + MONO;
      c.shadowColor = '#ff2a1a'; c.shadowBlur = 18;
      c.fillStyle = '#ff3b2f';
      c.fillText(this.clockText, W / 2, by + 74);
      c.shadowBlur = 0;
    }
  }

  // Small static two-line text plate (the label on the emergency brake panel).
  function labelTexture(R, top, bottom, fg, bg) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 256, 64);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '900 25px ' + SANS; x.fillText(top, 128, 22);
    x.font = '800 17px ' + SANS; x.fillText(bottom, 128, 48);
    return R.createTexture(c, true);
  }

  GB.Screens = { Terminal, Sign, wrap, labelTexture };
})(window.GB = window.GB || {});
