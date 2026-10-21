/* Granny Bench - low-poly model builders. Characters are built facing +Z. */
(function (GB) {
  'use strict';
  const G = GB.Geo, Node = GB.Node, U = GB.U;
  const PI = Math.PI;

  const C = {
    skin: '#f1c7a1', skinDark: '#e3a98a', blush: '#f0a0a0', hair: '#e4e4ea',
    dress: '#8e6cc0', cardigan: '#d77f8f', stockings: '#d9b59b', shoe: '#2b2424', rope: '#c8a46a',
    wood: '#9a6235', woodDark: '#7a4b27', frame: '#3a2e2a', yarn: '#d64545', needle: '#d8d8d8',
    robot: '#a9bccf', robotLight: '#c4d2df', robotDark: '#5f7287', robotAccent: '#ffc83d', face: '#14202a',
    chair: '#2d3138', desk: '#c49a6c', deskLeg: '#5c4630', crt: '#ddd5bb', crtDark: '#c4bb9f', keyboard: '#3a3d44',
    trainRed: '#c0392b', trainBlack: '#26272b', gold: '#e0b13c', cab: '#7f2620', wheel: '#b5312a', rod: '#a3a9b0',
    pilot: '#d64532', tender: '#6b221d', coal: '#1c1c1f', car1: '#2f7f7a', car2: '#d9a441', roof: '#3b3b40', window: '#1d2733',
    rail: '#9aa2ab', railTop: '#c9cfd6', sleeper: '#6b4a33', ballast: '#8a8178',
  };
  const M = { colors: C };

  const P = (g, p, r, s, color) => ({ g, p, r, s, color });

  function mesh(R, g, name, mat) { return new Node(name, R.createMesh(g), mat); }

  // ---------------------------------------------------------------------------
  // Grandma on her chair (rig origin at the chair's feet).
  // ---------------------------------------------------------------------------
  M.granny = function (R) {
    const rig = new Node('grannyRig');

    // Chair
    const chairParts = [P(G.box(0.54, 0.06, 0.5, C.wood), [0, 0.45, 0])];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) chairParts.push(P(G.box(0.05, 0.45, 0.05, C.woodDark), [sx * 0.22, 0.225, sz * 0.21]));
    for (const sx of [-1, 1]) chairParts.push(P(G.box(0.055, 0.7, 0.055, C.woodDark), [sx * 0.22, 0.8, -0.215]));
    for (const y of [0.64, 0.82, 1.0]) chairParts.push(P(G.box(0.44, 0.05, 0.03, C.wood), [0, y, -0.22]));
    chairParts.push(P(G.box(0.56, 0.08, 0.07, C.wood), [0, 1.16, -0.22]));
    const chair = mesh(R, G.jitter(G.merge(chairParts), 0.05, 3), 'chair');
    rig.add(chair);

    // Lower legs + shoes + leg rope stay with the chair.
    const legParts = [];
    for (const sx of [-1, 1]) {
      legParts.push(P(G.cylinder(0.055, 0.05, 0.42, 8, C.stockings), [sx * 0.09, 0.25, 0.34]));
      legParts.push(P(G.box(0.1, 0.07, 0.2, C.shoe), [sx * 0.09, 0.035, 0.38]));
    }
    legParts.push(P(G.torus(0.17, 0.02, 16, 5, C.rope), [0, 0.3, 0.33], [0, 0, 0], [1, 1, 0.55]));
    legParts.push(P(G.torus(0.17, 0.02, 16, 5, C.rope), [0, 0.2, 0.33], [0, 0, 0], [1, 1, 0.55]));
    rig.add(mesh(R, G.merge(legParts), 'legs'));

    // Torso pivot at the seat so she can wobble and struggle.
    const torso = new Node('torso').at(0, 0.48, 0);
    rig.add(torso);
    const tp = [
      P(G.cylinder(0.17, 0.22, 0.46, 10, C.dress), [0, 0.23, 0]),
      P(G.cylinder(0.12, 0.235, 0.15, 10, C.cardigan), [0, 0.45, 0]),
      P(G.box(0.38, 0.13, 0.38, C.dress), [0, 0.03, 0.17]),
    ];
    for (const sx of [-1, 1]) {
      tp.push(P(G.cylinder(0.05, 0.055, 0.3, 7, C.cardigan), [sx * 0.215, 0.32, 0.0], [0, 0, sx * 0.12]));
      tp.push(P(G.cylinder(0.042, 0.048, 0.27, 7, C.cardigan), [sx * 0.17, 0.2, 0.12], [PI / 2 - 0.25, 0, 0]));
      tp.push(P(G.icosphere(0.045, 1, C.skin), [sx * 0.11, 0.165, 0.25]));
    }
    // ropes around her and the chair back
    for (const y of [0.17, 0.31]) tp.push(P(G.torus(0.27, 0.022, 20, 5, C.rope), [0, y, -0.05], [0, 0, 0], [1.02, 1, 0.98]));
    // knitting in her lap
    tp.push(P(G.icosphere(0.065, 1, C.yarn), [0.02, 0.13, 0.3]));
    tp.push(P(G.cylinder(0.006, 0.006, 0.3, 4, C.needle), [0.02, 0.17, 0.3], [0.3, 0, 0.9]));
    tp.push(P(G.cylinder(0.006, 0.006, 0.3, 4, C.needle), [0.02, 0.17, 0.3], [0.3, 0, -0.9]));
    torso.add(mesh(R, G.jitter(G.merge(tp), 0.04, 5), 'torsoMesh'));

    // Head pivot at the neck.
    const head = new Node('head').at(0, 0.52, 0);
    torso.add(head);
    const hp = [
      P(G.cylinder(0.055, 0.06, 0.09, 8, C.skin), [0, 0.02, 0]),
      P(G.icosphere(0.15, 1, C.skin), [0, 0.17, 0], null, [1, 1.08, 1]),
      P(G.icosphere(0.16, 1, C.hair, 0.04, 11), [0, 0.215, -0.04], null, [1.04, 0.84, 1.0]),
      P(G.icosphere(0.078, 1, C.hair, 0.06, 12), [0, 0.33, -0.08]),
      P(G.icosphere(0.028, 1, C.skinDark), [0, 0.158, 0.152]),
    ];
    for (const sx of [-1, 1]) {
      hp.push(P(G.icosphere(0.03, 1, C.blush), [sx * 0.085, 0.14, 0.12]));
      hp.push(P(G.torus(0.04, 0.0075, 12, 4, C.frame), [sx * 0.052, 0.19, 0.148], [PI / 2, 0, 0]));
      hp.push(P(G.box(0.006, 0.006, 0.13, C.frame), [sx * 0.098, 0.192, 0.085]));
    }
    hp.push(P(G.box(0.03, 0.006, 0.006, C.frame), [0, 0.195, 0.152]));
    head.add(mesh(R, G.merge(hp), 'headMesh'));

    const eyes = [];
    for (const sx of [-1, 1]) {
      const e = mesh(R, G.icosphere(0.017, 1, '#1b1b1b'), 'eye').at(sx * 0.052, 0.19, 0.14);
      head.add(e); eyes.push(e);
      const brow = mesh(R, G.box(0.055, 0.012, 0.012, '#b9b9c2'), 'brow').at(sx * 0.055, 0.232, 0.142);
      brow.rotation[2] = sx * 0.25;
      head.add(brow);
    }
    const mouth = mesh(R, G.box(0.06, 0.016, 0.02, '#5a1f24'), 'mouth').at(0, 0.105, 0.14);
    head.add(mouth);

    return { rig, torso, head, mouth, eyes, chair };
  };

  // ---------------------------------------------------------------------------
  // Robot on an office chair at its desk (rig origin on the floor, robot faces +Z).
  // ---------------------------------------------------------------------------
  M.robot = function (R) {
    const rig = new Node('robotRig');

    // office chair
    const ch = [P(G.cylinder(0.035, 0.035, 0.34, 8, '#8d939b'), [0, 0.26, 0]), P(G.box(0.5, 0.08, 0.5, C.chair), [0, 0.45, 0]),
      P(G.box(0.46, 0.55, 0.07, C.chair), [0, 0.82, -0.25]), P(G.box(0.06, 0.4, 0.05, '#8d939b'), [0, 0.5, -0.24])];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * PI * 2;
      ch.push(P(G.box(0.05, 0.04, 0.34, '#55595f'), [Math.sin(a) * 0.17, 0.08, Math.cos(a) * 0.17], [0, a, 0]));
      ch.push(P(G.icosphere(0.035, 0, '#222'), [Math.sin(a) * 0.33, 0.035, Math.cos(a) * 0.33]));
    }
    rig.add(mesh(R, G.merge(ch), 'officeChair'));

    // robot body (pivot at seat)
    const body = new Node('robotBody').at(0, 0.49, 0);
    rig.add(body);
    const bp = [
      P(G.box(0.4, 0.14, 0.32, C.robotDark), [0, 0.07, 0]),
      P(G.box(0.46, 0.5, 0.32, C.robot), [0, 0.4, 0]),
      P(G.box(0.26, 0.17, 0.02, C.robotDark), [0, 0.44, 0.165]),
      P(G.cylinder(0.05, 0.06, 0.09, 8, C.robotDark), [0, 0.69, 0]),
    ];
    for (const sx of [-1, 1]) {
      bp.push(P(G.icosphere(0.075, 1, C.robotAccent), [sx * 0.27, 0.6, 0]));
      bp.push(P(G.cylinder(0.045, 0.045, 0.26, 8, C.robotDark), [sx * 0.29, 0.47, 0.04], [0.35, 0, 0]));
      bp.push(P(G.box(0.13, 0.12, 0.38, C.robot), [sx * 0.11, 0.03, 0.2]));
      bp.push(P(G.box(0.11, 0.42, 0.12, C.robotDark), [sx * 0.11, -0.2, 0.38]));
      bp.push(P(G.box(0.14, 0.07, 0.24, C.robotAccent), [sx * 0.11, -0.42, 0.44]));
    }
    body.add(mesh(R, G.jitter(G.merge(bp), 0.03, 9), 'robotBodyMesh'));
    const buttons = [];
    ['#ff4d4d', '#ffd23f', '#3ddc84'].forEach((col, i) => {
      const b = mesh(R, G.box(0.045, 0.045, 0.02, col), 'button', { emissive: G.hex(col).map((c) => c * 0.6) }).at(-0.07 + i * 0.07, 0.44, 0.177);
      body.add(b); buttons.push(b);
    });

    const forearms = [];
    for (const sx of [-1, 1]) {
      const fa = new Node('forearm').at(sx * 0.29, 0.36, 0.12);
      fa.add(mesh(R, G.merge([P(G.cylinder(0.04, 0.04, 0.3, 8, C.robotDark), [0, 0, 0.15], [PI / 2, 0, 0]),
        P(G.box(0.09, 0.045, 0.11, C.robotAccent), [0, 0, 0.32])]), 'forearmMesh'));
      fa.rotation[0] = 0.25;
      fa.rotation[1] = -sx * 0.18;
      body.add(fa); forearms.push(fa);
    }

    const head = new Node('robotHead').at(0, 0.74, 0);
    body.add(head);
    const hp = [
      P(G.box(0.4, 0.32, 0.34, C.robotLight), [0, 0.16, 0]),
      P(G.box(0.32, 0.21, 0.02, C.face), [0, 0.16, 0.172]),
      P(G.cylinder(0.012, 0.012, 0.16, 5, C.robotDark), [0, 0.38, 0]),
    ];
    for (const sx of [-1, 1]) hp.push(P(G.cylinder(0.055, 0.055, 0.06, 10, C.robotAccent), [sx * 0.215, 0.16, 0], [0, 0, PI / 2]));
    head.add(mesh(R, G.merge(hp), 'robotHeadMesh'));
    const eyes = [];
    for (const sx of [-1, 1]) {
      const e = mesh(R, G.cylinder(0.035, 0.035, 0.012, 12, '#4ef2ff'), 'robotEye', { emissive: [0.15, 0.75, 0.85], unlit: false }).at(sx * 0.075, 0.19, 0.182);
      e.rotation[0] = PI / 2;
      head.add(e); eyes.push(e);
    }
    const mouth = mesh(R, G.box(0.15, 0.025, 0.012, '#4ef2ff'), 'robotMouth', { emissive: [0.05, 0.25, 0.3] }).at(0, 0.11, 0.182);
    head.add(mouth);
    const bulb = mesh(R, G.icosphere(0.035, 1, '#ff3b3b'), 'antennaBulb', { emissive: [0.9, 0.1, 0.1] }).at(0, 0.47, 0);
    head.add(bulb);

    // desk with CRT
    const desk = new Node('desk').at(0, 0, 0.78);
    rig.add(desk);
    const dp = [P(G.box(1.5, 0.05, 0.75, C.desk), [0, 0.76, 0])];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) dp.push(P(G.box(0.05, 0.74, 0.05, C.deskLeg), [sx * 0.68, 0.37, sz * 0.31]));
    dp.push(P(G.box(0.48, 0.03, 0.16, C.keyboard), [0, 0.8, -0.24]));
    dp.push(P(G.box(0.44, 0.012, 0.12, '#6c717a'), [0, 0.818, -0.24]));
    dp.push(P(G.box(0.07, 0.03, 0.11, '#e6e6e6'), [0.36, 0.8, -0.22]));
    dp.push(P(G.cylinder(0.045, 0.04, 0.1, 10, '#f4f4f4'), [-0.52, 0.835, -0.18]));
    dp.push(P(G.torus(0.03, 0.008, 8, 4, '#f4f4f4'), [-0.575, 0.84, -0.18], [PI / 2, 0, 0]));
    dp.push(P(G.box(0.11, 0.1, 0.11, '#c4683f'), [0.58, 0.835, 0.18]));
    dp.push(P(G.cylinder(0.035, 0.04, 0.2, 7, '#4f9a55'), [0.58, 0.98, 0.18]));
    dp.push(P(G.cylinder(0.02, 0.022, 0.08, 6, '#4f9a55'), [0.62, 1.0, 0.18], [0, 0, -0.9]));
    // CRT
    dp.push(P(G.box(0.2, 0.04, 0.2, C.crtDark), [0, 0.805, 0.12]));
    dp.push(P(G.box(0.54, 0.45, 0.44, C.crt), [0, 1.05, 0.12]));
    dp.push(P(G.box(0.38, 0.32, 0.28, C.crtDark), [0, 1.03, 0.45]));
    desk.add(mesh(R, G.jitter(G.merge(dp), 0.03, 4), 'deskMesh'));

    // Screen (texture assigned by the world), faces -Z toward the robot.
    const screen = new Node('screen', null).at(0, 1.07, -0.105);
    screen.rotation[1] = PI;
    desk.add(screen);
    const led = mesh(R, G.box(0.03, 0.015, 0.01, '#3ddc84'), 'led', { emissive: [0.2, 0.9, 0.4] }).at(0.21, 0.86, -0.105);
    desk.add(led);

    return { rig, body, head, eyes, mouth, bulb, forearms, desk, screen, buttons };
  };

  // ---------------------------------------------------------------------------
  // Steam train. Local +Z is forward; the cowcatcher tip is at z = 0 and the train extends toward -Z.
  // y = 0 is the top of the rails.
  // ---------------------------------------------------------------------------
  function wheelGeo(r, w, color, spokes) {
    const parts = [
      P(G.cylinder(r, r, w, 16, color), [0, 0, 0], [0, 0, PI / 2]),
      P(G.cylinder(r * 0.26, r * 0.26, w * 1.4, 8, C.gold), [0, 0, 0], [0, 0, PI / 2]),
    ];
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * PI * 2;
      parts.push(P(G.box(w * 1.15, r * 0.12, r * 0.85, '#7e1f1a'), [0, Math.sin(a) * r * 0.45, Math.cos(a) * r * 0.45], [-a, 0, 0]));
    }
    parts.push(P(G.torus(r * 0.97, r * 0.06, 16, 4, '#d9d9d9'), [0, 0, 0], [0, 0, PI / 2]));
    return G.merge(parts);
  }

  M.train = function (R) {
    const root = new Node('train');
    const wheels = [];
    const addWheel = (parent, mesh, x, y, z, r) => {
      const n = new Node('wheel', mesh).at(x, y, z);
      parent.add(n);
      wheels.push({ node: n, r });
      return n;
    };

    // --- locomotive ---
    const loco = new Node('loco');
    root.add(loco);
    const lp = [
      P(G.box(1.9, 0.34, 7.0, C.trainBlack), [0, 0.78, -3.95]),
      P(G.prism([[0, 0.06], [-0.95, 0.06], [-0.95, 0.78]], 1.9, C.pilot, 'x'), [0, 0, 0]),
      P(G.box(2.3, 0.4, 0.2, C.pilot), [0, 0.95, -1.02]),
      P(G.cylinder(0.83, 0.83, 1.1, 14, C.trainBlack), [0, 1.8, -1.75], [PI / 2, 0, 0]),
      P(G.cylinder(0.7, 0.7, 0.08, 14, '#34353b'), [0, 1.8, -1.18], [PI / 2, 0, 0]),
      P(G.cylinder(0.12, 0.12, 0.1, 8, C.gold), [0, 1.8, -1.12], [PI / 2, 0, 0]),
      P(G.cylinder(0.78, 0.78, 3.7, 14, C.trainRed), [0, 1.8, -4.15], [PI / 2, 0, 0]),
      P(G.cylinder(0.2, 0.22, 0.6, 10, C.trainBlack), [0, 2.85, -1.85]),
      P(G.cylinder(0.4, 0.22, 0.42, 10, C.trainBlack), [0, 3.35, -1.85]),
      P(G.torus(0.39, 0.04, 12, 4, C.gold), [0, 3.56, -1.85]),
      P(G.icosphere(0.36, 1, C.gold), [0, 2.55, -3.5], null, [1, 0.85, 1.25]),
      P(G.icosphere(0.28, 1, C.trainRed), [0, 2.52, -4.7], null, [1, 0.8, 1.2]),
      P(G.cone(0.13, 0.22, 8, C.gold), [0, 2.75, -2.75]),
      P(G.cylinder(0.05, 0.05, 0.3, 6, C.gold), [0, 2.75, -5.7]),
      P(G.cylinder(0.24, 0.24, 0.36, 10, C.trainBlack), [0, 2.72, -1.4], [PI / 2, 0, 0]),
      P(G.box(2.3, 1.95, 2.15, C.cab), [0, 2.15, -6.9]),
      P(G.box(2.65, 0.14, 2.6, C.trainBlack), [0, 3.18, -6.9]),
      P(G.box(2.3, 0.08, 0.05, C.gold), [0, 1.6, -5.82]),
    ];
    for (const z of [-2.55, -3.6, -4.65, -5.7]) lp.push(P(G.torus(0.795, 0.035, 16, 4, C.gold), [0, 1.8, z], [PI / 2, 0, 0]));
    for (const sx of [-1, 1]) {
      lp.push(P(G.box(0.55, 0.55, 0.04, C.window), [sx * 0.55, 2.6, -5.81]));
      lp.push(P(G.box(0.04, 0.6, 0.9, C.window), [sx * 1.16, 2.55, -6.75]));
      lp.push(P(G.cylinder(0.22, 0.22, 0.8, 10, '#3d3f46'), [sx * 0.98, 0.88, -1.6], [PI / 2, 0, 0]));
      lp.push(P(G.cylinder(0.1, 0.1, 0.26, 8, C.trainBlack), [sx * 0.8, 0.95, -0.85], [PI / 2, 0, 0]));
      lp.push(P(G.box(0.08, 0.9, 7.0, C.trainBlack), [sx * 1.05, 1.3, -3.95]));
    }
    // cowcatcher slats
    const slope = Math.atan2(0.72, 0.95);
    for (let i = -2; i <= 2; i++) lp.push(P(G.box(0.07, 0.035, 1.18, C.trainBlack), [i * 0.38, 0.43, -0.48], [slope, 0, 0]));
    loco.add(mesh(R, G.jitter(G.merge(lp), 0.03, 21), 'locoMesh'));

    // headlight lens (bright) - separate so it can flicker
    const headlight = mesh(R, G.cylinder(0.19, 0.19, 0.03, 14, '#fff6c8'), 'headlight', { emissive: [1, 0.85, 0.5] }).at(0, 2.72, -1.21);
    headlight.rotation[0] = PI / 2;
    loco.add(headlight);

    const bigWheel = R.createMesh(wheelGeo(0.62, 0.12, C.wheel, 8));
    const smallWheel = R.createMesh(wheelGeo(0.36, 0.1, C.wheel, 6));
    const rods = [];
    for (const sx of [-1, 1]) {
      for (const z of [-2.75, -4.15, -5.55]) addWheel(loco, bigWheel, sx * 0.86, 0.62, z, 0.62);
      addWheel(loco, smallWheel, sx * 0.84, 0.36, -0.95, 0.36);
      const rod = mesh(R, G.box(0.06, 0.1, 3.0, C.rod), 'rod').at(sx * 0.98, 0.62, -4.15);
      loco.add(rod);
      rods.push({ node: rod, baseY: 0.62, baseZ: -4.15, crank: 0.27, phase: sx > 0 ? 0 : PI / 2 });
    }

    // smoke stack top in loco space
    const stackTop = [0, 3.6, -1.85];

    // --- tender ---
    const tender = new Node('tender').at(0, 0, -10.2);
    root.add(tender);
    const tp = [
      P(G.box(2.3, 1.75, 4.1, C.tender), [0, 1.55, 0]),
      P(G.box(2.32, 0.1, 4.12, C.gold), [0, 1.95, 0]),
      P(G.box(1.9, 0.3, 4.0, C.trainBlack), [0, 0.6, 0]),
      P(G.icosphere(1, 1, C.coal, 0.12, 31), [0, 2.4, 0.2], null, [1.0, 0.38, 1.75]),
      P(G.box(0.4, 0.2, 0.6, C.trainBlack), [0, 0.65, 2.25]),
    ];
    tender.add(mesh(R, G.jitter(G.merge(tp), 0.04, 22), 'tenderMesh'));
    const mediumWheel = R.createMesh(wheelGeo(0.42, 0.1, C.trainBlack, 6));
    for (const sx of [-1, 1]) for (const z of [-1.4, -0.5, 0.5, 1.4]) addWheel(tender, mediumWheel, sx * 0.84, 0.42, z, 0.42);

    // --- carriages ---
    const cars = [];
    const carColors = [C.car1, C.car2];
    for (let i = 0; i < 2; i++) {
      const car = new Node('car' + i).at(0, 0, -17.0 - i * 9.1);
      root.add(car);
      const cp = [
        P(G.box(2.5, 2.2, 8.3, carColors[i]), [0, 1.85, 0]),
        P(G.box(2.66, 0.16, 8.5, C.roof), [0, 3.0, 0]),
        P(G.cylinder(1.3, 1.3, 8.5, 12, C.roof, { arc: PI, startAngle: -PI / 2 }), [0, 3.04, 0], [-PI / 2, 0, 0], [1, 1, 0.22]),
        P(G.box(2.0, 0.3, 8.0, C.trainBlack), [0, 0.65, 0]),
        P(G.box(2.52, 0.12, 8.32, C.gold), [0, 1.25, 0]),
        P(G.box(0.4, 0.2, 0.5, C.trainBlack), [0, 0.65, 4.35]),
      ];
      for (const sx of [-1, 1]) {
        for (let w = 0; w < 6; w++) cp.push(P(G.box(0.04, 0.55, 0.85, C.window), [sx * 1.255, 2.15, -3.0 + w * 1.2]));
      }
      car.add(mesh(R, G.jitter(G.merge(cp), 0.03, 40 + i), 'carMesh'));
      for (const sx of [-1, 1]) for (const z of [-3.2, -2.3, 2.3, 3.2]) addWheel(car, mediumWheel, sx * 0.84, 0.42, z, 0.42);
      cars.push(car);
    }

    return { root, loco, tender, cars, wheels, rods, headlight, stackTop };
  };

  // ---------------------------------------------------------------------------
  // Track: ballast, sleepers, rails along Z.
  // ---------------------------------------------------------------------------
  M.track = function (R, z0, z1) {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const parts = [P(G.prism([[-1.95, 0], [1.95, 0], [1.45, 0.1], [-1.45, 0.1]], len, C.ballast, 'z'), [0, 0, zc])];
    const rnd = U.rng(77);
    for (let z = z0 + 0.4; z < z1; z += 0.7) {
      parts.push(P(G.box(2.5, 0.08, 0.24, C.sleeper), [rnd.range(-0.04, 0.04), 0.14, z], [0, rnd.range(-0.03, 0.03), 0]));
    }
    for (const sx of [-1, 1]) {
      parts.push(P(G.box(0.09, 0.12, len, C.rail), [sx * 0.72, 0.24, zc]));
      parts.push(P(G.box(0.11, 0.035, len, C.railTop), [sx * 0.72, 0.3, zc]));
    }
    const g = G.jitter(G.merge(parts), 0.06, 8);
    const n = mesh(R, g, 'track');
    return n;
  };

  // ---------------------------------------------------------------------------
  // Scenery (terrain, trees, rocks, mountains, clouds, telegraph poles).
  // ---------------------------------------------------------------------------
  function hash2(x, y) {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return U.lerp(U.lerp(a, b, s(xf)), U.lerp(c, d, s(xf)), s(yf));
  }
  M.noise = vnoise;

  // Flat corridor around the track and the set; hills further out.
  M.groundHeight = function (x, z) {
    const corridor = Math.abs(x);
    const set = Math.hypot(x - 3, z - 1);
    const k = U.smoothstep(16, 70, corridor) * U.smoothstep(20, 60, set);
    const n = vnoise(x * 0.012 + 3.1, z * 0.012 - 7.3) * 16 + vnoise(x * 0.04, z * 0.04) * 4;
    return -0.03 + k * (n - 4);
  };

  M.scenery = function (R) {
    const nodes = [];
    const rnd = U.rng(1234);
    const grass = ['#5f9a4a', '#67a050', '#5a9145', '#6fa957', '#57883f'];

    // terrain
    const terrain = G.terrain(900, 100, (x, z) => M.groundHeight(x, z), (x, z, y) => {
      const n = vnoise(x * 0.05 + 11, z * 0.05 - 4);
      const base = G.hex(grass[Math.floor(n * grass.length) % grass.length]);
      const shade = 0.92 + U.clamp(y / 30, -0.1, 0.2);
      return [base[0] * shade, base[1] * shade, base[2] * shade];
    });
    const tn = mesh(R, terrain, 'terrain');
    tn.castShadow = false;
    nodes.push(tn);

    // trees, rocks, bushes
    const tp = [];
    const pineGeo = (s) => G.merge([
      P(G.cylinder(0.18 * s, 0.24 * s, 1.4 * s, 6, '#6b4a2f'), [0, 0.7 * s, 0]),
      P(G.cone(1.5 * s, 2.4 * s, 7, '#2f6b3f'), [0, 2.4 * s, 0]),
      P(G.cone(1.2 * s, 2.0 * s, 7, '#367646'), [0, 3.5 * s, 0]),
      P(G.cone(0.85 * s, 1.6 * s, 7, '#3d8150'), [0, 4.5 * s, 0]),
    ]);
    const roundGeo = (s, seed) => G.merge([
      P(G.cylinder(0.16 * s, 0.22 * s, 1.8 * s, 6, '#6b4a2f'), [0, 0.9 * s, 0]),
      P(G.icosphere(1.35 * s, 1, rnd() > 0.5 ? '#5e9e4f' : '#6aa957', 0.15, seed), [0, 2.6 * s, 0]),
    ]);
    let placed = 0, guard = 0;
    while (placed < 230 && guard++ < 5000) {
      const x = rnd.range(-260, 260), z = rnd.range(-200, 330);
      if (Math.abs(x) < 8) continue;                       // keep the track clear
      if (Math.hypot(x - 2, z - 1) < 22) continue;          // keep the set clear
      if (x < -4 && x > -40 && z < -2 && z > -40) continue; // keep the default camera view open
      const y = M.groundHeight(x, z);
      const s = rnd.range(0.8, 1.5);
      tp.push(P(rnd() < 0.6 ? pineGeo(s) : roundGeo(s, placed), [x, y - 0.05, z], [0, rnd.range(0, PI * 2), 0]));
      placed++;
    }
    const rp = [];   // rocks, bushes and flowers are a mesh of their own, so framing mode can remove them
    for (let i = 0; i < 45; i++) {
      const x = rnd.range(-90, 90), z = rnd.range(-60, 160);
      if (Math.abs(x) < 3.2 || Math.hypot(x - 3, z - 1) < 6) continue;
      const s = rnd.range(0.3, 1.1);
      rp.push(P(G.icosphere(s, 0, '#9a9a96', 0.25, i + 3), [x, M.groundHeight(x, z) + s * 0.3, z], [rnd() * 3, rnd() * 3, 0], [1, 0.65, 1]));
    }
    for (let i = 0; i < 70; i++) {
      const x = rnd.range(-40, 50), z = rnd.range(-25, 80);
      if (Math.abs(x) < 2.6 || Math.hypot(x - 7, z - 1.5) < 2.5 || Math.hypot(x + 3.4, z - 3.6) < 2) continue;
      const s = rnd.range(0.25, 0.6);
      rp.push(P(G.icosphere(s, 1, rnd() > 0.5 ? '#5f9a4c' : '#6eae58', 0.18, i + 100), [x, M.groundHeight(x, z) + s * 0.4, z], null, [1, 0.75, 1]));
    }
    // flowers near the set
    const flowerCols = ['#ffffff', '#ffd23f', '#ff7a9c', '#b48cff'];
    for (let i = 0; i < 90; i++) {
      const x = rnd.range(-14, 18), z = rnd.range(-12, 18);
      if (Math.abs(x) < 2.3 || Math.hypot(x - 7, z - 1.4) < 1.6) continue;
      rp.push(P(G.icosphere(0.06, 0, rnd.pick(flowerCols)), [x, 0.06, z]));
      rp.push(P(G.cylinder(0.008, 0.008, 0.12, 3, '#4c8a3e'), [x, 0.02, z]));
    }
    const trees = mesh(R, G.jitter(G.merge(tp), 0.06, 99), 'trees');
    nodes.push(trees);
    const foliage = mesh(R, G.jitter(G.merge(rp), 0.06, 98), 'foliage');
    nodes.push(foliage);

    // telegraph poles and wires along the track
    const pp = [];
    const poleX = 12.5;
    let prev = null;
    for (let z = -240; z <= 330; z += 32) {
      const y0 = M.groundHeight(poleX, z);
      pp.push(P(G.cylinder(0.09, 0.12, 7, 6, '#6e5640'), [poleX, y0 + 3.5, z]));
      pp.push(P(G.box(1.8, 0.1, 0.12, '#6e5640'), [poleX, y0 + 6.6, z]));
      for (const dx of [-0.7, 0.7]) pp.push(P(G.cylinder(0.05, 0.05, 0.14, 5, '#e7e2d0'), [poleX + dx, y0 + 6.72, z]));
      if (prev) {
        for (const dx of [-0.7, 0.7]) {
          const len = Math.hypot(32, prev.y - y0);
          pp.push(P(G.box(0.025, 0.025, len, '#2b2b2b'), [poleX + dx, (prev.y + y0) / 2 + 6.62, z - 16], [Math.atan2(prev.y - y0, 32), 0, 0]));
        }
      }
      prev = { y: y0 };
    }
    const poles = mesh(R, G.merge(pp), 'poles');
    nodes.push(poles);

    // mountains (no shadows; fog fades them)
    const mp = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * PI * 2 + rnd.range(-0.1, 0.1);
      const d = rnd.range(420, 520), r = rnd.range(70, 140), h = rnd.range(70, 150);
      const x = Math.cos(a) * d, z = Math.sin(a) * d + 60;
      mp.push(P(G.cone(r, h, 7, '#7d8fa6'), [x, h / 2 - 4, z], [0, rnd() * 3, 0]));
      mp.push(P(G.cone(r * 0.32, h * 0.32, 7, '#f1f5fa'), [x, h - h * 0.16 - 4 + 0.5, z], [0, rnd() * 3, 0]));
    }
    const mountains = mesh(R, G.jitter(G.merge(mp), 0.05, 5), 'mountains');
    mountains.castShadow = false;
    nodes.push(mountains);

    // clouds
    const clouds = [];
    for (let i = 0; i < 14; i++) {
      const cp = [];
      const n = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) cp.push(P(G.icosphere(rnd.range(6, 12), 1, '#ffffff', 0.1, i * 10 + k), [k * 8 - n * 4, rnd.range(-2, 3), rnd.range(-4, 4)], null, [1, 0.6, 1]));
      const cl = mesh(R, G.merge(cp), 'cloud', { emissive: [0.18, 0.18, 0.2] });
      cl.castShadow = false;
      cl.at(rnd.range(-450, 450), rnd.range(85, 130), rnd.range(-300, 450));
      clouds.push(cl);
      nodes.push(cl);
    }

    return { nodes, clouds, poles, foliage, trees, mountains };
  };

  // Wooden sign on posts; the board's texture is drawn by the world.
  M.sign = function (R) {
    const g = new Node('signRig');
    const parts = [];
    for (const sx of [-1, 1]) parts.push(P(G.box(0.14, 2.6, 0.14, C.woodDark), [sx * 1.45, 1.3, -0.08]));
    parts.push(P(G.box(3.3, 1.75, 0.1, C.wood), [0, 1.72, -0.06]));
    g.add(mesh(R, G.jitter(G.merge(parts), 0.05, 2), 'signFrame'));
    const face = new Node('signFace').at(0, 1.72, 0.0);
    g.add(face);
    return { rig: g, face };
  };

  // Brake relay box beside the track with a status lamp.
  M.relay = function (R) {
    const g = new Node('relay');
    const parts = [P(G.box(0.5, 0.65, 0.36, '#7c858f'), [0, 0.33, 0]), P(G.box(0.54, 0.06, 0.4, '#5d656e'), [0, 0.67, 0]),
      P(G.box(0.3, 0.04, 0.04, '#ffd23f'), [0, 0.45, 0.19]), P(G.box(0.3, 0.04, 0.04, '#26272b'), [0, 0.39, 0.19]),
      P(G.box(0.6, 0.06, 0.06, '#5d656e'), [-0.5, 0.12, 0])];
    g.add(mesh(R, G.merge(parts), 'relayBox'));
    const lamp = mesh(R, G.icosphere(0.08, 1, '#ff3b3b'), 'relayLamp', { emissive: [0.8, 0.05, 0.05] }).at(0, 0.76, 0);
    g.add(lamp);
    return { rig: g, lamp };
  };

  // Emergency brake panel on a post: red cabinet, a glass cover that can be smashed, a T-handle, and a beacon.
  M.brakePanel = function (R) {
    const g = new Node('brakePanel');
    const parts = [
      P(G.box(0.08, 0.98, 0.08, '#5d656e'), [0, 0.49, -0.02]),
      P(G.box(0.3, 0.05, 0.3, '#4a5058'), [0, 0.025, -0.02]),
      P(G.box(0.46, 0.56, 0.14, '#c0392b'), [0, 1.2, 0]),
      P(G.box(0.38, 0.47, 0.02, '#f2c230'), [0, 1.2, 0.07]),
      P(G.box(0.38, 0.05, 0.022, '#26272b'), [0, 1.33, 0.072]),
      P(G.box(0.38, 0.05, 0.022, '#26272b'), [0, 1.07, 0.072]),
      P(G.box(0.07, 0.07, 0.05, '#3a3d44'), [0, 1.2, 0.095]),
    ];
    g.add(mesh(R, G.jitter(G.merge(parts), 0.03, 4), 'panelBody'));
    // T-handle (pivots at its mount so it can be pulled down)
    const handle = new Node('panelHandle').at(0, 1.2, 0.11);
    handle.add(mesh(R, G.merge([P(G.box(0.03, 0.12, 0.03, '#d8d8d8'), [0, 0.06, 0.0]), P(G.box(0.17, 0.045, 0.045, '#e23b2e'), [0, 0.13, 0.0])]), 'panelHandleMesh'));
    g.add(handle);
    // Label plate (canvas text)
    const label = new Node('panelLabel', R.createMesh(G.plane(0.42, 0.105)), { unlit: true });
    label.at(0, 1.55, 0.075);
    label.castShadow = false;
    g.add(label);
    // Glass cover
    const glass = mesh(R, G.box(0.4, 0.5, 0.012, '#bfe6ff'), 'panelGlass', { opacity: 0.32, emissive: [0.08, 0.1, 0.12] }).at(0, 1.2, 0.135);
    glass.castShadow = false;
    g.add(glass);
    // Beacon on top
    // Beacon on a short stalk above the label plate
    g.add(mesh(R, G.merge([P(G.box(0.03, 0.17, 0.03, '#3a3d44'), [0, 1.565, -0.03]), P(G.box(0.44, 0.12, 0.02, '#3a3d44'), [0, 1.55, 0.062]),
      P(G.cylinder(0.06, 0.06, 0.05, 10, '#3a3d44'), [0, 1.66, -0.03])]), 'beaconBase'));
    const beacon = mesh(R, G.icosphere(0.065, 1, '#ff5a3c'), 'beacon', { emissive: [0.15, 0.02, 0.0] }).at(0, 1.715, -0.03);
    beacon.castShadow = false;
    g.add(beacon);
    return { rig: g, glass, handle, beacon, label };
  };

  // Simple poly-line cable on the ground.
  M.cable = function (R, points) {
    const parts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, Math.hypot(dx, dz));
      parts.push(P(G.box(0.03, 0.03, len + 0.02, '#1f1f22'), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [pitch, yaw, 0]));
    }
    const n = mesh(R, G.merge(parts), 'cable');
    n.castShadow = false;
    return n;
  };

  GB.Models = M;
})(window.GB = window.GB || {});
