(function () {
  const W = 1024, H = 1536, TILE = 512, VER = '44';      // bump VER when tiles/maps/data change (defeats browser cache)
  const PX_PER_CM = 150 / 9.8;               // jacket pixels per cm of cloth on these mannequin photos
  const ANG = new Float32Array(16); ANG[2] = 0.30; ANG[3] = -0.30;   // lapel grain (part id in warp.blue)
  const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = Math.pow(i / 255, 2.2);
  const OUTN = 4096, GAM = new Uint8Array(OUTN + 1); for (let i = 0; i <= OUTN; i++) GAM[i] = Math.round(255 * Math.pow(i / OUTN, 1 / 2.2));
  // cloth: highlights roll off softly (like a camera) instead of clipping to flat white on light cloth; input 0..2
  const TONE = new Uint8Array(2 * OUTN + 1);
  for (let i = 0; i <= 2 * OUTN; i++) { let x = i / OUTN; if (x > 0.7) x = 0.7 + 0.3 * (1 - Math.exp(-(x - 0.7) / 0.3)); TONE[i] = Math.round(255 * Math.pow(x, 1 / 2.2)); }
  // the photos' shading was taken on dark navy cloth; on light cloth the same contrast reads as blotches and glare,
  // so it is softened as the cloth gets lighter (dark cloth: unchanged)
  const shLuts = {};
  function shadeLut(tile) {
    const L = tile.L || 0, g = 1 - 0.38 * Math.max(0, Math.min(1, (L - 0.08) / 0.4)), key = g.toFixed(3);
    if (shLuts[key]) return shLuts[key];
    const t = new Float32Array(1025); for (let j = 0; j <= 1024; j++) t[j] = Math.pow(j / 256, g);
    return (shLuts[key] = t);
  }
  const COLOURS = { navy: '#1f2a44', black: '#111', charcoal: '#3b3d42', grey: '#7d7f84', 'light grey': '#c4c5c8', blue: '#3c5a8a',
    brown: '#5a3f2c', tan: '#b49a7e', burgundy: '#5c1f2a', red: '#c4545e', green: '#4f5e52', cream: '#ece6da' };
  const SEASONS = { '26FW': 'Autumn / Winter', '26SS': 'Spring / Summer' };
  const PATTERNS = { solid: 'Plain', textured: 'Textured', herringbone: 'Herringbone', stripe: 'Stripe', check: 'Check', corduroy: 'Corduroy' };
  const CLOTH = { wool: '100% wool', cashmere: 'Wool and cashmere', silk: 'Wool and silk', blend: 'Wool blend', other: 'Other blends', unknown: 'Composition to follow' };

  const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
  const cv = $('#cv'), ctx = cv.getContext('2d', { willReadFrequently: true }), busy = $('#busy');
  const state = { view: 'front', fabric: null, tile: null, custom: false, zoom: null,
    opts: {}, button: null, sleeveSame: true, sleeveButton: null, thread: { button: null, lapel: null, front: null, sleeve: [] },
    lining: null, sleeveLinSame: true, sleeveLining: null, holeSel: 0, undercollar: null, elbow: '', elbowFabric: null, hid: {},
    monos: [], monoSel: 0, fabricPicked: false, reached: 0, mode: '', location: '', build: '',
    remark: '', photos: [null, null, null], body: { front: null, side: null, back: null }, prefit: 'No', urgent: 'normal' };
  const views = {}, tiles = {};
  let FABRICS = [], STAFF = null, OPTS = [], BUTTONS = [], SLEEVES = [], LININGS = [], THREADS = [], CONTRAST = [], MONO = null, SUGG = null, EXTRAS = { opts: {}, lining: {} };

  const store = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
                  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const loadImg = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  function pixels(img) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, img.width, img.height).data;
  }
  // Tile in linear light, area-averaged down to its real size on the jacket (n px). Sampling the 512 px tile
  // directly at ~7x minification aliases fine weaves into moire waves.
  function linearTile(px, n) {
    const src = new Float32Array(TILE * TILE * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { src[j] = LIN[px[i]]; src[j + 1] = LIN[px[i + 1]]; src[j + 2] = LIN[px[i + 2]]; }
    n = Math.max(8, Math.min(TILE, Math.round(n)));
    const t = new Float32Array(n * n * 3), r = TILE / n;
    for (let y = 0; y < n; y++) {
      const y0 = y * r, y1 = Math.min(TILE, y0 + r);    // min: y0 + r can round past the tile's last row (NaN -> black lines)
      for (let x = 0; x < n; x++) {
        const x0 = x * r, x1 = Math.min(TILE, x0 + r); let R = 0, G = 0, Bc = 0, wsum = 0;
        for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
          const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
          for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
            const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx)), k = (sy * TILE + sx) * 3;
            R += src[k] * w; G += src[k + 1] * w; Bc += src[k + 2] * w; wsum += w;
          }
        }
        const o = (y * n + x) * 3; t[o] = R / wsum; t[o + 1] = G / wsum; t[o + 2] = Bc / wsum;
      }
    }
    let L = 0; for (let o = 0; o < t.length; o += 3) L += 0.2126 * t[o] + 0.7152 * t[o + 1] + 0.0722 * t[o + 2];
    return { T: t, n, L: L / (n * n) };
  }

  // ---------- which photo to show ----------
  // what the customer picked, reduced to the photos we have
  const DB_FRONTS = ['8', '9', '10', '11', '12', '13'];
  function styleOf() {
    const lap = OPTS.length ? (choiceOf('lapel') || {}).label || '' : 'Notch';
    const lapel = /removable/i.test(lap) ? (/peak/i.test(lap) ? 'peak' : 'notch') : /shawl/i.test(lap) ? 'shawl' : /peak/i.test(lap) ? 'peak' : 'notch';   // a removable shawl sits on a notch / peak lapel
    const front = state.opts.front || '2';
    return { lapel, db: DB_FRONTS.includes(front), front };
  }
  // factory pocket / vent codes grouped by the look we have a photo for
  const POCKET = { slant: 'G H I 9 10 23 25Y', hacking: 'O Q R 13 14 24', jet: 'D E F K L N P T U V Y', slantjet: 'J S',
    patch: '15 233 235 238 BE HMD M S1', jettab: '2', patchflap: '18 234 237 DJ', patchtab: '5 6 7', pleat: '19 20 236' };
  const pocketLook = c => Object.keys(POCKET).find(k => POCKET[k].split(' ').includes(c)) || 'flap';
  const ticketLook = c => c === 'D' ? '' : 'F G H I J'.split(' ').includes(c) ? 'flap' : '25K 25Q EG YK'.split(' ').includes(c) ? 'card' : 'jet';
  const POCKET_FALLBACK = { jettab: 'jet',  patchflap: 'patch', patchtab: 'patch', pleat: 'patch', slantjet: 'slant', hacking: 'slant' };   // views without that photo
  const CHEST = { round: 'HXD G 233 BE C1', patchflap: '234', pleat: '235', barchetta: '237 238 I', none: 'H', curved: 'D E F J', jetted: 'BC', trapezoid: 'R' };
  const chestLook = c => Object.keys(CHEST).find(k => CHEST[k].split(' ').includes(c)) || 'welt';
  // lapel width, shoulder and pick stitching: photos that show a specific one carry it as a 6th entry {w, sh, pick}
  function extrasWanted() {
    const cm = parseFloat(((choiceOf('lapelWidth') || {}).label || '')) || 7;
    const sh = { A: 'natural', C: 'rollino', D: 'neapolitan', E: 'neapolitan' }[state.opts.shoulder || 'B'] || '';
    const ch = chestLook(state.opts.chestPocket || 'B');
    return { w: cm <= 6.5 ? 'narrow' : cm >= 9 ? 'wide' : '', sh, pick: (state.opts.pick || 'A') !== 'A' ? 'pick' : '', chest: ch === 'welt' ? '' : ch };
  }
  // photos by angle: [lapel, front, lower pocket look, ticket look] -> map folder
  const LAPEL_PHOTOS = { BA: 'notch', BB: 'peak', BC: 'notch', BD: 'peak', 12: 'peak', 13: 'notch', 14: 'peak', 15: 'peak', 17: 'peak',
    21: 'peak', 216: 'shawl', 22: 'peak', 23: 'peak', 24: 'shawl', 25: 'shawl', 27: 'shawl', 28: 'shawl', 29: 'shawl', 30: 'peak', 31: 'notch',
    AD: 'peak', AE: 'notch', BG: 'notch', BI: 'notch', BJ: 'peak', BM: 'peak', BN: 'notch', DE: 'peak', 'HA279-118': 'notch', L: 'notch' };
  const PHOTOS = {
    front: [['notch', '2', 'slant', '', 'front_notch_sb_slant'], ['notch', '2', 'patch', '', 'front_notch_sb_patch'],
      ['notch', '2', 'jet', '', 'front_notch_sb_jet'], ['notch', '2', 'flap', 'jet', 'front_notch_sb_tjet'], ['notch', '2', 'flap', 'flap', 'front_notch_sb_tflap'],
      ['notch', '3', 'flap', '', 'front_notch_sb3'], ['notch', '3', 'patch', '', 'front_notch_sb3_patch'], ['notch', '3', 'jet', 'jet', 'front_notch_sb3_jet_tjet'],
      ['notch', '5', 'flap', '', 'front_notch_sb3r2'], ['notch', '1', 'flap', '', 'front_notch_sb1'],
      ['shawl', '1', 'flap', '', 'front_shawl_sb1'], ['shawl', '3', 'jet', 'jet', 'front_shawl_sb3_jet_tjet'],
      ['peak', '2', 'flap', '', 'front_peak_sb'], ['peak', '3', 'flap', '', 'front_peak_sb3'], ['peak', '3', 'jet', 'jet', 'front_peak_sb3_jet_tjet'],
      ['peak', 'db', 'flap', '', 'front_peak_db'], ['peak', 'db4', 'flap', '', 'front_peak_db4'],
      // 5-nov photos (jetted pockets)
      ['peak', '5', 'jet', '', 'front_peak_sb3r2'], ['peak', '1', 'jet', '', 'front_peak_sb1'], ['shawl', '5', 'jet', '', 'front_shawl_sb3r2'],
      ['shawl', '2', 'jet', '', 'front_shawl_sb'], ['shawl', 'db', 'jet', '', 'front_shawl_db'], ['shawl', 'db4', 'jet', '', 'front_shawl_db4'],
      // 6-nov photos: lapel widths, shoulders, pick stitching and more fronts (a slightly wider, shorter jacket)
      ['notch', '2', 'flap', '', 'front_n_narrow', { w: 'narrow' }], ['notch', '2', 'flap', '', 'front_n_wide', { w: 'wide' }],
      ['peak', '3', 'flap', '', 'front_peak_narrow', { w: 'narrow' }], ['peak', '3', 'flap', '', 'front_peak_wide', { w: 'wide' }],
      ['shawl', '2', 'flap', '', 'front_shawl_narrow', { w: 'narrow' }], ['shawl', '2', 'flap', '', 'front_shawl_wide', { w: 'wide' }],
      ['notch', '2', 'flap', '', 'front_n_sh_natural', { sh: 'natural' }], ['notch', '2', 'flap', '', 'front_n_sh_rollino', { sh: 'rollino' }],
      ['notch', '2', 'flap', '', 'front_n_sh_neapolitan', { sh: 'neapolitan' }], ['notch', '2', 'flap', '', 'front_n_pick', { pick: 'pick' }],
      ['notch', 'db4', 'flap', '', 'front_notch_db4n'], ['notch', 'db', 'flap', '', 'front_notch_dbn'], ['notch', '4', 'flap', '', 'front_n_sb4'],
      ['notch', '27', 'flap', '', 'front_n_sb5'], ['notch', 'db61', 'flap', '', 'front_n_db61'], ['notch', 'db21', 'flap', '', 'front_n_db21'],
      // the manufacturer's other lapel shapes (photo list 2, section F): one photo each
      ...Object.entries(LAPEL_PHOTOS).map(([code, fam]) => [fam, '2', 'flap', '', 'front_lap_' + code.replace('-', '_'), { lap: code }])],
    three4: [['notch', '2', 'flap', '', 'three4'], ['notch', '2', 'slant', '', 'three4_slant'], ['notch', '2', 'patch', '', 'three4_patch'],
      ['notch', '2', 'jet', '', 'three4_jet'], ['notch', '2', 'jet', 'jet', 'three4_jet_tjet'], ['notch', '2', 'flap', 'flap', 'three4_tflap'],
      ['notch', '3', 'flap', '', 'three4_notch_sb3'], ['shawl', '1', 'flap', '', 'three4_shawl_sb1'],
      ['peak', '2', 'flap', '', 'three4_peak_sb'], ['peak', '3', 'flap', '', 'three4_peak_sb3'], ['peak', 'db', 'flap', '', 'three4_peak_db'],
      ['notch', '1', 'jet', '', 'three4_notch_sb1'], ['notch', '5', 'jet', '', 'three4_notch_sb3r2'], ['notch', 'db', 'jet', '', 'three4_notch_db'],
      ['notch', 'db4', 'jet', '', 'three4_notch_db4'], ['peak', '1', 'jet', '', 'three4_peak_sb1'], ['peak', '5', 'jet', '', 'three4_peak_sb3r2'],
      ['peak', 'db4', 'jet', '', 'three4_peak_db4'], ['shawl', '2', 'jet', '', 'three4_shawl_sb'], ['shawl', '3', 'jet', '', 'three4_shawl_sb3'],
      ['shawl', '5', 'jet', '', 'three4_shawl_sb3r2'], ['shawl', 'db4', 'jet', '', 'three4_shawl_db4'], ['shawl', 'db', 'jet', '', 'three4_shawl_db'],
      // photo list 2, section B: a second three-quarter jacket (own photos, no pocket transplant)
      ['notch', '2', 'patchtab', '', 'three4_n_patchtab'], ['notch', '2', 'pleat', '', 'three4_n_pleat'], ['notch', '2', 'hacking', '', 'three4_n_hacking'],
      ['notch', '2', 'flap', 'card', 'three4_n_card'], ['notch', '2', 'flap', '', 'three4_n_narrow', { w: 'narrow' }], ['notch', '2', 'flap', '', 'three4_n_wide', { w: 'wide' }],
      ['notch', '2', 'flap', '', 'three4_n_sh_natural', { sh: 'natural' }], ['notch', '2', 'flap', '', 'three4_n_sh_rollino', { sh: 'rollino' }],
      ['notch', '2', 'flap', '', 'three4_n_sh_neapolitan', { sh: 'neapolitan' }], ['notch', '2', 'flap', '', 'three4_n_pick', { pick: 'pick' }],
      ['notch', '2', 'patchflap', '', 'three4_n_patchflap'], ['notch', '2', 'slantjet', '', 'three4_n_slantjet'],
      ...['round', 'patchflap', 'barchetta', 'pleat', 'none'].map(c => ['notch', '2', 'flap', '', 'three4_n_chest_' + c, { chest: c }])],
    side: [['notch', '2', 'flap', '', 'side'], ['peak', '2', 'flap', '', 'side_peak_sb'], ['peak', 'db', 'flap', '', 'side_peak_db'],
      ['notch', '1', 'jet', '', 'side_notch_sb1'], ['notch', '3', 'jet', '', 'side_notch_sb3'], ['notch', '5', 'jet', '', 'side_notch_sb3r2'],
      ['notch', 'db', 'jet', '', 'side_notch_db'], ['notch', 'db4', 'jet', '', 'side_notch_db4'], ['peak', '1', 'jet', '', 'side_peak_sb1'],
      ['peak', '3', 'jet', '', 'side_peak_sb3'], ['peak', '5', 'jet', '', 'side_peak_sb3r2'], ['peak', 'db4', 'jet', '', 'side_peak_db4'],
      ['shawl', '1', 'jet', '', 'side_shawl_sb1'], ['shawl', '2', 'jet', '', 'side_shawl_sb'], ['shawl', '3', 'jet', '', 'side_shawl_sb3'],
      ['shawl', '5', 'jet', '', 'side_shawl_sb3r2'], ['shawl', 'db4', 'jet', '', 'side_shawl_db4'], ['shawl', 'db', 'jet', '', 'side_shawl_db'],
      // photo list 2, section C: pockets and shoulders seen from the side (notch, 2 buttons)
      ['notch', '2', 'patch', '', 'side_patch'], ['notch', '2', 'patchtab', '', 'side_patchtab'], ['notch', '2', 'slant', '', 'side_slant'],
      ['notch', '2', 'slantjet', '', 'side_slantjet'], ['notch', '2', 'patchflap', '', 'side_patchflap'], ['notch', '2', 'pleat', '', 'side_pleat'],
      ['notch', '2', 'jet', '', 'side_jet'], ['notch', '2', 'flap', 'flap', 'side_tflap'], ['notch', '2', 'hacking', '', 'side_hacking'],
      ['notch', '2', 'flap', '', 'side_sh_natural', { sh: 'natural' }], ['notch', '2', 'flap', '', 'side_sh_rollino', { sh: 'rollino' }],
      ['notch', '2', 'flap', '', 'side_sh_neapolitan', { sh: 'neapolitan' }]]
  };
  // close-ups of the lapel (photo list 2, section G): shown while the lapel buttonhole or pick stitching is chosen
  const CLOSE_HOLE = { B: 'B', D: 'D', H: 'H', I: 'I', J: 'J', M: 'M', N: 'N', X: 'X', 15: '15', 16: '16', 17: '17', 32: '32', W: 'W', Y: 'Y', 34: '34',
    L: 'L', 13: '13', 14: '14', 40: '40', K: 'K', 33: '33', 4: '4',
    CA: 'sq', C: 'sq', 18: 'rome', 5: 'rome', 7: 'rome', Z: 'rome', 1: 'milanese', 2: 'milanese', 3: 'milanese', O: 'milanese' };
  const CLOSE_PICK = { B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H~' };   // '~': closest photo, not the exact style
  function closeName() {
    const pick = (tab, c, pre, dflt) => { const v = tab[c] || ''; return { name: pre + (v.replace('~', '') || dflt), exact: !!v && !v.endsWith('~') }; };
    if (state.closeup === 'lapelHoleStyle') { const c = (choiceOf('lapelHoleStyle') || {}).code || 'A'; return c === 'A' ? null : pick(CLOSE_HOLE, c, 'close_hole_', 'B'); }
    if (state.closeup === 'pick') { const c = state.opts.pick || 'A'; return c === 'A' ? null : pick(CLOSE_PICK, c, 'close_pick_', 'B'); }
    return null;
  }
  const SIZE_ONLY = { lowerPocket: ['A', 'C', '11', '12', '22', 'SA'], chestPocket: ['A', 'C', 'D', 'E', 'F', 'J'], ticket: ['G', 'H', 'I', 'J'], namecard: ['E', 'F'],
    lapelHoleStyle: ['5', '7', 'Z', '18'] };
  function mapName() {
    const s = styleOf(), miss = [], hid = t => (state.hid[t] || '');
    const sizes = [];                              // choices that differ only in size: same picture, exact size on the order
    for (const [id, codes] of Object.entries(SIZE_ONLY)) { const c = state.opts[id]; if (c && codes.includes(c)) sizes.push([((choiceOf(id) || {}).label || '').toLowerCase(), [id]]); }
    // each note part names the steps it is about, so the note under a step only says what concerns that step
    const sayFor = (step) => {
      const m = miss.filter(x => !step || x[1].includes(step)).map(x => x[0]), z = sizes.filter(x => !step || x[1].includes(step)).map(x => x[0]);
      return (m.length ? `Closest photo shown. Photo for ${m.join(' + ')} is coming. Your choice is saved for the order.` : '') +
        (z.length ? `${m.length ? ' ' : ''}The picture shows the style; the exact size (${z.join(', ')}) goes on the order.` : '');
    };
    const say = () => ({ all: sayFor(null), by: sayFor });
    const cl = state.view === 'front' && closeName();
    if (cl) { if (!cl.exact) miss.push(state.closeup === 'pick' ? ['this stitching', ['pick']] : ['this buttonhole style', ['lapelHoleStyle']]); return { name: cl.name, note: say() }; }
    if (state.view === 'back') {
      const v = state.opts.vent || 'C', turned = (state.opts.collarBack || 'A') === 'B';
      const name = v === 'A' ? 'back_none' : v === 'B' ? 'back_centre' : v === 'D' ? 'back_inner_belt' : v === 'F' ? 'back_fixed_belt' : turned ? 'back_collar' : 'back';
      if (turned && name !== 'back_collar') miss.push(['the collar turned back with this vent', ['collarBack', 'vent']]);
      return { name, note: say() };
    }
    if (state.view === 'open') {                    // inside photos: lining style first, then the inside details staff chose
      const ls = state.opts.liningStyle || 'A';
      let name = ls === 'C' ? 'open_unlined' : ls === 'B' ? 'open_half' : /piping/i.test(hid('Columbia stitching/Piping')) ? 'open_piping'
        : hid('Pen pocket') && hid('Pen pocket') !== 'None' ? 'open_pen' : hid('Inner ticket pocket') && hid('Inner ticket pocket') !== 'None' ? 'open_ticket' : '';
      const card = { A: 'open_card_l', B: 'open_card_r', C: 'open_card_both' }[state.opts.namecard || 'D'];
      if (!name && s.db) name = 'open_db';
      if (!name && card) name = card;
      if (!name) { name = s.lapel === 'shawl' ? 'open_shawl' : 'open_notch'; if (s.lapel === 'peak') miss.push(['peak lapel', ['lapel']]); }
      if (['F'].includes(state.opts.facing)) miss.push(['the slanted inner pockets of this facing', ['facing']]);
      return { name, note: say() };
    }
    if (state.view === 'side' && state.elbow) {    // elbow patches: one side photo (notch, 2 buttons)
      if (s.lapel !== 'notch' || s.db || s.front !== '2') miss.push(['this front with elbow patches', ['front', 'lapel']]);
      return { name: 'side_elbow', note: say() };
    }
    const F = s.front, ex = extrasWanted(), exW = ex.w;
    if (state.view === 'front') ex.w = '';          // first look for the photo as if the width were standard
    const want = { lapel: s.lapel, front: s.db ? ({ 8: 'db21', 9: 'db4', 11: 'db4', 10: 'db61' }[F] || 'db') : F === '26' ? '27' : F,
      pocket: pocketLook(state.opts.lowerPocket || 'B'), ticket: ticketLook(state.opts.ticket || 'D') };
    if (F === '6') want.front = '4';                // 4 roll 3: four buttons, the top one on the lapel roll
    if (F === 'Z998') want.front = '2';             // the customer's own buttons: a 2-button front
    // the lapel and closure matter most, then lapel width / shoulder, then the pocket shape, then the ticket pocket
    const pickPhoto = () => {
      let best = null, bestScore = -1e9;
      for (const [l, f, p, t, name, e = {}] of PHOTOS[state.view]) {
        let sc = (l === want.lapel) * 100 + (f === want.front) * 60 + (f.startsWith('db') === want.front.startsWith('db')) * 50 + (f.startsWith('db') && want.front.startsWith('db')) * 20 + (p === want.pocket) * 10 + (t === want.ticket) * 3;
        for (const d of ['w', 'sh', 'pick', 'chest']) if (e[d]) sc += e[d] === ex[d] ? 40 : -1000;
        if (e.lap) sc += e.lap === (state.opts.lapel || 'BK') ? 250 : -1000;      // a photo of exactly this lapel shape
        if (sc > bestScore) { bestScore = sc; best = { l, f, p, t, name, e }; }
      }
      return best;
    };
    let best = pickPhoto(), lw = 0;
    const cmW = parseFloat(((choiceOf('lapelWidth') || {}).label || '')) || LAPEL_CM;
    if (state.view === 'front') {
      if (LAPEL_IDS.has(best.name)) { if (Math.abs(cmW - LAPEL_CM) > 0.2) lw = Math.round(cmW / LAPEL_CM * 100) / 100; }
      else if (exW) { ex.w = exW; best = pickPhoto(); }   // no marked lapels on this photo: the narrow / wide photo
    }
    // pockets the photo does not have: laid in from a pocket photo (closest style where this angle has none)
    let pk = null, ck = null;
    const V = PK[state.view], has = (p, t) => V && V.patches.some(x => x[0] === p && (t === undefined || x[1] === t));
    let wp = want.pocket, wt = want.ticket;
    if (!has(wp)) wp = POCKET_FALLBACK[wp] || wp;
    if (wt === 'card' && !has(wp, 'card') && !V?.patches.some(x => x[1] === 'card')) wt = 'jet';
    const sx = s.db ? 14 : 0;                       // double-breasted: pockets further from the buttons
    if ((best.p !== wp || best.t !== wt || sx) && V && !best.name.startsWith('three4_n_')) {
      const P = V.patches.find(x => x[0] === wp && x[1] === wt) || V.patches.find(x => x[0] === wp && best.p !== wp);
      const own = V.patches.find(x => x[0] === best.p && x[1] === best.t) || V.patches.find(x => x[0] === best.p);
      const Pw = P || (sx && V.patches.find(x => x[0] === wp && x[1] === wt));
      if (Pw) { pk = Pw[2] + (own ? '+' + own[2] : '') + (sx ? '@' + sx : ''); best.p = Pw[0]; best.t = Pw[1]; }
    }
    if (want.pocket === 'jettab' && best.p === 'jet' && (state.view === 'front' || state.view === 'three4')) best.p = 'jettab';   // the tab is drawn on
    let tk = null;
    if (V && want.ticket && best.t !== want.ticket && best.p === want.pocket && !best.name.startsWith('three4_n_')) {
      const T = V.patches.find(x => x[1] === want.ticket && x[0] === 'flap') || V.patches.find(x => x[1] === want.ticket);
      if (T) { tk = T[2] + (sx ? '@' + sx : ''); best.t = want.ticket; }
    }
    const chest = chestLook(state.opts.chestPocket || 'B');
    if (chest !== 'welt') {
      if (best.e.chest === chest) { /* the photo shows this chest pocket */ } else if (PKC[state.view]) ck = `chest_${chest}+chest_welt`; else miss.push(['this chest pocket', ['chestPocket']]);
    }
    if (best.l !== want.lapel) miss.push([`${want.lapel} lapel`, ['lapel', 'front']]);
    else if (!['BK', '20', 'D'].includes(state.opts.lapel || 'BK') && best.e.lap !== state.opts.lapel) miss.push(['this lapel shape', ['lapel']]);
    if (best.f !== want.front) miss.push([((choiceOf('front') || {}).label || 'this front').toLowerCase(), ['front']]);
    if (best.p !== want.pocket || best.t !== want.ticket || false) miss.push(['these pockets', ['lowerPocket', 'ticket']]);
    if (ex.w && best.e.w !== ex.w) miss.push([`${ex.w} lapel`, ['lapelWidth']]);
    if (ex.sh && best.e.sh !== ex.sh) miss.push(['this shoulder', ['shoulder']]);
    return { name: best.name, pk, ck, lw, tk, note: say() };
  }
  async function loadView(name, pk, ck, lw, tk) {
    const lk = lw ? '~' + lw : '';
    if (ck) return views[name + lk + '|' + pk + '|' + tk + '|' + ck] || (views[name + lk + '|' + pk + '|' + tk + '|' + ck] = await patchView(await loadView(name, pk, null, lw, tk), ck, 'pkc'));
    if (tk) return views[name + lk + '|' + pk + '|tk' + tk] || (views[name + lk + '|' + pk + '|tk' + tk] = await patchView(await loadView(name, pk, null, lw), tk, 'tk'));
    if (pk) return views[name + lk + '|' + pk] || (views[name + lk + '|' + pk] = await patchView(await loadView(name, null, null, lw), pk));
    if (lw) return views[name + lk] || (views[name + lk] = widthView(await loadView(name), lw));
    if (views[name]) return views[name];
    const [base, shade, warp, ov] = await Promise.all(['base', 'shade', 'warp', 'overlay_photo'].map(n => loadImg(`maps/${name}/${n}.webp?v=${VER}`)));
    const B = pixels(base), S = pixels(shade), Wp = Float32Array.from(pixels(warp)), OVP = pixels(ov);   // Wp in floats: smoothed offsets keep their fractions
    smoothWarp(Wp, B);
    let meta = { frontal: [] };
    try { meta = await (await fetch(`maps/${name}/buttons.json?v=${VER}`)).json(); } catch (e) { /* no frontal buttons */ }
    let lsum = 0, lcnt = 0;
    for (let p = 0; p < OVP.length; p += 4) if (OVP[p + 3] > 128) { lsum += 0.299 * OVP[p] + 0.587 * OVP[p + 1] + 0.114 * OVP[p + 2]; lcnt++; }
    const n = W * H, U = new Float32Array(n), V = new Float32Array(n), A = new Float32Array(n), SH = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = B[p + 3];
      if (a === 255) continue;
      A[i] = 1 - a / 255; uvAt(i, S, Wp, U, V, SH);
    }
    let ovImg = ov;
    if (name.startsWith('back')) {                  // back photos: the 'buttons' mask caught the sleeve's shadows, not buttons;
      for (let i = 0; i < n; i++) {                 // seen from behind the sleeve buttons barely show, so this becomes plain cloth
        const p = i * 4; if (!OVP[p + 3]) continue;
        let sum = 0, c = 0, x = i % W, y = (i / W) | 0;
        for (let r = 2; r <= 14 && !c; r += 3) for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
          const j = yy * W + xx, q = j * 4; if (A[j] >= 1 && !OVP[q + 3]) { sum += S[q]; c++; }
        }
        A[i] = 1; S[p] = c ? sum / c : 128; uvAt(i, S, Wp, U, V, SH);
      }
      for (let p = 3; p < OVP.length; p += 4) OVP[p] = 0;
      ovImg = document.createElement('canvas'); ovImg.width = W; ovImg.height = H;
    }
    cleanPhoto(B, A, S, Wp, U, V, SH, OVP);
    let LN = null;                                  // open-jacket views: lining mask (alpha) and its shading (red, 128 = x1.0)
    if (name.startsWith('open') && name !== 'open_unlined') LN = pixels(await loadImg(`maps/${name}/lining.webp?v=${VER}`));
    let HOLE = null;                                // buttonhole close-ups: the stitching, cut out of the photo
    if (meta.hole) try { HOLE = pixels(await loadImg(`maps/${name}/hole.webp?v=${VER}`)); } catch (e) { /* none */ }
    return (views[name] = { name, HOLE, holeCache: {}, B, S, Wp, U, V, A, SH, ov: ovImg, OVP, meta, LN, Lo: lcnt ? lsum / lcnt : 40, ovCache: {} });
  }
  // The photo around the cloth: its off-white backdrop (with faint marks left by the photo) becomes one clean colour,
  // and at the soft cloth edge the photo's own dark navy is replaced by what lies behind it (backdrop, mannequin),
  // so light cloth gets no dark outline.
  const BGC = 254;
  function cleanPhoto(B, A, S, Wp, U, V, SH, OVP) {
    const n = W * H, bg = new Uint8Array(n), q = new Int32Array(n); let qh = 0, qt = 0;
    const light = i => { if (A[i]) return false; const p = i * 4, r = B[p], g = B[p + 1], b = B[p + 2];
      return r + g + b > 690 && Math.max(r, g, b) - Math.min(r, g, b) < 14; };
    const seed = i => { if (!bg[i] && light(i)) { bg[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    for (let i = 0; i < n; i += 7) {                // backdrop seen through gaps (between arm and body): very bright, neutral
      if (bg[i] || A[i]) continue; const p = i * 4, r = B[p], g = B[p + 1], b = B[p + 2];
      if (r + g + b > 735 && Math.max(r, g, b) - Math.min(r, g, b) < 8) seed(i);
    }
    while (qh < qt) {                              // grow over the backdrop; a step in brightness (an object's edge) stops it
      const i = q[qh++], x = i % W, p = i * 4, l0 = B[p] + B[p + 1] + B[p + 2];
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= n || bg[j] || !light(j)) continue;
        const pj = j * 4; if (Math.abs(B[pj] + B[pj + 1] + B[pj + 2] - l0) > 12) continue;
        bg[j] = 1; q[qt++] = j;
      }
    }
    for (let i = 0; i < n; i++) if (bg[i]) { const p = i * 4; B[p] = B[p + 1] = B[p + 2] = BGC; }
    // the photo's deepest shadows on its navy cloth (arm/body gaps, around buttons) were left as photo pixels:
    // invisible on navy, black holes on light cloth. They become cloth, as dark as the photo shows them.
    const dark = i => { if (A[i] || bg[i] || OVP[i * 4 + 3]) return false; const p = i * 4, r = B[p], g = B[p + 1], b = B[p + 2];
      return r + g + b < 300 && b - r > -8; };
    qh = qt = 0;
    for (let i = 0; i < n; i++) if (A[i] >= 1 && OVP[i * 4 + 3] === 0) {
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < n && !bg[j] && dark(j)) { bg[j] = 2; q[qt++] = j; }
    }
    while (qh < qt) {
      const i = q[qh++], x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < n && !bg[j] && dark(j)) { bg[j] = 2; q[qt++] = j; }
    }
    for (let k = 0; k < qt; k++) {
      const i = q[k], p = i * 4, l = 0.2126 * LIN[B[p]] + 0.7152 * LIN[B[p + 1]] + 0.0722 * LIN[B[p + 2]];
      A[i] = 1; S[p] = Math.round(128 * Math.max(0.2, Math.min(1, l / 0.03))); uvAt(i, S, Wp, U, V, SH);
    }
    for (let i = 0; i < n; i++) {                  // soft edge: what lies behind = mean of the nearest non-cloth pixels
      const k = A[i]; if (k <= 0 || k >= 1) continue;
      const x = i % W, y = (i / W) | 0;
      for (let r = 1; r <= 3; r++) {
        let R = 0, G = 0, Bb = 0, c = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
          const j = yy * W + xx; if (A[j]) continue; const pj = j * 4; R += B[pj]; G += B[pj + 1]; Bb += B[pj + 2]; c++;
        }
        if (c) { const p = i * 4; B[p] = R / c; B[p + 1] = G / c; B[p + 2] = Bb / c; break; }
      }
    }
  }
  // The fold offsets (warp red/green) are stored in whole pixels, so they step from one value to the next; on fine
  // weaves and stripes those 1 px steps show as little tears in the pattern. Smoothed over the cloth (box blur,
  // 3 passes) and kept in fractions, the pattern still follows the folds but runs on unbroken.
  function smoothWarp(Wp, B) {
    const n = W * H, R = 6, src = [new Float32Array(n), new Float32Array(n)], m = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = i * 4; if (B[p + 3] < 255) { m[i] = 1; src[0][i] = Wp[p] - 128; src[1][i] = Wp[p + 1] - 128; } }
    const blur = (a, horiz) => {                    // running-sum box blur along rows or columns
      const out = new Float32Array(n), L = horiz ? W : H, M = horiz ? H : W, st = horiz ? 1 : W, ln = horiz ? W : 1;
      for (let k = 0; k < M; k++) {
        const o = k * ln; let s = 0;
        for (let j = -R; j <= R; j++) if (j >= 0 && j < L) s += a[o + j * st];
        for (let j = 0; j < L; j++) {
          out[o + j * st] = s;
          const add = j + R + 1, rem = j - R; if (add < L) s += a[o + add * st]; if (rem >= 0) s -= a[o + rem * st];
        }
      }
      return out;
    };
    let mm = m;
    for (let pass = 0; pass < 3; pass++) mm = blur(blur(mm, true), false);
    for (const c of [0, 1]) {
      let v = src[c]; for (let pass = 0; pass < 3; pass++) v = blur(blur(v, true), false);
      for (let i = 0; i < n; i++) if (m[i] && mm[i] > 0) Wp[i * 4 + c] = 128 + v[i] / mm[i];
    }
  }
  // where pixel i of the cloth samples the fabric tile (warp offset, lapel grain rotation) and how lit it is
  function uvAt(i, S, Wp, U, V, SH) {
    const p = i * 4, cx = W / 2, cy = H * 0.35, x = i % W, y = (i / W) | 0, u = x + (Wp[p] - 128), v = y + (Wp[p + 1] - 128);
    const t = ANG[Wp[p + 2]] || 0, c = Math.cos(t), s = Math.sin(t);
    U[i] = (u - cx) * c - (v - cy) * s + cx; V[i] = (u - cx) * s + (v - cy) * c + cy; SH[i] = S[p] / 128;
  }
  // Lapel width: the photos show a 7 cm lapel. On photos where the lapels are marked (warp blue 2 / 3), each lapel
  // is stretched or narrowed row by row from its fold edge (by the opening) outwards, carrying its own edge shadow.
  // Wider: the lapel lies over more of the chest. Narrower: the chest next to it closes the gap.
  const LAPEL_IDS = new Set(["front_n_card", "front_n_chest_barchetta", "front_n_chest_none", "front_n_chest_patchflap", "front_n_chest_pleat", "front_n_chest_round", "front_n_hacking", "front_n_jet_tflap", "front_n_patch_tflap", "front_n_patchflap", "front_n_patchtab", "front_n_pick", "front_n_pleat", "front_n_sb4", "front_n_sb5", "front_n_sh_natural", "front_n_sh_neapolitan", "front_n_sh_rollino", "front_n_slant_tflap", "front_n_slantjet", "front_notch_sb", "front_notch_sb1", "front_notch_sb3", "front_notch_sb3_jet_tjet", "front_notch_sb3_patch", "front_notch_sb3r2", "front_notch_sb_jet", "front_notch_sb_patch", "front_notch_sb_slant", "front_notch_sb_tflap", "front_notch_sb_tjet", "front_peak_db", "front_peak_db4", "front_peak_sb", "front_peak_sb1", "front_peak_sb3", "front_peak_sb3_jet_tjet", "front_peak_sb3r2", "front_shawl_db", "front_shawl_db4", "front_shawl_sb", "front_shawl_sb1", "front_shawl_sb3_jet_tjet", "front_shawl_sb3r2"]), LAPEL_CM = 7;
  function widthView(st, sc0) {
    const B = st.B.slice(), S = st.S.slice(), Wp = st.Wp.slice(), A = st.A.slice(), U = st.U.slice(), V = st.V.slice(), SH = st.SH.slice();
    const M = 6, BAND = 90;
    const put = (y, x, sx) => {                     // pixel x of row y takes the map values at x = sx (linear for shading)
      if (x < 0 || x >= W) return;
      const i = y * W + x; if (!st.A[i] || st.OVP[i * 4 + 3]) return;
      sx = Math.max(0, Math.min(W - 1.001, sx)); const x0 = sx | 0, f = sx - x0, j0 = y * W + x0, j1 = j0 + 1, jn = f < 0.5 ? j0 : j1;
      if (!st.A[jn]) return;
      const p = i * 4, p0 = j0 * 4, p1 = j1 * 4;
      for (let c = 0; c < 4; c++) B[p + c] = st.B[jn * 4 + c];
      S[p] = st.S[p0] * (1 - f) + st.S[p1] * f; S[p + 1] = S[p + 2] = S[p];
      Wp[p] = st.Wp[p0] * (1 - f) + st.Wp[p1] * f; Wp[p + 1] = st.Wp[p0 + 1] * (1 - f) + st.Wp[p1 + 1] * f; Wp[p + 2] = st.Wp[jn * 4 + 2];
      A[i] = st.A[jn]; uvAt(i, S, Wp, U, V, SH);
    };
    for (const pid of [2, 3]) {
      let top = -1, bot = -1;                       // the lapel's rows: the change eases in at the top and out at the bottom
      for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x += 2) if (st.Wp[(y * W + x) * 4 + 2] === pid) c++; if (c > 1) { if (top < 0) top = y; bot = y; } }
      if (top < 0) continue;
      const hgt = bot - top, ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      for (let y = top; y <= bot; y++) {
      const tt = Math.min(ease((y - top) / (hgt * 0.08)), ease((bot - y) / (hgt * 0.18))), sc = 1 + (sc0 - 1) * tt;
      if (Math.abs(sc - 1) < 0.01) continue;
      let best = null, run = null;                  // the longest run of this lapel in the row
      for (let x = 0; x <= W; x++) {
        const on = x < W && st.Wp[(y * W + x) * 4 + 2] === pid;
        if (on && !run) run = [x, x]; else if (on) run[1] = x;
        if (!on && run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
      }
      if (!best || best[1] - best[0] < 4) continue;
      const w = best[1] - best[0] + 1, wn = w * sc;
      if (pid === 2) {                              // the wearer's left lapel: fold edge on the left, outer edge on the right
        const xf = best[0], xo = best[1], xn = xf + wn - 1, end = Math.round(Math.max(xn, xo) + M + (sc < 1 ? BAND : 0));
        for (let x = end; x >= xf; x--) {
          let sx;
          if (x <= xn) sx = xf + (x - xf) / sc;
          else if (x <= xn + M) sx = xo + (x - xn);
          else if (sc < 1) sx = xo + M + (x - xn - M) * BAND / (end - xn - M);
          else continue;
          put(y, x, sx);
        }
      } else {                                      // the wearer's right lapel: mirrored
        const xf = best[1], xo = best[0], xn = xf - wn + 1, end = Math.round(Math.min(xn, xo) - M - (sc < 1 ? BAND : 0));
        for (let x = end; x <= xf; x++) {
          let sx;
          if (x >= xn) sx = xf - (xf - x) / sc;
          else if (x >= xn - M) sx = xo - (xn - x);
          else if (sc < 1) sx = xo - M - (xn - M - x) * BAND / (xn - M - end);
          else continue;
          put(y, x, sx);
        }
      }
      }
    }
    return { ...st, B, S, Wp, A, U, V, SH, ovCache: {}, lapelGeo: undefined };
  }
  // Pocket styles: the pocket area of a notch photo with that pocket (shading + fold offsets) is blended into
  // this photo, moved to where this photo's own pocket sits. Buttons and the photo's outline stay its own.
  let PK = {}, PKC = {};
  const pkImgs = {};
  async function pkImg(f) { return pkImgs[f] || (pkImgs[f] = pixels(await loadImg(`maps/_pk/${f}.webp?v=${VER}`))); }
  // kind 'pk': lower pockets (left and right pocket move separately), 'pkc': the chest pocket
  async function patchView(st, pk, kind = 'pk') {
    const tkOnly = kind === 'tk'; if (tkOnly) kind = 'pk';      // only the ticket pocket: the rows above the lower pocket, on its side
    const v = (kind === 'pkc' ? PKC : PK)[state.view], [pkf, sxs] = pk.split('@'), [dn, tn] = pkf.split('+'), [pw, ph] = v.size;
    const off = st.meta[kind] || [0, 0, 0], tdy = off[1], tdx = px => px < split ? off[0] : (off[2] ?? off[0]);
    const sx = +sxs || 0, split = kind === 'pkc' ? 1e9 : state.view === 'front' ? pw / 2 : 209;   // left / right pocket (three-quarter: far / near)
    const dxOf = px => !sx ? 0 : px < split ? (state.view === 'front' ? -sx : 0) : sx;
    const Dp = v.patches.find(x => x[2] === dn), D = await pkImg(dn), Tp = tn && v.patches.find(x => x[2] === tn), T = Tp && await pkImg(tn);
    const ddx = (P, px) => px < split ? P[3][0] : (P[3][2] ?? P[3][0]);
    const S = st.S.slice(), Wp = st.Wp.slice(), U = st.U.slice(), V = st.V.slice(), SH = st.SH.slice();
    // per patch pixel: target index, donor value, weight = new pocket area + this photo's own pocket area
    const n = pw * ph, dsx = new Int32Array(n), idx = new Int32Array(n).fill(-1), w = new Float32Array(n), sd = new Float32Array(n), st0 = new Float32Array(n);
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      const x = v.at[0] + tdx(px) + px, y = v.at[1] + tdy + py, k = py * pw + px;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if (tkOnly && (px >= split || py >= 110)) continue;
      const i = y * W + x; if (!st.A[i] || st.OVP[i * 4 + 3]) continue;   // only on cloth, never over a button
      let e = 1;                                        // fade out near the jacket outline (outlines differ per photo)
      for (let d = 4; d <= 28 && e > 0; d += 4) if (!st.A[i - d] || !st.A[i + d]) e = Math.min(e, (d - 4) / 24);
      if (kind === 'pk' && st.meta.pkx) e = Math.min(e, Math.max(0, (st.meta.pkx - 6 - x) / 14));   // three-quarter: stop before the arm
      const qdy = py + Dp[3][1], qty = Tp ? py + Tp[3][1] : -1;   // each donor's pocket sits at its own offset
      const pxd = px - dxOf(px) + ddx(Dp, px), okd = pxd >= 0 && pxd < pw && qdy >= 0 && qdy < ph;
      const ptx = Tp ? px + ddx(Tp, px) : -1;
      dsx[k] = pxd;
      const a = okd ? D[((qdy + ph) * pw + pxd) * 4] / 255 : 0;   // weight: bottom half of the image
      const b = Tp && qty >= 0 && qty < ph && ptx >= 0 && ptx < pw ? T[((qty + ph) * pw + ptx) * 4 + 1] / 255 : 0;   // wide area: erase this photo's own pocket
      idx[k] = i; w[k] = Math.max(a, b) * e; st0[k] = S[i * 4];
      sd[k] = okd ? D[(qdy * pw + pxd) * 4] : st0[k];
    }
    // brightness match: one ratio between this photo's cloth and the donor's, measured on plain cloth around the
    // pockets (a local ratio picks up darts and folds and leaves bands)
    let s1 = 0, s2 = 0;
    for (let k = 0; k < n; k++) if (idx[k] >= 0 && w[k] < 0.05) { s1 += st0[k]; s2 += sd[k]; }
    const g = Math.min(1.25, Math.max(0.8, (s1 + 1) / (s2 + 1)));
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      const k = py * pw + px, i = idx[k]; if (i < 0 || w[k] <= 0) continue;
      const p = i * 4, ww = w[k];
      const qdy = py + Dp[3][1], q = qdy >= 0 && qdy < ph && dsx[k] >= 0 && dsx[k] < pw ? (qdy * pw + dsx[k]) * 4 : -1;
      S[p] = Math.min(255, st0[k] * (1 - ww) + sd[k] * g * ww);
      if (q >= 0) { Wp[p] = Wp[p] * (1 - ww) + D[q + 1] * ww; Wp[p + 1] = Wp[p + 1] * (1 - ww) + D[q + 2] * ww; }
      uvAt(i, S, Wp, U, V, SH);
    }
    return { ...st, S, Wp, U, V, SH, ovCache: {} };
  }
  const tilePx = {};
  async function loadTile(f, z = 1) {
    const key = f.id + '@' + z;
    if (tiles[key]) return tiles[key];
    const px = tilePx[f.id] || (tilePx[f.id] = pixels(await loadImg(`tiles/${f.id}.jpg?v=${VER}`)));
    return (tiles[key] = linearTile(px, f.tcm * PX_PER_CM * z));
  }

  function draw(st) {
    if (!st || !state.tile) return;
    const T = state.tile.T, N = state.tile.n, SL = shadeLut(state.tile);
    const out = ctx.createImageData(W, H), O = out.data, B = st.B, n = W * H;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const k = st.A[i];
      if (!k) { O[p] = B[p]; O[p + 1] = B[p + 1]; O[p + 2] = B[p + 2]; O[p + 3] = 255; continue; }
      let u = st.U[i] % N, v = st.V[i] % N; if (u < 0) u += N; if (v < 0) v += N; if (u >= N) u -= N; if (v >= N) v -= N;   // -1e-9 % N + N can round to N
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
      // at the soft edge the photo's light includes the white backdrop: never brighten the cloth there (pink fringe)
      const a = (y0 * N + x0) * 3, b = (y0 * N + x1) * 3, c = (y1 * N + x0) * 3, d = (y1 * N + x1) * 3, s0 = SL[Math.min(1024, (st.SH[i] * 256) | 0)], sh = k < 0.98 ? Math.min(s0, 0.9) : s0;
      for (let ch = 0; ch < 3; ch++) {
        const top = T[a + ch] + (T[b + ch] - T[a + ch]) * fx, bot = T[c + ch] + (T[d + ch] - T[c + ch]) * fx;
        let lin = (top + (bot - top) * fy) * sh; if (lin > 2) lin = 2;
        O[p + ch] = B[p + ch] * (1 - k) + TONE[(lin * OUTN) | 0] * k;
      }
      O[p + 3] = 255;
    }
    if (st.LN) liningPass(st, O, 0, 0, 1, state.tile);
    ctx.putImageData(out, 0, 0); drawHole(st, 0, 0, 1); drawLabel(st.name, 0, 0, 1); drawTabs(st, 0, 0, 1); drawCuffHoles(st, 0, 0, 1); drawLapelHoles(st, 0, 0, 1); ctx.drawImage(overlayFor(st), 0, 0); drawDiscs(st, 0, 0, 1); drawMonos(0, 0, 1);
  }

  // Zoomed view: redraw only the tapped area at ZOOM x the resolution, sampling the maps between pixels and a
  // finer copy of the fabric, so the weave shows real detail instead of enlarged pixels.
  const ZOOM = 3;
  function drawZoom(st, tile, zx, zy, Z = ZOOM) {
    const T = tile.T, N = tile.n, cx = W / 2, cy = H * 0.35, SL = shadeLut(state.tile || tile);
    const out = ctx.createImageData(W, H), O = out.data, B = st.B, S = st.S, Wp = st.Wp;
    for (let oy = 0, p = 0; oy < H; oy++) {
      const by = Math.min(zy + oy / Z, H - 1.001), y0 = by | 0, fy = by - y0, y1 = y0 + 1;
      for (let ox = 0; ox < W; ox++, p += 4) {
        const bx = Math.min(zx + ox / Z, W - 1.001), x0 = bx | 0, fx = bx - x0;
        // the 4 neighbouring map pixels and their weights
        const i00 = (y0 * W + x0) * 4, i01 = i00 + 4, i10 = i00 + W * 4, i11 = i10 + 4;
        const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
        const a00 = B[i00 + 3], a01 = B[i01 + 3], a10 = B[i10 + 3], a11 = B[i11 + 3];
        const alpha = (a00 * w00 + a01 * w01 + a10 * w10 + a11 * w11) / 255, k = 1 - alpha;
        // photo part, premultiplied so the transparent cloth pixels do not darken the edges
        let r = (B[i00] * a00 * w00 + B[i01] * a01 * w01 + B[i10] * a10 * w10 + B[i11] * a11 * w11) / 255;
        let g = (B[i00 + 1] * a00 * w00 + B[i01 + 1] * a01 * w01 + B[i10 + 1] * a10 * w10 + B[i11 + 1] * a11 * w11) / 255;
        let bl = (B[i00 + 2] * a00 * w00 + B[i01 + 2] * a01 * w01 + B[i10 + 2] * a10 * w10 + B[i11 + 2] * a11 * w11) / 255;
        if (k > 0.002) {
          const ni = (fx < 0.5 ? (fy < 0.5 ? i00 : i10) : (fy < 0.5 ? i01 : i11)), t = ANG[Wp[ni + 2]] || 0, cs = Math.cos(t), sn = Math.sin(t);
          const u0 = bx + (Wp[i00] * w00 + Wp[i01] * w01 + Wp[i10] * w10 + Wp[i11] * w11) - 128;
          const v0 = by + (Wp[i00 + 1] * w00 + Wp[i01 + 1] * w01 + Wp[i10 + 1] * w10 + Wp[i11 + 1] * w11) - 128;
          let u = (((u0 - cx) * cs - (v0 - cy) * sn + cx) * Z) % N, v = (((u0 - cx) * sn + (v0 - cy) * cs + cy) * Z) % N;
          if (u < 0) u += N; if (v < 0) v += N; if (u >= N) u -= N; if (v >= N) v -= N;   // -1e-9 % N + N can round to N
          const tx0 = u | 0, ty0 = v | 0, tfx = u - tx0, tfy = v - ty0, tx1 = (tx0 + 1) % N, ty1 = (ty0 + 1) % N;
          const a = (ty0 * N + tx0) * 3, b = (ty0 * N + tx1) * 3, c = (ty1 * N + tx0) * 3, d = (ty1 * N + tx1) * 3;
          let sh = SL[Math.min(1024, ((S[i00] * w00 + S[i01] * w01 + S[i10] * w10 + S[i11] * w11) * 2) | 0)];
          if (k < 0.98) sh = Math.min(sh, 0.9);
          const f = ch => {
            const top = T[a + ch] + (T[b + ch] - T[a + ch]) * tfx, bot = T[c + ch] + (T[d + ch] - T[c + ch]) * tfx;
            let lin = (top + (bot - top) * tfy) * sh; if (lin > 2) lin = 2;
            return TONE[(lin * OUTN) | 0] * k;
          };
          r += f(0); g += f(1); bl += f(2);
        }
        O[p] = r; O[p + 1] = g; O[p + 2] = bl; O[p + 3] = 255;
      }
    }
    if (st.LN) liningPass(st, O, zx, zy, Z, tile);
    ctx.putImageData(out, 0, 0); drawHole(st, zx, zy, Z); drawLabel(st.name, zx, zy, Z); drawTabs(st, zx, zy, Z); drawCuffHoles(st, zx, zy, Z); drawLapelHoles(st, zx, zy, Z);
    ctx.drawImage(overlayFor(st), zx, zy, W / Z, H / Z, 0, 0, W, H); drawDiscs(st, zx, zy, Z); drawMonos(zx, zy, Z);
  }

  // ---------- the lapel buttonhole on its close-up photo, in the chosen thread (matching thread: a shade lighter than the cloth) ----------
  const HBOX = [690, 330, 1010, 520];
  function drawHole(st, zx, zy, Z) {
    if (!st.HOLE) return;
    const t = threadRGB('lapel'), rgb = t || clothRGB().map(v => Math.min(255, v * 1.7 + 30)), key = rgb.join(',');
    let c = st.holeCache[key];
    if (!c) {
      const [x0, y0, x1, y1] = HBOX, w = x1 - x0, h = y1 - y0;
      c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'), im = x.createImageData(w, h), O = im.data, Hp = st.HOLE;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const p = ((y0 + yy) * W + x0 + xx) * 4, o = (yy * w + xx) * 4, a = Hp[p + 3]; if (!a) continue;
        const k = Math.min(1.6, Hp[p] / 128);                     // the stitch's own light and shadow
        O[o] = Math.min(255, rgb[0] * k); O[o + 1] = Math.min(255, rgb[1] * k); O[o + 2] = Math.min(255, rgb[2] * k); O[o + 3] = a;
      }
      x.putImageData(im, 0, 0); st.holeCache[key] = c;
    }
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, (HBOX[0] - zx) * Z, (HBOX[1] - zy) * Z, (HBOX[2] - HBOX[0]) * Z, (HBOX[3] - HBOX[1]) * Z); ctx.restore();
  }

  // ---------- brand label on the inside view ----------
  // Inner breast pocket welts on the open photos: [wearer's right (image left), wearer's left (image right)].
  const INNER_PK = { open_notch: [[312, 763], [712, 803]], open_shawl: [[320, 767], [712, 803]], _: [[300, 895], [725, 895]] };
  const LABEL_AT = { B: [0, -2.9], E: [1, -2.9], F: [1, 8], K: [0, 8], L1: [1, -1.6], R: [1, 1.7], S: [1, 1.7] };   // [pocket, cm below]
  function drawLabel(name, zx, zy, Z) {
    const pos = LABEL_AT[state.opts.brandLabel || 'A']; if (!pos || state.view !== 'open') return;
    const pk = (INNER_PK[name] || INNER_PK._)[pos[0]], k = PX_PER_CM * Z, cx = (pk[0] - zx) * Z, cy = (pk[1] + pos[1] * PX_PER_CM - zy) * Z;
    const w = 5 * k, h = 1.6 * k;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(pos[0] ? 0.03 : -0.02);
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 1.5 * Z; ctx.shadowOffsetY = 0.6 * Z;
    ctx.fillStyle = '#1f2533'; ctx.fillRect(-w / 2, -h / 2, w, h);                                     // woven label
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.5 * Z;
    for (let y = -h / 2 + Z; y < h / 2; y += 1.2 * Z) { ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke(); }
    ctx.fillStyle = '#c9a85a'; ctx.font = `600 ${Math.max(6, 0.62 * k)}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MAGNOLIA BESPOKE', 0, 0.5 * Z, w * 0.9);
    ctx.setLineDash(state.opts.brandLabel === 'S' ? [1.2 * Z, 1.6 * Z] : [2.2 * Z, 1 * Z]);           // stitched on (hand-made: spaced stitches)
    ctx.strokeStyle = 'rgba(200,190,170,0.55)'; ctx.lineWidth = 0.6 * Z; ctx.strokeRect(-w / 2 + 1.2 * Z, -h / 2 + 1.2 * Z, w - 2.4 * Z, h - 2.4 * Z);
    ctx.restore();
  }

  // ---------- jetted pockets with a button tab (lower pocket code 2): a pointed tab of the cloth hangs from the jet ----------
  // Jet centres on the pocket photos (front: left, right; three-quarter: far, near), moved like the pockets themselves.
  const JET_AT = { front: [[287, 997], [725, 991]], three4: [[268, 992], [577, 987]] };
  function drawTabs(st, zx, zy, Z) {
    if ((state.opts.lowerPocket || 'B') !== '2' || !JET_AT[state.view]) return;
    const off = st.meta.pk || [0, 0, 0], split = state.view === 'front' ? 521 : 454, sx = styleOf().db ? 14 : 0;
    const bi = state.button && btnImgs[state.button + '|' + (state.thread.button || '')];
    for (const [jx, jy] of JET_AT[state.view]) {
      const left = jx < split, x0 = jx + (left ? off[0] : (off[2] ?? off[0])) + (state.view === 'front' && sx ? (left ? -sx : sx) : 0), y0 = jy + off[1];
      const s = state.view === 'three4' && left ? 0.55 : 1;                // the far pocket is seen edge-on
      const w = 2.6 * PX_PER_CM * s, l = 3.3 * PX_PER_CM, X = (x0 - zx) * Z, Y = (y0 - zy) * Z, hw = w / 2 * Z, L = l * Z;
      const path = () => { ctx.beginPath(); ctx.moveTo(X - hw, Y); ctx.lineTo(X + hw, Y); ctx.lineTo(X + hw, Y + L * 0.72); ctx.lineTo(X, Y + L); ctx.lineTo(X - hw, Y + L * 0.72); ctx.closePath(); };
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 2.5 * Z; ctx.shadowOffsetY = 1.2 * Z; path(); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.shadowColor = 'transparent'; path(); ctx.clip();
      ctx.drawImage(cv, X - hw, Y + L * 1.3, 2 * hw, L * 1.05, X - hw, Y, 2 * hw, L * 1.05);    // the same cloth, from just below
      const g = ctx.createLinearGradient(X - hw, Y, X + hw, Y + L); g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = g; ctx.fillRect(X - hw, Y, 2 * hw, L);
      ctx.restore();
      ctx.save(); path(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.1 * Z; ctx.stroke();
      ctx.setLineDash([1.6 * Z, 1.4 * Z]); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.7 * Z;   // edge stitching
      ctx.beginPath(); ctx.moveTo(X - hw + 2.5 * Z, Y + 2 * Z); ctx.lineTo(X - hw + 2.5 * Z, Y + L * 0.7); ctx.lineTo(X, Y + L - 3 * Z); ctx.lineTo(X + hw - 2.5 * Z, Y + L * 0.7); ctx.lineTo(X + hw - 2.5 * Z, Y + 2 * Z); ctx.stroke();
      ctx.restore();
      const R = 0.75 * PX_PER_CM * Z * Math.max(s, 0.7), bx = X, by = Y + L * 0.62;                     // the button
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 2 * Z; ctx.shadowOffsetY = 0.8 * Z;
      if (bi) { ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(bi, bx - R, by - R, 2 * R, 2 * R); }
      else {
        const gr = ctx.createRadialGradient(bx - R * 0.3, by - R * 0.3, R * 0.1, bx, by, R); gr.addColorStop(0, '#5a5856'); gr.addColorStop(1, '#1d1c1b');
        ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.fillStyle = gr; ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.fillStyle = 'rgba(0,0,0,0.7)';
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(bx + a * R * 0.28, by + b * R * 0.28, R * 0.12, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.restore();
    }
  }

  // ---------- sleeve buttons (side and three-quarter views) ----------
  // The photo's 4 kissing buttons are replaced by the chosen number, kissing or spaced, copied from the photo's
  // own bottom button, so they keep its light. Holes are drawn under them, straight or slanted.
  function cuffOpts() {
    return { n: +(state.opts.cuffButtons || '4') || 0, kiss: (state.opts.kissing || 'B') === 'A', slant: (state.opts.sleeveHoleDir || 'A') === 'B',
      holes: (state.opts.sleeveHoleDir || 'A') !== 'Z' };
  }
  function cuffView(st) {
    const c = st.meta.cuff; if (!c) return st;
    const o = cuffOpts(), key = o.n + '|' + o.kiss;
    st.cuffs = st.cuffs || {};
    if (st.cuffs[key]) return st.cuffs[key];
    const [ax, ay] = c.a, [bx, by] = c.b, r = c.r, L = Math.hypot(ax - bx, ay - by), dx = (ax - bx) / L, dy = (ay - by) / L;   // d: up the sleeve
    // copies: the plain view reads A / SH / U / V, the zoomed view reads the photo's alpha (B) and shade (S)
    const A = st.A.slice(), OVP = new Uint8ClampedArray(st.OVP), B = new Uint8ClampedArray(st.B), S = new Uint8ClampedArray(st.S), SH = st.SH.slice(), U = st.U.slice(), V = st.V.slice();
    const segDist = (x, y) => { const t = Math.max(-r, Math.min(L + r, (x - bx) * dx + (y - by) * dy)); return Math.hypot(x - (bx + dx * t), y - (by + dy * t)); };
    const x0 = Math.floor(Math.min(ax, bx) - 3.2 * r - 16), x1 = Math.ceil(Math.max(ax, bx) + 3.2 * r + 16), y0 = Math.floor(Math.min(ay, by) - 3.2 * r - 16), y1 = Math.ceil(Math.max(ay, by) + 3.2 * r + 16);
    // the photo's light on the cloth right around the buttons
    let ss = 0, sn = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, dd = segDist(x, y);
      if (dd > r + 5 && dd < r + 16 && st.A[i] > 0.99 && !st.OVP[i * 4 + 3]) { ss += st.SH[i]; sn++; }
    }
    const sh = sn ? ss / sn : 1;
    // the sprite: the bottom button as photographed
    const R = Math.ceil(r + 3), spr = [];
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const X = Math.round(bx) + x, Y = Math.round(by) + y, q = (Y * W + X) * 4;
      if (x * x + y * y <= R * R && st.OVP[q + 3]) spr.push([x, y, st.OVP[q], st.OVP[q + 1], st.OVP[q + 2], st.OVP[q + 3]]);
    }
    // clear the photo's buttons: the light there is the smoothed light of the cloth around them (box mean over
    // cloth outside the button row), plus the fine texture of a strip of the same sleeve beside them
    const R2 = 3.2 * r + 6, ex0 = -dy, ey0 = dx, D = 2 * R2 + 6;   // R2: wide enough to take in the old buttonholes too
    const okC = j => st.A[j] > 0.99 && !st.OVP[j * 4 + 3];
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, KS = Math.ceil(R2) + 14;
    const integ = f => {                           // summed-area table over the box
      const t = new Float64Array((bw + 1) * (bh + 1));
      for (let y = 0; y < bh; y++) { let row = 0; for (let x = 0; x < bw; x++) { row += f(x0 + x, y0 + y); t[(y + 1) * (bw + 1) + x + 1] = t[y * (bw + 1) + x + 1] + row; } }
      return (x, y) => { const ax0 = Math.max(0, x - x0 - KS), ay0 = Math.max(0, y - y0 - KS), ax1 = Math.min(bw, x - x0 + KS + 1), ay1 = Math.min(bh, y - y0 + KS + 1);
        return t[ay1 * (bw + 1) + ax1] - t[ay0 * (bw + 1) + ax1] - t[ay1 * (bw + 1) + ax0] + t[ay0 * (bw + 1) + ax0]; };
    };
    const outside = (x, y) => x >= 0 && x < W && y >= 0 && y < H && segDist(x, y) > R2 && okC(y * W + x);
    const sumS = integ((x, y) => outside(x, y) ? st.S[(y * W + x) * 4] : 0), sumN = integ((x, y) => outside(x, y) ? 1 : 0);
    let side = 0, best = -1;
    for (const sg of [1, -1]) {                     // the side of the button row where the sleeve continues
      let c = 0;
      for (let y = y0; y <= y1; y += 3) for (let x = x0; x <= x1; x += 3) if (segDist(x, y) <= R2) {
        const X = Math.round(x + ex0 * D * sg), Y = Math.round(y + ey0 * D * sg); if (X >= 0 && X < W && Y >= 0 && Y < H && okC(Y * W + X)) c++;
      }
      if (c > best) { best = c; side = sg; }
    }
    const sx0 = Math.round(ex0 * D * side), sy0 = Math.round(ey0 * D * side);
    const texAt = (x, y) => {                       // the strip's fine texture: its value minus its 9x9 mean
      let v = 0, c = 0, X = x + sx0, Y = y + sy0;
      if (X < 4 || X >= W - 4 || Y < 4 || Y >= H - 4 || !okC(Y * W + X)) return 0;
      for (let yy = -4; yy <= 4; yy += 2) for (let xx = -4; xx <= 4; xx += 2) { const j = (Y + yy) * W + X + xx; if (okC(j)) { v += st.S[j * 4]; c++; } }
      return c ? st.S[(Y * W + X) * 4] - v / c : 0;
    };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, p = i * 4, dd = segDist(x, y); if (dd > R2) continue;
      const n = sumN(x, y), v = Math.max(0, Math.min(255, (n ? sumS(x, y) / n : sh * 128) + texAt(x, y)));
      const isBtn = OVP[p + 3] > 0 || (dd <= r + 4 && A[i] < 0.99 && (st.B[p] + st.B[p + 1] + st.B[p + 2]) / 3 < 150);   // any piece of the old buttons, even its highlights
      if (isBtn) { OVP[p + 3] = 0; A[i] = 1; B[p + 3] = 0; S[p] = v; uvAt(i, S, st.Wp, U, V, SH); }
      else if (A[i] > 0.99 && !OVP[p + 3]) {
        const w = Math.min(1, (R2 - dd) / 10);
        S[p] = Math.min(255, S[p] * (1 - w) + v * w); SH[i] = S[p] / 128;
      }
    }
    // the chosen buttons, from the cuff edge up
    const sp = L / 3 * (o.kiss ? 1 : 1.45), centres = [];
    for (let k = 0; k < o.n; k++) centres.push([bx + dx * sp * k, by + dy * sp * k]);
    for (const [cx, cy] of centres) for (const [x, y, r8, g8, b8, a8] of spr) {
      const X = Math.round(cx) + x, Y = Math.round(cy) + y, q = (Y * W + X) * 4;
      if (a8 > OVP[q + 3]) { OVP[q] = r8; OVP[q + 1] = g8; OVP[q + 2] = b8; OVP[q + 3] = a8; }
    }
    const ov = document.createElement('canvas'); ov.width = W; ov.height = H;
    const ox = ov.getContext('2d'), im = ox.createImageData(W, H); im.data.set(OVP); ox.putImageData(im, 0, 0);
    let ex = -dy, ey = dx;
    if (ex > 0) { ex = -ex; ey = -ey; }                      // as in the photos: towards the vent, on the left of the buttons
    return (st.cuffs[key] = { ...st, A, B, S, OVP, SH, U, V, ov, ovCache: {}, cuffAt: { centres, r, ex, ey, dx, dy } });
  }
  function drawCuffHoles(st, zx, zy, Z) {
    const c = st.cuffAt, o = cuffOpts(); if (!c || !o.holes || !c.centres.length) return;
    const t = threadRGB('button');
    let { ex, ey } = c;
    if (o.slant) { const a = 0.45 * Math.sign(ex * c.dy - ey * c.dx || 1), cs = Math.cos(a), sn = Math.sin(a); [ex, ey] = [ex * cs - ey * sn, ex * sn + ey * cs]; }
    ctx.save(); ctx.lineCap = 'round';
    for (const [cx, cy] of c.centres) {                // a buttonhole: stitched edge (thread colour) round a dark slit
      const x = (cx - zx) * Z, y = (cy - zy) * Z, l = c.r * 1.9 * Z, x2 = x + ex * l, y2 = y + ey * l;
      ctx.strokeStyle = t ? `rgba(${t},0.95)` : 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(2.5, 2.6 * Z);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      if (!t) { ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = Math.max(0.8, 0.9 * Z);   // matching thread: the stitched ridge catches the light
        ctx.beginPath(); ctx.moveTo(x - 0.8 * Z, y - 1.1 * Z); ctx.lineTo(x2 - 0.8 * Z, y2 - 1.1 * Z); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = Math.max(0.8, 0.8 * Z);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2 - ex * Z, y2 - ey * Z); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- lapel buttonhole (front views) ----------
  // Placed a quarter of the way down each lapel, 40 % in from its outer edge, sloping up towards the edge.
  function lapelGeo(st) {
    if (st.lapelGeo !== undefined) return st.lapelGeo;
    const at = pid => {
      let top = -1, bot = -1;
      for (let y = 150; y < 1100; y++) { let c = 0; for (let x = 150; x < 880; x++) if (st.Wp[(y * W + x) * 4 + 2] === pid) c++; if (c >= 6) { if (top < 0) top = y; bot = y; } }
      if (top < 0) return null;
      const y = Math.round(top + (bot - top) * 0.24); let x0 = W, x1 = -1;
      for (let x = 150; x < 880; x++) if (st.Wp[(y * W + x) * 4 + 2] === pid) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      if (x1 <= x0) return null;
      const outer = pid === 2 ? x1 : x0, w = x1 - x0;               // about 40 % in from the lapel's outer edge
      return { x: outer + (pid === 2 ? -1 : 1) * w * 0.4, y, w };
    };
    if (st.meta.lapelL && state.view === 'front') {   // the photo already shows a lapel buttonhole: draw over it
      const [x, y] = st.meta.lapelL; return (st.lapelGeo = { L: { x, y, w: 60 }, R: { x: 1024 - x, y, w: 60 } });
    }
    return (st.lapelGeo = state.view === 'front' ? { L: at(2), R: at(3) } : null);   // L = the wearer's left lapel
  }
  function lapelHoles(st) {
    const g = lapelGeo(st), pos = state.opts.lapelHole || 'A'; if (!g || pos === 'Z') return [];
    const sides = { A: ['L'], B: ['R'], C: ['L'], D: ['L', 'R'], E: ['L', 'R'] }[pos] || ['L'], dbl = pos === 'C' || pos === 'E', out = [];
    for (const k of sides) { const h = g[k]; if (!h) continue; out.push({ ...h, side: k }); if (dbl) out.push({ ...h, y: h.y + 20, side: k }); }
    return out;
  }
  function drawLapelHoles(st, zx, zy, Z) {
    const holes = lapelHoles(st); if (!holes.length) return;
    const style = (choiceOf('lapelHoleStyle') || {}).code || 'A'; if (style === 'A') return;     // 'None': no lapel buttonhole
    const hand = /Handmade/i.test((choiceOf('lapelHoleStyle') || {}).label || '');
    const t = threadRGB('lapel'), len = 2.3 * PX_PER_CM;            // a 2.3 cm buttonhole
    ctx.save(); ctx.lineCap = 'round';
    for (const h of holes) {
      const a = (h.side === 'L' ? -1 : 1) * 0.3, dx = Math.cos(a) * (h.side === 'L' ? 1 : -1), dy = Math.sin(a) * (h.side === 'L' ? 1 : -1);
      const x = (h.x - zx) * Z, y = (h.y - zy) * Z, hx = dx * len / 2 * Z, hy = dy * len / 2 * Z;
      ctx.strokeStyle = t ? `rgb(${t})` : 'rgba(0,0,0,0.42)'; ctx.lineWidth = (hand ? 3.6 : 2.8) * Z;
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = Z; ctx.shadowOffsetY = 0.4 * Z;
      ctx.beginPath(); ctx.moveTo(x - hx, y - hy); ctx.lineTo(x + hx, y + hy); ctx.stroke();
      if (!/Square|Rome/i.test((choiceOf('lapelHoleStyle') || {}).label || '')) {   // round (keyhole) end towards the edge
        ctx.beginPath(); ctx.arc(x + hx, y + hy, (hand ? 2.2 : 1.8) * Z, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      }
      if (!t) { ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1 * Z;       // matching thread: its stitched ridge catches the light
        ctx.beginPath(); ctx.moveTo(x - hx - Z, y - hy - 1.2 * Z); ctx.lineTo(x + hx - Z, y + hy - 1.2 * Z); ctx.stroke(); }
      ctx.shadowColor = 'transparent'; ctx.strokeStyle = t ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.8 * Z;
      ctx.beginPath(); ctx.moveTo(x - hx * 0.85, y - hy * 0.85); ctx.lineTo(x + hx * 0.85, y + hy * 0.85); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- monogram preview ----------
  // Where each factory position sits on our photos: [view, x, y, angle in degrees]. Left/right = the wearer's.
  const MONO_POS = { P01: ['front', 695, 572, 0], P02: ['front', 695, 610, 0], P03: ['front', 695, 606, 0], P04: ['open', 708, 968, 0],
    P05: ['front', 610, 440, -20], P06: ['open', 740, 772, 0], P07: ['open', 285, 748, 0], P08: ['front', 695, 652, 0],
    P09: ['open', 708, 862, 0], P10: ['open', 315, 840, 0], P11: ['open', 315, 840, 0], P12: ['open', 315, 840, 0], P13: ['open', 315, 840, 0],
    P14: ['melton', 512, 0, 0], P15: ['open', 710, 772, 0], P16: ['open', 315, 748, 0], P17: ['open', 690, 1150, 0], P18: ['open', 335, 1150, 0],
    P19: ['front', 572, 560, -77], P20: ['front', 452, 560, 77] };
  // the closest web font to each factory font (the embroidery itself uses the factory's own font)
  const MONO_FONT = { 'Bank Gothic': 'Michroma', 'Bank Gothic Light BT': 'Michroma', 'Arial Black': 'Archivo Black', Arial: 'Arimo',
    Bradley: 'Caveat', Constantia: 'Crimson Text', 'Monotype Corsiva': 'Cormorant Garamond', 'Viner Hand ITC': 'Kalam', 'Harlow Solid Italic': 'Lobster',
    'Lucida Handwriting': 'Merienda', Mistral: 'Marck Script', 'Kunstler Script': 'Great Vibes', 'Comic Book': 'Bangers',
    Gradl: 'Poiret One', 'Lucida Calligraphy': 'Fondamento', 'Old English Text': 'UnifrakturMaguntia', 'Script MT Bold': 'Yesteryear', 'Times New Roman': 'Tinos' };
  // italic faces: Corsiva is a chancery italic, Lucida Calligraphy a slanted broad-pen hand (the free face is upright: slanted here)
  const MONO_STYLE = { 'Monotype Corsiva': { style: 'italic', weight: 600 }, 'Lucida Calligraphy': { skew: -0.2 }, 'Lucida Handwriting': { weight: 500 } };
  const monoFamily = m => MONO_FONT[((MONO.fonts.find(f => f.id === m.font) || {}).name)] || 'Tinos';
  const monoStyle = m => MONO_STYLE[((MONO.fonts.find(f => f.id === m.font) || {}).name)] || {};
  const monoFont = (m, px) => { const st = monoStyle(m); return `${st.style || ''} ${st.weight || ''} ${Math.round(px)}px "${monoFamily(m)}", serif`.trim(); };
  // Embroidery: the shape (letters or symbol) filled with the thread, in satin stitches (fine parallel thread lines across
  // the strokes), its edges raised (light on the upper-left edge, shade on the lower-right) and a soft shadow on the
  // cloth. Drawn at 3x and shrunk, so the stitches stay fine.
  function stitched(paintMask, w, h, rgb) {
    const S = 3, CW = Math.ceil(w * S) + 16, CH = Math.ceil(h * S) + 16;
    const mk = () => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return [c, c.getContext('2d')]; };
    const [M, mx] = mk(); mx.translate(CW / 2, CH / 2); mx.scale(S, S); mx.fillStyle = '#fff'; mx.strokeStyle = '#fff'; paintMask(mx);
    const [T, tx] = mk();
    tx.fillStyle = `rgb(${rgb})`; tx.fillRect(0, 0, CW, CH);
    tx.save(); tx.translate(CW / 2, CH / 2); tx.rotate(0.5);
    const R = CW + CH, P = Math.max(3, CH / 22);    // thread lines: fine, but visible at the size shown
    for (let x = -R; x < R; x += P) {
      tx.fillStyle = 'rgba(255,255,255,0.2)'; tx.fillRect(x, -R, P * 0.4, 2 * R);
      tx.fillStyle = 'rgba(0,0,0,0.24)'; tx.fillRect(x + P * 0.55, -R, P * 0.3, 2 * R);
    }
    tx.restore();
    tx.globalCompositeOperation = 'destination-in'; tx.drawImage(M, 0, 0);
    const [I, ix] = mk(); ix.fillStyle = '#fff'; ix.fillRect(0, 0, CW, CH); ix.globalCompositeOperation = 'destination-out'; ix.drawImage(M, 0, 0);
    const tint = col => { const [c, x] = mk(); x.drawImage(I, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, CW, CH); return c; };
    const Dk = tint('rgba(0,0,0,0.22)'), Lt = tint('rgba(255,255,255,0.2)');
    tx.globalCompositeOperation = 'source-atop';
    for (const k of [1, 2, 3, 4]) tx.drawImage(Dk, -k, -k);     // the outside, moved up-left, shades the letters' lower-right edges
    for (const k of [1, 2, 3]) tx.drawImage(Lt, k, k);          // and moved down-right, lights their upper-left edges
    return { c: T, w: CW / S, h: CH / S };
  }
  function drawStitched(m, rgb, cap, Z, maxW) {      // at the current origin (ctx already moved and turned)
    let st;
    if (m.type === 'word' && m.text) {
      const x = document.createElement('canvas').getContext('2d'); let px = cap / 0.7; x.font = monoFont(m, px);
      let tw = x.measureText(m.text).width; if (maxW && tw > maxW) { px *= maxW / tw; x.font = monoFont(m, px); tw = x.measureText(m.text).width; }
      const sk = monoStyle(m).skew || 0;
      st = stitched(c => { c.font = monoFont(m, px); c.textAlign = 'center'; c.textBaseline = 'middle'; if (sk) c.transform(1, 0, sk, 1, 0, 0); c.fillText(m.text, 0, 0); },
        tw + px * (0.4 + Math.abs(sk)), px * 1.5, rgb);
    } else if (m.type === 'gallery' && monoImgs[m.gal]) {
      const im = monoImgs[m.gal], h = cap, w = h * im.width / im.height, mask = monoTint(im, [255, 255, 255]);
      st = stitched(c => c.drawImage(mask, -w / 2, -h / 2, w, h), w + 4, h + 4, rgb);
    }
    if (!st) return;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 1.6 * Z; ctx.shadowOffsetX = 0.3 * Z; ctx.shadowOffsetY = 0.7 * Z;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(st.c, -st.w / 2, -st.h / 2, st.w, st.h); ctx.restore();
  }
  const monoImgs = {};
  async function monoReady() {                     // fonts and symbol pictures used by the monograms on the current view
    for (const m of state.monos) {
      const pos = MONO_POS[m.pos]; if (!pos || (pos[0] !== state.view && !(state.melton && pos[0] === 'melton'))) continue;
      if (m.type === 'word' && m.text) try { await document.fonts.load(monoFont(m, 40), m.text); } catch (e) { /* fallback font */ }
      if (m.type === 'gallery' && m.gal && !monoImgs[m.gal]) {
        const g = MONO.gallery.find(x => x.id === m.gal);
        if (g) try { monoImgs[m.gal] = await loadImg(`mono/${g.img}?v=${VER}`); } catch (e) { /* no picture */ }
      }
    }
  }
  function monoTint(img, rgb) {                    // the symbol's dark lines in the thread colour, the white card removed
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), D = d.data;
    for (let p = 0; p < D.length; p += 4) {
      const v = (D[p] + D[p + 1] + D[p + 2]) / 3; D[p + 3] = Math.max(0, Math.min(255, (225 - v) * 2.2));
      D[p] = rgb[0]; D[p + 1] = rgb[1]; D[p + 2] = rgb[2];
    }
    x.putImageData(d, 0, 0); return c;
  }
  function drawMonos(zx, zy, Z) {
    if (state.view === 'front' && closeName()) return;   // positions are for the full jacket, not the close-ups
    for (const m of state.monos) {
      const pos = MONO_POS[m.pos]; if (!pos || pos[0] !== state.view) continue;
      const t = m.colour && THREADS.find(x => x.id === m.colour);
      const rgb = t ? t.rgb : [200, 170, 90];        // no colour chosen yet: a gold thread so the position is visible
      const mm = parseFloat(((m.type === 'gallery' ? MONO.gHeights : MONO.heights).find(h => h.id === (m.type === 'gallery' ? m.gheight : m.height)) || {}).name) || (m.type === 'gallery' ? 20 : 10);
      const capPx = mm / 10 * PX_PER_CM * Z, x = (pos[1] - zx) * Z, y = (pos[2] - zy) * Z;
      ctx.save(); ctx.translate(x, y); ctx.rotate(pos[3] * Math.PI / 180);
      drawStitched(m, rgb, capPx, Z);
      ctx.restore();
    }
  }
  function showMono() {                            // after a monogram choice: go to its position, close up
    const m = cm(), pos = m && MONO_POS[m.pos]; state.melton = !!pos && pos[0] === 'melton';
    if (!pos) { render(); return; }
    if (state.melton) {                              // under the collar: the back view with the collar turned up, drawn close
      state.view = 'back'; state.zoom = null; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === 'back')); render(); return;
    }
    state.view = pos[0]; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === pos[0]));
    state.zoom = zoomBox(pos[1], pos[2], 2.2); render();
  }

  // Positions on the under collar: the melton is only seen with the collar turned up, so draw that part close up
  // (the middle ~24 cm of the collar, about 42 px per cm): the felt piece, its roll line, and the monogram in the stand.
  function clothRGB() {
    const px = state.fabric && tilePx[state.fabric.id]; if (!px) return [60, 62, 72];
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 64) { r += LIN[px[i]]; g += LIN[px[i + 1]]; b += LIN[px[i + 2]]; n++; }
    return [r, g, b].map(v => Math.round(255 * Math.pow(v / n, 1 / 2.2)));
  }
  function drawMelton() {
    const k = W / 24, cloth = clothRGB(), uc = state.undercollar && CONTRAST.find(c => c.id === state.undercollar);
    const mel = uc ? uc.rgb : cloth.map(v => Math.round(v * 0.88 + 22));     // no contrast melton: one matched to the cloth (felt reads a touch lighter)
    const seamY = x => 980 - 0.00016 * (x - W / 2) ** 2, topY = x => 560 - 0.00005 * (x - W / 2) ** 2, foldY = x => seamY(x) - 3 * k;
    ctx.save();
    ctx.fillStyle = '#f3f0ea'; ctx.fillRect(0, 0, W, H);
    const path = (f, g) => { ctx.beginPath(); ctx.moveTo(0, f(0)); for (let x = 16; x <= W; x += 16) ctx.lineTo(x, f(x)); for (let x = W; x >= 0; x -= 16) ctx.lineTo(x, g(x)); ctx.closePath(); };
    path(seamY, () => H); ctx.fillStyle = `rgb(${cloth.map(v => Math.round(v * 0.7))})`; ctx.fill();   // the back of the jacket, in the collar's shadow
    const sh = ctx.createLinearGradient(0, 940, 0, 1300); sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh; ctx.fill();
    path(topY, seamY); ctx.fillStyle = `rgb(${mel})`; ctx.fill();                                  // the melton
    const lt = ctx.createLinearGradient(0, 560, 0, 980); lt.addColorStop(0, 'rgba(0,0,0,0.25)'); lt.addColorStop(0.55, 'rgba(255,255,255,0.06)'); lt.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = lt; ctx.fill();
    const img = ctx.getImageData(0, 0, W, H), D = img.data;                                        // felt: a fine, soft grain
    for (let y = 400; y < 1000; y++) for (let x = 0; x < W; x++) {
      if (y < topY(x) || y > seamY(x)) continue;
      const p = (y * W + x) * 4, n = (Math.random() - 0.5) * 22 + ((x * 7 + y * 13) % 5 - 2);
      const lift = (y - topY(x)) < 40 ? -18 * (1 - (y - topY(x)) / 40) : 0;                   // the collar's top edge rolls away
      D[p] = Math.max(0, Math.min(255, D[p] + n + lift)); D[p + 1] = Math.max(0, Math.min(255, D[p + 1] + n + lift)); D[p + 2] = Math.max(0, Math.min(255, D[p + 2] + n + lift));
    }
    ctx.putImageData(img, 0, 0);
    ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.35)';  // the roll line (where the collar folds)
    ctx.beginPath(); ctx.moveTo(0, foldY(0)); for (let x = 16; x <= W; x += 16) ctx.lineTo(x, foldY(x)); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.35)';                // the zigzag stitch onto the jacket
    ctx.beginPath(); for (let x = 0, u = 0; x <= W; x += 9, u ^= 1) { const y = seamY(x) - 10 - u * 9; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    for (const m of state.monos) {                                                                 // the letters, centred in the stand
      const pos = MONO_POS[m.pos]; if (!pos || pos[0] !== 'melton') continue;
      const t = m.colour && THREADS.find(x => x.id === m.colour), rgb = t ? t.rgb : [200, 170, 90];
      const mm = parseFloat(((m.type === 'gallery' ? MONO.gHeights : MONO.heights).find(h => h.id === (m.type === 'gallery' ? m.gheight : m.height)) || {}).name) || (m.type === 'gallery' ? 20 : 10);
      const cap = mm / 10 * k, x = W / 2, y = seamY(x) - 1.5 * k;
      ctx.save(); ctx.translate(x, y); drawStitched(m, rgb, cap, 2.5, W * 0.9); ctx.restore();
    }
    ctx.shadowColor = 'transparent'; ctx.font = '600 38px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#333';
    ctx.fillText('Melton collar (collar turned up)', W / 2, 300);
    ctx.font = '32px system-ui, sans-serif'; ctx.fillStyle = '#666';
    ctx.fillText(uc ? `Melton: ${contrastName(uc.id)}` : 'Melton matched to your cloth', W / 2, 350);
    ctx.fillText('Collar edge', W / 2, topY(W / 2) - 20);
    ctx.restore();
  }

  // ---------- lining on the open-jacket view ----------
  // The photo's grey lining keeps its folds and pocket welts (shading); its colour becomes the chosen lining.
  // Plain linings are one colour; printed ones repeat their swatch photo (made seamless at build time, LIN_CM wide).
  const LIN_CM = 14, linTex = {};
  async function loadLinTex(l, Z) {
    const key = l.id + '@' + Z;
    if (linTex[key]) return linTex[key];
    const im = await loadImg(`linings_tile/${l.id}.jpg?v=${VER}`);
    const w = Math.max(8, Math.round(LIN_CM * PX_PER_CM * Z)), h = Math.max(8, Math.round(w * im.height / im.width));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data, T = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { T[j] = LIN[px[i]]; T[j + 1] = LIN[px[i + 1]]; T[j + 2] = LIN[px[i + 2]]; }
    return (linTex[key] = { T, w, h });
  }
  function liningColour() {                        // flat linear colour, or null when the lining is printed
    const l = state.lining && LININGS.find(x => x.id === state.lining);
    if (l) return null;                            // every lining shows its own photo (weave, jacquard, stripes, prints)
    const T = state.tile && state.tile.T; if (!T) return [0.2, 0.2, 0.22];
    const m = [0, 0, 0]; for (let i = 0; i < T.length; i += 3) { m[0] += T[i]; m[1] += T[i + 1]; m[2] += T[i + 2]; }
    return m.map(v => Math.min(1, v / (T.length / 3) * 1.6));    // tone on tone: a lighter shade of the cloth
  }
  // Facing (the cloth band inside the front edge): the photos show facing 4 (straight). Other facings take more of
  // the inside in cloth, following the factory's sketches; width added to the photo's facing, in cm, by height
  // (p = the inner breast pocket's height, top = the lining's top, hem = its bottom).
  const FACING = {
    A: (y, p, top, hem) => y < p ? 7 : y < p + 200 ? 7 * (1 - (y - p) / 200) ** 2 : 0,                     // facing 5: curves out to the armhole
    C: (y, p) => Math.max(0, 3.6 * (1 - Math.abs(y - p) / 95)),                                            // sword: a point round the pocket
    DGG: (y, p, top, hem) => y < p + 40 ? 13 : y < p + 260 ? 13 * (1 - (y - p - 40) / 220) : 0,           // facing 9: the upper front in cloth
    E: () => 1.5,                                                                                          // facing 2: a wider straight facing
    US66: (y, p) => Math.abs(y - p) < 28 ? 1 : 4.5                                                         // facing 7: wide, the lining round the pocket
  };
  function facingMask(st) {
    const code = state.opts.facing || 'B', f = FACING[code]; if (!f || !st.LN) return null;
    st.facing = st.facing || {}; if (st.facing[code]) return st.facing[code];
    const L = st.LN, M = new Uint8Array(W * H), pk = INNER_PK[st.name] || INNER_PK._;
    for (const side of [0, 1]) {
      let top = -1, hem = -1;
      for (let y = 0; y < H; y++) for (let x = side ? 512 : 0; x < (side ? W : 512); x += 3) if (L[(y * W + x) * 4 + 3] > 128) { if (top < 0) top = y; hem = y; break; }
      if (top < 0) continue;
      for (let y = top; y <= hem; y++) {
        const add = f(y, pk[side][1], top, hem) * PX_PER_CM; if (add < 0.5) continue;
        let xe = -1;                                 // the lining's outer edge in this row (towards the front edge)
        if (!side) { for (let x = 0; x < 512; x++) if (L[(y * W + x) * 4 + 3] > 128) { xe = x; break; } }
        else { for (let x = W - 1; x >= 512; x--) if (L[(y * W + x) * 4 + 3] > 128) { xe = x; break; } }
        if (xe < 0) continue;
        for (let k = 0; k < add + 3; k++) {
          const x = side ? xe - k : xe + k; if (x < 0 || x >= W) break;
          const i = y * W + x; if (L[i * 4 + 3] < 30) continue;
          M[i] = k < add ? 1 : 2;                    // 1 = cloth now, 2 = the seam where the lining starts
        }
      }
    }
    return (st.facing[code] = M);
  }
  function liningPass(st, O, zx, zy, Z, tile) {
    const L = st.LN, flat = liningColour(), tex = flat ? null : linTex[state.lining + '@' + Z];
    if (!flat && !tex) return;                     // printed swatch still loading: render() loads it first
    const FM = facingMask(st), T = tile && tile.T, N = tile && tile.n;
    for (let oy = 0, p = 0; oy < H; oy++) {
      const my = Math.min(H - 1, (zy + oy / Z) | 0);
      for (let ox = 0; ox < W; ox++, p += 4) {
        const mx = Math.min(W - 1, (zx + ox / Z) | 0), q = (my * W + mx) * 4, a = L[q + 3] / 255;
        if (!a) continue;
        let sh = L[q] / 128;
        const fm = FM ? FM[my * W + mx] : 0;
        if (fm === 1 && T) {                        // facing: the cloth, in the lining's folds
          const u = Math.floor(zx * Z + ox) % N, v = Math.floor(zy * Z + oy) % N, k = (v * N + u) * 3;
          for (let ch = 0; ch < 3; ch++) { let lin = T[k + ch] * sh * 0.92; if (lin > 2) lin = 2; O[p + ch] = O[p + ch] * (1 - a) + TONE[(lin * OUTN) | 0] * a; }
          continue;
        }
        if (fm === 2) sh *= 0.55;                   // the facing seam
        let c = flat;
        if (!c) {                                   // straight repeat: the tile is seamless
          const u = Math.floor(zx * Z + ox) % tex.w, v = Math.floor(zy * Z + oy) % tex.h;
          const k = (v * tex.w + u) * 3; c = [tex.T[k], tex.T[k + 1], tex.T[k + 2]];
        }
        for (let ch = 0; ch < 3; ch++) {
          let lin = c[ch] * sh; if (lin > 1) lin = 1;
          O[p + ch] = O[p + ch] * (1 - a) + GAM[(lin * OUTN) | 0] * a;
        }
      }
    }
  }

  // ---------- buttons on the jacket ----------
  // The photo's own buttons stay in the overlay (light, shadow, thread holes); their colour is moved to the
  // chosen button's colour. Buttons seen straight from the front are replaced by the real catalogue photo.
  const btnImgs = {};
  const btnByCode = id => BUTTONS.find(b => b.id === id) || SLEEVES.find(b => b.id === id);
  const trimCode = (kind, id) => STAFF && STAFF._trims && id ? STAFF._trims[kind][id] : null;
  const sleeveBtn = () => state.sleeveSame ? state.button : (state.sleeveButton || state.button);
  function threadRGB(key) { const t = state.thread[key]; return t ? (THREADS.find(x => x.id === t) || {}).rgb : null; }
  const threadName = id => `Colour ${parseInt(id.slice(1), 10)}`;
  function overlayFor(st) {
    const fb = state.button && btnByCode(state.button), sb = btnByCode(sleeveBtn());
    if (!fb && !sb) return st.ov;
    const key = (fb ? fb.id : '-') + '|' + (sb ? sb.id : '-');
    if (st.ovCache[key]) return st.ovCache[key];
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), img = x.createImageData(W, H), O = img.data, P = st.OVP, Lo = st.Lo;
    const body = new Uint8Array(W * H);             // 1 = pixel belongs to a button on the jacket body
    for (const [bx, by, r] of st.meta.body || []) {
      const R = r + 5;
      for (let y = Math.max(0, by - R); y <= Math.min(H - 1, by + R); y++)
        for (let x2 = Math.max(0, bx - R); x2 <= Math.min(W - 1, bx + R); x2++)
          if ((x2 - bx) ** 2 + (y - by) ** 2 <= R * R) body[y * W + x2] = 1;
    }
    for (let p = 0, i = 0; p < P.length; p += 4, i++) {
      const a = P[p + 3]; if (!a) continue;
      const b = body[i] ? fb : sb;
      if (!b) { O[p] = P[p]; O[p + 1] = P[p + 1]; O[p + 2] = P[p + 2]; O[p + 3] = a; continue; }
      const L = (0.299 * P[p] + 0.587 * P[p + 1] + 0.114 * P[p + 2]) / Lo;
      O[p] = Math.min(255, b.rgb[0] * L); O[p + 1] = Math.min(255, b.rgb[1] * L); O[p + 2] = Math.min(255, b.rgb[2] * L); O[p + 3] = a;
    }
    x.putImageData(img, 0, 0);
    return (st.ovCache[key] = c);
  }
  async function loadBtn(code) {
    const key = code + '|' + (state.thread.button || '');
    if (btnImgs[key]) return btnImgs[key];
    const im = await loadImg(`buttons/${code}.png?v=${VER}`);
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
    const t = threadRGB('button') || (btnByCode(code) || {}).rgb.map(v => v * 0.8);
    const d = x.getImageData(0, 0, c.width, c.height), D = d.data;
    for (let p = 0; p < D.length; p += 4) {        // the catalogue sews every button with white thread
      const mx = Math.max(D[p], D[p + 1], D[p + 2]), mn = Math.min(D[p], D[p + 1], D[p + 2]);
      if (D[p + 3] > 0 && mn > 170 && mx - mn < 40) { const k = mn / 255; D[p] = t[0] * k; D[p + 1] = t[1] * k; D[p + 2] = t[2] * k; }
    }
    x.putImageData(d, 0, 0);
    return (btnImgs[key] = c);
  }
  function drawDiscs(st, zx, zy, Z) {
    const img = state.button && btnImgs[state.button + '|' + (state.thread.button || '')];
    if (!img || !st.meta.frontal.length) return;
    for (const [bx, by, r] of st.meta.frontal) {
      const cx = (bx - zx) * Z, cy = (by - zy) * Z, R = r * Z * 0.97;
      if (cx < -R || cy < -R || cx > W + R || cy > H + R) continue;
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, cx - R, cy - R, 2 * R, 2 * R);
      const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.2, cx, cy, R);   // soft light like the photo
      g.addColorStop(0, 'rgba(255,255,255,0.06)'); g.addColorStop(0.75, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.restore();
    }
  }

  let ticket = 0;
  async function render() {
    const my = ++ticket, m = mapName();
    busy.hidden = false; busy.textContent = 'Updating…';
    const allNote = m.note ? m.note.all : '';
    $('#angleNote').hidden = !allNote; $('#angleNote').textContent = allNote;
    $$('.pic-note').forEach(e => e.remove());
    const stepNote = m.note && state.lastStep ? m.note.by(state.lastStep) : '';
    const ls = stepNote && document.querySelector(`#styleSteps [data-step="${state.lastStep}"]`);
    if (ls) ls.insertAdjacentHTML('beforeend', `<p class="pic-note">${esc(stepNote)}</p>`);
    try {
      const st = cuffView(await loadView(m.name, m.pk, m.ck, m.lw, m.tk));
      if (state.zoomAt === 'lapelhole') {             // the hole's place depends on the photo: zoom once it is loaded
        const g = lapelGeo(st), pos = state.opts.lapelHole || 'A'; state.zoomAt = null;
        if (g && g.L && g.R && (pos === 'D' || pos === 'E')) state.zoom = zoomBox((g.L.x + g.R.x) / 2, (g.L.y + g.R.y) / 2 + 80, 1.6);   // both lapels
        else { const h = g && (pos === 'B' ? g.R || g.L : g.L || g.R); if (h) state.zoom = zoomBox(h.x - 20, h.y + 60, 2.2); }
      }
      if (!state.custom) {
        const f = state.fabric;
        state.tile = await loadTile(f);
        const sc = st.meta.scale || 1;                // close-up photos show the cloth magnified
        if (sc !== 1) state.tile = await loadTile(f, sc);
        if (state.zoom) state.ztile = await loadTile(f, state.zoom.z * sc);
      }
      if (state.button) await loadBtn(state.button);
      const lo = st.LN && state.lining && LININGS.find(x => x.id === state.lining);
      if (lo) await loadLinTex(lo, state.zoom ? state.zoom.z : 1);
      await monoReady();
      if (state.custom && state.zoom && state.ctileZ !== state.zoom.z) { state.ctile = linearTile(state.cup, 150 * state.zoom.z); state.ctileZ = state.zoom.z; }
      if (my !== ticket) return;                    // a newer choice arrived while loading
      if (state.zoom) busy.textContent = 'Zooming in…';
      requestAnimationFrame(() => setTimeout(() => {
        if (state.zoom) drawZoom(st, state.custom ? state.ctile : state.ztile, state.zoom.zx, state.zoom.zy, state.zoom.z); else draw(st);
        if (state.diagram && state.view === 'front' && !state.zoom) drawConstruction(st, state.diagram);
        paintMini();                                  // the small copy shows exactly what the big picture shows, zoom included
        if (state.melton && state.view === 'back' && !state.zoom) { drawMelton(); paintMini(); }
        $('#stage').classList.toggle('zoom', !!state.zoom);
        $('#zoomHint').textContent = state.zoom ? 'Tap again to zoom out' : 'Tap the jacket to zoom into the cloth';
        if (my === ticket) busy.hidden = true;
      }, 0));
    } catch (e) {
      busy.textContent = 'Could not load the preview. Please refresh the page.';
    }
    paintChosen(); paintSummary();
  }

  // ---------- catalogue ----------
  function clothOf(f) {
    const c = f.composition.toLowerCase();
    if (!c) return 'unknown';
    if (/^100% wool$/.test(c)) return 'wool';
    if (c.includes('cashmere')) return 'cashmere';
    if (c.includes('silk') && c.includes('wool')) return 'silk';
    const w = c.match(/([\d.]+)% wool/);
    return w && parseFloat(w[1]) >= 50 ? 'blend' : 'other';
  }
  function weightOf(f) { return !f.weight ? 'unknown' : f.weight < 270 ? 'light' : f.weight <= 320 ? 'mid' : 'heavy'; }
  const num = f => f.id.replace('MB-', '');

  const filt = { q: '', colours: new Set(), pattern: '', cloth: '', weight: '', use: '', season: '', italy: false };
  function matches(f) {
    if (filt.colours.size && !filt.colours.has(f.colour)) return false;
    if (filt.pattern && f.pattern !== filt.pattern) return false;
    if (filt.cloth && f._cloth !== filt.cloth) return false;
    if (filt.weight && f._weight !== filt.weight) return false;
    if (filt.use && f.use !== filt.use) return false;
    if (filt.season && f.season !== filt.season) return false;
    if (filt.italy && !f.italian) return false;
    if (filt.q) {
      const s = STAFF && STAFF[f.id] ? ` ${STAFF[f.id].code} ${STAFF[f.id].band} ${STAFF[f.id].factory || ''}` : '';
      const hay = `${f.id} ${num(f)} ${f.name} ${f.colour} ${PATTERNS[f.pattern]} ${f.composition} ${f.use} ${SEASONS[f.season] || ''} ${f.italian ? 'italian italy' : ''}${s}`.toLowerCase();
      if (!filt.q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }
  function paintGrid() {
    const list = FABRICS.filter(matches);
    $('#count').textContent = `Showing ${list.length} of ${FABRICS.length} fabrics`;
    $('#grid').innerHTML = list.length ? list.map(f => {
      const s = STAFF && STAFF[f.id];
      return `<button type="button" class="fab${state.fabric && state.fabric.id === f.id && !state.custom ? ' on' : ''}" data-id="${f.id}">
        <img src="thumbs/${f.id}.jpg?v=${VER}" alt="" loading="lazy" width="160" height="160"><b>No. ${num(f)}</b><small>${esc(f.name)}</small>${s ? `<small class="code">${esc(s.code)}${s.band ? ` · ${esc(s.band)}` : ''}</small>` : ''}</button>`;
    }).join('') : '<p class="empty">No fabric matches these filters.</p>';
  }
  function paintChosen() {
    const el = $('#chosen');
    if (state.custom) { el.innerHTML = '<div><b>Your uploaded swatch</b><small>Only on this screen, not saved.</small></div>'; return; }
    const f = state.fabric; if (!f) return;
    const s = STAFF && STAFF[f.id];
    el.innerHTML = `<button type="button" class="sw-open" title="See the swatch photo"><img src="thumbs/${f.id}.jpg?v=${VER}" alt="Swatch"></button><div><b>No. ${num(f)} · ${esc(f.name)}${f.italian ? '<span class="tag">Italian cloth</span>' : ''}</b>
      <small>${f.composition ? esc(f.composition) : 'Composition to follow'}${f.weight ? ` · ${f.weight} g` : ''} · ${f.use === 'Blazer' ? 'Blazer cloth' : 'Suit cloth'} · ${SEASONS[f.season] || ''}</small>
      <button type="button" class="sw-link">See the real swatch photo</button>
      ${s ? `<small class="staffline">Factory code ${esc(s.code)} · ${s.band ? `Band ${esc(s.band)}` : (s.usd ? `Cost $${esc(s.usd)}/m (band not set yet)` : 'Band not set yet')}${s.origin ? ` · ${esc(s.origin)}` : ''} · ${esc(s.book || '')}</small>` : ''}</div>`;
  }
  function paintSummary() {
    const f = state.fabric, s = f && STAFF && STAFF[f.id];
    const rows = [
      ['Design', state.mode === 'online' ? 'Online' : state.mode === 'inperson' ? `In person${state.location ? ', ' + LOCS[state.location] : ''}` : 'Not chosen', ''],
      ['Building', { suit: 'Full suit (jacket now, trousers coming soon)', jacket: 'Jacket only', pants: 'Trousers only' }[state.build] || 'Jacket', ''],
      ['Fabric', state.custom ? 'Uploaded swatch' : `No. ${num(f)}, ${f.name}`, s && !state.custom ? `${s.code} · band ${s.band || 'not set yet'}` : ''],
      ['Cloth', state.custom ? '' : `${f.composition || 'Composition to follow'}${f.weight ? `, ${f.weight} g` : ''}`, '']
    ];
    let sec = '';
    for (const o of OPTS) {
      const c = choiceOf(o.id) || {};
      const so = STAFF && STAFF._opts ? STAFF._opts[o.id] : null;
      const code = so ? `${so.names[c.code] || c.code}${so.group ? ` · ${so.group} ${c.code}` : ''}` : '', val = c.label;
      if (o.section !== sec) { sec = o.section; rows.push([`<b>${sec}</b>`, '', '', true]); }
      rows.push([o.label, val, code]);
    }
    const bt = btnByCode(state.button), sbt = btnByCode(sleeveBtn()), ln = state.lining;
    const bc = trimCode('buttons', bt && bt.id), sc = trimCode('buttons', sbt && sbt.id);
    rows.push(['<b>Trims</b>', '', '', true]);
    rows.push(['Front buttons', bt ? `${MAT[bt.mat] || 'Button'}, No. ${parseInt(bt.id.slice(1), 10)}` : 'As pictured (to be chosen)', bc ? bc.code : '']);
    rows.push(['Sleeve buttons', state.sleeveSame ? 'Same as the front' : (sbt ? `${MAT[sbt.mat] || 'Button'}, No. ${parseInt(sbt.id.slice(1), 10)}` : 'As pictured'),
      sc ? (sc.sleeve || sc.code) : '']);
    const tn = k => state.thread[k] ? threadName(state.thread[k]) : 'Matching the cloth', tc = k => { const yz = trimCode('threads', state.thread[k]); return yz ? `${yz}${STAFF._mono && STAFF._mono.yz[yz] ? ' · ' + STAFF._mono.yz[yz] : ''}` : ''; };
    rows.push(['Button thread', tn('button'), tc('button')]);
    rows.push(['Lapel buttonhole', tn('lapel'), tc('lapel')]);
    const n = sleeveHoles(), sl = state.thread.sleeve.slice(0, n);
    if (STAFF) rows.push(['Front buttonholes', tn('front'), tc('front')]);
    if (STAFF) rows.push(['Sleeve buttonholes', sl.some(Boolean) ? Array.from({ length: n }, (_, i) => `${i + 1}: ${sl[i] ? threadName(sl[i]) + (trimCode('threads', sl[i]) ? ` (${trimCode('threads', sl[i])})` : '') : 'match'}`).join(', ') : 'Matching the cloth', '']);
    const lo = LININGS.find(l => l.id === ln);
    rows.push(['Body lining', lo ? `${lo.name || liningName(ln)}${lo.book ? '' : ' (reach out for availability)'}` : 'Matching (to be chosen)', trimCode('linings', ln) || '']);
    const sln = state.sleeveLinSame ? null : state.sleeveLining, slo = LININGS.find(l => l.id === sln);
    rows.push(['Sleeve lining', state.sleeveLinSame ? 'Same as the body' : (slo ? `${slo.name || liningName(sln)}${slo.book ? '' : ' (reach out for availability)'}` : 'Matching (to be chosen)'),
      sln ? trimCode('linings', sln) || '' : '']);
    const G = STAFF && STAFF._trims ? STAFF._trims.groups : null;
    if (STAFF) rows.push(['Undercollar', state.undercollar ? contrastName(state.undercollar) : 'Matching the cloth',
      G ? `${G.undercollar} ${state.undercollar ? trimCode('contrast', state.undercollar) : G.undercollarMatch}` : '']);
    if (STAFF) rows.push(['Elbow patches', state.elbow ? `${state.elbow === 'A' ? 'Round elbow patch' : 'Round sleeve patch'}, ${contrastName(state.elbowFabric)}` : 'None',
      G && state.elbow ? `${G.elbow} ${state.elbow} · ${G.elbowFabric} ${trimCode('contrast', state.elbowFabric)}` : '']);
    if (MONO) monoRows(rows);
    const ex = extrasList();
    if (ex.length) { rows.push(['<b>Extras</b>', '', '', true]); ex.forEach(([k, v]) => rows.push([k, `+$${v}`, ''])); rows.push(['Extras total', `+$${ex.reduce((a, x) => a + x[1], 0)}`, '']); }
    rows.push(['<b>Remarks</b>', '', '', true]);
    rows.push(['Remark', state.remark || 'None', '']);
    const nb = BODY.filter(([k]) => state.body[k]).length;
    rows.push(['Your photos (front, side, back)', nb === 3 ? 'All 3 added' : `${nb} of 3 added (required)`, '']);
    const np = state.photos.filter(Boolean).length; if (np) rows.push(['Other photos', `${np} added`, '']);
    if (STAFF) { rows.push(['Pre-fitting', state.prefit, '']); rows.push(['Urgent', (URGENT.find(u => u[0] === state.urgent) || [])[1], '']); }
    if (STAFF && STAFF._opts._hidden) {                 // every hidden factory option, so the order sheet is complete
      rows.push(['<b>Staff only</b>', '', '', true]);
      for (const h of STAFF._opts._hidden) {
        const v = state.hid[h.title] || h.default, oc = (h.options.find(x => x.name === v) || {}).code;
        rows.push([h.title, v ? (state.hid[h.title] ? v : `${v} (default)`) : 'Not set', h.group && oc ? `${h.group} ${oc}` : '']);
      }
    }
    $('#summary').innerHTML = rows.map(([k, v, code, head]) => head ? `<dt class="sum-h">${k}</dt><dd></dd>` :
      `<dt>${k}</dt><dd>${esc(v || '')}${STAFF && code ? ` <span class="code">${esc(code)}</span>` : ''}</dd>`).join('');
  }

  function setupFilters() {
    const used = [...new Set(FABRICS.map(f => f.colour))].sort((a, b) => Object.keys(COLOURS).indexOf(a) - Object.keys(COLOURS).indexOf(b));
    $('#colours').innerHTML = used.map(c => `<button type="button" class="chip" data-c="${c}"><i style="background:${COLOURS[c] || '#999'}"></i>${c[0].toUpperCase() + c.slice(1)}</button>`).join('');
    const pats = [...new Set(FABRICS.map(f => f.pattern))];
    $('#fPattern').insertAdjacentHTML('beforeend', Object.keys(PATTERNS).filter(p => pats.includes(p)).map(p => `<option value="${p}">${PATTERNS[p]}</option>`).join(''));
    const cloths = [...new Set(FABRICS.map(f => f._cloth))];
    $('#fCloth').insertAdjacentHTML('beforeend', Object.keys(CLOTH).filter(c => cloths.includes(c)).map(c => `<option value="${c}">${CLOTH[c]}</option>`).join(''));
    $('#colours').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c; filt.colours.has(c) ? filt.colours.delete(c) : filt.colours.add(c); b.classList.toggle('on'); paintGrid(); };
    $('#q').oninput = e => { filt.q = e.target.value.trim().toLowerCase(); paintGrid(); };
    $('#fPattern').onchange = e => { filt.pattern = e.target.value; paintGrid(); };
    $('#fCloth').onchange = e => { filt.cloth = e.target.value; paintGrid(); };
    $('#fWeight').onchange = e => { filt.weight = e.target.value; paintGrid(); };
    $('#fUse').onchange = e => { filt.use = e.target.value; paintGrid(); };
    $('#fSeason').onchange = e => { filt.season = e.target.value; paintGrid(); };
    $('#fItaly').onchange = e => { filt.italy = e.target.checked; paintGrid(); };
    $('#clear').onclick = () => {
      Object.assign(filt, { q: '', pattern: '', cloth: '', weight: '', use: '', season: '', italy: false }); filt.colours.clear();
      $('#q').value = ''; ['#fPattern', '#fCloth', '#fWeight', '#fUse', '#fSeason'].forEach(s => { $(s).value = ''; }); $('#fItaly').checked = false;
      $$('#colours .chip').forEach(b => b.classList.remove('on')); paintGrid();
    };
    $('#grid').onclick = e => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      state.fabric = FABRICS.find(f => f.id === b.dataset.id); state.custom = false; state.fabricPicked = true; paintSteps(); paintProgress(); goNext($('[data-next=fabric]'));
      store.set('mb_look', ''); paintSugg(); paintTips();
      $$('#grid .fab').forEach(x => x.classList.toggle('on', x === b)); render();
    };
  }

  // ---------- designer suggestions: ready-made looks + pairing tips ----------
  function paintSugg() {
    const box = $('#suggBox'); if (!box) return;
    const looks = SUGG && SUGG.looks ? SUGG.looks.filter(L => FABRICS.some(f => f.id === L.fabric)) : [];
    if (!looks.length) { box.hidden = true; return; }
    box.hidden = false;
    $('#suggRow').innerHTML = looks.map(L => {
      const b = BUTTONS.find(x => x.id === L.button), lo = LININGS.find(x => x.id === L.lining);
      const pair = [L.buttonLabel || (b ? `${MAT[b.mat] || 'Button'}` : ''), L.liningLabel || (lo ? (lo.name || liningName(lo.id)) : '')].filter(Boolean).join(' \u00b7 ');
      return `<button type="button" class="sugg-card${store.get('mb_look') === L.id ? ' on' : ''}" data-look="${L.id}" title="${esc(L.why || '')}">
        <img src="thumbs/${L.fabric}.jpg?v=${VER}" alt="" loading="lazy" width="160" height="160">
        <b>${esc(L.name)}</b><small>${esc(L['for'] || '')}</small><small class="pair">${esc(pair)}</small></button>`;
    }).join('');
  }
  function applyLook(L) {
    const f = FABRICS.find(x => x.id === L.fabric); if (!f) return;
    state.fabric = f; state.custom = false; state.fabricPicked = true;
    state.opts = Object.assign({}, state.opts, L.opts || {});      // the look's style on top of the customer's own choices
    state.button = L.button || null;
    state.sleeveSame = !L.sleeveButton; state.sleeveButton = L.sleeveButton || null;
    state.lining = L.lining || null;
    state.sleeveLinSame = !L.sleeveLining; state.sleeveLining = L.sleeveLining || null;
    state.zoom = null; state.zoomAt = null; state.view = 'front';
    $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === 'front'));
    store.set('mb_look', L.id);
    paintGrid(); paintStyle(); paintButtons(); paintThreads(); paintLinings(); paintTips(); paintSugg();
    state.reached = Math.max(state.reached, 1); paintSteps(); showTab('style'); render();
    const note = $('#lookNote');
    if (note) { note.innerHTML = `<b>${esc(L.name)}:</b> ${esc(L.why || '')} Set for you: the cloth${L.opts && (L.opts.front || L.opts.lapel) ? ', that style' : ''}, the buttons and the lining. Your thread colours, monogram and remarks stay as they were - and you can still change anything.`; note.hidden = false; }
    toast(`"${L.name}" is set - fabric, style, buttons and lining.`);
  }
  $('#suggRow') && ($('#suggRow').onclick = e => {
    const c = e.target.closest('[data-look]'); if (!c || !SUGG) return;
    const L = SUGG.looks.find(x => x.id === c.dataset.look); if (L) applyLook(L);
  });
  function tipsFor(f) {
    if (!SUGG || !f || !SUGG.tips) return null;
    for (const r of SUGG.tips) {
      const w = r.when || {};
      if (w.use && !w.use.includes(f.use)) continue;
      if (w.colour && !w.colour.includes(f.colour)) continue;
      if (w.pattern && !w.pattern.includes(f.pattern)) continue;
      return r;
    }
    return null;
  }
  function paintTips() {
    const r = state.custom ? null : tipsFor(state.fabric);
    const bt = $('#btnTip'), lt = $('#linTip');
    if (bt) { bt.hidden = !(r && r.buttons); if (r && r.buttons) bt.innerHTML = `<b>Designer tip for this cloth:</b> ${esc(r.buttons)}`; }
    if (lt) { lt.hidden = !(r && r.linings); if (r && r.linings) lt.innerHTML = `<b>Designer tip for this cloth:</b> ${esc(r.linings)}`; }
  }

  // ---------- style (factory options) ----------
  const optOf = id => OPTS.find(o => o.id === id);
  // extra charges (customer-facing): an option choice or a printed lining that costs more
  function optExtra(id, code) { const x = EXTRAS.opts && EXTRAS.opts[id]; return x && !x.free.includes(code) ? x.price : 0; }
  const linExtra = l => (l && l.kind === 'printed' && EXTRAS.lining && EXTRAS.lining.printed) || 0;
  function extrasList() {
    const out = [];
    for (const o of OPTS) { const c = choiceOf(o.id), e = c ? optExtra(o.id, c.code) : 0; if (e) out.push([`${o.label}: ${c.label}`, e]); }
    for (const [k, id] of [['Body lining', state.lining], ['Sleeve lining', state.sleeveLinSame ? null : state.sleeveLining]]) {
      const l = LININGS.find(x => x.id === id), e = linExtra(l); if (e) out.push([`${k}: printed`, e]);
    }
    return out;
  }
  function choiceOf(id) { const o = optOf(id); return o && o.choices.find(c => c.code === (state.opts[id] || o.default)); }
  const sleeveHoles = () => +((choiceOf('cuffButtons') || {}).code || 4) || 4;
  const STYLE_HINT = { vent: 'See it in the Back view.' };
  // every section is a row (current choice + its sketch) that opens into a grid of sketches, like the factory screen
  const skImg = (img, alt) => img ? `<img src="${img.includes('/') ? img : 'sketch/' + img}?v=${VER}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(''))">` : `<span class="sk-none">${esc(alt || '')}</span>`;
  function stepRow(attr, label, cur, list, hint) {
    const c = list.find(x => x.v === cur) || list[0];
    return `<div class="step" ${attr}><button type="button" class="step-head"><span class="step-thumb">${c && c.img ? skImg(c.img) : ''}</span>` +
      `<span class="step-txt"><b>${esc(label)}</b><small>${esc(c ? c.label : '')}</small></span><i class="step-arrow"></i></button>` +
      `<div class="sk-grid" hidden>${list.map(x => `<button type="button" class="sk${x.v === cur ? ' on' : ''}${x.img ? '' : ' txt'}" data-v="${esc(x.v)}">${x.img ? skImg(x.img) : ''}<span>${esc(x.label)}</span></button>`).join('')}</div>` +
      (hint ? `<p class="hint">${hint}</p>` : '') + '</div>';
  }
  function paintStyle() {
    let sec = '', html = '';
    for (const o of OPTS) {
      if (o.section !== sec) { sec = o.section; html += `<p class="sec-title">${esc(sec)}</p>`; }
      const list = o.show.map(code => o.choices.find(c => c.code === code)).filter(Boolean).map(c => ({ v: c.code, label: c.label + (optExtra(o.id, c.code) ? ` (+$${optExtra(o.id, c.code)})` : ''), img: c.img }));
      html += stepRow(`data-step="${o.id}"`, o.label, state.opts[o.id] || o.default, list, STYLE_HINT[o.id]);
    }
    $('#styleSteps').innerHTML = html;
    paintHidden();
  }
  // staff only: the factory options the order screen hides (shoulder pad, gorge, contrast, labels, inner pockets ...)
  function paintHidden() {
    const H = STAFF && STAFF._opts && STAFF._opts._hidden;
    $('#staffHidden').innerHTML = !H ? '' : H.map((h, i) => {
      const list = [{ v: '', label: h.default ? `Default: ${h.default}` : 'Not set', img: (h.options.find(o => o.name === h.default) || {}).img }]
        .concat(h.options.map(o => ({ v: o.name, label: o.name, img: o.img })));
      return stepRow(`data-hstep="${i}"`, h.title, state.hid[h.title] || '', list);
    }).join('');
  }
  // after each choice, bring the next part into view so the customer always knows where to go
  function goNext(el) { if (!el) return; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); }
  function nextAfter(st, sel) {
    const all = [...document.querySelectorAll(sel)], i = all.indexOf(st);
    return all[i + 1] || null;
  }
  function toggleStep(e) {
    const head = e.target.closest('.step-head'); if (!head) return false;
    const g = head.nextElementSibling, open = g.hidden;
    head.closest('.step').classList.toggle('open', open); g.hidden = !open; return true;
  }
  function closeStep(tile) {
    const st = tile.closest('.step'); st.classList.remove('open'); st.querySelector('.sk-grid').hidden = true;
  }
  $('#staffHidden').onclick = e => {
    if (toggleStep(e)) return;
    const b = e.target.closest('.sk'); if (!b) return;
    const h = STAFF._opts._hidden[+b.closest('[data-hstep]').dataset.hstep];
    const hi = +b.closest('[data-hstep]').dataset.hstep;
    if (b.dataset.v) state.hid[h.title] = b.dataset.v; else delete state.hid[h.title];
    paintHidden(); paintSummary();
    if (['Pen pocket', 'Inner ticket pocket', 'Columbia stitching/Piping'].includes(h.title)) showInside();   // inside details: open the jacket
    goNext(document.querySelector(`[data-hstep="${hi + 1}"]`) || $('[data-next=style]'));
  };
  const zoomBox = (x, y, z = ZOOM) => ({ zx: Math.max(0, Math.min(W - W / z, x - W / z / 2)), zy: Math.max(0, Math.min(H - H / z, y - H / z / 2)), z });
  // where each style choice shows on the jacket: [view, zoom x, zoom y, zoom] (no x = whole jacket).
  // Sleeve choices use the side view, where the cuff buttons lie flat to the camera.
  const SLEEVE = ['side', 530, 1255, 2];
  const SHOW = { front: ['front'], lapel: ['front', 512, 560, 1.5], lapelWidth: ['front', 512, 560, 1.5], lapelHoleStyle: ['front', 'lapelhole'],
    lapelHole: ['front', 'lapelhole'], collarBack: ['back', 512, 330, 2], chestPocket: ['front', 690, 610, 2.2], lowerPocket: ['front', 300, 1000, 2],
    ticket: ['front', 290, 960, 2.6], namecard: ['open', 512, 940, 1.7], vent: ['back', 512, 1220, 1.7], cuffButtons: SLEEVE, kissing: SLEEVE, sleeveHoleDir: SLEEVE,
    pick: ['front', 420, 560, 1.7], shoulder: ['front', 330, 520, 1.7], canvas: ['front'],
    facing: ['open'], liningStyle: ['open'], brandLabel: ['open', 512, 880, 1.7] };
  function showPart(id) {
    const s = SHOW[id]; if (!s) return;
    state.view = s[0]; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === s[0]));
    state.zoomAt = s[1] === 'lapelhole' ? 'lapelhole' : null;
    state.zoom = s.length > 2 ? zoomBox(s[1], s[2], s[3]) : null;
    state.closeup = (id === 'lapelHoleStyle' || id === 'pick') ? id : null;
    if (state.closeup && closeName()) {               // the close-up photo, centred on the buttonhole / the stitched lapel edge
      state.zoomAt = null; state.zoom = state.closeup === 'pick' ? zoomBox(760, 560, 1.5) : zoomBox(852, 424, 2.2);
    }
  }
  // construction: how much of the front is canvas (sewn in, floating) and how much is fused (glued interlining)
  const diagMask = {};
  function drawConstruction(st, kind) {
    const full = /full/i.test(kind), half = !full && /half/i.test(kind), CUT = 820;   // half canvas: chest and lapels, to about the waist
    const img = ctx.getImageData(0, 0, W, H), O = img.data;
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      if (!st.A[i] || x < 175 || x > 850 || st.OVP[i * 4 + 3]) continue;       // front panels only (not the sleeves), never the buttons
      const canvas = full || (half && y < CUT), c = canvas ? [26, 140, 145] : [214, 150, 40], a = st.A[i] * (((x + y) % 16) < 3 ? 0.7 : 0.32);
      const p = i * 4; O[p] = O[p] * (1 - a) + c[0] * a; O[p + 1] = O[p + 1] * (1 - a) + c[1] * a; O[p + 2] = O[p + 2] * (1 - a) + c[2] * a;
    }
    ctx.putImageData(img, 0, 0);
    const rows = full ? [['Canvas (sewn in): whole front', [26, 140, 145]]]
      : half ? [['Canvas (sewn in): chest, lapels', [26, 140, 145]], ['Fused (glued): below', [214, 150, 40]]] : [['Fused (glued): whole front', [214, 150, 40]]];
    ctx.save(); ctx.font = '600 40px system-ui, sans-serif';
    const bw = Math.min(W - 20, 40 + Math.max(...rows.map(r => ctx.measureText(r[0]).width)) + 70), bh = 28 + rows.length * 60;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect((W - bw) / 2, H - bh - 30, bw, bh);
    rows.forEach(([t, c], k) => {
      const y = H - bh - 30 + 22 + k * 60;
      ctx.fillStyle = `rgb(${c})`; ctx.fillRect((W - bw) / 2 + 20, y, 44, 40);
      ctx.fillStyle = '#222'; ctx.fillText(t, (W - bw) / 2 + 80, y + 33);
    });
    ctx.restore();
  }
  function setOpt(id, v) {
    state.opts[id] = v; state.melton = false; state.lastStep = id;
    state.diagram = id === 'canvas' ? (choiceOf('canvas') || {}).label || '' : null;
    if (id === 'cuffButtons') paintThreads();
    showPart(id); render();
  }
  $('#styleSteps').onclick = e => {
    if (toggleStep(e)) return;
    const b = e.target.closest('.sk'); if (!b) return;
    const st = b.closest('[data-step]'), id = st.dataset.step;
    st.querySelectorAll('.sk').forEach(x => x.classList.toggle('on', x === b));
    const o = optOf(id), c = o.choices.find(x => x.code === b.dataset.v);
    st.querySelector('.step-txt small').textContent = c ? c.label : '';
    st.querySelector('.step-thumb').innerHTML = c && c.img ? skImg(c.img) : '';
    closeStep(b);
    setOpt(id, b.dataset.v);
    goNext(nextAfter(document.querySelector(`[data-step="${id}"]`), '#styleSteps .step') || $('[data-next=style]'));
  };

  // show a part of the jacket close up (front view), e.g. the buttons right after choosing them
  function zoomTo(x, y) {
    state.view = 'front'; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === 'front'));
    state.zoom = zoomBox(x, y);
  }
  const FRONT_BTN = [500, 940], SLEEVE_BTN = [70, 1250];      // where the buttons sit on the front photos
  // phones: a small copy of the jacket follows the customer down the page while the big picture is out of view
  const onSummary = () => !!document.querySelector('.tabs button.on[data-tab=summary]');
  let stageOff = false;                           // the summary has the big picture on top: no floating copy there
  const updMini = () => { mini.hidden = !(stageOff && innerWidth <= 900 && !$('#designer').hidden && !onSummary()); };
  const mini = document.createElement('button'); mini.type = 'button'; mini.className = 'mini'; mini.hidden = true;
  mini.setAttribute('aria-label', 'Back to the jacket picture');
  const miniCv = document.createElement('canvas'); miniCv.width = 240; miniCv.height = 360; mini.appendChild(miniCv); document.body.appendChild(mini);
  // the small copy: shrunk in two steps with high-quality smoothing, so fine stripes and weaves keep the look of
  // the big picture (one coarse step makes them shimmer and look shinier or more stripy than they are)
  const miniTmp = document.createElement('canvas'); miniTmp.width = 480; miniTmp.height = 720;
  function paintMini() {
    const t = miniTmp.getContext('2d'), m = miniCv.getContext('2d');
    t.imageSmoothingEnabled = m.imageSmoothingEnabled = true; t.imageSmoothingQuality = m.imageSmoothingQuality = 'high';
    t.drawImage(cv, 0, 0, 480, 720); m.drawImage(miniTmp, 0, 0, 240, 360);
  }
  mini.onclick = () => $('#stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if ('IntersectionObserver' in window) new IntersectionObserver(es => {
    const off = !es[0].isIntersecting;
    stageOff = off; updMini();
  }, { threshold: 0.15 }).observe($('#stage'));

  // ---------- trims: buttons, thread colours, lining ----------
  const MAT = { Horn: 'Horn', Corozo: 'Corozo', Shell: 'Shell', Metal: 'Metal', Pes: 'Polyester', Bone: 'Bone', Wood: 'Wood', Fabric: 'Covered', '': 'Button' };
  let btnFilter = '', sleeveFilter = '';
  function btnTiles(list, cur) {
    return `<button type="button" class="fab${!cur ? ' on' : ''}" data-b=""><span class="ph round">Standard</span><b>As pictured</b></button>` +
      list.map(b => `<button type="button" class="fab${b.id === cur ? ' on' : ''}" data-b="${b.id}"><img src="buttons/${b.id}.png?v=${VER}" alt="" loading="lazy" width="96" height="96"><b>${esc(MAT[b.mat] || 'Button')}</b>${trimCode('buttons', b.id) ? `<small class="code">${esc(trimCode('buttons', b.id).code)}</small>` : ''}</button>`).join('');
  }
  const matChips = cur => ['<button type="button" class="chip' + (!cur ? ' on' : '') + '" data-m="">All</button>']
    .concat(Object.keys(MAT).filter(m => BUTTONS.some(b => b.mat === m))
      .map(m => `<button type="button" class="chip${cur === (m || '__other') ? ' on' : ''}" data-m="${m || '__other'}">${m ? MAT[m] : 'Other'}</button>`)).join('');
  const byMat = f => BUTTONS.filter(b => !f || (f === '__other' ? !b.mat : b.mat === f));
  function paintButtons() {
    $('#btnMat').innerHTML = matChips(btnFilter);
    $('#btnGrid').innerHTML = btnTiles(byMat(btnFilter), state.button);
    $$('#sleeveSeg button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'same') === state.sleeveSame));
    $('#sleeveBtnBox').hidden = state.sleeveSame;
    if (!state.sleeveSame) {
      $('#sleeveMat').innerHTML = matChips(sleeveFilter);
      $('#sleeveGrid').innerHTML = btnTiles(byMat(sleeveFilter), state.sleeveButton);
    }
  }
  $('#btnMat').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; btnFilter = b.dataset.m; paintButtons(); };
  $('#btnGrid').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; state.button = b.dataset.b || null; paintButtons(); if (state.button) zoomTo(...FRONT_BTN); render(); goNext($('#sleeveSeg')); };
  $('#sleeveGrid').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; state.sleeveButton = b.dataset.b || null; paintButtons(); if (state.sleeveButton) zoomTo(...SLEEVE_BTN); render(); goNext($('#hThreads')); };
  $('#sleeveSeg').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; state.sleeveSame = b.dataset.v === 'same';
    paintButtons(); paintSummary(); if (!state.sleeveSame) zoomTo(...SLEEVE_BTN); render(); };
  $('#sleeveMat').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; sleeveFilter = b.dataset.m; paintButtons(); };

  const rgbCss = c => `rgb(${c.join(',')})`;
  function palette(cur, key) {
    return `<div class="pal" data-t="${key}"><button type="button" class="match${!cur ? ' on' : ''}" data-c="">Match the cloth</button>` +
      THREADS.map(t => `<button type="button" data-c="${t.id}" title="${threadName(t.id)}${trimCode('threads', t.id) ? ' · ' + trimCode('threads', t.id) : ''}" style="background:${rgbCss(t.rgb)}" class="${t.id === cur ? 'on' : ''}"></button>`).join('') + '</div>';
  }
  function paintThreads() {
    const n = sleeveHoles(), sel = Math.min(state.holeSel, n);
    const dot = c => { const t = THREADS.find(x => x.id === c); return `<i style="background:${t ? rgbCss(t.rgb) : 'transparent'}"></i>`; };
    const holes = `<div class="sleeve-holes"><button type="button" data-h="0" class="${sel === 0 ? 'on' : ''}">All holes</button>` +
      Array.from({ length: n }, (_, i) => `<button type="button" data-h="${i + 1}" class="${sel === i + 1 ? 'on' : ''}">${dot(state.thread.sleeve[i])}Hole ${i + 1}</button>`).join('') + '</div>';
    const cur = sel ? state.thread.sleeve[sel - 1] : (state.thread.sleeve.slice(0, n).every(c => c === state.thread.sleeve[0]) ? state.thread.sleeve[0] : undefined);
    $('#threadRows').innerHTML =
      `<div class="thread-row"><b>Button thread</b>${palette(state.thread.button, 'button')}</div>` +
      `<div class="thread-row"><b>Lapel buttonhole</b>${palette(state.thread.lapel, 'lapel')}</div>` +
      (STAFF ? `<div class="thread-row adv"><b>Staff only: front buttonholes</b>${palette(state.thread.front, 'front')}</div>` +
      `<div class="thread-row adv"><b>Staff only: sleeve buttonholes</b><p class="hint">Pick a colour for all holes, or choose a hole first to give it its own colour.</p>${holes}${palette(cur, 'sleeve')}</div>` : '');
  }
  $('#threadRows').onclick = e => {
    const h = e.target.closest('[data-h]');
    if (h) { state.holeSel = +h.dataset.h; paintThreads(); return; }
    const c = e.target.closest('[data-c]'); if (!c) return;
    const key = c.closest('[data-t]').dataset.t, v = c.dataset.c || null;
    if (key === 'sleeve') {
      if (state.holeSel) state.thread.sleeve[state.holeSel - 1] = v;
      else state.thread.sleeve = Array.from({ length: 6 }, () => v);
    } else state.thread[key] = v;
    paintThreads();
    if (key === 'button') { zoomTo(...FRONT_BTN); render(); } else paintSummary();
    if (key === 'sleeve' && state.holeSel) return;            // picking hole by hole: stay here
    const rows = [...document.querySelectorAll('#threadRows .pal')].map(p => p.closest('.thread-row'));
    const i = rows.findIndex(r => r.querySelector(`[data-t="${key}"]`));
    goNext(rows[i + 1] || $('#hLining'));
  };
  const liningName = id => `Lining ${parseInt(id.slice(1), 10)}`;
  const LIN_GROUPS = [['Plain', l => l.book && (l.kind === 'plain' || l.kind === 'bemberg')], ['Printed', l => l.book && l.kind === 'printed'],
    ['Picture linings', l => l.book && l.kind === 'positional', 'One printed scene across the back. Only with double vents or no vent.'],
    ['Reach out for availability', l => !l.book, 'Not in our books. Please ask us before choosing one of these.']];
  function linTile(l, cur = state.lining) {
    const code = trimCode('linings', l.id);
    return `<button type="button" class="fab${l.id === cur ? ' on' : ''}" data-l="${l.id}"><img src="linings/${l.id}.jpg?v=${VER}" alt="" loading="lazy" width="150" height="105"><b>${l.name ? esc(l.name) : liningName(l.id)}</b>${linExtra(l) ? `<small>+$${linExtra(l)}</small>` : ''}${code ? `<small class="code">${esc(code)}</small>` : ''}</button>`;
  }
  function paintLinings() {
    $('#linGrid').innerHTML = `<button type="button" class="fab${!state.lining ? ' on' : ''}" data-l=""><span class="ph">Tone on tone</span><b>Matching</b><small>We choose a tone to suit the cloth</small></button>` +
      LIN_GROUPS.map(([title, test, hint]) => {
        const list = LININGS.filter(l => l.b !== false && test(l));
        return list.length ? `<p class="lin-h${hint && hint.startsWith('Not in') ? ' warn' : ''}">${esc(title)}</p>${hint ? `<p class="hint lin-hint">${esc(hint)}</p>` : ''}${list.map(l => linTile(l)).join('')}` : '';
      }).join('');
    $('#sleeveLinBox').hidden = state.sleeveLinSame;
    if (!state.sleeveLinSame) {
      const sl = LININGS.filter(l => l.s && l.kind !== 'positional');      // sleeve linings the factory offers; picture linings are cut for the back only
      $('#sleeveLinGrid').innerHTML = `<button type="button" class="fab${!state.sleeveLining ? ' on' : ''}" data-l=""><span class="ph">Tone on tone</span><b>Matching</b></button>` +
        sl.filter(l => l.book).map(l => linTile(l, state.sleeveLining)).join('') +
        (sl.some(l => !l.book) ? `<p class="lin-h warn">Reach out for availability</p>` + sl.filter(l => !l.book).map(l => linTile(l, state.sleeveLining)).join('') : '');
    }
  }
  $('#sleeveLinSame').onchange = e => { state.sleeveLinSame = e.target.checked; paintLinings(); paintSummary(); };
  $('#sleeveLinGrid').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; state.sleeveLining = b.dataset.l || null; paintLinings(); paintSummary(); goNext($('#hMono')); };
  function showInside() { state.view = 'open'; state.zoom = null; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === 'open')); render(); }
  $('#linGrid').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; state.lining = b.dataset.l || null; paintLinings(); paintSummary(); showInside(); goNext($('#sleeveLinSame').closest('label')); };

  // ---------- contrast fabrics (undercollar melton, elbow patch suede) ----------
  const contrastName = id => { const c = CONTRAST.find(x => x.id === id); if (!c) return '';
    if (c.name) return c.name;
    return `${c.kind === 'melton' ? 'Melton' : 'Suede'} ${CONTRAST.filter(x => x.kind === c.kind).indexOf(c) + 1}`; };
  function cTiles(kind, cur, none) {
    return (none ? `<button type="button" class="fab${!cur ? ' on' : ''}" data-c=""><span class="ph">Same cloth</span><b>${none}</b></button>` : '') +
      CONTRAST.filter(c => c.kind === kind).map(c => { const code = trimCode('contrast', c.id);
        return `<button type="button" class="fab${c.id === cur ? ' on' : ''}" data-c="${c.id}"><img src="contrast/${c.id}.jpg?v=${VER}" alt="" loading="lazy" width="150" height="105"><b>${contrastName(c.id)}</b>${code ? `<small class="code">${esc(code)}</small>` : ''}</button>`; }).join('');
  }
  function paintContrast() {
    $('#ucGrid').innerHTML = cTiles('melton', state.undercollar, 'Matching the cloth');
    $$('#elbowSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === state.elbow));
    $('#elbowGrid').hidden = !state.elbow;
    if (state.elbow) $('#elbowGrid').innerHTML = cTiles('suede', state.elbowFabric);
  }
  $('#ucGrid').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; state.undercollar = b.dataset.c || null; paintContrast(); paintSummary(); };
  $('#elbowSeg').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; state.elbow = b.dataset.v;
    state.view = 'side'; state.zoom = null; $$('#views button').forEach(x => x.classList.toggle('on', x.dataset.view === 'side')); render();
    if (state.elbow && !state.elbowFabric) state.elbowFabric = (CONTRAST.find(c => c.kind === 'suede') || {}).id || null;
    paintContrast(); paintSummary(); };
  $('#elbowGrid').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; state.elbowFabric = b.dataset.c; paintContrast(); paintSummary(); };

  // ---------- monogram (factory Monogram tab: letters, a gallery symbol, or the customer's own drawing; max 2 per jacket) ----------
  const MAX_MONO = 2;
  const newMono = () => ({ type: '', text: '', colour: null, font: null, pos: null, height: null, gal: null, gheight: null, drawing: '' });
  state.monos.push(newMono());
  const cm = () => state.monos[state.monoSel];
  function paintMonoTabs() {
    $('#monoTabs').innerHTML = state.monos.map((m, i) => `<button type="button" class="chip${i === state.monoSel ? ' on' : ''}" data-mi="${i}">Monogram ${i + 1}${i ? ' <span class="x" data-mx="' + i + '">&times;</span>' : ''}</button>`).join('') +
      (state.monos.length < MAX_MONO ? '<button type="button" class="chip" data-madd="1">+ Add a second monogram</button>' : '');
  }
  $('#monoTabs').onclick = e => {
    const x = e.target.closest('[data-mx]'); if (x) { state.monos.splice(+x.dataset.mx, 1); state.monoSel = 0; paintMono(); paintSummary(); return; }
    if (e.target.closest('[data-madd]')) { state.monos.push(newMono()); state.monoSel = state.monos.length - 1; paintMono(); paintSummary(); return; }
    const b = e.target.closest('[data-mi]'); if (b) { state.monoSel = +b.dataset.mi; paintMono(); }
  };
  function paintMono() {
    paintMonoTabs();
    const m = cm(), M = MONO;
    $$('#monoType button').forEach(b => b.classList.toggle('on', b.dataset.v === m.type));
    if (!m.type) { $('#monoBox').innerHTML = ''; return; }
    const row = (key, label, cur, list) => stepRow(`data-mstep="${key}"`, label, cur, list);
    let html = '';
    if (m.type === 'word') {
      html += `<label class="adv-row">Letters or text<input id="monoText" class="mono-text" maxlength="${M.maxText}" value="${esc(m.text)}" placeholder="e.g. J.D.R"></label><small id="monoCount">${m.text.length}/${M.maxText}</small>`;
      html += row('font', 'Font', m.font || '', [{ v: '', label: 'Choose a font' }].concat(M.fonts.map(f => ({ v: f.id, label: f.name, img: f.img && 'mono/' + f.img }))));
    }
    if (m.type === 'gallery') {
      html += row('gal', 'Symbol', m.gal || '', [{ v: '', label: 'Choose a symbol' }].concat(M.gallery.map(g => ({ v: g.id, label: g.name, img: g.img && 'mono/' + g.img }))));
    }
    if (m.type === 'drawing') {
      html += `<label class="upload">${m.drawing ? `Drawing added: ${esc(m.drawing)} (tap to change)` : 'Upload your drawing or logo'}<input type="file" accept="image/*" id="monoDraw"></label>`;
      html += `<p class="hint">We will contact you to confirm size and colours before ordering.</p>`;
    }
    if (m.type !== 'drawing') html += `<div class="thread-row"><b>Thread colour</b>${palette(m.colour, 'mono')}</div>`;
    html += row('pos', 'Position', m.pos || '', [{ v: '', label: 'Choose a position' }].concat(M.positions.map(p => ({ v: p.id, label: p.name, img: p.img && 'mono/' + p.img }))));
    const H = m.type === 'gallery' ? M.gHeights : M.heights;
    const hk = m.type === 'gallery' ? 'gheight' : 'height';
    html += row(hk, 'Height', m[hk] || '', [{ v: '', label: 'Standard' }].concat(H.map(h => ({ v: h.id, label: h.name, img: h.img && 'mono/' + h.img }))));
    $('#monoBox').innerHTML = html;
  }
  $('#monoType').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; cm().type = b.dataset.v; paintMono(); paintSummary(); };
  let monoT = 0;
  $('#monoBox').oninput = e => { if (e.target.id !== 'monoText') return; cm().text = e.target.value; $('#monoCount').textContent = `${cm().text.length}/${MONO.maxText}`; paintSummary();
    clearTimeout(monoT); monoT = setTimeout(() => { if (MONO_POS[cm().pos]) render(); }, 350); };
  $('#monoBox').onchange = e => { if (e.target.id !== 'monoDraw' || !e.target.files[0]) return; cm().drawing = e.target.files[0].name; paintMono(); paintSummary(); };
  $('#monoBox').onclick = e => {
    if (toggleStep(e)) return;
    const sk = e.target.closest('.sk');
    const parts = () => [...document.querySelectorAll('#monoBox [data-mstep], #monoBox .thread-row')];
    if (sk) { const k = sk.closest('[data-mstep]').dataset.mstep; cm()[k] = sk.dataset.v || null; paintMono(); paintSummary(); showMono();
      const ps = parts(), i = ps.findIndex(x => x.dataset.mstep === k); goNext(ps[i + 1] || $('[data-next=trims]')); return; }
    const c = e.target.closest('.pal [data-c]'); if (c) { cm().colour = c.dataset.c || null; paintMono(); paintSummary(); showMono();
      const ps = parts(), i = ps.findIndex(x => x.classList.contains('thread-row')); goNext(ps[i + 1]); return; }
  };
  function monoRows(rows) {
    const used = state.monos.filter(m => m.type);
    if (!used.length) { rows.push(['<b>Monogram</b>', '', '', true]); rows.push(['Monogram', 'None', '']); return; }
    used.forEach((m, i) => monoRow(rows, m, used.length > 1 ? `Monogram ${i + 1}` : 'Monogram'));
  }
  function monoRow(rows, m, title) {
    const M = MONO, S = STAFF && STAFF._mono;
    rows.push([`<b>${title}</b>`, '', '', true]);
    const pick = (list, id) => (list.find(x => x.id === id) || {}).name;
    if (m.type === 'word') {
      rows.push(['Monogram text', m.text || 'Not entered yet', '']);
      rows.push(['Font', pick(M.fonts, m.font) || 'To be chosen', S && m.font ? `${S.groups['Embroidery Font']} ${S.font[m.font]}` : '']);
    }
    if (m.type === 'gallery') rows.push(['Symbol', pick(M.gallery, m.gal) || 'To be chosen', S && m.gal ? 'Emb.gallery' : '']);
    if (m.type === 'drawing') rows.push(['Own drawing', m.drawing || 'Not uploaded yet', S ? 'Customers Drawings' : '']);
    if (m.type !== 'drawing') {
      const yz = m.colour && STAFF && STAFF._trims ? STAFF._trims.threads[m.colour] : '';
      rows.push(['Thread colour', m.colour ? threadName(m.colour) : 'To be chosen', S && m.colour ? `${yz} · ${S.groups['Embroidery Color']} ${S.colour[m.colour] || ''}` : '']);
    }
    rows.push(['Position', pick(M.positions, m.pos) || 'To be chosen', S && m.pos ? `${S.groups['Embroidery Position']} ${S.position[m.pos]}` : '']);
    const hid = m.type === 'gallery' ? m.gheight : m.height, H = m.type === 'gallery' ? M.gHeights : M.heights;
    rows.push(['Height', pick(H, hid) || 'Standard', S && hid ? `${S.groups['Embroidery Height']} ${hid}` : '']);
  }

  // ---------- remarks, photos, pre-fitting / urgent (factory "Remark" and "Pre-fitting / Urgent") ----------
  const PREFIT = ['No', 'Pre-fitting', 'Unfinished Semi-Made Fitting', 'Canvas Shell Sample (No Return)', 'Blank display sample (no return afterwards)'];
  const URGENT = [['normal', 'Normal (7 working days)'], ['urgent', 'Urgent (5 working days)']];
  const BODY = [['front', 'Front'], ['side', 'Side'], ['back', 'Back']];
  const bodyMissing = () => BODY.filter(([k]) => !state.body[k]).map(([, l]) => l.toLowerCase());
  function paintExtras() {
    $('#bodySlots').innerHTML = BODY.map(([k, l]) => `<label class="photo-slot${state.body[k] ? ' done' : ''}">${state.body[k] ? `<img src="${state.body[k].url}" alt="">` : `<span>+ ${l}</span>`}<b class="slot-cap">${l}</b><input type="file" accept="image/*" data-body="${k}"></label>`).join('');
    const miss = bodyMissing();
    $('#bodyMissing').textContent = miss.length ? `Still needed: ${miss.join(', ')} photo${miss.length > 1 ? 's' : ''}.` : '';
    $('#photoSlots').innerHTML = state.photos.map((p, i) => `<label class="photo-slot">${p ? `<img src="${p.url}" alt="">` : '<span>+ Photo</span>'}<input type="file" accept="image/*" data-ph="${i}"></label>`).join('');
    $('#prefitSeg').innerHTML = PREFIT.map(v => `<button type="button" data-v="${esc(v)}" class="${state.prefit === v ? 'on' : ''}">${esc(v)}</button>`).join('');
    $('#urgentSeg').innerHTML = URGENT.map(([v, l]) => `<button type="button" data-v="${v}" class="${state.urgent === v ? 'on' : ''}">${l}</button>`).join('');
  }
  $('#remark').oninput = e => { state.remark = e.target.value; $('#remarkCount').textContent = `${state.remark.length}/400`; paintSummary(); };
  $('#photoSlots').onchange = e => { const i = e.target.dataset.ph, f = e.target.files[0]; if (i == null || !f) return;
    if (state.photos[i]) URL.revokeObjectURL(state.photos[i].url);
    state.photos[i] = { name: f.name, url: URL.createObjectURL(f) }; paintExtras(); paintSummary(); };
  $('#bodySlots').onchange = e => { const k = e.target.dataset.body, f = e.target.files[0]; if (!k || !f) return;
    if (state.body[k]) URL.revokeObjectURL(state.body[k].url);
    state.body[k] = { name: f.name, url: URL.createObjectURL(f) }; paintExtras(); paintSummary(); };
  // sending the order (Phase 4) checks this first: no order without the three body photos
  window.magnoliaOrderReady = () => bodyMissing().length === 0;
  $('#prefitSeg').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; state.prefit = b.dataset.v; paintExtras(); paintSummary(); };
  $('#urgentSeg').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; state.urgent = b.dataset.v; paintExtras(); paintSummary(); };

  // ---------- welcome: home, how it works, in person / online, what are we building ----------
  const LOCS = { jerusalem: 'Jerusalem (Ramat Eshkol / Sanhedria)', lakewood: 'Lakewood, NJ' };
  function showWelcome(w) {
    $('#welcome').hidden = false; $('#designer').hidden = true; $('#restartBtn').hidden = true; busy.hidden = true;
    $$('.w-screen').forEach(x => { x.hidden = x.dataset.w !== w; });
    if (w === 'mode') { $$('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode)); $('#wLocs').hidden = state.mode !== 'inperson'; }
    if (w === 'build') {
      const from = state.mode === 'online' ? 395 : 445;
      $('[data-price=suit]').textContent = `From $${from}`;
      $('#wBuildNote').textContent = '';
    }
    window.scrollTo(0, 0);
  }
  function startDesigner() {
    $('#welcome').hidden = true; $('#designer').hidden = false; $('#restartBtn').hidden = false;
    store.set('mb_flow', JSON.stringify({ mode: state.mode, location: state.location, build: state.build }));
    paintProgress(); paintSummary(); render();
  }
  $('#welcome').onclick = e => {
    const go = e.target.closest('[data-go]'); if (go) return showWelcome(go.dataset.go);
    const m = e.target.closest('[data-mode]');
    if (m) { state.mode = m.dataset.mode; if (state.mode === 'online') { state.location = ''; return showWelcome('build'); } return showWelcome('mode'); }
    const l = e.target.closest('[data-loc]'); if (l) { state.location = l.dataset.loc; return showWelcome('build'); }
    const b = e.target.closest('[data-build]'); if (b && !b.disabled) { state.build = b.dataset.build; startDesigner(); }
  };
  $('#howBtn').onclick = () => showWelcome('how');
  $('#restartBtn').onclick = () => { if (confirm('Start over? Your choices on this screen will be cleared.')) { store.set('mb_flow', ''); location.reload(); } };

  // progress: where the customer is in the steps
  const STEP_PCT = { fabric: 0, style: 25, trims: 60, summary: 90 };
  function paintProgress() {
    const cur = ($('.tabs button.on') || {}).dataset ? $('.tabs button.on').dataset.tab : 'fabric';
    const i = STEPS_ORDER.indexOf(cur), names = { fabric: 'Fabric', style: 'Style', trims: 'Trims', summary: 'Review' };
    const pct = cur === 'fabric' && state.fabricPicked ? 10 : STEP_PCT[cur];
    $('#pgTxt').innerHTML = `Step ${i + 1} of ${STEPS_ORDER.length} &middot; <b>${names[cur]}</b>`;
    $('#pgPct').textContent = `${pct}%`; $('#pgBar').style.width = pct + '%';
  }

  // ---------- views / tabs ----------
  $('#views').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; state.view = b.dataset.view; state.closeup = null; state.zoom = null; state.melton = false; $$('#views button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  // steps in order: a customer cannot open Style before choosing a fabric, Trims before Style, and so on (staff can jump)
  const STEPS_ORDER = ['fabric', 'style', 'trims', 'summary'];
  function showTab(name) {
    const ln = $('#lookNote'); if (ln) ln.hidden = true;
    $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
    updMini();
    $$('.tab').forEach(p => { p.hidden = p.dataset.pane !== name; });
    $('.panel').scrollTop = 0; if (innerWidth <= 900) $('.tabs').scrollIntoView({ block: 'start' });
    paintProgress();
  }
  function paintSteps() {
    $$('.tabs button').forEach(b => b.classList.toggle('locked', !STAFF && STEPS_ORDER.indexOf(b.dataset.tab) > state.reached));
    const fb = $('[data-next=fabric]');
    fb.disabled = !state.fabricPicked && !STAFF;
    fb.nextElementSibling.textContent = fb.disabled ? 'Choose a fabric first (tap one of the swatches).' : '';
  }
  $$('.tabs button').forEach(b => b.onclick = () => {
    const i = STEPS_ORDER.indexOf(b.dataset.tab);
    if (!STAFF && i > state.reached) {
      const need = STEPS_ORDER[state.reached];
      toast(`Please finish the ${need[0].toUpperCase() + need.slice(1)} step first, then tap Next.`); return;
    }
    showTab(b.dataset.tab);
  });
  $$('.next-btn').forEach(b => b.onclick = () => {
    const i = STEPS_ORDER.indexOf(b.dataset.next);
    if (b.disabled) return;
    state.reached = Math.max(state.reached, i + 1); paintSteps(); showTab(STEPS_ORDER[i + 1]);
  });
  let toastT;
  function toast(msg) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function openSwatch() {
    const f = state.fabric; if (!f || state.custom) return;
    $('#swImg').src = `swatch/${f.id}.jpg?v=${VER}`;
    $('#swCap').textContent = `No. ${num(f)} · ${f.name}. Actual swatch photo, about 5 × 5 cm of cloth.`;
    $('#swModal').hidden = false;
  }
  $('#chosen').onclick = e => { if (e.target.closest('.sw-open, .sw-link')) openSwatch(); };
  $('#swClose').onclick = () => { $('#swModal').hidden = true; };
  $('#swModal').onclick = e => { if (e.target.id === 'swModal') $('#swModal').hidden = true; };
  $('#stage').onclick = e => {
    if (e.target !== cv) return;
    if (state.melton) { state.melton = false; render(); return; }
    if (state.zoom) { state.zoom = null; render(); return; }
    const r = cv.getBoundingClientRect();
    const bx = (e.clientX - r.left) / r.width * W, by = (e.clientY - r.top) / r.height * H;
    state.zoom = zoomBox(bx, by, 5);                 // tap: close enough to see the weave
    render();
  };

  // ---------- staff view (codes are encrypted in the published files) ----------
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function unlock(pw) {
    const box = await (await fetch('staff.enc', { cache: 'no-store' })).json();
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(box.salt), iterations: box.iter, hash: 'SHA-256' },
      await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function staffOn(data, pw) {
    STAFF = data; store.set('mb_staff', pw);
    $('#staffBadge').hidden = false; $('#staffBtn').textContent = 'Exit staff';
    $$('.staff-only').forEach(x => { x.hidden = false; });
    $('#q').placeholder = 'Search by number, colour, cloth or factory code';
    paintGrid(); paintChosen(); paintSummary(); paintButtons(); paintLinings(); paintThreads(); paintStyle(); paintContrast(); paintMono(); paintSteps();
  }
  function staffOff() {
    STAFF = null; store.set('mb_staff', '');
    $('#staffBadge').hidden = true; $('#staffBtn').textContent = 'Staff';
    $$('.staff-only').forEach(x => { x.hidden = true; });
    $('#q').placeholder = 'Search by number, colour or cloth (e.g. 1042, navy, cashmere)';
    if (state.custom) { state.custom = false; render(); }
    paintGrid(); paintChosen(); paintSummary(); paintButtons(); paintLinings(); paintThreads(); paintStyle(); paintContrast(); paintMono(); paintSteps();
  }
  $('#staffBtn').onclick = () => { if (STAFF) return staffOff(); $('#pwErr').hidden = true; $('#modal').hidden = false; $('#pw').value = ''; $('#pw').focus(); };
  $('#pwCancel').onclick = () => { $('#modal').hidden = true; };
  $('#staffForm').onsubmit = async e => {
    e.preventDefault(); const pw = $('#pw').value;
    try { staffOn(await unlock(pw), pw); $('#modal').hidden = true; } catch (err) { $('#pwErr').hidden = false; }
  };

  $('#upload').onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = TILE;
      const x = c.getContext('2d', { willReadFrequently: true }), h = TILE / 2, sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      const quad = (fx, fy, dx, dy) => { x.save(); x.translate(dx + (fx < 0 ? h : 0), dy + (fy < 0 ? h : 0)); x.scale(fx, fy); x.drawImage(img, sx, sy, s, s, 0, 0, h, h); x.restore(); };
      quad(1, 1, 0, 0); quad(-1, 1, h, 0); quad(1, -1, 0, h); quad(-1, -1, h, h);
      const up = x.getImageData(0, 0, TILE, TILE).data;
      state.cup = up; state.tile = linearTile(up, 150); state.ctile = linearTile(up, 150 * ZOOM); state.ctileZ = ZOOM; state.custom = true;
      paintTips();
      $$('#grid .fab').forEach(b => b.classList.remove('on')); URL.revokeObjectURL(img.src); render();
    };
    img.src = URL.createObjectURL(file);
  };

  // ---------- start ----------
  (async function init() {
    try {
      const get = async n => (await fetch(`${n}?v=${VER}`)).json();
      try { PK = await get('maps/_pk/index.json'); } catch (e) { PK = {}; }
      try { PKC = await get('maps/_pk/chest.json'); } catch (e) { PKC = {}; }
      [FABRICS, OPTS, BUTTONS, SLEEVES, LININGS, THREADS, CONTRAST, MONO] = await Promise.all(['fabrics.json', 'options.json', 'buttons.json', 'sleeve_buttons.json', 'linings.json', 'threads.json', 'contrast.json', 'monogram.json'].map(get));
      try { SUGG = await get('suggestions.json'); } catch (e) { SUGG = null; }
      try { EXTRAS = await get('extras.json'); } catch (e) { /* no extra charges listed */ }
    } catch (e) { busy.textContent = 'Could not load the fabrics. Please refresh the page.'; return; }
    FABRICS.forEach(f => { f._cloth = clothOf(f); f._weight = weightOf(f); });
    state.fabric = FABRICS.find(f => f.colour === 'navy' && f.pattern === 'solid' && f.use === 'Suit' && f.composition === '100% wool') || FABRICS[0];
    setupFilters(); paintGrid(); paintStyle(); paintButtons(); paintThreads(); paintLinings(); paintContrast(); paintMono(); paintExtras(); paintSteps(); paintSugg(); paintTips();
    let flow = null; try { flow = JSON.parse(store.get('mb_flow') || 'null'); } catch (e) { flow = null; }
    if (flow && flow.build) { Object.assign(state, flow); startDesigner(); } else showWelcome('home');
    const pw = store.get('mb_staff');
    if (pw) { try { staffOn(await unlock(pw), pw); } catch (e) { store.set('mb_staff', ''); } }
  })();
})();
