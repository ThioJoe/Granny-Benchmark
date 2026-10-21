/* Granny Bench - WebGL2 renderer: lit flat-shaded meshes, PCF shadow map, exponential fog, gradient sky. */
(function (GB) {
  'use strict';
  const m4 = GB.m4, v3 = GB.v3, hex = GB.Geo.hex;

  const LIT_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 a_col;
layout(location=3) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_viewProj;
uniform mat3 u_nrmMat;
uniform mat4 u_lightVP;
out vec3 v_wpos;
out vec3 v_nrm;
out vec3 v_col;
out vec2 v_uv;
out vec4 v_lpos;
void main() {
  vec4 wp = u_model * vec4(a_pos, 1.0);
  v_wpos = wp.xyz;
  v_nrm = u_nrmMat * a_nrm;
  v_col = a_col;
  v_uv = a_uv;
  v_lpos = u_lightVP * wp;
  gl_Position = u_viewProj * wp;
}`;

  const LIT_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 v_wpos;
in vec3 v_nrm;
in vec3 v_col;
in vec2 v_uv;
in vec4 v_lpos;
uniform vec3 u_tint;
uniform vec3 u_emissive;
uniform float u_unlit;
uniform float u_opacity;
uniform sampler2D u_tex;
uniform float u_useTex;
uniform sampler2DShadow u_shadow;
uniform float u_shadowOn;
uniform float u_texel;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform vec3 u_skyColor;
uniform vec3 u_groundColor;
uniform vec3 u_camPos;
uniform vec3 u_fogColor;
uniform float u_fogDensity;
out vec4 o_col;

float shadowFactor(vec3 n) {
  vec3 p = v_lpos.xyz / v_lpos.w * 0.5 + 0.5;
  if (p.x <= 0.001 || p.x >= 0.999 || p.y <= 0.001 || p.y >= 0.999 || p.z >= 1.0) return 1.0;
  float ndl = clamp(dot(n, u_lightDir), 0.0, 1.0);
  float bias = mix(0.0025, 0.0006, ndl);
  float s = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      s += texture(u_shadow, vec3(p.xy + vec2(float(x), float(y)) * u_texel, p.z - bias));
    }
  }
  return s / 9.0;
}

void main() {
  vec3 base = v_col * u_tint;
  float alpha = u_opacity;
  if (u_useTex > 0.5) {
    vec4 t = texture(u_tex, v_uv);
    base *= t.rgb;
    alpha *= t.a;
  }
  vec3 col;
  if (u_unlit > 0.5) {
    col = base;
  } else {
    vec3 n = normalize(v_nrm);
    if (!gl_FrontFacing) n = -n;
    float ndl = max(dot(n, u_lightDir), 0.0);
    float sh = u_shadowOn > 0.5 ? shadowFactor(n) : 1.0;
    float hemi = n.y * 0.5 + 0.5;
    vec3 amb = mix(u_groundColor, u_skyColor, hemi);
    col = base * (amb + u_lightColor * ndl * sh);
    vec3 V = normalize(u_camPos - v_wpos);
    float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += rim * 0.12 * u_skyColor;
  }
  col += u_emissive;
  float d = length(v_wpos - u_camPos);
  float f = 1.0 - exp(-pow(d * u_fogDensity, 2.0));
  col = mix(col, u_fogColor, clamp(f, 0.0, 1.0));
  o_col = vec4(col, alpha);
}`;

  const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_model;
uniform mat4 u_lightVP;
void main() { gl_Position = u_lightVP * u_model * vec4(a_pos, 1.0); }`;

  const DEPTH_FS = `#version 300 es
precision mediump float;
out vec4 o_col;
void main() { o_col = vec4(1.0); }`;

  const SKY_VS = `#version 300 es
out vec2 v_ndc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_ndc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

  const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_invVP;
uniform vec3 u_camPos;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_ground;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
out vec4 o_col;
void main() {
  vec4 w = u_invVP * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - u_camPos);
  float y = dir.y;
  vec3 col = y > 0.0 ? mix(u_horizon, u_zenith, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(u_horizon, u_ground, clamp(-y * 6.0, 0.0, 1.0));
  float s = max(dot(dir, u_sunDir), 0.0);
  col += u_sunColor * (pow(s, 900.0) * 2.5 + pow(s, 12.0) * 0.25);
  o_col = vec4(col, 1.0);
}`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile error: ' + log);
    }
    return sh;
  }

  function program(gl, vs, fs, uniforms) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
    const u = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
    return { p, u };
  }

  class Renderer {
    constructor(canvas, opts) {
      opts = opts || {};
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' });
      if (!gl) throw new Error('This browser does not support WebGL2, which the 3D view needs.');
      this.gl = gl;
      this.canvas = canvas;
      this.pixelRatioCap = opts.pixelRatioCap || 1.75;
      this.shadows = opts.shadows !== false;
      this.shadowSize = 2048;
      this.shadowRange = 30;
      this.cssW = 1; this.cssH = 1;
      this.view = m4.create(); this.proj = m4.create(); this.viewProj = m4.create(); this.invViewProj = m4.create();
      this.lightView = m4.create(); this.lightProj = m4.create(); this.lightVP = m4.create();
      this.camPos = [0, 0, 0];
      this.env = {
        lightDir: v3.normalize([0, 0, 0], [-0.45, 0.8, -0.38]),
        lightColor: [0.98, 0.92, 0.82],
        skyColor: [0.44, 0.5, 0.6],
        groundColor: [0.32, 0.29, 0.22],
        zenith: hex('#4f8fd6'),
        horizon: hex('#cfe3f2'),
        ground: hex('#a8c49a'),
        fogColor: hex('#cfe3f2'),
        fogDensity: 0.0024,
        sunColor: [1.0, 0.9, 0.7],
      };
      this.stats = { draws: 0 };
      this._nm = new Float32Array(9);

      this.lit = program(gl, LIT_VS, LIT_FS, ['u_model', 'u_viewProj', 'u_nrmMat', 'u_lightVP', 'u_tint', 'u_emissive', 'u_unlit',
        'u_opacity', 'u_tex', 'u_useTex', 'u_shadow', 'u_shadowOn', 'u_texel', 'u_lightDir', 'u_lightColor', 'u_skyColor',
        'u_groundColor', 'u_camPos', 'u_fogColor', 'u_fogDensity']);
      this.depth = program(gl, DEPTH_VS, DEPTH_FS, ['u_model', 'u_lightVP']);
      this.sky = program(gl, SKY_VS, SKY_FS, ['u_invVP', 'u_camPos', 'u_zenith', 'u_horizon', 'u_ground', 'u_sunDir', 'u_sunColor']);
      this.emptyVao = gl.createVertexArray();

      // 1x1 white texture so the sampler always has something bound.
      this.white = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.white);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

      this._initShadow();
      this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    }

    _initShadow() {
      const gl = this.gl, size = this.shadowSize;
      this.shadowTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      this.shadowFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    createMesh(geo) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffers = [];
      const attr = (data, loc, size) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        buffers.push(b);
      };
      attr(geo.pos, 0, 3);
      attr(geo.nrm, 1, 3);
      attr(geo.col, 2, 3);
      if (geo.uv && geo.uv.length) attr(geo.uv, 3, 2);
      gl.bindVertexArray(null);
      return { vao, count: geo.pos.length / 3, buffers };
    }

    createTexture(canvas, mipmaps) {
      const gl = this.gl;
      const t = { tex: gl.createTexture(), canvas, mipmaps: mipmaps !== false };
      const self = this;
      t.update = function () {
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.canvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        if (t.mipmaps) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (self.aniso) gl.texParameterf(gl.TEXTURE_2D, self.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      };
      t.update();
      return t;
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
      const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
      this.cssW = w; this.cssH = h;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw;
        this.canvas.height = ph;
      }
    }

    // Vertical field of view for a view of this shape. The shots are made for a wide view, so a view taller than it
    // is wide (such as the 9:16 frame for vertical video) gets a wider field of view: 60% of what a 16:9 view
    // would show across, instead of a narrow slice.
    fovFor(fov, aspect) {
      if (aspect >= 1) return fov;
      const across = 0.6 * 2 * Math.atan(Math.tan(fov / 2) * 16 / 9);
      return Math.max(fov, 2 * Math.atan(Math.tan(across / 2) / aspect));
    }

    _updateCamera(cam) {
      const aspect = this.canvas.width / Math.max(1, this.canvas.height);
      m4.perspective(this.proj, this.fovFor(cam.fov || 0.96, aspect), aspect, cam.near || 0.1, cam.far || 1500);
      m4.lookAt(this.view, cam.position, cam.target, cam.up || [0, 1, 0]);
      m4.multiply(this.viewProj, this.proj, this.view);
      m4.invert(this.invViewProj, this.viewProj);
      v3.copy(this.camPos, cam.position);
    }

    _updateLight(focus) {
      const L = this.env.lightDir, dist = 90, r = this.shadowRange;
      const up = Math.abs(L[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
      // Snap the focus to whole shadow texels so the shadows do not shimmer as the camera moves.
      const eye0 = [focus[0] + L[0] * dist, focus[1] + L[1] * dist, focus[2] + L[2] * dist];
      m4.lookAt(this.lightView, eye0, focus, up);
      const right = [this.lightView[0], this.lightView[4], this.lightView[8]];
      const upv = [this.lightView[1], this.lightView[5], this.lightView[9]];
      const texel = (2 * r) / this.shadowSize;
      const pr = v3.dot(focus, right), pu = v3.dot(focus, upv);
      const dr = Math.floor(pr / texel) * texel - pr, du = Math.floor(pu / texel) * texel - pu;
      const f = [focus[0] + right[0] * dr + upv[0] * du, focus[1] + right[1] * dr + upv[1] * du, focus[2] + right[2] * dr + upv[2] * du];
      const eye = [f[0] + L[0] * dist, f[1] + L[1] * dist, f[2] + L[2] * dist];
      m4.lookAt(this.lightView, eye, f, up);
      m4.ortho(this.lightProj, -r, r, -r, r, 1, dist * 2 + 40);
      m4.multiply(this.lightVP, this.lightProj, this.lightView);
    }

    render(scene, cam) {
      const gl = this.gl;
      this.resize();
      scene.updateWorld(null);
      this._updateCamera(cam);
      const list = scene.collect([]);
      this.stats.draws = 0;

      // ---- shadow pass ----
      const shadowOn = this.shadows;
      if (shadowOn) {
        this._updateLight(cam.shadowFocus || cam.target);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.5, 3.0);
        gl.useProgram(this.depth.p);
        gl.uniformMatrix4fv(this.depth.u.u_lightVP, false, this.lightVP);
        for (const n of list) {
          if (!n.castShadow || n.material.opacity < 1 || n.material.unlit) continue;
          gl.uniformMatrix4fv(this.depth.u.u_model, false, n.world);
          gl.bindVertexArray(n.mesh.vao);
          gl.drawArrays(gl.TRIANGLES, 0, n.mesh.count);
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      // ---- main pass ----
      const env = this.env;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // sky
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      gl.useProgram(this.sky.p);
      gl.uniformMatrix4fv(this.sky.u.u_invVP, false, this.invViewProj);
      gl.uniform3fv(this.sky.u.u_camPos, this.camPos);
      gl.uniform3fv(this.sky.u.u_zenith, env.zenith);
      gl.uniform3fv(this.sky.u.u_horizon, env.horizon);
      gl.uniform3fv(this.sky.u.u_ground, env.ground);
      gl.uniform3fv(this.sky.u.u_sunDir, env.lightDir);
      gl.uniform3fv(this.sky.u.u_sunColor, env.sunColor);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // meshes
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      const L = this.lit;
      gl.useProgram(L.p);
      gl.uniformMatrix4fv(L.u.u_viewProj, false, this.viewProj);
      gl.uniformMatrix4fv(L.u.u_lightVP, false, this.lightVP);
      gl.uniform3fv(L.u.u_lightDir, env.lightDir);
      gl.uniform3fv(L.u.u_lightColor, env.lightColor);
      gl.uniform3fv(L.u.u_skyColor, env.skyColor);
      gl.uniform3fv(L.u.u_groundColor, env.groundColor);
      gl.uniform3fv(L.u.u_camPos, this.camPos);
      gl.uniform3fv(L.u.u_fogColor, env.fogColor);
      gl.uniform1f(L.u.u_fogDensity, env.fogDensity);
      gl.uniform1f(L.u.u_shadowOn, shadowOn ? 1 : 0);
      gl.uniform1f(L.u.u_texel, 1 / this.shadowSize);
      gl.uniform1i(L.u.u_tex, 0);
      gl.uniform1i(L.u.u_shadow, 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.activeTexture(gl.TEXTURE0);

      const transparent = [];
      for (const n of list) {
        if (n.material.opacity < 1) { transparent.push(n); continue; }
        this._draw(n);
      }
      if (transparent.length) {
        const cp = this.camPos;
        transparent.sort((a, b) => {
          const da = (a.world[12] - cp[0]) ** 2 + (a.world[13] - cp[1]) ** 2 + (a.world[14] - cp[2]) ** 2;
          const db = (b.world[12] - cp[0]) ** 2 + (b.world[13] - cp[1]) ** 2 + (b.world[14] - cp[2]) ** 2;
          return db - da;
        });
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        for (const n of transparent) this._draw(n);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    }

    _draw(n) {
      const gl = this.gl, L = this.lit, mat = n.material;
      gl.uniformMatrix4fv(L.u.u_model, false, n.world);
      m4.normalMat3(this._nm, n.world);
      gl.uniformMatrix3fv(L.u.u_nrmMat, false, this._nm);
      gl.uniform3fv(L.u.u_tint, mat.tint);
      gl.uniform3fv(L.u.u_emissive, mat.emissive);
      gl.uniform1f(L.u.u_unlit, mat.unlit ? 1 : 0);
      gl.uniform1f(L.u.u_opacity, mat.opacity);
      if (mat.texture) {
        gl.uniform1f(L.u.u_useTex, 1);
        gl.bindTexture(gl.TEXTURE_2D, mat.texture.tex);
      } else {
        gl.uniform1f(L.u.u_useTex, 0);
        gl.bindTexture(gl.TEXTURE_2D, this.white);
      }
      if (mat.doubleSided) gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(n.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, n.mesh.count);
      if (mat.doubleSided) gl.enable(gl.CULL_FACE);
      this.stats.draws++;
    }

    // World point -> CSS pixel position on the canvas (seen by the current camera, or through viewProj).
    project(p, out, viewProj) {
      out = out || {};
      const m = viewProj || this.viewProj;
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      out.behind = w <= 0.0001;
      const iw = 1 / Math.abs(w || 0.0001);
      const nx = x * iw, ny = y * iw;
      out.x = (nx * 0.5 + 0.5) * this.cssW;
      out.y = (1 - (ny * 0.5 + 0.5)) * this.cssH;
      out.onScreen = !out.behind && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
      return out;
    }

    // View-projection matrix for a camera pose other than the current one ({ position, target, fov }).
    viewProjFor(cam) {
      const aspect = this.canvas.width / Math.max(1, this.canvas.height);
      const proj = m4.perspective(m4.create(), this.fovFor(cam.fov || 0.96, aspect), aspect, cam.near || 0.1, cam.far || 1500);
      const view = m4.lookAt(m4.create(), cam.position, cam.target, cam.up || [0, 1, 0]);
      return m4.multiply(m4.create(), proj, view);
    }
  }

  GB.Renderer = Renderer;
})(window.GB = window.GB || {});
