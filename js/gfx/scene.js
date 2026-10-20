/* Granny Bench - scene graph node. Rotation is Euler YXZ in radians. */
(function (GB) {
  'use strict';
  const m4 = GB.m4;

  let nextId = 1;

  class Node {
    constructor(name, mesh, material) {
      this.id = nextId++;
      this.name = name || '';
      this.mesh = mesh || null;
      this.material = Object.assign({ tint: [1, 1, 1], emissive: [0, 0, 0], unlit: false, opacity: 1, texture: null }, material || {});
      this.position = [0, 0, 0];
      this.rotation = [0, 0, 0];
      this.scale = [1, 1, 1];
      this.children = [];
      this.parent = null;
      this.visible = true;
      this.castShadow = true;
      this.local = m4.create();
      this.world = m4.create();
    }

    add(...nodes) {
      for (const n of nodes) {
        if (n.parent) n.parent.remove(n);
        n.parent = this;
        this.children.push(n);
      }
      return this;
    }

    remove(n) {
      const i = this.children.indexOf(n);
      if (i >= 0) { this.children.splice(i, 1); n.parent = null; }
      return this;
    }

    at(x, y, z) { this.position[0] = x; this.position[1] = y; this.position[2] = z; return this; }
    rot(x, y, z) { this.rotation[0] = x; this.rotation[1] = y; this.rotation[2] = z; return this; }
    scl(x, y, z) { if (y === undefined) { y = x; z = x; } this.scale[0] = x; this.scale[1] = y; this.scale[2] = z; return this; }

    updateWorld(parentWorld) {
      m4.compose(this.local, this.position, this.rotation, this.scale);
      if (parentWorld) m4.multiply(this.world, parentWorld, this.local);
      else this.world.set(this.local);
      for (const c of this.children) c.updateWorld(this.world);
    }

    traverse(fn) {
      fn(this);
      for (const c of this.children) c.traverse(fn);
    }

    // Visible descendants with meshes, honoring parent visibility.
    collect(list) {
      if (!this.visible) return list;
      if (this.mesh) list.push(this);
      for (const c of this.children) c.collect(list);
      return list;
    }

    worldPosition(out) {
      out = out || [0, 0, 0];
      out[0] = this.world[12]; out[1] = this.world[13]; out[2] = this.world[14];
      return out;
    }

    // World-space point for a local offset (uses the last computed world matrix).
    localToWorld(p, out) { return GB.v3.transformMat4(out || [0, 0, 0], p, this.world); }

    find(name) {
      if (this.name === name) return this;
      for (const c of this.children) { const f = c.find(name); if (f) return f; }
      return null;
    }
  }

  GB.Node = Node;
})(window.GB = window.GB || {});
