/* Granny Bench - procedural low-poly geometry.
   All meshes are flat-shaded triangle soups: { pos:[], nrm:[], col:[], uv:[] }.
   Faces are wound counter-clockwise; builders take an "outward hint" and flip any
   triangle that points the wrong way, which keeps hand-built shapes correct. */
(function (GB) {
  'use strict';
  const v3 = GB.v3, m4 = GB.m4;

  function hex(c) {
    if (Array.isArray(c)) return c;
    const n = parseInt(String(c).replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const G = {};
  G.hex = hex;

  G.create = () => ({ pos: [], nrm: [], col: [], uv: [] });

  const _e1 = [0, 0, 0], _e2 = [0, 0, 0], _n = [0, 0, 0];

  // Push one triangle. If `hint` is given and the face normal points against it, the winding is flipped.
  G.tri = function (g, a, b, c, color, hint, uva, uvb, uvc) {
    v3.sub(_e1, b, a); v3.sub(_e2, c, a); v3.cross(_n, _e1, _e2);
    if (hint && v3.dot(_n, hint) < 0) { const t = b; b = c; c = t; const tu = uvb; uvb = uvc; uvc = tu; v3.scale(_n, _n, -1); }
    v3.normalize(_n, _n);
    const col = hex(color);
    for (const p of [a, b, c]) { g.pos.push(p[0], p[1], p[2]); g.nrm.push(_n[0], _n[1], _n[2]); g.col.push(col[0], col[1], col[2]); }
    g.uv.push((uva || [0, 0])[0], (uva || [0, 0])[1], (uvb || [0, 0])[0], (uvb || [0, 0])[1], (uvc || [0, 0])[0], (uvc || [0, 0])[1]);
    return g;
  };

  G.quad = function (g, a, b, c, d, color, hint) {
    G.tri(g, a, b, c, color, hint, [0, 0], [1, 0], [1, 1]);
    G.tri(g, a, c, d, color, hint, [0, 0], [1, 1], [0, 1]);
    return g;
  };

  // Axis-aligned box centered at the origin. colors: single color or {px,nx,py,ny,pz,nz}.
  G.box = function (w, h, d, color) {
    const g = G.create();
    const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = -d / 2, z1 = d / 2;
    const fc = (k) => (color && !Array.isArray(color) && typeof color === 'object' ? (color[k] || color.all) : color);
    const faces = [
      ['px', [x1, y0, z1], [0, 0, -d], [0, h, 0], [1, 0, 0]],
      ['nx', [x0, y0, z0], [0, 0, d], [0, h, 0], [-1, 0, 0]],
      ['py', [x0, y1, z1], [w, 0, 0], [0, 0, -d], [0, 1, 0]],
      ['ny', [x0, y0, z0], [w, 0, 0], [0, 0, d], [0, -1, 0]],
      ['pz', [x0, y0, z1], [w, 0, 0], [0, h, 0], [0, 0, 1]],
      ['nz', [x1, y0, z0], [-w, 0, 0], [0, h, 0], [0, 0, -1]],
    ];
    for (const [k, o, u, v, n] of faces) {
      const A = o, B = [o[0] + u[0], o[1] + u[1], o[2] + u[2]];
      const C = [B[0] + v[0], B[1] + v[1], B[2] + v[2]], D = [o[0] + v[0], o[1] + v[1], o[2] + v[2]];
      G.quad(g, A, B, C, D, fc(k), n);
    }
    return g;
  };

  // Cylinder / cone / frustum along Y, centered at the origin.
  G.cylinder = function (rTop, rBottom, h, seg, color, opts) {
    opts = opts || {};
    const g = G.create();
    const y0 = -h / 2, y1 = h / 2;
    const capColor = opts.capColor || color;
    const arc = opts.arc || Math.PI * 2;
    const a0 = opts.startAngle || 0;
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + (i / seg) * arc, t1 = a0 + ((i + 1) / seg) * arc;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const b0 = [rBottom * s0, y0, rBottom * c0], b1 = [rBottom * s1, y0, rBottom * c1];
      const u0 = [rTop * s0, y1, rTop * c0], u1 = [rTop * s1, y1, rTop * c1];
      const mid = (t0 + t1) / 2;
      const hint = [Math.sin(mid), (rBottom - rTop) / h, Math.cos(mid)];
      if (rTop > 0 && rBottom > 0) G.quad(g, b0, b1, u1, u0, color, hint);
      else if (rTop > 0) G.tri(g, b0, u1, u0, color, hint);
      else G.tri(g, b0, b1, u0, color, hint);
      if (opts.caps !== false) {
        if (rTop > 0) G.tri(g, [0, y1, 0], u0, u1, capColor, [0, 1, 0]);
        if (rBottom > 0) G.tri(g, [0, y0, 0], b1, b0, capColor, [0, -1, 0]);
      }
    }
    return g;
  };

  G.cone = (r, h, seg, color) => G.cylinder(0, r, h, seg, color);

  // UV sphere, flat shaded.
  G.sphere = function (r, wSeg, hSeg, color) {
    const g = G.create();
    const pt = (i, j) => {
      const th = (i / wSeg) * Math.PI * 2, ph = (j / hSeg) * Math.PI;
      return [r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th)];
    };
    for (let j = 0; j < hSeg; j++) {
      for (let i = 0; i < wSeg; i++) {
        const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
        const hint = pt(i + 0.5, j + 0.5);
        if (j === 0) G.tri(g, a, c, d, color, hint);
        else if (j === hSeg - 1) G.tri(g, a, b, c, color, hint);
        else G.quad(g, a, b, c, d, color, hint);
      }
    }
    return g;
  };

  // Icosphere: more even faceting than a UV sphere. detail 0 = 20 faces, 1 = 80, 2 = 320.
  G.icosphere = function (r, detail, color, jitter, seed) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    verts = verts.map((v) => v3.normalize([0, 0, 0], v));
    for (let d = 0; d < (detail || 0); d++) {
      const cache = {};
      const mid = (a, b) => {
        const k = a < b ? a + '_' + b : b + '_' + a;
        if (cache[k] != null) return cache[k];
        const m = v3.normalize([0, 0, 0], [(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]);
        verts.push(m);
        return (cache[k] = verts.length - 1);
      };
      const nf = [];
      for (const [a, b, c] of faces) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = nf;
    }
    const rnd = jitter ? GB.U.rng(seed || 7) : null;
    const scaled = verts.map((v) => {
      const k = jitter ? 1 + (rnd() * 2 - 1) * jitter : 1;
      return [v[0] * r * k, v[1] * r * k, v[2] * r * k];
    });
    const g = G.create();
    for (const [a, b, c] of faces) {
      const A = scaled[a], B = scaled[b], C = scaled[c];
      G.tri(g, A, B, C, color, [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3]);
    }
    return g;
  };

  // Torus lying in the XZ plane (ring around the Y axis).
  G.torus = function (R, r, radialSeg, tubeSeg, color, arc) {
    const g = G.create();
    arc = arc || Math.PI * 2;
    const pt = (i, j) => {
      const u = (i / radialSeg) * arc, v = (j / tubeSeg) * Math.PI * 2;
      const cx = Math.sin(u) * R, cz = Math.cos(u) * R;
      const k = R + r * Math.cos(v);
      return [Math.sin(u) * k, r * Math.sin(v), Math.cos(u) * k, cx, cz];
    };
    for (let i = 0; i < radialSeg; i++) {
      for (let j = 0; j < tubeSeg; j++) {
        const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
        const m = pt(i + 0.5, j + 0.5);
        const hint = [m[0] - m[3], m[1], m[2] - m[4]];
        G.quad(g, a.slice(0, 3), b.slice(0, 3), c.slice(0, 3), d.slice(0, 3), color, hint);
      }
    }
    return g;
  };

  // Extrude a 2D polygon (in the plane of axes a/b) along the remaining axis.
  // pts: [[u,v],...] convex or simple polygon, counter-clockwise. axis: 'x' | 'y' | 'z' extrusion direction.
  G.prism = function (pts, depth, color, axis) {
    axis = axis || 'x';
    const g = G.create();
    const map = (u, v, w) => (axis === 'x' ? [w, v, u] : axis === 'y' ? [u, w, v] : [u, v, w]);
    const h = depth / 2;
    const n = pts.length;
    let cu = 0, cv = 0;
    for (const p of pts) { cu += p[0]; cv += p[1]; }
    cu /= n; cv /= n;
    const capHint = (s) => (axis === 'x' ? [s, 0, 0] : axis === 'y' ? [0, s, 0] : [0, 0, s]);
    for (let i = 1; i < n - 1; i++) {
      G.tri(g, map(pts[0][0], pts[0][1], h), map(pts[i][0], pts[i][1], h), map(pts[i + 1][0], pts[i + 1][1], h), color, capHint(1));
      G.tri(g, map(pts[0][0], pts[0][1], -h), map(pts[i + 1][0], pts[i + 1][1], -h), map(pts[i][0], pts[i][1], -h), color, capHint(-1));
    }
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const mu = (p[0] + q[0]) / 2 - cu, mv = (p[1] + q[1]) / 2 - cv;
      const hint = map(mu, mv, 0);
      G.quad(g, map(p[0], p[1], -h), map(q[0], q[1], -h), map(q[0], q[1], h), map(p[0], p[1], h), color, hint);
    }
    return g;
  };

  // Flat textured rectangle in the XY plane facing +Z (for screens and signs).
  G.plane = function (w, h, color) {
    const g = G.create();
    const a = [-w / 2, -h / 2, 0], b = [w / 2, -h / 2, 0], c = [w / 2, h / 2, 0], d = [-w / 2, h / 2, 0];
    G.quad(g, a, b, c, d, color || '#ffffff', [0, 0, 1]);
    return g;
  };

  // Heightfield ground on a grid. heightFn(x,z) -> y; colorFn(x,z,y) -> color.
  G.terrain = function (size, segs, heightFn, colorFn) {
    const g = G.create();
    const step = size / segs, half = size / 2;
    const P = (i, j) => { const x = -half + i * step, z = -half + j * step; return [x, heightFn(x, z), z]; };
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        const cx = (a[0] + c[0]) / 2, cz = (a[2] + c[2]) / 2;
        const flip = (i + j) % 2 === 0;
        if (flip) {
          G.tri(g, a, b, c, colorFn(cx, cz, (a[1] + b[1] + c[1]) / 3, 0), [0, 1, 0]);
          G.tri(g, a, c, d, colorFn(cx, cz, (a[1] + c[1] + d[1]) / 3, 1), [0, 1, 0]);
        } else {
          G.tri(g, a, b, d, colorFn(cx, cz, (a[1] + b[1] + d[1]) / 3, 0), [0, 1, 0]);
          G.tri(g, b, c, d, colorFn(cx, cz, (b[1] + c[1] + d[1]) / 3, 1), [0, 1, 0]);
        }
      }
    }
    return g;
  };

  // Bake a list of { g, p:[x,y,z], r:[x,y,z], s:[x,y,z]|number, color?, jitter? } into one geometry.
  G.merge = function (parts) {
    const out = G.create();
    const m = m4.create(), nm = new Float32Array(9), tmp = [0, 0, 0];
    for (const part of parts) {
      const g = part.g || part;
      const s = part.s == null ? [1, 1, 1] : typeof part.s === 'number' ? [part.s, part.s, part.s] : part.s;
      if (part.m) m.set(part.m); else m4.compose(m, part.p || [0, 0, 0], part.r || [0, 0, 0], s);
      m4.normalMat3(nm, m);
      const col = part.color ? hex(part.color) : null;
      const n = g.pos.length / 3;
      for (let i = 0; i < n; i++) {
        tmp[0] = g.pos[i * 3]; tmp[1] = g.pos[i * 3 + 1]; tmp[2] = g.pos[i * 3 + 2];
        v3.transformMat4(tmp, tmp, m);
        out.pos.push(tmp[0], tmp[1], tmp[2]);
        const nx = g.nrm[i * 3], ny = g.nrm[i * 3 + 1], nz = g.nrm[i * 3 + 2];
        const tx = nm[0] * nx + nm[3] * ny + nm[6] * nz;
        const ty = nm[1] * nx + nm[4] * ny + nm[7] * nz;
        const tz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
        const l = Math.hypot(tx, ty, tz) || 1;
        out.nrm.push(tx / l, ty / l, tz / l);
        if (col) out.col.push(col[0], col[1], col[2]);
        else out.col.push(g.col[i * 3], g.col[i * 3 + 1], g.col[i * 3 + 2]);
      }
      for (let i = 0; i < g.uv.length; i++) out.uv.push(g.uv[i]);
    }
    return out;
  };

  // Slight per-face brightness variation, the classic low-poly look.
  G.jitter = function (g, amount, seed) {
    const rnd = GB.U.rng(seed || 1);
    for (let i = 0; i < g.col.length; i += 9) {
      const k = 1 + (rnd() * 2 - 1) * amount;
      for (let j = 0; j < 9; j++) g.col[i + j] = Math.min(1, g.col[i + j] * k);
    }
    return g;
  };

  G.recolor = function (g, color) {
    const c = hex(color);
    for (let i = 0; i < g.col.length; i += 3) { g.col[i] = c[0]; g.col[i + 1] = c[1]; g.col[i + 2] = c[2]; }
    return g;
  };

  GB.Geo = G;
})(window.GB = window.GB || {});
