'use strict';
(() => {
  // =====================================================================
  //  Constants & maze
  // =====================================================================
  const TILE = 8, COLS = 28, ROWS = 31, MY = 24, W = 224, H = 288;
  const UP = 0, LEFT = 1, DOWN = 2, RIGHT = 3;
  const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
  const BASE = 75.75757625 / 60;           // 100% speed in px per 60Hz frame
  const STEP_MS = 1000 / 60;

  // '#' wall, '.' dot, 'o' energizer, ' ' empty path, '-' ghost door, '_' ghost house
  const MAZE = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    '     #.##### ## #####.#     ',
    '     #.##          ##.#     ',
    '     #.## ###--### ##.#     ',
    '######.## #______# ##.######',
    '      .   #______#   .      ',
    '######.## #______# ##.######',
    '     #.## ######## ##.#     ',
    '     #.##          ##.#     ',
    '     #.## ######## ##.#     ',
    '######.## ######## ##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################',
  ];

  const mod = (a, n) => ((a % n) + n) % n;
  const tileOf = v => Math.floor(v / TILE);

  function tileAt(c, r) {
    if (r === 14 && (c < 0 || c >= COLS)) return ' ';      // tunnel beyond the edges
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return '#';
    return MAZE[r][c];
  }
  function walkable(c, r) {
    const t = tileAt(c, r);
    return t !== '#' && t !== '_' && t !== '-';
  }

  // Tiles reachable by Pac-Man (separates corridors from the void outside the maze)
  const reach = new Uint8Array(COLS * ROWS);
  (() => {
    const stack = [[13, 23]];
    while (stack.length) {
      const [c, r] = stack.pop();
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      const i = r * COLS + c;
      if (reach[i] || !walkable(c, r)) continue;
      reach[i] = 1;
      stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
  })();

  // =====================================================================
  //  Canvas
  // =====================================================================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  let S = 0, mazeBlue = null, mazeWhite = null;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function pix(w, h, fn) {
    const c = makeCanvas(w, h);
    fn(c.getContext('2d'));
    return c;
  }

  // =====================================================================
  //  Maze renderer: the arcade's rounded outline walls, generated with
  //  Euclidean distance transforms at the exact display resolution.
  // =====================================================================
  const INF = 1e20;
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let p = v[k];
      let s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      while (s <= z[k]) {
        k--; p = v[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + f[p];
    }
  }
  function edt(g, w, h) {
    const n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = g[y * w + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) f[x] = g[o + x];
      edt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) g[o + x] = d[x];
    }
  }
  // Marks a line of thickness t at distance `offset` from `set`, with corners rounded by r.
  function contour(set, w, h, offset, r, t, band) {
    const n = w * h, g = new Float64Array(n);
    for (let i = 0; i < n; i++) g[i] = set[i] ? 0 : INF;
    edt(g, w, h);
    const lim = (offset + r) * (offset + r);
    for (let i = 0; i < n; i++) g[i] = g[i] <= lim ? INF : 0;
    edt(g, w, h);
    const lo = r * r, hi = (r + t) * (r + t);
    for (let i = 0; i < n; i++) if (g[i] > lo && g[i] <= hi) band[i] = 1;
  }

  function buildMaze() {
    const T = TILE * S, w = (COLS + 2) * T, h = (ROWS + 2) * T, n = w * h;
    const P = new Uint8Array(n), O = new Uint8Array(n), HS = new Uint8Array(n);
    const fill = (arr, c, r) => {
      const x0 = (c + 1) * T, y0 = (r + 1) * T;
      for (let y = y0; y < y0 + T; y++) arr.fill(1, y * w + x0, y * w + x0 + T);
    };
    for (let r = -1; r <= ROWS; r++) {
      for (let c = -1; c <= COLS; c++) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) {
          if (r === 14) fill(P, c, r);
          else if (r !== 13 && r !== 15) fill(O, c, r);
          continue;
        }
        const ch = MAZE[r][c];
        if (ch === '_') fill(HS, c, r);
        else if (ch !== '#' && ch !== '-') fill(reach[r * COLS + c] ? P : O, c, r);
      }
    }
    const band = new Uint8Array(n);
    contour(P, w, h, 4.5 * S, 3 * S, S, band);   // inner walls (centre of wall tiles)
    contour(O, w, h, 1.5 * S, 2 * S, S, band);   // outer line of the double border
    contour(HS, w, h, 1.5 * S, 0, S, band);      // inner line of the ghost house

    const cw = W * S, chh = 248 * S;
    const c = makeCanvas(cw, chh), g = c.getContext('2d');
    const img = g.createImageData(cw, chh), d = img.data;
    for (let y = 0; y < chh; y++) {
      const row = (y + T) * w + T;
      for (let x = 0; x < cw; x++) {
        if (band[row + x]) {
          const k = (y * cw + x) * 4;
          d[k] = 0x21; d[k + 1] = 0x21; d[k + 2] = 0xff; d[k + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);

    // Ghost house door
    const R = v => Math.round(v * S);
    g.clearRect(R(104), R(98.5), R(120) - R(104), R(104) - R(98.5));
    g.fillStyle = '#2121ff';
    g.fillRect(R(103), R(99.5), R(104) - R(103), R(103.5) - R(99.5));
    g.fillRect(R(120), R(99.5), R(121) - R(120), R(103.5) - R(99.5));
    g.fillStyle = '#ffb8ff';
    g.fillRect(R(104), R(101), R(120) - R(104), R(103) - R(101));
    mazeBlue = c;

    const wc = makeCanvas(cw, chh), wg = wc.getContext('2d');
    wg.drawImage(c, 0, 0);
    wg.globalCompositeOperation = 'source-in';
    wg.fillStyle = '#ffffff';
    wg.fillRect(0, 0, cw, chh);
    mazeWhite = wc;
  }

  // =====================================================================
  //  Sprites (pixel art, drawn at 1x and scaled with nearest-neighbour)
  // =====================================================================
  function drawRows(g, rows, color, ox = 0, oy = 0) {
    g.fillStyle = color;
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') g.fillRect(ox + x, oy + y, 1, 1);
    });
  }

  const GHOST_TOP = [
    '     ####     ',
    '   ########   ',
    '  ##########  ',
    ' ############ ',
    ' ############ ',
    ' ############ ',
    '##############',
    '##############',
    '##############',
    '##############',
    '##############',
    '##############',
  ];
  const GHOST_FEET = [
    ['## ###  ### ##', '#   ##  ##   #'],
    ['#### #### ####', ' ##   ##   ## '],
  ];
  const EYE = [' ## ', '####', '####', '####', ' ## '];
  const EYE_POS = [ // UP, LEFT, DOWN, RIGHT
    { x: [2, 8], y: 1, px: 1, py: 0 },
    { x: [1, 7], y: 3, px: 0, py: 2 },
    { x: [2, 8], y: 4, px: 1, py: 3 },
    { x: [3, 9], y: 3, px: 2, py: 2 },
  ];
  const FRIGHT_FACE = ['', '', '', '', '    ##  ##    ', '    ##  ##    ', '', '', '',
    '  ##  ##  ##  ', ' #  ##  ##  # '];
  const GHOST_COLORS = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852'];

  function drawEyes(g, dir) {
    const e = EYE_POS[dir];
    for (const ex of e.x) {
      drawRows(g, EYE, '#ffffff', ex, e.y);
      g.fillStyle = '#2121ff';
      g.fillRect(ex + e.px, e.y + e.py, 2, 2);
    }
  }
  function ghostBody(g, color, f) {
    drawRows(g, GHOST_TOP, color);
    drawRows(g, GHOST_FEET[f], color, 0, 12);
  }
  const ghostSpr = GHOST_COLORS.map(col => [0, 1].map(f => [0, 1, 2, 3].map(d =>
    pix(14, 14, g => { ghostBody(g, col, f); drawEyes(g, d); }))));
  const eyesSpr = [0, 1, 2, 3].map(d => pix(14, 14, g => drawEyes(g, d)));
  const frightSpr = [['#2121ff', '#ffb8ae'], ['#dedeff', '#ff0000']].map(([body, face]) =>
    [0, 1].map(f => pix(14, 14, g => { ghostBody(g, body, f); drawRows(g, FRIGHT_FACE, face); })));

  // Pac-Man: 13px disc (rows 5,9,11,11,13,13,13,13,13,11,11,9,5 — same as the arcade)
  function pacSprite(angle, half, keepCenter = true) {
    return pix(15, 15, g => {
      g.fillStyle = '#ffff00';
      for (let j = 0; j < 15; j++) {
        for (let i = 0; i < 15; i++) {
          const dx = i - 7, dy = j - 7;
          if (dx * dx + dy * dy > 42.25) continue;
          if (half > 0) {
            if (dx === 0 && dy === 0) { if (!keepCenter) continue; }
            else {
              let a = Math.atan2(dy, dx) - angle;
              a = Math.atan2(Math.sin(a), Math.cos(a));
              if (Math.abs(a) < half) continue;
            }
          }
          g.fillRect(i, j, 1, 1);
        }
      }
    });
  }
  const DIR_ANG = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];
  const pacClosed = pacSprite(0, 0);
  const pacSpr = DIR_ANG.map(a => [pacClosed, pacSprite(a, 0.42), pacSprite(a, 0.82)]);
  const deathSpr = [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 2.95, 3.1]
    .map(h => pacSprite(-Math.PI / 2, h, h < 3))
    .concat([pix(15, 15, g => {
      g.fillStyle = '#ffff00';
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        for (let r = 3; r <= 6; r++) {
          if (r === 4) continue;
          g.fillRect(Math.round(7 + Math.cos(a) * r), Math.round(7 + Math.sin(a) * r), 1, 1);
        }
      }
    })]);

  const energizerSpr = pix(8, 8, g => drawRows(g,
    ['  ####  ', ' ###### ', '########', '########', '########', '########', ' ###### ', '  ####  '], '#ffb8ae'));

  // Intermission sprites (Blinky's torn / patched / missing sheet)
  const SKIN = '#ffb8ae';
  const tornSpr = [0, 1, 2, 3].map(d => pix(14, 14, g => {
    ghostBody(g, '#ff0000', 0); drawEyes(g, d);
    g.clearRect(8, 11, 6, 3);
    g.fillStyle = SKIN; g.fillRect(9, 11, 2, 3);
  }));
  const patchedSpr = [0, 1].map(f => pix(14, 14, g => {
    ghostBody(g, '#ff0000', f); drawEyes(g, LEFT);
    g.fillStyle = SKIN; g.fillRect(9, 8, 3, 3);
    g.fillStyle = '#ff0000'; g.fillRect(10, 9, 1, 1);
  }));
  const nakedSpr = [0, 1].map(f => pix(14, 8, g => {
    drawRows(g, ['   #######  ', '  ######### ', ' ###########', ' ###########'], '#ff0000', 1, 2);
    drawRows(g, f ? ['  #  #  #  # ', ' #  #  #  #  '] : ['   ##    ##  ', '   ##    ##  '], SKIN, 1, 6);
  }));
  const sheetSpr = pix(12, 6, g => drawRows(g, ['   ######   ', ' ########## ', '############', '## ## ## ## '], '#ff0000', 0, 2));

  // Fruits: drawn with vector shapes then alpha-thresholded into crisp pixels
  function fruitCanvas(draw) {
    const c = makeCanvas(14, 14), g = c.getContext('2d');
    draw(g);
    const id = g.getImageData(0, 0, 14, 14), d = id.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
    g.putImageData(id, 0, 0);
    return c;
  }
  const circ = (g, x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const dots = (g, col, pts) => { g.fillStyle = col; for (const [x, y] of pts) g.fillRect(x, y, 1, 1); };
  const poly = (g, col, pts) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath(); g.fill();
  };
  const FRUITS = [
    { pts: 100, spr: fruitCanvas(g => { // cherry
      circ(g, 4, 10, 3.3, '#ff0000'); circ(g, 10, 10.5, 3.3, '#ff0000');
      g.strokeStyle = '#de9751'; g.lineWidth = 1.3; g.beginPath();
      g.moveTo(4.5, 7); g.quadraticCurveTo(7, 3, 12.5, 1.5);
      g.moveTo(10, 7.5); g.quadraticCurveTo(10, 4, 12.5, 1.5); g.stroke();
      dots(g, '#ffffff', [[2, 10], [3, 11], [8, 11], [9, 12]]);
    }) },
    { pts: 300, spr: fruitCanvas(g => { // strawberry
      g.fillStyle = '#ff0000'; g.beginPath();
      g.moveTo(1.5, 5.5); g.quadraticCurveTo(7, 1.5, 12.5, 5.5);
      g.quadraticCurveTo(12.5, 10, 7, 13.5); g.quadraticCurveTo(1.5, 10, 1.5, 5.5); g.fill();
      dots(g, '#ffffff', [[4, 5], [9, 5], [6, 7], [3, 8], [10, 8], [8, 9], [5, 10], [7, 12]]);
      g.fillStyle = '#00ff00'; g.fillRect(4, 2, 6, 2); g.fillRect(6, 1, 2, 1);
      dots(g, '#ffffff', [[6, 0], [7, 0]]);
    }) },
    { pts: 500, spr: fruitCanvas(g => { // orange
      circ(g, 7, 8.2, 5.6, '#ffb847');
      g.fillStyle = '#de9751'; g.fillRect(6, 1, 2, 2);
      g.fillStyle = '#00ff00'; g.fillRect(8, 1, 4, 2); g.fillRect(9, 0, 2, 1);
    }) },
    { pts: 700, spr: fruitCanvas(g => { // apple
      circ(g, 4.5, 8.5, 4.3, '#ff0000'); circ(g, 9.5, 8.5, 4.3, '#ff0000'); circ(g, 7, 10, 4, '#ff0000');
      g.fillStyle = '#de9751'; g.fillRect(7, 1, 1, 4);
      dots(g, '#ffffff', [[3, 6], [3, 7], [3, 8], [4, 5]]);
    }) },
    { pts: 1000, spr: fruitCanvas(g => { // melon
      g.fillStyle = '#00c000'; g.beginPath(); g.ellipse(7, 8.5, 5.6, 5.2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#007000';
      for (let x = 3; x <= 11; x += 3) g.fillRect(x, 4, 1, 9);
      dots(g, '#ffffff', [[4, 6], [7, 8], [10, 6], [5, 11], [9, 10]]);
      g.fillStyle = '#de9751'; g.fillRect(7, 1, 1, 3);
      g.fillStyle = '#00ff00'; g.fillRect(8, 1, 3, 1);
    }) },
    { pts: 2000, spr: fruitCanvas(g => { // galaxian flagship
      poly(g, '#2121ff', [[0.5, 3], [7, 8], [13.5, 3], [13.5, 7.5], [7, 12], [0.5, 7.5]]);
      poly(g, '#ffff00', [[7, 1], [9.5, 6], [8.5, 13.5], [5.5, 13.5], [4.5, 6]]);
      g.fillStyle = '#ff0000'; g.fillRect(6, 4, 2, 3); g.fillRect(3, 6, 1, 2); g.fillRect(10, 6, 1, 2);
    }) },
    { pts: 3000, spr: fruitCanvas(g => { // bell
      g.fillStyle = '#ffff00'; g.beginPath();
      g.moveTo(2, 11); g.quadraticCurveTo(2, 1.5, 7, 1); g.quadraticCurveTo(12, 1.5, 12, 11); g.closePath(); g.fill();
      g.fillRect(1, 10, 12, 2);
      g.fillStyle = '#00ffff'; g.fillRect(5, 12, 4, 2);
      dots(g, '#ffffff', [[4, 4], [4, 5], [4, 6], [4, 7], [5, 3]]);
    }) },
    { pts: 5000, spr: fruitCanvas(g => { // key
      g.fillStyle = '#00ffff'; g.fillRect(4, 1, 6, 4); g.fillRect(5, 0, 4, 6);
      g.fillStyle = '#000000'; g.fillRect(6, 2, 2, 1);
      g.fillStyle = '#ffffff'; g.fillRect(6, 6, 2, 8); g.fillRect(8, 9, 2, 1); g.fillRect(8, 12, 2, 1);
    }) },
  ];

  // Tiny 3x5 digits for point pop-ups
  const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
    '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
  function drawDigits(str, cx, cy, color) {
    ctx.fillStyle = color;
    const x0 = Math.round(cx - (str.length * 4 - 1) / 2), y0 = Math.round(cy - 2);
    for (let k = 0; k < str.length; k++) {
      const bits = DIG[+str[k]];
      for (let p = 0; p < 15; p++) if (bits[p] === '1') ctx.fillRect(x0 + k * 4 + p % 3, y0 + ((p / 3) | 0), 1, 1);
    }
  }

  // =====================================================================
  //  Sound (synthesised with Web Audio)
  // =====================================================================
  const Sound = (() => {
    let ac = null, out = null, muted = false;
    let lo = null, lg = null, loopMode = null, loopT = 0;
    const VOL = 0.35;

    function init() {
      try {
        if (!ac) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ac = new AC();
          out = ac.createGain();
          out.gain.value = muted ? 0 : VOL;
          out.connect(ac.destination);
          lo = ac.createOscillator();
          lg = ac.createGain();
          lg.gain.value = 0;
          lo.type = 'triangle';
          lo.connect(lg); lg.connect(out);
          lo.start();
        }
        if (ac.state === 'suspended') ac.resume();
      } catch (e) { ac = null; }
    }
    let music = [];
    function tone(type, f0, f1, dur, vol, when = 0, track = false) {
      if (!ac) return;
      const t0 = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
      if (track) music.push(o);
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) o.frequency.linearRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.setValueAtTime(vol, t0 + dur * 0.75);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(out);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
    const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
    const freq = n => {
      const m = /^([A-G]#?)(\d)$/.exec(n);
      return 440 * Math.pow(2, (NOTE[m[1]] + 12 * +m[2] - 57) / 12);
    };
    let wk = false;

    return {
      init,
      toggleMute() { muted = !muted; if (out) out.gain.value = muted ? 0 : VOL; },
      intro() {
        if (!ac) return 0;
        const U = 0.135;
        const m1 = [['B4', 1], ['B5', 1], ['F#5', 1], ['D#5', 1], ['B5', .5], ['F#5', 1.5], ['D#5', 2]];
        const m2 = [['C5', 1], ['C6', 1], ['G5', 1], ['E5', 1], ['C6', .5], ['G5', 1.5], ['E5', 2]];
        const m4 = [['D#5', .5], ['E5', .5], ['F5', 1], ['F5', .5], ['F#5', .5], ['G5', 1],
          ['G5', .5], ['G#5', .5], ['A5', 1], ['B5', 2]];
        const bassBar = (lo, hi) => [[lo, 0, 1.5], [hi, 3, 1], [lo, 4, 1.5], [hi, 7, 1]];
        return this.song(U, [...m1, ...m2, ...m1, ...m4], [bassBar('B2', 'B3'), bassBar('C3', 'C4'), bassBar('B2', 'B3'),
          [['F#3', 0, 1.5], ['G#3', 2, 1.5], ['A#3', 4, 1.5], ['B3', 6, 2]]]);
      },
      intermission() {
        if (!ac) return 0;
        const b1 = [['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['C6', 2], ['G5', 2]];
        const b2 = [['A5', 1], ['G5', 1], ['F5', 1], ['E5', 1], ['D5', 2], ['G4', 2]];
        const b3 = [['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['C6', 1], ['B5', 1], ['A5', 1], ['G5', 1]];
        const b4 = [['F5', 1], ['D5', 1], ['B4', 1], ['D5', 1], ['C5', 4]];
        const bb = (lo, hi) => [[lo, 0, 1], [hi, 2, 1], [lo, 4, 1], [hi, 6, 1]];
        const bass = [bb('C3', 'G3'), bb('F3', 'G3'), bb('C3', 'G3'), bb('G2', 'C3')];
        return this.song(0.14, [...b1, ...b2, ...b3, ...b4, ...b1, ...b2, ...b3, ...b4], [...bass, ...bass]);
      },
      // melody: [note, units]; bass: bars of 8 units holding [note, start, units]
      song(U, melody, bass) {
        this.stopMusic();
        let t = 0.05;
        for (const [n, d] of melody) { tone('square', freq(n), freq(n), d * U * 0.92, 0.09, t, true); t += d * U; }
        bass.forEach((bar, i) => {
          for (const [n, s, d] of bar) tone('triangle', freq(n), freq(n), d * U * 0.95, 0.5, 0.05 + (i * 8 + s) * U, true);
        });
        return t;
      },
      stopMusic() {
        for (const o of music) { try { o.stop(); } catch (e) { /* already stopped */ } }
        music = [];
      },
      waka() {
        wk = !wk;
        if (wk) tone('triangle', 560, 200, 0.075, 0.55);
        else tone('triangle', 200, 560, 0.075, 0.55);
      },
      eatGhost() { tone('triangle', 110, 1100, 0.45, 0.5); },
      eatFruit() { tone('triangle', 260, 900, 0.12, 0.5); tone('triangle', 900, 260, 0.18, 0.5, 0.12); },
      extraLife() { for (let i = 0; i < 6; i++) tone('square', 1046, 1046, 0.09, 0.08, i * 0.17); },
      death() {
        let t = 0;
        for (let i = 0; i < 10; i++) { tone('triangle', 900 - i * 55, 380 - i * 25, 0.11, 0.45, t); t += 0.115; }
        tone('triangle', 150, 650, 0.09, 0.45, t + 0.08);
        tone('triangle', 150, 650, 0.09, 0.45, t + 0.25);
      },
      // Continuous background sound: 'siren' | 'fright' | 'eyes' | null
      loop(mode, stage = 0) {
        if (!ac) return;
        const now = ac.currentTime;
        if (mode !== loopMode) {
          loopMode = mode; loopT = 0;
          lg.gain.setTargetAtTime(!mode ? 0 : mode === 'siren' ? 0.13 : mode === 'fright' ? 0.16 : 0.11, now, 0.01);
        }
        if (!mode) return;
        loopT++;
        let f;
        if (mode === 'siren') {
          const P = 26 - stage * 2, ph = (loopT % P) / P, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
          const a = 330 + stage * 50, b = 560 + stage * 90;
          f = a + (b - a) * tri;
        } else if (mode === 'fright') {
          f = 160 + 280 * ((loopT % 10) / 10);
        } else {
          f = 1500 - 900 * ((loopT % 7) / 7);
        }
        lo.frequency.setTargetAtTime(f, now, 0.006);
      },
    };
  })();

  // =====================================================================
  //  Level tables (from the arcade's behaviour)
  // =====================================================================
  const FRIGHT_SECS = [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1];
  const FLASHES = [5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5, 3, 3, 5, 3, 3, 0, 3];
  const ELROY_DOTS = [20, 30, 40, 40, 40, 50, 50, 50, 60, 60, 60, 80, 80, 80, 100, 100, 100, 100, 120];
  const FRUIT_FOR = [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];

  function levelSpec(l) {
    const i = l - 1, at = (a, d) => i < a.length ? a[i] : d;
    let s;
    if (l === 1) s = { pac: .80, fpac: .90, ghost: .75, fghost: .50, tunnel: .40, e1: .80, e2: .85 };
    else if (l <= 4) s = { pac: .90, fpac: .95, ghost: .85, fghost: .55, tunnel: .45, e1: .90, e2: .95 };
    else if (l <= 20) s = { pac: 1, fpac: 1, ghost: .95, fghost: .60, tunnel: .50, e1: 1, e2: 1.05 };
    else s = { pac: .90, fpac: .90, ghost: .95, fghost: .60, tunnel: .50, e1: 1, e2: 1.05 };
    s.fright = at(FRIGHT_SECS, 0) * 60;
    s.flashes = at(FLASHES, 0);
    s.elroy1 = at(ELROY_DOTS, 120);
    s.elroy2 = s.elroy1 >> 1;
    s.modes = l === 1 ? [7, 20, 7, 20, 5, 20, 5, Infinity]
      : l <= 4 ? [7, 20, 7, 20, 5, 1033, 1 / 60, Infinity]
        : [5, 20, 5, 20, 5, 1037, 1 / 60, Infinity];
    s.dotLimits = l === 1 ? [0, 0, 30, 60] : l === 2 ? [0, 0, 0, 50] : [0, 0, 0, 0];
    s.idle = l < 5 ? 240 : 180;
    s.fruit = l <= FRUIT_FOR.length ? FRUIT_FOR[i] : 7;
    return s;
  }

  // =====================================================================
  //  Game state
  // =====================================================================
  let state = 'title', stateTimer = 0, frame = 0, titleT = 0, introFrames = 260;
  let score = 0, lives = 3, level = 1, extraGiven = false, paused = false, cheatMode = false;
  let high = 0;
  try { high = +localStorage.getItem('pacman-high') || 0; } catch (e) { /* storage unavailable */ }
  function saveHigh() { try { localStorage.setItem('pacman-high', String(high)); } catch (e) { /* ignore */ } }

  const dotMap = new Uint8Array(COLS * ROWS);
  let dotsLeft = 0, dotsEaten = 0;
  let spec = levelSpec(1);
  let pac = null, ghosts = [];
  let modeIdx = 0, modeTimer = 0, frightTimer = 0, ghostCombo = 0;
  let fruit = null, fruitPopup = null, ghostPopup = null, eatenGhost = null;
  let useGlobal = false, globalDots = 0, idleTimer = 0;
  const ghostDots = [0, 0, 0, 0];
  let wantDir = -1;

  function initLevel() {
    spec = levelSpec(level);
    dotsLeft = 0; dotsEaten = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = MAZE[r][c], v = ch === '.' ? 1 : ch === 'o' ? 2 : 0;
        dotMap[r * COLS + c] = v;
        if (v) dotsLeft++;
      }
    }
    if (level === 256) {   // the infamous split-screen: right half is garbage and can never be cleared
      for (let r = 0; r < ROWS; r++) for (let c = 14; c < COLS; c++) {
        if (dotMap[r * COLS + c]) { dotMap[r * COLS + c] = 0; dotsLeft--; }
      }
      dotsLeft++;
    }
    ghostDots.fill(0);
    useGlobal = false; globalDots = 0;
    fruit = null; fruitPopup = null;
  }

  function resetActors() {
    pac = { x: 112, y: 188, dir: LEFT, acc: 0, stall: 0, anim: 0 };
    wantDir = -1;
    const mk = (id, x, y, dir, mode, scatter) =>
      ({ id, x, y, dir, mode, scatter, acc: 0, frightened: false, reverse: false });
    ghosts = [
      mk(0, 112, 92, LEFT, 'active', [25, -3]),
      mk(1, 112, 116, DOWN, 'house', [2, -3]),
      mk(2, 96, 116, UP, 'house', [27, 32]),
      mk(3, 128, 116, UP, 'house', [0, 32]),
    ];
    modeIdx = 0; modeTimer = 0; frightTimer = 0; ghostCombo = 0;
    idleTimer = 0; ghostPopup = null; eatenGhost = null;
  }

  function startGame() {
    score = 0; lives = 3; level = 1; extraGiven = false; paused = false;
    cheatMode = false;
    initLevel();
    resetActors();
    const dur = Sound.intro();
    introFrames = Math.round((dur || 4.3) * 60) + 6;
    state = 'intro'; stateTimer = 0;
  }

  function addScore(n) {
    score += n;
    if (!extraGiven && score >= 10000) { extraGiven = true; lives++; Sound.extraLife(); }
    if (score > high) high = score;
  }

  const elroyLevel = () => dotsLeft <= spec.elroy2 ? 2 : dotsLeft <= spec.elroy1 ? 1 : 0;

  // ---------------- Pac-Man ----------------
  function movePac() {
    if (pac.stall > 0) { pac.stall--; return; }
    pac.acc += (frightTimer > 0 ? spec.fpac : spec.pac) * BASE;
    while (pac.acc >= 1) {
      pac.acc -= 1;
      stepPac();
      if (eatAtPac() || state !== 'play') break;
    }
  }

  function stepPac() {
    const tc = tileOf(pac.x), tr = tileOf(pac.y);
    const ox = mod(pac.x, 8) - 4, oy = mod(pac.y, 8) - 4;

    // Steering (instant reversal, or a pre/post-turn "corner cut" within 3px of centre)
    if (wantDir >= 0 && wantDir !== pac.dir) {
      if (wantDir === (pac.dir ^ 2)) pac.dir = wantDir;
      else if (walkable(tc + DX[wantDir], tr + DY[wantDir])) {
        const off = DX[wantDir] !== 0 ? oy : ox;
        if (Math.abs(off) <= 3) pac.dir = wantDir;
      }
    }

    const d = pac.dir;
    const along = DX[d] !== 0 ? ox : oy;
    let moved = false;
    const blocked = (along === 0 && !walkable(tc + DX[d], tr + DY[d])) ||
      !walkable(tileOf(pac.x + DX[d]), tileOf(pac.y + DY[d]));
    if (!blocked) { pac.x += DX[d]; pac.y += DY[d]; moved = true; }
    if (DX[d] !== 0 && oy !== 0) { pac.y -= Math.sign(oy); moved = true; }
    if (DY[d] !== 0 && ox !== 0) { pac.x -= Math.sign(ox); moved = true; }
    if (pac.x < -8) pac.x += 240; else if (pac.x >= 232) pac.x -= 240;
    if (moved) pac.anim++;
  }

  function eatAtPac() {
    const c = tileOf(pac.x), r = tileOf(pac.y);
    if (fruit && Math.abs(pac.y - 140) < 4 && Math.abs(pac.x - 112) < 6) {
      const f = FRUITS[spec.fruit];
      addScore(f.pts);
      fruitPopup = { pts: f.pts, timer: 120 };
      fruit = null;
      Sound.eatFruit();
    }
    if (c < 0 || c >= COLS) return false;
    const i = r * COLS + c, v = dotMap[i];
    if (!v) return false;
    dotMap[i] = 0;
    dotsLeft--; dotsEaten++;
    idleTimer = 0;
    Sound.waka();
    if (v === 1) { addScore(10); pac.stall = 1; }
    else { addScore(50); pac.stall = 3; energize(); }

    // ghost-house release counters
    if (useGlobal) {
      globalDots++;
      if (globalDots === 7 && ghosts[1].mode === 'house') release(ghosts[1]);
      else if (globalDots === 17 && ghosts[2].mode === 'house') release(ghosts[2]);
      else if (globalDots === 32 && ghosts[3].mode === 'house') { release(ghosts[3]); useGlobal = false; }
    } else {
      const g = preferredGhost();
      if (g) ghostDots[g.id]++;
    }

    if (dotsEaten === 70 || dotsEaten === 170) fruit = { timer: 540 + Math.floor(Math.random() * 60) };
    if (dotsLeft === 0) { state = 'levelDone'; stateTimer = 0; fruit = null; }
    return true;
  }

  function energize() {
    ghostCombo = 0;
    for (const g of ghosts) {
      if (g.mode === 'eyes' || g.mode === 'entering') continue;
      if (g.mode === 'active') g.reverse = true;
      if (spec.fright > 0) g.frightened = true;
    }
    if (spec.fright > 0) frightTimer = spec.fright;
  }

  // ---------------- Ghosts ----------------
  const preferredGhost = () => ghosts.find(g => g.id > 0 && g.mode === 'house');
  const release = g => { g.mode = 'leaving'; };

  function updateRelease() {
    if (!useGlobal) {
      const g = preferredGhost();
      if (g && ghostDots[g.id] >= spec.dotLimits[g.id]) release(g);
    }
    if (++idleTimer >= spec.idle) {
      idleTimer = 0;
      const g = preferredGhost();
      if (g) release(g);
    }
  }

  function targetFor(g) {
    if (g.mode === 'eyes') return [13, 11];
    const scatter = (modeIdx & 1) === 0;
    if (scatter && !(g.id === 0 && elroyLevel() > 0)) return g.scatter;
    const pc = tileOf(pac.x), pr = tileOf(pac.y), d = pac.dir;
    switch (g.id) {
      case 0: return [pc, pr];
      case 1: return [pc + DX[d] * 4 - (d === UP ? 4 : 0), pr + DY[d] * 4];
      case 2: {
        const ax = pc + DX[d] * 2 - (d === UP ? 2 : 0), ay = pr + DY[d] * 2, b = ghosts[0];
        return [2 * ax - tileOf(b.x), 2 * ay - tileOf(b.y)];
      }
      default: {
        const dx = tileOf(g.x) - pc, dy = tileOf(g.y) - pr;
        return dx * dx + dy * dy > 64 ? [pc, pr] : g.scatter;
      }
    }
  }

  function chooseDir(g, tc, tr) {
    const cands = [];
    const restrictUp = g.mode === 'active' && !g.frightened && (tr === 11 || tr === 23) && (tc === 12 || tc === 15);
    for (let d = 0; d < 4; d++) {
      if (d === (g.dir ^ 2)) continue;
      if (d === UP && restrictUp) continue;
      if (walkable(tc + DX[d], tr + DY[d])) cands.push(d);
    }
    if (!cands.length) return g.dir ^ 2;
    if (g.frightened && g.mode === 'active') return cands[(Math.random() * cands.length) | 0];
    const [tx, ty] = targetFor(g);
    let best = cands[0], bestD = Infinity;
    for (const d of cands) {
      const ex = tc + DX[d] - tx, ey = tr + DY[d] - ty, dist = ex * ex + ey * ey;
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  function moveGhost(g) {
    let sp;
    if (g.mode === 'eyes' || g.mode === 'entering') sp = 2;
    else if (g.mode === 'house' || g.mode === 'leaving') sp = 0.5;
    else {
      const tc = tileOf(g.x), tr = tileOf(g.y);
      if (tr === 14 && (tc <= 5 || tc >= 22)) sp = spec.tunnel * BASE;
      else if (g.frightened) sp = spec.fghost * BASE;
      else if (g.id === 0 && elroyLevel()) sp = (elroyLevel() === 2 ? spec.e2 : spec.e1) * BASE;
      else sp = spec.ghost * BASE;
    }
    g.acc += sp;
    while (g.acc >= 1) { g.acc -= 1; stepGhost(g); }
  }

  function stepGhost(g) {
    switch (g.mode) {
      case 'house':
        if (g.y <= 112) g.dir = DOWN; else if (g.y >= 120) g.dir = UP;
        g.y += DY[g.dir];
        return;
      case 'leaving':
        if (g.x !== 112) { g.dir = g.x < 112 ? RIGHT : LEFT; g.x += DX[g.dir]; }
        else if (g.y > 92) { g.dir = UP; g.y--; }
        else { g.mode = 'active'; g.dir = LEFT; g.reverse = false; }
        return;
      case 'entering':
        if (g.x !== 112) { g.dir = g.x < 112 ? RIGHT : LEFT; g.x += DX[g.dir]; }
        else if (g.y < 116) { g.dir = DOWN; g.y++; }
        else g.mode = 'leaving';
        return;
    }
    if (g.reverse) { g.reverse = false; g.dir ^= 2; }
    if (mod(g.x, 8) === 4 && mod(g.y, 8) === 4) {
      const tc = tileOf(g.x), tr = tileOf(g.y);
      if (g.mode === 'eyes' && tr === 11 && (tc === 13 || tc === 14)) { g.mode = 'entering'; return; }
      g.dir = chooseDir(g, tc, tr);
    }
    g.x += DX[g.dir]; g.y += DY[g.dir];
    if (g.x < -8) g.x += 240; else if (g.x >= 232) g.x -= 240;
  }

  function checkCollisions() {
    for (const g of ghosts) {
      if (g.mode !== 'active') continue;
      if (Math.abs(g.x - pac.x) < 6 && Math.abs(g.y - pac.y) < 6) {
        if (g.frightened) {
          ghostCombo++;
          const pts = 200 << (ghostCombo - 1);
          addScore(pts);
          g.mode = 'eyes'; g.frightened = false;
          eatenGhost = g;
          ghostPopup = { x: g.x, y: g.y, pts };
          state = 'ghostEaten'; stateTimer = 0;
          Sound.eatGhost();
        } else if (!cheatMode) {
          state = 'dying'; stateTimer = 0;
        }
        return;
      }
    }
  }

  function updatePlay() {
    if (frightTimer > 0) {
      if (--frightTimer === 0) for (const g of ghosts) g.frightened = false;
    } else {
      const t = spec.modes[modeIdx];
      if (t !== Infinity && ++modeTimer >= t * 60) {
        modeIdx++; modeTimer = 0;
        for (const g of ghosts) if (g.mode === 'active') g.reverse = true;
      }
    }
    updateRelease();
    if (fruit && --fruit.timer <= 0) fruit = null;

    movePac();
    if (state !== 'play') return;
    for (const g of ghosts) moveGhost(g);
    checkCollisions();
  }

  // ---------------- Attract-mode chase on the title screen ----------------
  let att;
  function resetAttract() {
    att = { phase: 0, px: 250, gx: [274, 290, 306, 322], eaten: [false, false, false, false], combo: 0, pop: null, popT: 0 };
  }
  resetAttract();
  function updateAttract() {
    if (att.popT > 0) { if (--att.popT === 0) att.pop = null; return; }
    if (att.phase === 0) {
      att.px -= 1.25;
      for (let i = 0; i < 4; i++) att.gx[i] -= 1.3;
      if (att.px <= 28) att.phase = 1;
    } else {
      att.px += 1.25;
      for (let i = 0; i < 4; i++) {
        if (att.eaten[i]) continue;
        att.gx[i] += 0.65;
        if (Math.abs(att.gx[i] - att.px) < 4) {
          att.eaten[i] = true; att.combo++;
          att.pop = { x: att.gx[i], pts: 200 << (att.combo - 1) };
          att.popT = 50;
        }
      }
      if (att.px > 260) resetAttract();
    }
  }

  // ---------------- Levels & intermissions ----------------
  // Act I "The Chase" after level 2, Act II "The Nail" after 5, Act III "Patched" after 9, 13 and 17
  const CUTSCENE_AFTER = { 2: 1, 5: 2, 9: 3, 13: 3, 17: 3 };
  const SNAG_T = Math.round((276 - 122) / 1.3);
  let cutAct = 0;

  function nextLevel() {
    level++;
    initLevel(); resetActors();
    state = 'ready'; stateTimer = 0;
  }
  function jumpLevel(delta) {
    const next = Math.max(1, Math.min(256, level + delta));
    if (next === level) return;
    level = next;
    Sound.stopMusic();
    initLevel(); resetActors();
    state = 'ready'; stateTimer = 0; paused = false;
    needsRender = true;
  }
  function startCutscene(act) {
    cutAct = act;
    state = 'cutscene'; stateTimer = 0;
    Sound.intermission();
  }
  function endCutscene() {
    Sound.stopMusic();
    nextLevel();
  }
  const cutsceneEnd = () => cutAct === 1 ? 590 : cutAct === 2 ? SNAG_T + 330 : 560;

  // ---------------- Main update ----------------
  function update() {
    frame++;
    switch (state) {
      case 'title':
        titleT++;
        if (titleT > 400) updateAttract();
        break;
      case 'intro':
        if (++stateTimer >= introFrames) { state = 'play'; stateTimer = 0; }
        break;
      case 'ready':
        if (++stateTimer >= 120) { state = 'play'; stateTimer = 0; }
        break;
      case 'play':
        updatePlay();
        break;
      case 'ghostEaten':
        for (const g of ghosts) if (g !== eatenGhost && (g.mode === 'eyes' || g.mode === 'entering')) moveGhost(g);
        if (++stateTimer >= 60) { state = 'play'; ghostPopup = null; eatenGhost = null; }
        break;
      case 'dying':
        stateTimer++;
        if (stateTimer === 60) Sound.death();
        if (stateTimer >= 60 + deathSpr.length * 8 + 40) {
          lives--;
          if (lives <= 0) { state = 'gameOver'; stateTimer = 0; saveHigh(); }
          else { resetActors(); useGlobal = true; globalDots = 0; state = 'ready'; stateTimer = 0; }
        }
        break;
      case 'levelDone':
        if (++stateTimer >= 60 + 8 * 12 + 20) {
          const act = CUTSCENE_AFTER[level];
          if (act) startCutscene(act);
          else nextLevel();
        }
        break;
      case 'cutscene':
        if (++stateTimer >= cutsceneEnd()) endCutscene();
        break;
      case 'gameOver':
        if (++stateTimer >= 210) { state = 'title'; titleT = 0; resetAttract(); }
        break;
    }
    if (fruitPopup && --fruitPopup.timer <= 0) fruitPopup = null;

    // background loop sound
    let loop = null;
    if (state === 'play' || state === 'ghostEaten') {
      if (ghosts.some(g => g.mode === 'eyes' || g.mode === 'entering')) loop = 'eyes';
      else if (frightTimer > 0) loop = 'fright';
      else loop = 'siren';
    }
    Sound.loop(loop, dotsEaten < 120 ? 0 : dotsEaten < 180 ? 1 : dotsEaten < 220 ? 2 : 3);
  }

  // =====================================================================
  //  Rendering
  // =====================================================================
  const FONT = '8px "Press Start 2P", "Courier New", monospace';
  function text(str, col, row, color) {
    ctx.fillStyle = color;
    ctx.fillText(str, col * 8, row * 8);
  }
  const sprite = (spr, x, y) => ctx.drawImage(spr, Math.round(x) - 7, Math.round(y) - 7);

  function drawHeader(blink) {
    if (!blink || ((frame >> 4) & 1) === 0) text('1UP', 3, 0, '#ffffff');
    text('HIGH SCORE', 9, 0, '#ffffff');
    const s = score ? String(score) : '00';
    text(s, 7 - s.length, 1, '#ffffff');
    if (high) { const h = String(high); text(h, 17 - h.length, 1, '#ffffff'); }
  }

  function drawFooter(reserve) {
    for (let i = 0; i < Math.min(reserve, 5); i++) ctx.drawImage(pacSpr[LEFT][2], 16 + i * 16, 273);
    const first = Math.max(1, level - 6);
    for (let l = first; l <= level; l++) ctx.drawImage(FRUITS[levelSpec(l).fruit].spr, 194 - (l - first) * 16, 273);
  }

  function drawGhost(g) {
    let spr;
    const f = (frame >> 3) & 1;
    if (g.mode === 'eyes' || g.mode === 'entering') spr = eyesSpr[g.dir];
    else if (g.frightened) {
      const white = frightTimer <= spec.flashes * 28 && ((frightTimer / 14) | 0) % 2 === 0;
      spr = frightSpr[white ? 1 : 0][f];
    } else spr = ghostSpr[g.id][f][g.dir];
    sprite(spr, g.x, g.y + MY);
  }

  function drawPac() {
    let spr;
    if (state === 'dying' && stateTimer >= 60) {
      const k = ((stateTimer - 60) / 8) | 0;
      if (k >= deathSpr.length) return;
      spr = deathSpr[k];
    } else if (state === 'intro' || state === 'ready' || state === 'levelDone') {
      spr = pacClosed;
    } else {
      const fr = [0, 1, 2, 1][(pac.anim >> 1) & 3];
      spr = pacSpr[pac.dir][fr];
    }
    sprite(spr, pac.x, pac.y + MY);
  }

  function drawDots() {
    ctx.fillStyle = '#ffb8ae';
    const blinkOff = state === 'play' && ((frame / 10) | 0) % 2 === 1;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = dotMap[r * COLS + c];
        if (v === 1) ctx.fillRect(c * 8 + 3, r * 8 + 3 + MY, 2, 2);
        else if (v === 2 && !blinkOff) ctx.drawImage(energizerSpr, c * 8, r * 8 + MY);
      }
    }
  }

  function renderGame() {
    drawHeader(state === 'play' || state === 'ghostEaten');
    if (cheatMode) text('CHEAT MODE', 9, 2, '#00ff00');

    const flashing = state === 'levelDone' && stateTimer >= 60 && (((stateTimer - 60) / 12) | 0) % 2 === 1;
    ctx.drawImage(flashing ? mazeWhite : mazeBlue, 0, MY, W, 248);
    if (state !== 'levelDone') drawDots();
    if (level === 256) drawKillScreen();

    const introHidden = state === 'intro' && stateTimer < introFrames / 2;
    const showGhosts = !introHidden && state !== 'gameOver' &&
      !(state === 'dying' && stateTimer >= 60) && !(state === 'levelDone' && stateTimer >= 60);
    const showPac = !introHidden && state !== 'gameOver' && state !== 'ghostEaten';

    if (fruit && (state === 'play' || state === 'ghostEaten' || (state === 'dying' && stateTimer < 60))) {
      ctx.drawImage(FRUITS[spec.fruit].spr, 105, 133 + MY);
    }
    if (fruitPopup) drawDigits(String(fruitPopup.pts), 112, 140 + MY, '#ffb8ff');

    if (showGhosts) for (const g of ghosts) if (g !== eatenGhost) drawGhost(g);
    if (showPac) drawPac();
    if (ghostPopup) drawDigits(String(ghostPopup.pts), ghostPopup.x, ghostPopup.y + MY, '#00ffff');

    if (state === 'intro' && introHidden) text('PLAYER ONE', 9, 14, '#00ffff');
    if (state === 'intro' || state === 'ready') text('READY!', 11, 20, '#ffff00');
    if (state === 'gameOver') text('GAME  OVER', 9, 20, '#ff0000');
    if (paused) {
      ctx.fillStyle = '#000';
      ctx.fillRect(10 * 8, 20 * 8, 8 * 8, 8);
      text('PAUSED', 11, 20, '#ffff00');
    }

    drawFooter(introHidden ? lives : lives - 1);
  }

  function renderTitle() {
    drawHeader(false);
    const t = titleT;
    if (t >= 20) text('CHARACTER / NICKNAME', 7, 5, '#ffffff');
    const names = [['SHADOW', 'BLINKY'], ['SPEEDY', 'PINKY'], ['BASHFUL', 'INKY'], ['POKEY', 'CLYDE']];
    for (let i = 0; i < 4; i++) {
      const b = 50 + i * 80, row = 7 + i * 3;
      if (t >= b) sprite(ghostSpr[i][0][RIGHT], 4 * 8 + 4, row * 8 + 4);
      if (t >= b + 30) text('-' + names[i][0], 7, row, GHOST_COLORS[i]);
      if (t >= b + 55) text('"' + names[i][1] + '"', 18, row, GHOST_COLORS[i]);
    }
    if (t >= 390) {
      ctx.fillStyle = '#ffb8ae';
      ctx.fillRect(10 * 8 + 3, 25 * 8 + 3, 2, 2);
      text('10', 12, 25, '#ffffff'); text('PTS', 15, 25, '#ffffff');
      ctx.drawImage(energizerSpr, 10 * 8, 27 * 8);
      text('50', 12, 27, '#ffffff'); text('PTS', 15, 27, '#ffffff');
    }
    if (t >= 400) {
      const y = 20 * 8 + 4;
      if (att.phase === 0 && ((frame / 10) | 0) % 2 === 0) ctx.drawImage(energizerSpr, 20, 20 * 8);
      const fr = [0, 1, 2, 1][((att.popT ? 0 : frame) >> 2) & 3];
      if (!att.popT) sprite(fr === 0 ? pacClosed : pacSpr[att.phase === 0 ? LEFT : RIGHT][fr], att.px, y);
      for (let i = 0; i < 4; i++) {
        if (att.eaten[i]) continue;
        const f = (frame >> 3) & 1;
        sprite(att.phase === 0 ? ghostSpr[i][f][LEFT] : frightSpr[0][f], att.gx[i], y);
      }
      if (att.pop) drawDigits(String(att.pop.pts), att.pop.x, y, '#00ffff');
      if (((frame >> 5) & 1) === 0) text('PRESS ENTER TO START', 4, 31, '#ffb852');
      text('ARROWS/WASD P:PAUSE M:MUTE', 0, 33, '#ffb8ae');
      text('R:RULES  C:CHEAT  [ ]:LEVEL', 0, 34, '#ffb8ae');
    }
  }

  function renderRules() {
    drawHeader(false);
    text('GAME RULES', 9, 5, '#ffff00');
    text('EAT DOTS TO CLEAR THE', 3, 8, '#ffffff');
    text('MAZE AND ADVANCE.', 5, 9, '#ffffff');
    text('DOTS: 10 PTS. POWER: 50.', 1, 11, '#ffffff');
    text('POWER PELLETS FRIGHTEN.', 2, 12, '#ffffff');
    text('EAT BLUE GHOSTS:', 6, 14, '#00ffff');
    text('200 / 400 / 800 / 1600', 2, 15, '#ffffff');
    text('AVOID GHOSTS OR LOSE LIFE.', 1, 17, '#ffffff');
    text('START WITH 3 LIVES.', 5, 18, '#ffffff');
    text('FRUIT BONUS. EXTRA LIFE', 3, 20, '#ffb8ff');
    text('AT 10,000 POINTS.', 5, 21, '#ffb8ff');
    text('C: TOGGLE INVINCIBILITY.', 2, 23, '#00ff00');
    text('GHOSTS CANNOT HURT YOU.', 2, 24, '#ffffff');
    text('[ / ]: PREV/NEXT LEVEL.', 2, 26, '#ffb852');
    text('KEEP SCORE/LIVES; NEW BOARD.', 0, 27, '#ffffff');
    text('R: BACK  ENTER: START', 3, 30, '#ffb852');
  }

  function renderCutscene() {
    drawHeader(false);
    const t = stateTimer, y = 148, f = (frame >> 3) & 1;
    const mouth = [0, 1, 2, 1][(t >> 2) & 3];
    const pacFrame = dir => mouth === 0 ? pacClosed : pacSpr[dir][mouth];
    const chase = (ghost) => {       // Pac-Man runs left across the screen with a ghost behind him
      const px = 240 - 1.25 * t;
      if (px > -10) sprite(pacFrame(LEFT), px, y);
      sprite(ghost, 272 - 1.3 * t, y);
    };

    if (cutAct === 1) {
      if (t < 260) chase(ghostSpr[0][f][LEFT]);
      else {
        const u = t - 260, gx = -10 + u * 0.9, bx = -54 + u * 0.9;
        sprite(frightSpr[0][f], gx, y);
        const p = pacFrame(RIGHT);
        ctx.drawImage(p, Math.round(bx) - 14, y - 22, 30, 30);
      }
    } else if (cutAct === 2) {
      ctx.fillStyle = SKIN;
      ctx.fillRect(127, y + 2, 3, 1);
      ctx.fillRect(128, y + 2, 1, 5);
      const px = 240 - 1.25 * t;
      if (px > -10) sprite(pacFrame(LEFT), px, y);
      if (t < SNAG_T) sprite(ghostSpr[0][f][LEFT], 276 - 1.3 * t, y);
      else if (t < SNAG_T + 90) {
        const bx = Math.round(122 - 10 * (t - SNAG_T) / 90);
        sprite(ghostSpr[0][f][LEFT], bx, y);
        poly(ctx, '#ff0000', [[129, y + 4], [bx + 6, y + 2], [bx + 6, y + 7]]);
      } else {
        poly(ctx, '#ff0000', [[129, y + 3], [124, y + 5], [129, y + 7]]);
        const dir = t < SNAG_T + 150 ? LEFT : t < SNAG_T + 210 ? RIGHT : DOWN;
        sprite(tornSpr[dir], 112, y);
      }
    } else {
      if (t < 260) chase(patchedSpr[f]);
      else {
        const nx = Math.round(-20 + (t - 260));
        ctx.drawImage(sheetSpr, nx - 22, y - 2);
        ctx.drawImage(nakedSpr[f], nx - 7, y - 3);
      }
    }
    drawFooter(lives - 1);
  }

  let killScreen = null;
  function drawKillScreen() {
    if (!killScreen) {
      killScreen = pix(112, 248, g => {
        let seed = 256;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const cols = ['#ffffff', '#ffff00', '#ff0000', '#00ffff', '#ffb8ff', '#2121ff', '#ffb852', '#ffb8ae'];
        for (let r = 0; r < 31; r++) for (let c = 0; c < 14; c++) {
          if (rnd() < 0.35) continue;
          g.fillStyle = cols[(rnd() * cols.length) | 0];
          for (let p = 0; p < 64; p++) if (rnd() < 0.42) g.fillRect(c * 8 + (p & 7), r * 8 + (p >> 3), 1, 1);
        }
      });
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(112, MY, 112, 248);
    ctx.drawImage(killScreen, 112, MY);
  }

  let needsRender = true;
  function render() {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (state === 'title') renderTitle();
    else if (state === 'rules') renderRules();
    else if (state === 'cutscene') renderCutscene();
    else renderGame();
  }

  // =====================================================================
  //  Layout: integer scaling for perfectly crisp pixels
  // =====================================================================
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const s = Math.max(1, Math.floor(Math.min(window.innerWidth * dpr / W, window.innerHeight * dpr / H)));
    if (s !== S || !mazeBlue) {
      S = s;
      canvas.width = W * S;
      canvas.height = H * S;
      buildMaze();
    }
    canvas.style.width = (W * S / dpr) + 'px';
    canvas.style.height = (H * S / dpr) + 'px';
    needsRender = true;
  }
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 80); });
  resize();

  // =====================================================================
  //  Input
  // =====================================================================
  const KEYS = {
    ArrowUp: UP, KeyW: UP, ArrowLeft: LEFT, KeyA: LEFT,
    ArrowDown: DOWN, KeyS: DOWN, ArrowRight: RIGHT, KeyD: RIGHT,
  };
  const inGame = () => state !== 'title' && state !== 'rules' && state !== 'gameOver';

  window.addEventListener('keydown', e => {
    Sound.init();
    if (e.code in KEYS) {
      wantDir = KEYS[e.code];
      e.preventDefault();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      if (state === 'title') startGame();
      else if (state === 'rules') startGame();
      else if (state === 'cutscene') endCutscene();
    } else if (e.code === 'KeyR') {
      if (state === 'title') { state = 'rules'; needsRender = true; }
      else if (state === 'rules') { state = 'title'; titleT = 400; needsRender = true; }
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'rules' && e.code === 'Escape') {
        state = 'title'; titleT = 400; needsRender = true;
      } else if (inGame()) { paused = !paused; needsRender = true; }
    } else if (e.code === 'KeyM') {
      Sound.toggleMute();
    } else if (e.code === 'KeyC' && inGame()) {
      cheatMode = !cheatMode;
      needsRender = true;
    } else if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && inGame()) {
      e.preventDefault();
      jumpLevel(e.code === 'BracketRight' ? 1 : -1);
    }
  });

  // Touch: swipe to steer, tap to start
  let touchStart = null;
  window.addEventListener('touchstart', e => {
    Sound.init();
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
    if (state === 'title') startGame();
    else if (state === 'cutscene') endCutscene();
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchmove', e => {
    if (!touchStart) return;
    const t = e.changedTouches[0], dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) {
      wantDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP);
      touchStart = { x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('mousedown', () => { Sound.init(); if (state === 'title') startGame(); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && inGame()) paused = true;
  });
  if (document.fonts && document.fonts.load) document.fonts.load(FONT).then(() => { needsRender = true; }, () => {});

  // =====================================================================
  //  Main loop: fixed 60Hz simulation, rendering only when something changed
  // =====================================================================
  let last = performance.now(), acc = 0;
  function tick(now) {
    const dt = now - last;
    last = now;
    let updated = false;
    if (dt > 14 && dt < 19.5) {          // ~60Hz display: exactly one step per frame, no jitter
      acc = 0;
      if (!paused) { update(); updated = true; }
    } else {                              // high-refresh or irregular: accumulate
      acc += Math.min(dt, 250);
      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        if (!paused) { update(); updated = true; }
      }
    }
    if (paused) Sound.loop(null);
    if (updated || needsRender) { render(); needsRender = false; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
