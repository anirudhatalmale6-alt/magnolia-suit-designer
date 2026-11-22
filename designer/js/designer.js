(function () {
  const W = 1024, H = 1536, TILE = 512, VER = '56';      // bump VER when tiles/maps/data change (defeats browser cache)
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
  // very dark cloths (black, the darkest navies and charcoals): a neutral sheen that follows the photo's light, as real
  // cloth reflects some light whatever its colour, so lapels, pockets, flaps and seams stay visible (owner, 17 Nov)
  function sheenOf(tile) {                        // per channel, in the cloth's own hue (a navy stays navy)
    if (tile.sheen) return tile.sheen;
    const L = tile.L || 0, k = L >= 0.008 ? 0 : 0.0045 * Math.min(1, (0.008 - L) / 0.006), T = tile.T, m = [0, 0, 0];
    if (!k) return (tile.sheen = [0, 0, 0]);
    for (let o = 0; o < T.length; o += 3) { m[0] += T[o]; m[1] += T[o + 1]; m[2] += T[o + 2]; }
    const avg = (m[0] + m[1] + m[2]) / 3 || 1;
    return (tile.sheen = m.map(c => k * Math.max(0.6, Math.min(1.6, c / avg))));
  }
  function shadeLut(tile) {
    const L = tile.L || 0, g = 1 - 0.38 * Math.max(0, Math.min(1, (L - 0.08) / 0.4)), key = g.toFixed(3);
    if (shLuts[key]) return shLuts[key];
    const t = new Float32Array(1025); for (let j = 0; j <= 1024; j++) t[j] = Math.pow(j / 256, g);
    return (shLuts[key] = t);
  }
  const COLOURS = { navy: '#1f2a44', black: '#111', charcoal: '#3b3d42', grey: '#7d7f84', 'light grey': '#c4c5c8', blue: '#3c5a8a',
    brown: '#5a3f2c', tan: '#b49a7e', burgundy: '#5c1f2a', red: '#c4545e', green: '#4f5e52', cream: '#ece6da' };
  const SEASONS = { '26FW': 'Autumn / Winter', '26SS': 'Spring / Summer', Yikabol: 'Yikabol' };
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
  const PV_ICONS = [0, 1].map(d => '<span class="pv-i" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="4.3"/><path d="M9.8 9.8 14 14"/></svg>' +
    (d ? '<svg viewBox="0 0 16 16"><path class="f" d="M5 3.2v9.6L12.6 8z"/></svg>' : '') + '</span>');   // phones: magnifier = close-up, play = draped video
  // the "from" prices on the start screens and the summary: change them here only (owner's figures: in person $445,
  // online $395, bekeshe $450 with the belt included)
  const START_PRICE = { inperson: 445, online: 395, bekeshe: 450 };
  let compact = false;                             // phones: the sticky picture in its smaller size (stageCompact)
  let PREV = {};                                   // fabric code -> its preview files (previews.json)
  const PVB = window.MAGNOLIA_PREVIEW_BASE || 'previews/';   // where the preview files are served (set in index.html)
  let FABRICS = [], JF = [], BKF = [], JOPTS = [], STAFF = null, OPTS = [], BUTTONS = [], SLEEVES = [], LININGS = [], THREADS = [], CONTRAST = [], MONO = null, SUGG = null, EXTRAS = { opts: {}, lining: {} };

  const store = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
                  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // a picture that fails (a passing network or hosting hiccup) is asked for again, twice, before giving up
  const loadImg = (src, tries = 2) => new Promise((ok, bad) => {
    const i = new Image(); i.onload = () => ok(i);
    i.onerror = e => tries > 0 ? setTimeout(() => loadImg(src + (src.includes('?') ? '&' : '?') + 'r=' + tries, tries - 1).then(ok, bad), 800) : bad(e);
    i.src = src;
  });
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

  // ---------- bekeshe: its own cloths (Yikabol book) and choices; one front photo for now ----------
  const BK_OPTS = [
    { id: 'bkLapel', label: 'Lapel', section: 'Bekeshe', default: 'peak', show: ['peak', 'shawl'],
      choices: [{ code: 'peak', label: 'Peak', img: '27.jpg' }, { code: 'shawl', label: 'Shawl', img: '18.jpg' }] },
    { id: 'bkBelt', label: 'Belt', section: 'Bekeshe', default: 'none', show: ['none', 'belt'],
      choices: [{ code: 'none', label: 'Without belt' }, { code: 'belt', label: 'With belt (included)' }] }];
  const BK_SLEEVE = ['cuffButtons', 'kissing', 'sleeveHoleDir'];
  const isBk = () => state.build === 'bekeshe';
  function applyBuild() {                          // the garment decides the cloth list, the style choices and the views
    const bk = isBk();
    FABRICS = bk ? BKF : JF;
    OPTS = bk ? BK_OPTS.concat(JOPTS.filter(o => BK_SLEEVE.includes(o.id))) : JOPTS;
    if (!FABRICS.includes(state.fabric)) state.fabric = bk ? FABRICS[0] : (FABRICS.find(f => f.colour === 'navy' && f.pattern === 'solid' && f.use === 'Suit' && f.composition === '100% wool') || FABRICS[0]);
    if (bk) { for (const k of Object.keys(state.opts)) if (!OPTS.some(o => o.id === k)) delete state.opts[k]; state.monos = []; state.view = 'front'; state.zoom = null; }
    $$('#views button').forEach(b => { b.hidden = bk && b.dataset.view !== 'front'; b.classList.toggle('on', b.dataset.view === state.view); });
    document.body.classList.toggle('bk', bk);
    if (bk) { Object.assign(filt, { q: '', pattern: '', cloth: '', weight: '', use: '', season: '', italy: false }); filt.colours.clear(); }
    setupFilters(); paintGrid(); paintStyle(); paintSugg();
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
  const POCKET = { slant: 'G H I 9 10 23 25Y', hacking: 'O Q R 13 14 24', jet: 'D E F K L N P T U V Y SA', slantjet: 'J S',
    multipleat: 'S1', boxpleat: 'BE', roundpatch: '233 235 238 HMD M', slantpatch: '15', jettab: '2', patchflap: '18 234 237 DJ', patchtab: '5 6 7', pleat: '19 20 236' };
  const pocketLook = c => Object.keys(POCKET).find(k => POCKET[k].split(' ').includes(c)) || 'flap';
  const ticketLook = c => c === 'D' ? '' : 'F G H I J'.split(' ').includes(c) ? 'flap' : '25K 25Q EG YK'.split(' ').includes(c) ? 'card' : 'jet';
  const POCKET_FALLBACK = { jettab: 'jet', slantpatch: 'patch', roundpatch: 'patch', multipleat: 'patch', boxpleat: 'patch',  patchflap: 'patch', patchtab: 'patch', pleat: 'patch', slantjet: 'slant', hacking: 'slant' };   // views without that photo
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
      ['notch', '2', 'multipleat', '', 'front_n_multipleat'], ['notch', '2', 'boxpleat', '', 'front_n_boxpleat'],
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
  // the front closure each choice needs a photo of, per angle (26 = 5 hidden buttons: the 5-button photo, buttons hidden)
  const FRONT_KEY = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '4r3', 26: '27', 27: '27', Z998: '2', 8: 'db21', 9: 'db41', 10: 'db61',
    11: 'db4', 12: 'db', 13: 'db63' };
  // angles that have no photo of the chosen front are not offered: a different jacket is never shown
  function viewOk(v) {
    if (isBk() || !['three4', 'side'].includes(v) || !PHOTOS[v]) return true;
    const k = FRONT_KEY[state.opts.front || '2'] || '2';
    return PHOTOS[v].some(e => e[1] === k);
  }
  function paintViews() {
    $$('#views button').forEach(b => { const ok = viewOk(b.dataset.view); b.classList.toggle('na', !ok);
      b.title = ok ? '' : 'No photo of this front from this angle yet'; });
    // the cuff close-up names itself in the view row; the angle tabs stay available to go back to the jacket
    const cuff = $('#views [data-view="cuff"]'); if (cuff) cuff.hidden = !state.cuffPanel;
    const na = ['three4', 'side'].filter(v => !viewOk(v)).map(v => v === 'three4' ? 'Three-quarter' : 'Side');
    state.viewNote = na.length ? `${na.join(' and ')}: no photo of this front yet (not shown)` : '';
    $$('#views button').forEach(b => b.classList.toggle('on', state.cuffPanel ? b.dataset.view === 'cuff' : b.dataset.view === state.view));
  }
  const SIDE_WELT = new Set(['side_notch_sb1', 'side_notch_sb3', 'side_notch_sb3r2', 'side_notch_db', 'side_notch_db4', 'side_peak_sb1', 'side_peak_sb3',
    'side_peak_sb3r2', 'side_peak_db4', 'side_shawl_sb1', 'side_shawl_sb', 'side_shawl_sb3', 'side_shawl_sb3r2', 'side_shawl_db4', 'side_shawl_db']);
  const FRONTISH = ['front', 'three4', 'side'];
  const APPROX = [
    ['chestPocket', FRONTISH, { 233: 'the tulip-shaped chest pocket', 234: 'two chest pockets with flaps', BE: 'the angled box-pleat chest pocket',
      C1: 'the multi-pleated chest pocket' }],
    ['lowerPocket', FRONTISH, { 233: 'the tulip-shaped pockets', 235: 'the water-drop pockets', HMD: 'the water-drop pockets',
      236: 'the button on the pocket flaps', 237: 'the button on the pocket flaps', 19: 'the angled flaps with a button', DJ: 'the diagonal patch pockets',
      Y: 'this jetted pocket' }],
    ['lapel', FRONTISH, { 'HA279-118': 'the removable shawl lapel' }],
    ['shoulder', FRONTISH, { E: 'the shirt-head shoulder' }],
    ['vent', ['three4', 'side', 'open'], { D: 'the inner belt (shown in the Back view)', F: 'the belt (shown in the Back view)' }],
    ['front', ['front'], { 6: 'the 4 roll 3 front', 9: 'the 4-button double-breasted (1 to close)', 13: 'the 6-button double-breasted (3 to close)' }],
    ['collarBack', ['front', 'three4', 'side'], { B: 'the collar turned back at the end' }],
    ['facing', ['open'], { A: 'this facing shape', C: 'the sword-shaped facing', DGG: 'this facing shape', E: 'this facing shape',
      G: 'the half-lining facing', G03: 'the unlined facing', US66: 'this facing shape' }]];
  const SIZE_ONLY = { lowerPocket: ['A', 'C', '11', '12', '22'], chestPocket: ['A', 'C', 'D', 'E', 'F', 'J'], ticket: ['G', 'H', 'I', 'J'], namecard: ['E', 'F'],
    lapelHoleStyle: ['5', '7', 'Z', '18'] };
  function mapName() {
    if (isBk()) {                                   // one photo: peak lapel, no belt; the shawl, belt and sleeve photos follow
      const m = [];
      if (state.opts.bkLapel === 'shawl') m.push(['the shawl collar', 'bkLapel']);
      if (state.opts.bkBelt === 'belt') m.push(['the belt', 'bkBelt']);
      const t = step => { const x = m.filter(y => !step || y[1] === step).map(y => y[0]);
        return (x.length ? `Closest photo shown. Photo for ${x.join(' + ')} is coming. Your choice is saved for the order.` : '') +
          (BK_SLEEVE.includes(step) ? 'The sleeve photo is coming; your sleeve choice is saved for the order.' : ''); };
      return { name: 'bk_front', note: { all: t(null), by: t } };
    }
    const s = styleOf(), miss = [], hid = t => (state.hid[t] || '');
    // choices whose picture is the closest photo, not the exact style (checked choice by choice, 17 Nov): say so
    for (const [id, views, codes] of APPROX) {
      const c = state.opts[id]; if (c && codes[c] && views.includes(state.view)) miss.push([codes[c], [id]]);
    }
    const sizes = [];                              // choices that differ only in size: same picture, exact size on the order
    const seen = id => (id === 'namecard' ? ['open'] : FRONTISH).includes(state.view);   // only where that part can be seen
    for (const [id, codes] of Object.entries(SIZE_ONLY)) { const c = state.opts[id]; if (c && codes.includes(c) && seen(id)) sizes.push([((choiceOf(id) || {}).label || '').toLowerCase(), [id]]); }
    for (const id of ['lowerPocket', 'chestPocket', 'ticket']) {   // every pocket sized in cm: one picture per style, the size named
      const c = state.opts[id], o = OPTS.find(x => x.id === id); if (!c || !o || c === o.default || !seen(id)) continue;   // the standard size: no note
      const lab = ((choiceOf(id) || {}).label || ''); if (/\d\s?cm/i.test(lab) && !sizes.some(x => x[1][0] === id)) sizes.push([lab.toLowerCase(), [id]]);
    }
    // each note part names the steps it is about, so the note under a step only says what concerns that step
    const info = [];                                // plain remarks about what the picture can show
    const sayFor = (step) => {
      const m = miss.filter(x => !step || x[1].includes(step)).map(x => x[0]), z = sizes.filter(x => !step || x[1].includes(step)).map(x => x[0]),
        f = info.filter(x => !step || x[1].includes(step)).map(x => x[0]);
      return [m.length ? `Closest photo shown. Photo for ${m.join(' + ')} is coming. Your choice is saved for the order.` : '',
        z.length ? `The picture shows the style; the exact size (${z.join(', ')}) goes on the order.` : '', ...f].filter(Boolean).join(' ');
    };
    const say = () => ({ all: sayFor(null), by: sayFor });
    if ((state.opts.pick || 'A') !== 'A' && state.closeup !== 'pick' && FRONTISH.includes(state.view))
      info.push(['At this size every stitching style looks alike: your style shows in its close-up (open Pick stitching).', ['pick']]);
    if (state.opts.front === 'Z998' && FRONTISH.includes(state.view))   // the customer's buttons cannot be photographed in advance
      info.push(['Your own buttons: the picture shows standard buttons in their place; the buttons you bring are the ones sewn on.', ['front']]);
    const cl = state.view === 'front' && closeName();
    if (cl) { if (!cl.exact) miss.push(state.closeup === 'pick' ? ['this stitching', ['pick']] : ['this buttonhole style', ['lapelHoleStyle']]); return { name: cl.name, note: say() }; }
    if (state.view === 'back') {
      const v = state.opts.vent || 'C', turned = (state.opts.collarBack || 'A') === 'B';
      const name = v === 'A' ? 'back_none' : v === 'B' ? 'back_centre' : v === 'D' ? 'back_inner_belt' : v === 'F' ? 'back_fixed_belt' : turned ? 'back_collar' : 'back';
      if (turned && name !== 'back_collar') miss.push(['the collar turned back at the end with this vent', ['collarBack', 'vent']]);   // that photo has side vents
      return { name, note: say() };
    }
    if (state.view === 'open') {                    // inside photos: lining style first, then the inside details staff chose
      const ls = state.opts.liningStyle || 'A';
      let name = ls === 'C' ? 'open_unlined' : ls === 'B' ? 'open_half' : /piping/i.test(hid('Columbia stitching/Piping')) ? 'open_piping'
        : hid('Pen pocket') && hid('Pen pocket') !== 'None' ? 'open_pen' : hid('Inner ticket pocket') && hid('Inner ticket pocket') !== 'None' ? 'open_ticket' : '';
      const card = { A: 'open_card_l', B: 'open_card_r', C: 'open_card_both' }[state.opts.namecard || 'D'];
      if (!name && s.db) name = 'open_db';
      if (!name && card) name = card;
      if (!name) name = s.lapel === 'shawl' ? 'open_shawl' : s.lapel === 'peak' ? 'open_peak' : 'open_notch';
      if (['F'].includes(state.opts.facing)) miss.push(['the slanted inner pockets of this facing', ['facing']]);
      if (state.opts.facing === 'G' && ls === 'B' || state.opts.facing === 'G03' && ls === 'C') for (let k = miss.length - 1; k >= 0; k--) if (miss[k][1][0] === 'facing') miss.splice(k, 1);   // that photo shows this facing
      return { name, note: say() };
    }
    if (state.view === 'side' && state.elbow) {    // elbow patches: one side photo (notch, 2 buttons)
      if (s.lapel !== 'notch' || s.db || s.front !== '2') miss.push(['this front with elbow patches', ['front', 'lapel']]);
      if (state.elbow === 'B') miss.push(['the round sleeve patch shape', ['elbow']]);
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
        let sc = (l === want.lapel) * 100 + (f === want.front) * 60 + (f.startsWith('db') === want.front.startsWith('db')) * 50 + (f.startsWith('db') && want.front.startsWith('db')) * 20 + (p === want.pocket) * 10 + (p !== want.pocket && p === POCKET_FALLBACK[want.pocket]) * 6 + (t === want.ticket) * 3;
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
    // the lapel drawn at its exact width only on the marked front photos; elsewhere a narrow / standard / wide photo
    if (!lw && Math.abs(cmW - LAPEL_CM) > 0.2 && state.opts.lapelWidth) sizes.push([`${cmW} cm lapel width`, ['lapelWidth']]);
    // pockets the photo does not have: laid in from a pocket photo (closest style where this angle has none)
    let pk = null, ck = null;
    const V = PK[state.view], has = (p, t) => V && V.patches.some(x => x[0] === p && (t === undefined || x[1] === t));
    let wp = want.pocket, wt = want.ticket;
    if (!has(wp) && !(best.p === wp && !wt)) wp = POCKET_FALLBACK[wp] || wp;   // a photo that shows this pocket keeps it (no plain pocket laid over)
    if (wt === 'card' && !has(wp, 'card') && !V?.patches.some(x => x[1] === 'card')) wt = 'jet';
    const sx = s.db ? 14 : 0;                       // double-breasted: pockets further from the buttons
    if ((best.p !== wp || best.t !== wt || sx) && V) {
      const P = V.patches.find(x => x[0] === wp && x[1] === wt) || V.patches.find(x => x[0] === wp && best.p !== wp);
      const own = V.patches.find(x => x[0] === best.p && x[1] === best.t) || V.patches.find(x => x[0] === best.p);
      const Pw = P || (sx && V.patches.find(x => x[0] === wp && x[1] === wt));
      if (Pw) { pk = Pw[2] + (own ? '+' + own[2] : '') + (sx ? '@' + sx : ''); best.p = Pw[0]; best.t = Pw[1]; }
    }
    if (want.pocket === 'jettab' && best.p === 'jet' && (state.view === 'front' || state.view === 'three4')) best.p = 'jettab';   // the tab is drawn on
    // side views shot with a jetted pocket: the standard flap is drawn over the welt (build/side_welts.py), so the default
    // pocket shows as the default pocket (owner, 19 Nov)
    const sideFlap = state.view === 'side' && want.pocket === 'flap' && !want.ticket && best.p === 'jet' && SIDE_WELT.has(best.name);
    if (sideFlap) best.p = 'flap';
    let tk = null;
    if (V && want.ticket && best.t !== want.ticket && best.p === want.pocket) {
      const T = V.patches.find(x => x[1] === want.ticket && x[0] === 'flap') || V.patches.find(x => x[1] === want.ticket);
      if (T) { tk = T[2] + (sx ? '@' + sx : ''); best.t = want.ticket; }
    }
    const chest = chestLook(state.opts.chestPocket || 'B');
    if (chest !== 'welt') {
      // a chest pocket laid in from its own photo: front (every style) and, since 21 Nov, three-quarter (the styles with
      // a three-quarter photo, on the photos whose welt was located: chest.json "names")
      const C = PKC[state.view], pre = state.view === 'three4' ? 'chest3_' : 'chest_';
      const layer = C && C.patches.some(p => p[0] === chest) && (!C.names || C.names.includes(best.name));
      if (best.e.chest === chest) { /* the photo shows this chest pocket */ } else if (layer) ck = `${pre}${chest}+${pre}welt`; else miss.push(['this chest pocket', ['chestPocket']]);
    }
    if (best.l !== want.lapel) miss.push([`${want.lapel} lapel`, ['lapel', 'front']]);
    else if (!['BK', '20', 'D'].includes(state.opts.lapel || 'BK') && best.e.lap !== state.opts.lapel) miss.push(['this lapel shape', ['lapel']]);
    if (best.f !== want.front) miss.push([((choiceOf('front') || {}).label || 'this front').toLowerCase(), ['front']]);
    if (best.p !== want.pocket || best.t !== want.ticket) miss.push(['these pockets', ['lowerPocket', 'ticket']]);
    if (ex.w && best.e.w !== ex.w) {                 // no narrow / wide photo from this angle: one note, naming the exact width
      miss.push([`a ${cmW} cm (${ex.w}) lapel`, ['lapelWidth']]);
      for (let k = sizes.length - 1; k >= 0; k--) if (sizes[k][1][0] === 'lapelWidth') sizes.splice(k, 1);
    }
    if (ex.sh && best.e.sh !== ex.sh) miss.push(['this shoulder', ['shoulder']]);
    let sz = null;
    if (DRAWN && SZ_REG[state.view]) {             // preview: the flap depth and chest welt height drawn to the chosen cm
      const cmOf = id => { const r = /(\d+(?:\.\d+)?)\s?cm/i.exec((choiceOf(id) || {}).label || ''); return r ? +r[1] : 0; };
      const noted = id => sizes.some(x => x[1][0] === id);   // only a size the customer changed (it has a size note)
      const fl = noted('lowerPocket') && ['flap', 'slant', 'hacking'].includes(want.pocket) && best.p === want.pocket && cmOf('lowerPocket');
      const cw = noted('chestPocket') && SZ_REG[state.view].c && chest === 'welt' && cmOf('chestPocket');   // straight welts (the curved welt: next)
      sz = { f: fl ? Math.round(fl / SZ_BASE.f * 1000) / 1000 : 1, c: cw ? Math.round(cw / SZ_BASE.c * 1000) / 1000 : 1 };
      if (!fl && !cw) sz = null; else sz.cm = { f: fl, c: cw };
    }
    // the size note goes only once the picture really was resized (every flap / welt of this view found, 21 Nov): the
    // render calls noteSz with what was done; the photo's flap / welt size is an assumption until the owner confirms it
    const noteSz = done => {
      const id = { f: 'lowerPocket', c: 'chestPocket' }, what = { f: 'flap', c: 'chest welt' };
      for (const kind of ['f', 'c']) if (done[kind]) {
        for (let k = sizes.length - 1; k >= 0; k--) if (sizes[k][1][0] === id[kind]) sizes.splice(k, 1);
        info.push([`Preview: the ${what[kind]} is drawn at ${sz.cm[kind]} cm, measured from the ${what[kind]} in the photo taken as ${SZ_BASE[kind]} cm (an assumption until it is confirmed).`, [id[kind]]]);
      }
      return say();
    };
    return { name: best.name, pk, ck, lw, tk, sideFlap, sz, note: say(), noteSz };
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
    return { ...st, B, S, Wp, A, U, V, SH, ovCache: {}, lapelGeo: undefined, cuffs: undefined, linBox: undefined, elbowPx: undefined };   // a new picture: its own caches
  }
  // ---------- drawn sizes (preview only, ?drawn=1 in the link, 20 Nov): the lower pocket flap's depth and the chest
  // welt's height are resized in the photo itself. The flap / welt is found as two parallel dark lines (its top seam and
  // its bottom edge) in the photo's shading; rows between them are stretched or squeezed from the top seam down, the
  // shadow under the edge moves with it, and when it gets shorter the cloth below closes up over a short band.
  const DRAWN = new URLSearchParams(location.search).has('drawn');
  const SZ_REG = { front: { f: [[180, 405], [615, 862]], c: [[560, 820]] }, three4: { f: [[474, 750], [215, 312, 'far']], c: [[400, 720]] }, side: { f: [[250, 480]] } };
  const SZ_Y = { f: [900, 1250, 35, 120], c: [440, 700, 25, 60] };     // search rows, smallest / largest height (px)
  const SZ_BASE = { f: 4.5, c: 2.5 };                                  // cm of the flap / chest welt in the photos
  const edgeCache = new WeakMap();
  function edgeMap(st) {                          // dark horizontal lines: mean of 15 rows minus mean of 3 rows (shade)
    if (edgeCache.has(st)) return edgeCache.get(st);
    const E = new Float32Array(W * H), col = new Float64Array(H + 1);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) col[y + 1] = col[y] + st.S[(y * W + x) * 4];
      const m = (y, r) => { const lo = Math.max(0, y - r), hi = Math.min(H, y + r + 1); return (col[hi] - col[lo]) / (hi - lo); };
      for (let y = 0; y < H; y++) E[y * W + x] = st.A[y * W + x] ? m(y, 7) - m(y, 1) : 0;
    }
    edgeCache.set(st, E); return E;
  }
  function szLines(E, xa, xb, ya, yb, wmin, minPts = 20) {
    const P = [];
    for (let x = xa; x < xb; x += 2) for (let y = ya + 2; y < yb - 2; y++) {
      const v = E[y * W + x]; if (v <= 5) continue;
      if (v >= E[(y - 1) * W + x] && v >= E[(y + 1) * W + x] && v >= E[(y - 2) * W + x] && v >= E[(y + 2) * W + x]) P.push([x, y, v]);
    }
    const out = [];
    for (let b = -0.4; b <= 0.4001; b += 0.02) {
      const by = new Map();
      for (const p of P) { const a = Math.round(p[1] - b * p[0]); for (const k of [a - 2, a - 1, a, a + 1, a + 2]) { if (!by.has(k)) by.set(k, []); by.get(k).push(p); } }
      for (const [a0, ps] of by) {
        if (ps.length < minPts) continue;
        const xs = ps.map(p => p[0]).sort((u, v) => u - v); let s0 = xs[0], pv = xs[0], best = [xs[0], xs[0]];
        for (const x of xs.slice(1)) { if (x - pv > 8) { if (pv - s0 > best[1] - best[0]) best = [s0, pv]; s0 = x; } pv = x; }
        if (pv - s0 > best[1] - best[0]) best = [s0, pv];
        if (best[1] - best[0] < wmin) continue;
        let sum = 0; for (const p of ps) if (p[0] >= best[0] && p[0] <= best[1] && Math.abs(p[1] - b * p[0] - a0) <= 2) sum += p[2];
        out.push({ a: a0, b, x0: best[0], x1: best[1], s: sum });
      }
    }
    out.sort((u, v) => v.s - u.s); const keep = [];
    for (const l of out) {
      const ym = l.a + l.b * (l.x0 + l.x1) / 2;
      if (keep.some(k => Math.abs(ym - (k.a + k.b * (k.x0 + k.x1) / 2)) < 8 && Math.min(l.x1, k.x1) - Math.max(l.x0, k.x0) > 20)) continue;
      keep.push(l); if (keep.length >= 12) break;
    }
    return keep;
  }
  function szFind(E, xa, xb, ya, yb, hmin, hmax, ext = 12) {   // the pair of lines (top seam, bottom edge) that bounds the flap / welt
    const wmin = xb - xa < 120 ? 20 : 45, L = szLines(E, xa, xb, ya, yb, wmin); let best = null;
    for (const u of L) for (const d of L) {
      if (Math.abs(u.b - d.b) > 0.07) continue;
      const x0 = Math.max(u.x0, d.x0), x1 = Math.min(u.x1, d.x1); if (x1 - x0 < wmin) continue;
      const xm = (x0 + x1) / 2, gap = (d.a + d.b * xm) - (u.a + u.b * xm); if (gap < hmin || gap > hmax) continue;
      const sc = Math.min(u.s, d.s) * (x1 - x0); if (!best || sc > best.sc) best = { sc, x0, x1, a: d.a, b: d.b, h: Math.round(gap) };
    }
    if (!best) return null;
    const strong = x => { for (const yy of [best.a + best.b * x, best.a + best.b * x - best.h]) for (let d = -2; d <= 2; d++) { const y = Math.round(yy) + d; if (y > 0 && y < H && E[y * W + x] > 3) return true; } return false; };
    const x0 = best.x0, x1 = best.x1;               // its full width (at most 12 px more each side: not into a sleeve or lapel edge)
    for (let gap = 0, x = x0 - 1; x >= x0 - ext && gap <= 4; x--) { if (strong(x)) { best.x0 = x; gap = 0; } else gap++; }
    for (let gap = 0, x = x1 + 1; x <= x1 + ext && gap <= 4; x++) { if (strong(x)) { best.x1 = x; gap = 0; } else gap++; }
    return best;
  }
  // the far flap on three-quarter is seen almost edge-on: often only its bottom edge shows as a line. Then the flap is
  // taken as that edge with the near flap's height above it (the two flaps are the same size, at the same height)
  function szEdge(E, xa, xb, near) {
    const ym = near.a + near.b * (near.x0 + near.x1) / 2, L = szLines(E, xa, xb, Math.round(ym - 70), Math.round(ym + 25), 10, 6);
    const l = L.find(u => u.x1 - u.x0 >= 10); return l ? { sc: 0, x0: l.x0, x1: l.x1, a: l.a, b: l.b, h: near.h } : null;
  }
  const szMemo = new WeakMap();
  function sizedView(st, view, sz) {
    const key = JSON.stringify(sz); let memo = szMemo.get(st); if (!memo) szMemo.set(st, memo = new Map());
    if (memo.has(key)) return memo.get(key);
    const B = st.B.slice(), S = st.S.slice(), Wp = st.Wp.slice(), A = st.A.slice(), U = st.U.slice(), V = st.V.slice(), SH = st.SH.slice();
    let clipR = null, clipL = null;                 // a sleeve's edge beside the flap: nothing past it changes
    const put = (y, x, sy) => {                     // pixel (x, y) takes the map values at row sy of the same column
      if (y < 0 || y >= H || x < 0 || x >= W) return;
      if ((clipR && x > clipR(y) - 1) || (clipL && x < clipL(y) + 1)) return;
      const i = y * W + x; if (!st.A[i] || st.OVP[i * 4 + 3] || st.Wp[i * 4 + 2] === 2 || st.Wp[i * 4 + 2] === 3) return;   // lapels stay
      sy = Math.max(0, Math.min(H - 1.001, sy)); const y0 = sy | 0, f = sy - y0, j0 = y0 * W + x, j1 = j0 + W, jn = f < 0.5 ? j0 : j1;
      if (!st.A[jn] || st.Wp[jn * 4 + 2] === 2 || st.Wp[jn * 4 + 2] === 3) return;
      const p = i * 4, p0 = j0 * 4, p1 = j1 * 4;
      for (let c = 0; c < 4; c++) B[p + c] = st.B[jn * 4 + c];
      S[p] = st.S[p0] * (1 - f) + st.S[p1] * f; S[p + 1] = S[p + 2] = S[p];
      Wp[p] = st.Wp[p0] * (1 - f) + st.Wp[p1] * f; Wp[p + 1] = st.Wp[p0 + 1] * (1 - f) + st.Wp[p1 + 1] * f; Wp[p + 2] = st.Wp[jn * 4 + 2];
      A[i] = st.A[jn]; uvAt(i, S, Wp, U, V, SH);
    };
    const E = edgeMap(st), found = [];
    for (const kind of ['f', 'c']) {
      const kk = sz[kind]; if (!kk || Math.abs(kk - 1) < 0.01) continue;
      const [ya, yb, hmin, hmax] = SZ_Y[kind];
      let near = null;
      for (const [xa, xb, far] of ((SZ_REG[view] || {})[kind] || [])) {
        const g = szFind(E, xa, xb, ya, yb, hmin, hmax) || (far && near && szEdge(E, xa, xb, near)); if (!g) continue; found.push(kind);
        if (!far) near = g;
        const SHD = 10, BAND = 50, mg = kk < 1 || kind === 'c' ? 1 : 3, xl = Math.max(8, g.x0 - mg), xr = Math.min(W - 9, g.x1 + mg), xc = Math.round((g.x0 + g.x1) / 2);
        // a sleeve or lapel edge crossing the flap's end (three-quarter, side): measured in the plain cloth just below the
        // flap, the first strong vertical edge either side of the middle ends the change there, so the edge never moves
        // (a sharp step in brightness across it: a dart, a seam or a soft shadow does not count)
        const ybm = g.a + g.b * xc, band = (x, y0, y1) => { let t = 0, n = 0;
          for (let y = Math.round(y0); y <= Math.round(y1); y++) { const yy = Math.round(y + g.b * (x - xc)); if (yy < 1 || yy >= H - 1 || x < 9 || x > W - 10) continue;
            t += (st.S[(yy * W + x + 1) * 4] + st.S[(yy * W + x + 2) * 4] - st.S[(yy * W + x - 1) * 4] - st.S[(yy * W + x - 2) * 4]) / 2; n++; }
          return n ? Math.abs(t / n) : 0; };
        const stepAt = x => band(x, ybm - g.h * 0.7, ybm - g.h * 0.3);   // across the flap itself (22 Nov: not below it, where the
        // flap's own pocket shadow made a step a few px before its end and left a stub of the old flap)
        let xr2 = xr, xl2 = xl; clipR = clipL = null;
        if (view === 'front') {                        // front: nothing crosses the flap; it wraps round past the side seam to the
          const inside = x => { const y = Math.round(g.a + g.b * x); return x > 8 && x < W - 9 && y > 0 && y < H && st.A[y * W + x]; };
          while (xr2 < xr + 30 && inside(xr2 + 1)) xr2++;   // jacket's outline, so the change runs on to the outline (no corner at the seam)
          while (xl2 > xl - 30 && inside(xl2 - 1)) xl2--;
        } else {
          // the flap's end in deep shadow (by a sleeve): its edge line fades out gradually; the change runs on while the line
          // is still there (up to 30 px), so no stub of the old flap is left in the shadow
          const lineE = x => { let m = 0; const y = Math.round(g.a + g.b * x); for (let d = -3; d <= 3; d++) if (y + d > 0 && y + d < H) m = Math.max(m, E[(y + d) * W + x]); return m; };
          // a step across the flap close to its own end is the flap's end edge (it moves with the flap); further in, it is
          // something crossing the flap (it stays). The far flap on three-quarter ends on its left at the jacket's front edge: that stays
          let stopR = false, stopL = false;
          for (let x = xc; x <= xr + 30 && x < W - 10; x++) {
            if (stepAt(x) > 25) { let pk = x; for (let q = x; q <= x + 8; q++) if (stepAt(q) > stepAt(pk)) pk = q; xr2 = Math.abs(pk - g.x1) <= 10 ? pk + 4 : pk - 1; stopR = true; break; }
            if (x > xr && lineE(x) < 2) { xr2 = x - 1; stopR = true; break; }
          }
          if (!stopR) xr2 = Math.min(W - 10, xr + 30);
          for (let x = xc; x >= xl - 30 && x > 9; x--) {
            if (stepAt(x) > 25) { let pk = x; for (let q = x; q >= x - 8; q--) if (stepAt(q) > stepAt(pk)) pk = q; xl2 = !far && Math.abs(pk - g.x0) <= 10 ? pk - 4 : pk + 1; stopL = true; break; }
            if (x < xl && lineE(x) < 2) { xl2 = x + 1; stopL = true; break; }
          }
          if (!stopL) xl2 = Math.max(9, xl - 30);
          // a sleeve edge crossing just below the flap's end (side): its line is measured below the flap, row by row, and
          // nothing on the sleeve's side of it changes (the flap goes under the sleeve; the sleeve's outline stays whole)
          const below = x => band(x, ybm + 14, ybm + 40), hstep = (x, y) => Math.abs(st.S[(y * W + x + 1) * 4] + st.S[(y * W + x + 2) * 4] - st.S[(y * W + x - 1) * 4] - st.S[(y * W + x - 2) * 4]) / 2;
          const sleeveLine = (xa2, xb2) => {
            const pts = [];
            for (let y = Math.round(ybm + 6); y <= Math.round(ybm + 60) && y < H - 1; y += 2) {
              let bx = -1, bv = 25; for (let x = Math.max(10, xa2); x <= Math.min(W - 11, xb2); x++) { const v = hstep(x, y); if (v > bv) { bv = v; bx = x; } }
              if (bx >= 0) pts.push([y, bx]);
            }
            if (pts.length < 10) return null;
            const n = pts.length, my = pts.reduce((t, p) => t + p[0], 0) / n, mx = pts.reduce((t, p) => t + p[1], 0) / n;
            let sxy = 0, syy = 0; for (const [y, x] of pts) { sxy += (y - my) * (x - mx); syy += (y - my) ** 2; }
            const m = sxy / syy, c = mx - m * my, res = pts.reduce((t, [y, x]) => t + Math.abs(x - (c + m * y)), 0) / n;
            return res < 3 ? y => c + m * y : null;
          };
          for (let x = xc; x <= xr2; x++) if (below(x) > 25) { clipR = sleeveLine(x - 8, xr2 + 8); break; }
          for (let x = xc; x >= xl2; x--) if (below(x) > 25) { clipL = sleeveLine(xl2 - 8, x + 8); break; }
        }
        const k = kk;
        for (let x = xl2; x <= xr2; x++) {
          const yb0 = g.a + g.b * x, yt = yb0 - g.h, nb = yt + g.h * k;
          if (k > 1) {
            for (let y = Math.round(nb + SHD); y >= Math.round(yt); y--) put(y, x, y <= nb ? yt + (y - yt) / k : yb0 + (y - nb));
          } else {
            const end = yb0 + SHD + BAND, gp = yb0 - nb;
            for (let y = Math.round(yt); y <= Math.round(end); y++) {
              const sy = y <= nb ? yt + (y - yt) / k : y <= nb + SHD ? yb0 + (y - nb) : y + gp * (1 - (y - nb - SHD) / (end - nb - SHD));
              put(y, x, sy);
            }
          }
        }
      }
    }
    const out = { ...st, B, S, Wp, A, U, V, SH, ovCache: {}, lapelGeo: undefined, cuffs: undefined, linBox: undefined, elbowPx: undefined, holeCache: undefined, szFound: found };
    memo.set(key, out); return out;
  }
  // Pocket styles: the pocket area of a notch photo with that pocket (shading + fold offsets) is blended into
  // this photo, moved to where this photo's own pocket sits. Buttons and the photo's outline stay its own.
  let PK = {}, PKC = {};
  const pkImgs = {};
  async function pkImg(f) { return pkImgs[f] || (pkImgs[f] = pixels(await loadImg(`maps/_pk/${f}.webp?v=${VER}`))); }
  // kind 'pk': lower pockets (left and right pocket move separately), 'pkc': the chest pocket
  // the lapel's outer edge beside the chest pocket, per row (owner, 21 Nov: the lapel always sits above the chest pocket).
  // Photos with marked lapels: the rightmost pixel of the wearer's left lapel (part 2), which follows the lapel width.
  // Other photos: the lapel edge found as a straight diagonal dark line (RANSAC on line peaks), the rightmost such line.
  function lapelEdge(st, x0, y0, w, h) {
    const edge = new Map(); let marked = 0;
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
      let r = -1; for (let x = Math.max(0, x0 - 120); x < Math.min(W, x0 + w); x++) if (st.Wp[(y * W + x) * 4 + 2] === 2) r = x;
      if (r >= 0) { edge.set(y, r); marked++; }
    }
    if (marked > h * 0.3) return y => { if (edge.has(y)) return edge.get(y); let best = null, bd = 1e9; for (const [yy, x] of edge) if (Math.abs(yy - y) < bd) { bd = Math.abs(yy - y); best = x; } return bd <= 40 ? best : null; };
    const pts = [], xa = Math.max(8, x0 - 70), xb = Math.min(W - 9, x0 + Math.round(w * 0.6));
    for (let y = Math.max(1, y0); y < Math.min(H - 1, y0 + h); y += 2) {
      const row = new Float64Array(W + 1); for (let x = 0; x < W; x++) row[x + 1] = row[x] + st.S[(y * W + x) * 4];
      const ev = x => (row[x + 8] - row[x - 7]) / 15 - (row[x + 2] - row[x - 1]) / 3;
      for (let x = xa + 2; x < xb - 2; x++) { if (!st.A[y * W + x]) continue; const v = ev(x); if (v > 6 && v >= ev(x - 1) && v >= ev(x + 1)) pts.push([x, y]); }
    }
    let best = null;
    for (let it = 0; it < 400 && pts.length > 20; it++) {
      const p1 = pts[(it * 7919) % pts.length], p2 = pts[(it * 104729 + 13) % pts.length]; if (p1[1] === p2[1]) continue;
      const b = (p2[0] - p1[0]) / (p2[1] - p1[1]); if (b > -0.25 || b < -1.6) continue;   // a diagonal: further left lower down
      const a = p1[0] - b * p1[1]; let n = 0; for (const q of pts) if (Math.abs(q[0] - (a + b * q[1])) <= 2) n++;
      if (n < Math.max(20, h / 8)) continue;
      const xm = a + b * (y0 + h / 2);              // the rightmost good line is the lapel's outer edge (the roll line is further left)
      if (!best || xm > best.xm + 6 || (Math.abs(xm - best.xm) <= 6 && n > best.n)) best = { a, b, n, xm };
    }
    return best ? y => best.a + best.b * y : null;
  }
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
    const lapX = kind === 'pkc' ? lapelEdge(st, v.at[0] + tdx(0), v.at[1] + tdy, pw, ph) : null;   // the chest pocket stays beside the lapel
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      const x = v.at[0] + tdx(px) + px, y = v.at[1] + tdy + py, k = py * pw + px;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if (tkOnly && (px >= split || py >= 110)) continue;
      const i = y * W + x; if (!st.A[i] || st.OVP[i * 4 + 3]) continue;   // only on cloth, never over a button
      let e = 1;                                        // fade out near the jacket outline (outlines differ per photo)
      for (let d = 4; d <= 28 && e > 0; d += 4) if (!st.A[i - d] || !st.A[i + d]) e = Math.min(e, (d - 4) / 24);
      if (kind === 'pk' && st.meta.pkx) e = Math.min(e, Math.max(0, (st.meta.pkx - 6 - x) / 14));   // three-quarter: stop before the arm
      if (lapX) { const xe = lapX(y); if (xe != null) { e = Math.min(e, Math.max(0, Math.min(1, (x - xe - 3) / 4))); if (e <= 0) continue; } }   // the lapel lies over it
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
    return { ...st, S, Wp, U, V, SH, ovCache: {}, cuffs: undefined, elbowPx: undefined };   // a new picture: its own caches (sleeve-button views were shared and drew the unpatched photo)
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
    const T = state.tile.T, N = state.tile.n, SL = shadeLut(state.tile), SK = sheenOf(state.tile);
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
        let lin = (top + (bot - top) * fy) * sh + SK[ch] * sh * sh; if (lin > 2) lin = 2;
        O[p + ch] = B[p + ch] * (1 - k) + TONE[(lin * OUTN) | 0] * k;
      }
      O[p + 3] = 255;
    }
    if (st.LN) liningPass(st, O, 0, 0, 1, state.tile);
    ctx.putImageData(out, 0, 0); drawHole(st, 0, 0, 1); drawLabel(st.name, 0, 0, 1); drawTabs(st, 0, 0, 1); drawSideFlap(st, 0, 0, 1); drawCuffHoles(st, 0, 0, 1); drawLapelHoles(st, 0, 0, 1); ctx.drawImage(overlayFor(st), 0, 0); drawDiscs(st, 0, 0, 1); drawCuffDiscs(st, 0, 0, 1); drawMonos(0, 0, 1);
  }

  // Zoomed view: redraw only the tapped area at ZOOM x the resolution, sampling the maps between pixels and a
  // finer copy of the fabric, so the weave shows real detail instead of enlarged pixels.
  const ZOOM = 3;
  function drawZoom(st, tile, zx, zy, Z = ZOOM) {
    const T = tile.T, N = tile.n, cx = W / 2, cy = H * 0.35, SL = shadeLut(state.tile || tile), SK = sheenOf(state.tile || tile);
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
            let lin = (top + (bot - top) * tfy) * sh + SK[ch] * sh * sh; if (lin > 2) lin = 2;
            return TONE[(lin * OUTN) | 0] * k;
          };
          r += f(0); g += f(1); bl += f(2);
        }
        O[p] = r; O[p + 1] = g; O[p + 2] = bl; O[p + 3] = 255;
      }
    }
    if (st.LN) liningPass(st, O, zx, zy, Z, tile);
    ctx.putImageData(out, 0, 0); drawHole(st, zx, zy, Z); drawLabel(st.name, zx, zy, Z); drawTabs(st, zx, zy, Z); drawSideFlap(st, zx, zy, Z); drawCuffHoles(st, zx, zy, Z); drawLapelHoles(st, zx, zy, Z);
    ctx.drawImage(overlayFor(st), zx, zy, W / Z, H / Z, 0, 0, W, H); drawDiscs(st, zx, zy, Z); drawCuffDiscs(st, zx, zy, Z); drawMonos(zx, zy, Z);
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

  // ---------- the standard flap on side photos shot with a jetted pocket ----------
  function drawSideFlap(st, zx, zy, Z) {
    if (!state.sideFlap || state.view !== 'side' || !st.meta.welt) return;
    const [wx0, wx1, wy] = st.meta.welt, w = wx1 - wx0 + 6, h = 5.6 * PX_PER_CM * 1.12 * (state.szF || 1), top = wy - 6;   // drawn sizes: its depth too
    const X = (wx0 - 3 - zx) * Z, Y = (top - zy) * Z, Wd = w * Z, Hd = h * Z, r = 6 * Z;
    const path = () => { ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Wd, Y); ctx.lineTo(X + Wd - 1.5 * Z, Y + Hd - r); ctx.quadraticCurveTo(X + Wd - 1.5 * Z, Y + Hd, X + Wd - 1.5 * Z - r, Y + Hd);
      ctx.lineTo(X + 1.5 * Z + r, Y + Hd); ctx.quadraticCurveTo(X + 1.5 * Z, Y + Hd, X + 1.5 * Z, Y + Hd - r); ctx.closePath(); };
    ctx.save(); ctx.filter = `blur(${2.5 * Z}px)`; ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.translate(0, 2.5 * Z); path(); ctx.fill(); ctx.restore();   // its shadow
    ctx.save(); path(); ctx.clip();
    // the cloth itself (its repeat), lit like the cloth round the pocket: copying the picture from below brought the side
    // seam along
    let sh = 0, n = 0; for (let y = top + 10; y < top + h; y += 4) for (let x = wx0; x < wx1; x += 4) { const i = y * W + x; if (st.A[i] > 0.99) { sh += st.SH[i]; n++; } }
    sh = n ? sh / n : 1;
    const tk = (state.tile && state.tile.n) + '|' + sh.toFixed(2);
    if (st.flapPat !== tk || !st.flapCanvas) {
      const T = state.tile.T, N = state.tile.n, SL = shadeLut(state.tile), SK = sheenOf(state.tile), s0 = SL[Math.min(1024, (sh * 256) | 0)];
      const c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), im = x.createImageData(N, N);
      for (let i = 0; i < N * N; i++) for (let ch = 0; ch < 3; ch++) { let lin = T[i * 3 + ch] * s0 + SK[ch] * s0 * s0; if (lin > 2) lin = 2; im.data[i * 4 + ch] = TONE[(lin * OUTN) | 0]; im.data[i * 4 + 3] = 255; }
      x.putImageData(im, 0, 0); st.flapCanvas = c; st.flapPat = tk;
    }
    const pat = ctx.createPattern(st.flapCanvas, 'repeat'); pat.setTransform(new DOMMatrix([Z, 0, 0, Z, -zx * Z, -zy * Z]));
    ctx.fillStyle = pat; ctx.fillRect(X, Y, Wd, Hd);
    const g = ctx.createLinearGradient(X, Y, X, Y + Hd); g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(0.18, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g; ctx.fillRect(X, Y, Wd, Hd); ctx.restore();
    ctx.save(); path(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.1 * Z; ctx.stroke();
    ctx.setLineDash([1.6 * Z, 1.4 * Z]); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.7 * Z;   // edge stitching
    ctx.beginPath(); ctx.moveTo(X + 3.5 * Z, Y + 3 * Z); ctx.lineTo(X + 3.5 * Z, Y + Hd - 4 * Z); ctx.lineTo(X + Wd - 4.5 * Z, Y + Hd - 4 * Z); ctx.lineTo(X + Wd - 4.5 * Z, Y + 3 * Z); ctx.stroke();
    ctx.restore();
  }
  // ---------- jetted pockets with a button tab (lower pocket code 2): a pointed tab of the cloth hangs from the jet ----------
  // Jet centres on the pocket photos (front: left, right; three-quarter: far, near), moved like the pockets themselves.
  const JET_AT = { front: [[287, 997], [725, 991]], three4: [[268, 992], [577, 987]] };
  function drawTabs(st, zx, zy, Z) {
    if ((state.opts.lowerPocket || 'B') !== '2' || !JET_AT[state.view]) return;
    const off = st.meta.pk || [0, 0, 0], split = state.view === 'front' ? 521 : 454, sx = styleOf().db ? 14 : 0;
    const bi = curBtn() && btnImgs[curBtn() + '|' + (state.thread.button || '')];
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
    return (st.cuffs[key] = { ...st, A, B, S, OVP, SH, U, V, ov, ovCache: {}, cuffs: undefined, elbowPx: undefined, cuffAt: { centres, r, ex, ey, dx, dy } });
  }
  // ---------- sleeve buttons in the front and inside photos: the chosen number (owner, 19 Nov: Front must match) ----------
  // build/cuff_stacks.py marks each cuff's button stack in buttons.json: "own" = the photographed buttons are in the
  // overlay (redrawn in the chosen number from their own bottom button), "ref" = melted into the cloth on that photo
  // (the reference photo's button is drawn there instead). Kissing or spaced as on the side view.
  const CUFF_REF = {};
  async function cuffRef() {
    for (const s of 'LR') if (!CUFF_REF[s]) {
      try { const im = await loadImg(`maps/_cuffbtn_${s}.png?v=${VER}`); CUFF_REF[s] = { w: im.width, h: im.height, d: pixels(im) }; } catch (e) { /* none */ }
    }
  }
  function stackView(st) {
    const S = st.meta.stacks; if (!S || !S.length) return st;
    const o = cuffOpts(), key = 'stk' + o.n + '|' + o.kiss;
    st.cuffs = st.cuffs || {};
    if (st.cuffs[key]) return st.cuffs[key];
    const OVP = new Uint8ClampedArray(st.OVP), A = st.A.slice(), B = new Uint8ClampedArray(st.B), Sh = new Uint8ClampedArray(st.S),
      SH = st.SH.slice(), U = st.U.slice(), V = st.V.slice();
    for (const [x, y, w, h, kind] of S) {
      let spr; const left = x < W / 2;
      if (kind === 'own') {
        const bh = Math.round(h / 4); spr = { w, h: bh, d: new Uint8ClampedArray(w * bh * 4) };
        for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < w; xx++) {
          const q = ((y + h - bh + yy) * W + x + xx) * 4, t = (yy * w + xx) * 4;
          for (let k = 0; k < 4; k++) spr.d[t + k] = st.OVP[q + k];
        }
        // the photographed buttons are taken out: outside the sleeve's edge (read just above and below the stack)
        // becomes backdrop, over the sleeve becomes the cloth beside it
        const edges = [];
        for (const yy of [y - 14, y - 8, y + h + 8, y + h + 14]) {
          if (yy < 0 || yy >= H) continue;
          for (let k = 0; k < 60; k++) { const xx = left ? x - 20 + k : x + w + 20 - k; if (st.A[yy * W + xx] > 0.99) { edges.push(xx); break; } }
        }
        const ex = edges.length ? edges.sort((p, q) => p - q)[edges.length >> 1] : (left ? x + w / 2 : x + w / 2);
        for (let yy = y - 3; yy < y + h + 3; yy++) for (let xx = x - 4; xx < x + w + 4; xx++) {
          const i = yy * W + xx, p = i * 4; OVP[p + 3] = 0;
          if (left ? xx < ex : xx > ex) { A[i] = 0; B[p] = B[p + 1] = B[p + 2] = BGC; B[p + 3] = 255; Sh[p] = Sh[p + 1] = Sh[p + 2] = BGC; continue; }
          // weave from the cloth one stack-width further in; light from the cloth just above and below at this spot
          const j = yy * W + (left ? xx + w + 6 : xx - w - 6), t = (y - 6) * W + xx, u = (y + h + 6) * W + xx, f = (yy - y + 6) / (h + 12);
          A[i] = Math.max(st.A[t], st.A[u]); U[i] = st.U[j]; V[i] = st.V[j]; SH[i] = st.SH[t] * (1 - f) + st.SH[u] * f;
          for (let k = 0; k < 4; k++) { B[p + k] = st.B[t * 4 + k]; Sh[p + k] = st.S[t * 4 + k] * (1 - f) + st.S[u * 4 + k] * f; }
        }
      } else { spr = CUFF_REF[left ? 'L' : 'R']; if (!spr) continue; }
      const pitch = spr.h * (o.kiss ? 1 : 1.4);
      for (let k = 0; k < o.n; k++) {
        const top = Math.round(y + h - spr.h - k * pitch);
        for (let yy = 0; yy < spr.h; yy++) for (let xx = 0; xx < spr.w; xx++) {
          const t = (yy * spr.w + xx) * 4, a = spr.d[t + 3]; if (!a) continue;
          const q = ((top + yy) * W + x + xx) * 4;
          if (a > OVP[q + 3]) { OVP[q] = spr.d[t]; OVP[q + 1] = spr.d[t + 1]; OVP[q + 2] = spr.d[t + 2]; OVP[q + 3] = a; }
        }
      }
    }
    const ov = document.createElement('canvas'); ov.width = W; ov.height = H;
    const ox = ov.getContext('2d'), im = ox.createImageData(W, H); im.data.set(OVP); ox.putImageData(im, 0, 0);
    return (st.cuffs[key] = { ...st, A, B, S: Sh, SH, U, V, OVP, ov, ovCache: {}, cuffs: undefined, elbowPx: undefined });
  }
  // ---------- a worked buttonhole (owner, 19 Nov): a narrow dark opening between two thick stitched lips, a small
  // round eye at the button end, a bar-tack across the far end. Local frame: along +x from the button (0) to the tack (L).
  function workedButtonhole(c, x, y, ang, L, hw, rgb) {
    const t = rgb.map(v => Math.round(v)), sh = k => `rgb(${t.map(v => Math.max(0, Math.min(255, Math.round(v * k))))})`;
    const o = Math.max(0.9, hw * 0.24), step = Math.max(1.1, hw * 0.21), lw = Math.max(0.7, step * 0.6);
    let seed = Math.abs(Math.round(x * 7.13 + y * 3.71)) % 9973 + 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };   // the same small irregularities every redraw
    c.save(); c.translate(x, y); c.rotate(ang); c.lineCap = 'round';
    const x0 = hw * 0.2, x1 = L - hw * 0.2;
    // each lip's outer edge: a little uneven, as hand-worked thread is
    const edge = sgn => { const pts = []; for (let xx = x0 + hw; xx <= x1 - hw; xx += step) pts.push([xx, sgn * hw * (1 + (rnd() - 0.5) * 0.14)]); return pts; };
    const top = edge(-1), bot = edge(1);
    const lipPath = () => { c.beginPath(); c.moveTo(top[0][0], top[0][1]); top.forEach(([a, b]) => c.lineTo(a, b));
      c.arc(x1 - hw, 0, hw, -Math.PI / 2, Math.PI / 2); [...bot].reverse().forEach(([a, b]) => c.lineTo(a, b)); c.arc(x0 + hw, 0, hw, Math.PI / 2, Math.PI * 1.5); c.closePath(); };
    // sits a touch into the cloth: soft shadow round it
    c.save(); c.filter = `blur(${Math.max(0.8, hw * 0.25)}px)`; c.fillStyle = 'rgba(0,0,0,0.45)'; c.translate(0, hw * 0.16); lipPath(); c.fill(); c.restore();
    c.fillStyle = sh(0.74); lipPath(); c.fill();
    // the stitches: short diagonal purls across each lip, each a little different in slant, length and light
    c.save(); lipPath(); c.clip();
    for (const sgn of [-1, 1]) for (let xx = x0 + hw * 0.55; xx < x1 - hw * 0.3; xx += step * (0.85 + rnd() * 0.3)) {
      const sl = (0.45 + (rnd() - 0.5) * 0.25) * hw, inner = sgn * (o + 0.2), outer = sgn * hw * (0.92 + rnd() * 0.12), k = 0.95 + rnd() * 0.3;
      c.lineWidth = lw * (0.85 + rnd() * 0.3); c.strokeStyle = sh(k);
      c.beginPath(); c.moveTo(xx, inner); c.quadraticCurveTo(xx + sl * 0.45, (inner + outer) / 2 + (rnd() - 0.5) * 0.6, xx + sl, outer); c.stroke();
      c.lineWidth = lw * 0.45; c.strokeStyle = sh(0.48);                                 // the groove between two purls
      c.beginPath(); c.moveTo(xx + step * 0.5, inner); c.lineTo(xx + step * 0.5 + sl, outer); c.stroke();
    }
    for (let a = Math.PI * 0.55; a < Math.PI * 1.45; a += step / hw) {                 // stitches fanned round the eye end
      const cx = hw * 0.75, k = 0.95 + rnd() * 0.25; c.lineWidth = lw; c.strokeStyle = sh(k);
      c.beginPath(); c.moveTo(cx + Math.cos(a) * o * 1.6, Math.sin(a) * o * 1.6); c.lineTo(cx + Math.cos(a + 0.18) * (hw - 0.3), Math.sin(a + 0.18) * (hw - 0.3)); c.stroke();
    }
    c.restore();
    // the cord's roundness, gently: a soft light on top, shade into the opening (no bright lines)
    const g = c.createLinearGradient(0, -hw, 0, hw);
    g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.28)'); g.addColorStop(0.72, 'rgba(255,255,255,0.03)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
    c.fillStyle = g; lipPath(); c.fill();
    // the opening: a dark slit with a round eye at the button end
    c.fillStyle = 'rgba(8,8,10,0.94)';
    c.beginPath(); c.moveTo(hw * 0.75, -o); c.lineTo(L - hw * 1.15, -o * 0.8); c.lineTo(L - hw * 1.15, o * 0.8); c.lineTo(hw * 0.75, o); c.closePath(); c.fill();
    c.beginPath(); c.arc(hw * 0.75, 0, o * 1.6, 0, Math.PI * 2); c.fill();
    // the bar-tack across the far end: a little bundle of stitches
    const bx = L - hw * 0.55;
    c.fillStyle = sh(0.68); c.beginPath(); c.roundRect(bx - hw * 0.3, -hw * 1.05, hw * 0.6, hw * 2.1, hw * 0.25); c.fill();
    for (let yy = -hw * 0.95; yy < hw * 0.95; yy += step * (0.7 + rnd() * 0.25)) {
      c.lineWidth = lw * 0.8; c.strokeStyle = sh(0.95 + rnd() * 0.2); c.beginPath(); c.moveTo(bx - hw * 0.26, yy); c.lineTo(bx + hw * 0.26, yy + (rnd() - 0.3) * 0.8); c.stroke();
    }
    c.restore();
  }
  // ---------- sleeve buttons: a flat, straight-on close-up of the cuff (owner, 17 Nov) ----------
  // Shown while the customer chooses the sleeve buttons, their spacing, the buttonhole direction or the sleeve button /
  // hole thread: the back of the sleeve end seen square on, at real size, in the chosen cloth, buttons and threads.
  const CUFF_S = 64, CUFF_BTN = 'B007';            // panel pixels per cm; until buttons are chosen: a plain dark horn button, like the photos'
  async function cuffPanelReady() {
    if (!state.fabric || state.custom) return;
    state.cuffTile = await loadTile(state.fabric, CUFF_S / PX_PER_CM);
    await loadBtn(sleeveBtn() || CUFF_BTN);
  }
  function drawCuffPanel() {
    const t = state.cuffTile; if (!t) return;
    const o = cuffOpts(), S = CUFF_S, T = t.T, N = t.n, SK = sheenOf(t);
    const x0 = 190, x1 = 840, hem = 1450, top = 250, vent = 700;   // sleeve outline, the vent edge, the hem (a close crop: readable on a phone)
    ctx.save(); ctx.fillStyle = '#f3f0ea'; ctx.fillRect(0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H), D = img.data;
    for (let y = top; y < hem + 20; y++) for (let x = x0; x < x1; x++) {
      const bot = hem + 10 * Math.sin(Math.PI * (x - x0) / (x1 - x0)); if (y > bot) continue;   // the hem, gently rounded
      const r = (x - x0) / (x1 - x0), cyl = 0.5 + 0.62 * Math.pow(Math.sin(Math.PI * r), 0.55);   // the sleeve's roundness
      let sh = cyl * (y > bot - 26 ? 0.86 : 1);     // the turned-up hem edge
      if (Math.abs(x - vent) < 2 && y > hem - 11 * S) sh *= 0.45;                               // the vent edge
      else if (x > vent && x < vent + 10 && y > hem - 11 * S) sh *= 0.8;                         // its overlap
      const u = x % N, v = y % N, k = (v * N + u) * 3, p = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) { let lin = T[k + ch] * sh + SK[ch] * sh * sh; if (lin > 2) lin = 2; D[p + ch] = TONE[(lin * OUTN) | 0]; }
    }
    ctx.putImageData(img, 0, 0);
    // buttons: from 3 cm above the hem up the vent, kissing (just touching) or spaced
    // buttons: from 3 cm above the hem up the vent; kissing = touching and slightly overlapping, as sewn
    const d = 1.5 * S, pitch = o.kiss ? d * 0.9 : d * 1.5, cx = vent - 2.3 * S, R = d / 2;   // the holes run towards the vent and stop short of it
    const code = sleeveBtn() || CUFF_BTN, bi = btnImgs[code + '|' + (state.thread.button || '')];
    const ys = Array.from({ length: o.n }, (_, k) => hem - 3 * S - k * pitch);
    const own = clothRGB().map(v => Math.min(255, Math.round(v * 1.12 + 8)));    // matching thread: the cloth's colour, a touch of sheen
    if (o.holes) ys.forEach((cy, k) => {             // worked buttonholes: from the button towards the vent, in their thread
      const tc = (state.thread.sleeve[k] && (THREADS.find(x => x.id === state.thread.sleeve[k]) || {}).rgb) || own;
      const ang = o.slant ? -0.42 : 0, st = R * 0.85;  // the eye just clear of the button's rim; the tack short of the vent
      workedButtonhole(ctx, cx + Math.cos(ang) * st, cy + Math.sin(ang) * st, ang, 2.0 * S - st, 0.17 * S, tc);
    });
    // shadows first (each button casts a soft shadow on the cloth, and on the button below when kissing)
    ys.forEach(cy => {
      ctx.save(); ctx.filter = 'blur(6px)'; ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.ellipse(cx + 4, cy + 7, R * 1.02, R * 0.98, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    });
    // from the top down: each lower button sits over the one above, as kissing buttons are sewn
    [...ys].reverse().forEach(cy => {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      if (bi) ctx.drawImage(bi, cx - R, cy - R, d, d); else { ctx.fillStyle = '#2a2420'; ctx.fill(); }
      // the button's curve: lit from the upper left, the far rim in shade
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(0.88, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, d, d);
      // a soft gloss on the rim (polished horn / resin) and a fine edge line
      ctx.filter = 'blur(1.5px)'; ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, Math.PI * 1.05, Math.PI * 1.55); ctx.stroke(); ctx.filter = 'none';
      ctx.restore();
      ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    });
    // the key
    ctx.fillStyle = '#222'; ctx.font = '600 54px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Sleeve buttons: cuff close-up', W / 2, 92);
    ctx.font = '400 42px system-ui, sans-serif'; ctx.fillStyle = '#444';
    const words = o.n ? `${o.n} button${o.n > 1 ? 's' : ''} · ${o.kiss ? 'kissing' : 'spaced'} · ${!o.holes ? 'no buttonholes' : o.slant ? 'slanted holes' : 'straight holes'}` : 'No sleeve buttons';
    ctx.fillText(words, W / 2, 152); ctx.font = '400 32px system-ui, sans-serif'; ctx.fillStyle = '#666';
    ctx.fillText('The back of the sleeve end, seen straight on', W / 2, 200);
    ctx.restore();
  }
  function drawCuffHoles(st, zx, zy, Z) {
    const c = st.cuffAt, o = cuffOpts(); if (!c || !o.holes || !c.centres.length) return;
    let { ex, ey } = c;
    if (o.slant) { const a = 0.45 * Math.sign(ex * c.dy - ey * c.dx || 1), cs = Math.cos(a), sn = Math.sin(a); [ex, ey] = [ex * cs - ey * sn, ex * sn + ey * cs]; }
    const ang = Math.atan2(ey, ex), own = clothRGB().map(v => Math.min(255, Math.round(v * 1.12 + 8)));
    c.centres.forEach(([cx, cy], k) => {               // the same worked buttonhole as the cuff close-up, at this scale
      const tc = (state.thread.sleeve[k] && (THREADS.find(x => x.id === state.thread.sleeve[k]) || {}).rgb) || threadRGB('button') || own;
      const x = (cx - zx) * Z, y = (cy - zy) * Z, st0 = c.r * 0.85 * Z;
      workedButtonhole(ctx, x + ex * st0, y + ey * st0, ang, c.r * 1.6 * Z, Math.max(1.5, c.r * 0.16 * Z), tc);
    });
  }
  // the sleeve buttons on the side / three-quarter photos, when a button is chosen: that button's own photo, lit
  // like the jacket (soft shadow, curved rim, gloss), over the photographed ones; kissing ones overlap as sewn
  function drawCuffDiscs(st, zx, zy, Z) {
    const c = st.cuffAt, code = sleeveBtn(); if (!c || !code || !c.centres.length) return;
    const bi = btnImgs[code + '|' + (state.thread.button || '')]; if (!bi) return;
    const R = c.r * 1.04 * Z;
    c.centres.forEach(([cx, cy]) => { const x = (cx - zx) * Z, y = (cy - zy) * Z;
      ctx.save(); ctx.filter = `blur(${Math.max(1, R * 0.12)}px)`; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(x + R * 0.1, y + R * 0.16, R, R * 0.96, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
    [...c.centres].reverse().forEach(([cx, cy]) => {
      const x = (cx - zx) * Z, y = (cy - zy) * Z;
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(bi, x - R, y - R, 2 * R, 2 * R);
      const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
      g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(0.88, 'rgba(0,0,0,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = Math.max(0.8, R * 0.09); ctx.beginPath(); ctx.arc(x, y, R * 0.84, Math.PI * 1.05, Math.PI * 1.55); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = Math.max(0.6, R * 0.05); ctx.beginPath(); ctx.arc(x, y, R - 0.4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    });
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
    P09: ['open', 712, 890, 0], P10: ['open', 312, 852, 0], P11: ['open', 312, 852, 0], P12: ['open', 312, 852, 0], P13: ['open', 312, 852, 0],
    P14: ['melton', 512, 0, 0], P15: ['open', 710, 772, 0], P16: ['open', 315, 748, 0], P17: ['open', 690, 1150, 0], P18: ['open', 335, 1150, 0],
    P19: ['front', 572, 560, -77], P20: ['front', 452, 560, 77] };
  const MONO_SWATCH = { P09: 'cloth', P10: 'cloth', P11: [92, 64, 46], P12: [28, 28, 30], P13: [38, 58, 118] };
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
      const rgb = t ? t.rgb : matchThread();          // "Match the cloth": tone on tone
      const mm = parseFloat(((m.type === 'gallery' ? MONO.gHeights : MONO.heights).find(h => h.id === (m.type === 'gallery' ? m.gheight : m.height)) || {}).name) || (m.type === 'gallery' ? 20 : 10);
      const [px, py, rot] = monoXY(pos, state.mapName, mm);
      const capPx = mm / 10 * PX_PER_CM * Z, x = (px - zx) * Z, y = (py - zy) * Z;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot * Math.PI / 180);
      const sw = MONO_SWATCH[m.pos];
      if (sw) {                                       // the monogram sits on a sewn-in swatch: the cloth, or brown / black / blue
        const c = sw === 'cloth' ? clothRGB() : sw, h = 8 * PX_PER_CM * Z * 0.62;   // 8 cm, seen at the inside's angle
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 2 * Z; ctx.shadowOffsetY = Z;
        ctx.fillStyle = `rgb(${c})`; ctx.fillRect(-h / 2, -h / 2, h, h); ctx.restore();
        ctx.save(); ctx.setLineDash([2 * Z, 1.5 * Z]); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.7 * Z;
        ctx.strokeRect(-h / 2 + 2.5 * Z, -h / 2 + 2.5 * Z, h - 5 * Z, h - 5 * Z); ctx.restore();
      }
      drawStitched(m, rgb, capPx, Z);
      ctx.restore();
    }
  }
  // the chest pocket shown on the front (21 Nov): each style's outline on the reference photo [x0, x1, top, bottom]
  // (build_chest.py / chest_variants.py) moved by the photo's own chest offset (buttons.json "pkc")
  const CHEST_BOX = { welt: [660, 788, 521, 569], curved: [660, 788, 526, 575], trapezoid: [660, 788, 521, 569], jetted: [660, 788, 521, 569],
    round: [628, 780, 508, 716], patchflap: [630, 795, 508, 716], barchetta: [648, 792, 508, 588], pleat: [628, 792, 508, 668], none: [660, 788, 521, 569] };
  let monoSt = null;                               // the picture being drawn (its photo's offsets and lapel marks)
  function chestBox(st) {
    const look = chestLook(state.opts.chestPocket || 'B'), b = CHEST_BOX[look] || CHEST_BOX.welt, o = (st && st.meta && st.meta.pkc) || [0, 0];
    let [x0, x1, t, bt] = [b[0] + o[0], b[1] + o[0], b[2] + o[1], b[3] + o[1]];
    if (look === 'welt' && state.szC && state.szC !== 1) bt = t + (bt - t) * state.szC;   // the drawn welt height (preview)
    return { look, x0, x1, t, b: bt };
  }
  function foldLine(st, pid) {                      // a lapel's fold line from its marks: the inner edge, about half way down
    const ys = [], xs = [];
    for (let y = 150; y < 1100; y += 3) { let a = -1, z = -1; for (let x = 150; x < 880; x++) if (st.Wp[(y * W + x) * 4 + 2] === pid) { if (a < 0) a = x; z = x; } if (a >= 0) { ys.push(y); xs.push(pid === 2 ? a : z); } }
    if (ys.length < 12) return null;
    const i = Math.floor(ys.length * 0.55), i0 = Math.floor(ys.length * 0.35), i1 = Math.floor(ys.length * 0.75);
    let ang = Math.atan2(ys[i1] - ys[i0], xs[i1] - xs[i0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    return [xs[i] + (pid === 2 ? 5 : -5), ys[i], ang];
  }
  function monoXY(pos, name, mm = 10) {            // inside positions follow the inner pockets of the photo shown (set on the notch photo)
    let x = pos[1], y = pos[2], rot = pos[3];
    if (pos[0] === 'open' && name && name !== 'open_notch') {
      const side = x > 512 ? 1 : 0, a = INNER_PK.open_notch[side], b = (INNER_PK[name] || INNER_PK._)[side];
      x += b[0] - a[0]; y += b[1] - a[1];
    }
    const id = Object.keys(MONO_POS).find(k => MONO_POS[k] === pos), st = monoSt;
    if (pos[0] === 'front' && st && state.view === 'front') {   // front: from the pocket / lapel actually shown (21 Nov)
      const cap = mm / 10 * PX_PER_CM, c = chestBox(st), cx = (c.x0 + c.x1) / 2;
      if (id === 'P01') { x = cx; y = c.t - PX_PER_CM - cap / 2; }               // 1 cm above the pocket's top edge
      else if (id === 'P08') { x = cx; y = c.b + 2 * PX_PER_CM + cap / 2; }      // 2 cm below its bottom edge
      else if (id === 'P03') { x = cx; y = (c.t + c.b) / 2; }                     // on the pocket
      else if (id === 'P02') { const w = CHEST_BOX.welt, o = st.meta.pkc || [0, 0]; x = (w[0] + w[1]) / 2 + o[0]; y = (w[2] + w[3]) / 2 + o[1]; }   // mid chest, where a pocket would be
      else if (id === 'P19' || id === 'P20') { const f = foldLine(st, id === 'P19' ? 2 : 3); if (f) [x, y, rot] = f; else { const o = st.meta.pkc || [0, 0]; x += o[0]; y += o[1]; } }
      else if (id === 'P05') { const o = st.meta.pkc || [0, 0]; x += o[0]; y += o[1]; }   // the photo's own offset
    }
    return [x, y, rot];
  }
  function showMono() {                            // after a monogram choice: go to its position, close up
    const m = cm(), pos = m && MONO_POS[m.pos]; state.melton = !!pos && pos[0] === 'melton';
    if (!pos) { render(); return; }
    if (state.melton) {                              // under the collar: the back view with the collar turned up, drawn close
      state.view = 'back'; state.zoom = null; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === 'back')); render(); return;
    }
    state.view = pos[0]; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === pos[0]));
    const [x, y] = monoXY(pos, mapName().name);
    state.zoom = zoomBox(x, y, 2.2); render();
  }

  // Positions on the under collar: the melton is only seen with the collar turned up, so draw that part close up
  // (the middle ~24 cm of the collar, about 42 px per cm): the felt piece, its roll line, and the monogram in the stand.
  // thread matched to the cloth: the cloth's colour a shade lighter, so tone-on-tone embroidery still reads
  const matchThread = () => clothRGB().map(v => Math.min(255, Math.round(v * 1.18 + 22)));
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
      const t = m.colour && THREADS.find(x => x.id === m.colour), rgb = t ? t.rgb : matchThread();
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
  // picture linings (one scene, e.g. Nine-coloured Deer): placed once across the lining seen in the photo, not repeated
  const posTex = {};
  function linBox(st) {
    if (st.linBox) return st.linBox;
    let x0 = W, y0 = H, x1 = 0, y1 = 0; const L = st.LN;
    for (let y = 0, q = 3; y < H; y++) for (let x = 0; x < W; x++, q += 4) if (L[q]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return (st.linBox = x1 > x0 ? [x0, y0, x1 + 1, y1 + 1] : [0, 0, W, H]);
  }
  async function loadPosTex(l, st) {
    const [x0, y0, x1, y1] = linBox(st), key = l.id + '|' + [x0, y0, x1, y1].join(',');
    if (posTex[key]) return posTex[key];
    const im = await loadImg(`linings/${l.id}.jpg?v=${VER}`), w = x1 - x0, h = y1 - y0, s = Math.max(w / im.width, h / im.height);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high';
    x.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s);   // cover, centred
    const px = x.getImageData(0, 0, w, h).data, T = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { T[j] = LIN[px[i]]; T[j + 1] = LIN[px[i + 1]]; T[j + 2] = LIN[px[i + 2]]; }
    return (posTex[key] = { T, w, h, x0, y0 });
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
    const lo = state.lining && LININGS.find(x => x.id === state.lining), pos = lo && lo.kind === 'positional';
    const L = st.LN, flat = liningColour(), tex = flat ? null : pos ? posTex[state.lining + '|' + linBox(st).join(',')] : linTex[state.lining + '@' + Z];
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
        if (!c && pos) {                            // the one scene, in the photo's own coordinates
          const u = Math.min(tex.w - 1, Math.max(0, mx - tex.x0)), v = Math.min(tex.h - 1, Math.max(0, my - tex.y0)), k = (v * tex.w + u) * 3;
          c = [tex.T[k], tex.T[k + 1], tex.T[k + 2]];
        } else if (!c) {                            // straight repeat: the tile is seamless
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
      // the chosen button's colour on the photographed one, keeping part of the photo's own light and its highlights
      // (a flat tint read as a drawn oval, owner 19 Nov)
      const lum = 0.299 * P[p] + 0.587 * P[p + 1] + 0.114 * P[p + 2], L = lum / Lo, hi = Math.max(0, Math.min(1, (L - 1.35) / 0.8)) * 0.65;
      for (let ch = 0; ch < 3; ch++) { const tint = Math.min(255, b.rgb[ch] * Math.pow(L, 1.25)); O[p + ch] = Math.min(255, (tint * 0.82 + P[p + ch] * 0.18) * (1 - hi) + 245 * hi); }
      O[p + 3] = a;
    }
    x.putImageData(img, 0, 0);
    return (st.ovCache[key] = c);
  }
  // a button thread colour needs a button to sew: until the customer picks one, the closest catalogue button to the
  // photo's own (dark horn) is drawn, so the thread colour shows; the order still says no button was chosen
  const curBtn = () => state.button || (state.thread.button && BUTTONS.some(b => b.id === 'B001') ? 'B001' : null);
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
  // 5 hidden buttons (front 26, a fly front): the buttons are covered by the cloth, so each one on the photo is covered
  // with the cloth beside it (same panel, towards the side seam), feathered at the edge
  const hiddenFront = () => !isBk() && (state.opts.front || '2') === '26';
  function hideDiscs(st, zx, zy, Z) {
    const list = st.meta.body || st.meta.frontal;     // every front button on the photo (frontal = the ones redrawn)
    if (!hiddenFront() || !list.length) return;
    for (const [bx, by, r] of list) {
      const cx = (bx - zx) * Z, cy = (by - zy) * Z, R = r * Z * 2.1, off = -3.6 * r * Z;     // wide enough for its shadow
      if (cx < -R || cy < -R || cx > W + R || cy > H + R) continue;
      const t = document.createElement('canvas'); t.width = t.height = Math.ceil(2 * R); const tx = t.getContext('2d');
      tx.drawImage(ctx.canvas, cx + off - R, cy - R, 2 * R, 2 * R, 0, 0, 2 * R, 2 * R);
      const g = tx.createRadialGradient(R, R, R * 0.7, R, R, R); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      tx.globalCompositeOperation = 'destination-in'; tx.fillStyle = g; tx.fillRect(0, 0, 2 * R, 2 * R);
      ctx.drawImage(t, cx - R, cy - R);
    }
  }
  function drawDiscs(st, zx, zy, Z) {
    if (hiddenFront()) return hideDiscs(st, zx, zy, Z);
    const img = curBtn() && btnImgs[curBtn() + '|' + (state.thread.button || '')];
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

  let ticket = 0, staleT = 0, painted = false;
  // before the first full picture: the jacket photo as photographed (its colour layer, made opaque), drawn as soon as
  // that one file arrives; the full picture replaces it
  function firstPaint(name) {
    Promise.all(['base', 'shade'].map(n => loadImg(`maps/${name}/${n}.webp?v=${VER}`))).then(([bi, si]) => {
      if (painted) return;
      const B = pixels(bi), S = pixels(si), d = ctx.createImageData(W, H), D = d.data;
      for (let p = 0; p < D.length; p += 4) {          // the photo round the jacket; the jacket itself in its own light, a soft grey
        const a = B[p + 3] / 255, g = S[p] * 0.62;
        D[p] = B[p] * a + g * (1 - a); D[p + 1] = B[p + 1] * a + g * (1 - a); D[p + 2] = B[p + 2] * a + (g + 6) * (1 - a); D[p + 3] = 255;
      }
      if (!painted) ctx.putImageData(d, 0, 0);
    }).catch(() => {});
  }
  async function render() {
    if (!viewOk(state.view)) { state.view = 'front'; state.zoom = null; state.closeup = null; $$('#views button').forEach(x => x.classList.toggle('on', x.dataset.view === 'front')); }
    paintViews();
    const my = ++ticket, m = mapName(); state.mapName = m.name; state.sideFlap = !!m.sideFlap;
    busy.hidden = false; busy.textContent = 'Updating…';
    // the previous picture stays up while the new one loads: when that takes a moment it is faded, so it is never
    // mistaken for the new choice (owner, 17 Nov: buttons briefly seen on the hidden-button front)
    clearTimeout(staleT); staleT = setTimeout(() => { if (my === ticket && !busy.hidden && painted) cv.classList.add('stale'); }, 120);   // not the first photo
    // a cloth shown from a photo of its swatch with an estimated scale says so on the picture (and on its card)
    const paintNote = note => {
      const allNote = [note ? note.all : '', !state.custom && state.fabric && state.fabric.preview || ''].filter(Boolean).join(' ');
      $('#angleNote').hidden = !allNote; $('#angleNote').textContent = allNote;
      $('#noteBelow').hidden = !allNote; $('#noteBelow').textContent = allNote; $('#stage').classList.toggle('has-note', !!allNote);   // phones: a strip under the view tabs (CSS)
      $$('.pic-note').forEach(e => e.remove());
      const stepNote = note && state.lastStep ? note.by(state.lastStep) : '';
      const ls = stepNote && document.querySelector(`#styleSteps [data-step="${state.lastStep}"]`);
      if (ls) ls.insertAdjacentHTML('beforeend', `<p class="pic-note">${esc(stepNote)}</p>`);
    };
    paintNote(m.note);
    try {
      if (!painted) firstPaint(m.name);               // the photo itself while its maps load (the first picture took seconds)
      await cuffRef();
      let lv = await loadView(m.name, m.pk, m.ck, m.lw, m.tk); state.szC = 1; state.szF = 1;
      if (m.sz) {                                     // drawn sizes (preview): the note changes only for what was really resized
        lv = sizedView(lv, state.view, m.sideFlap ? { ...m.sz, f: 1 } : m.sz);   // a drawn side flap is not in the photo
        const need = k => m.sz[k] && Math.abs(m.sz[k] - 1) > 0.01 ? (SZ_REG[state.view][k] || []).length : 0, got = k => lv.szFound.filter(x => x === k).length;
        // the flap drawn on side photos shot with a jetted pocket: it is drawn at the chosen depth (no photo flap to find)
        const done = { f: !!m.sz.cm.f && (m.sideFlap || got('f') >= need('f')), c: !!m.sz.cm.c && got('c') >= need('c') };
        state.szC = done.c ? m.sz.c : 1; state.szF = m.sideFlap && done.f ? m.sz.f : 1;
        if (my === ticket && (done.f || done.c)) { m.note = m.noteSz(done); paintNote(m.note); }
      }
      const st = stackView(cuffView(lv)); monoSt = st;
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
      if (curBtn()) await loadBtn(curBtn());
      if (sleeveBtn()) await loadBtn(sleeveBtn());
      const lo = st.LN && state.lining && LININGS.find(x => x.id === state.lining);
      if (lo) await (lo.kind === 'positional' ? loadPosTex(lo, st) : loadLinTex(lo, state.zoom ? state.zoom.z : 1));
      await monoReady();
      if (state.cuffPanel) { state.zoom = null; state.zoomAt = null; await cuffPanelReady(); }   // the close-up is the whole picture: no zoom under it
      if (state.custom && state.zoom && state.ctileZ !== state.zoom.z) { state.ctile = linearTile(state.cup, 150 * state.zoom.z); state.ctileZ = state.zoom.z; }
      if (my !== ticket) return;                    // a newer choice arrived while loading
      if (state.zoom) busy.textContent = 'Zooming in…';
      requestAnimationFrame(() => setTimeout(() => {
        painted = true;
        if (state.zoom) drawZoom(st, state.custom ? state.ctile : state.ztile, state.zoom.zx, state.zoom.zy, state.zoom.z); else draw(st);
        if (state.diagram && state.view === 'front' && !state.zoom) drawConstruction(st, state.diagram);
        if (state.cuffPanel) drawCuffPanel();
        if (state.view === 'open' && !state.zoom) drawSleeveLining();
        if (st.name === 'side_elbow' && !state.zoom) drawElbow(st);
        paintMini(); popMini();                       // the small copy shows exactly what the big picture shows, zoom included
        if (state.melton && state.view === 'back' && !state.zoom) { drawMelton(); paintMini(); }
        $('#stage').classList.toggle('zoom', !!state.zoom); $('#stage').classList.toggle('cloth-zoom', !!state.zoom && state.zoom.z >= 5);
        $('#zoomHint').textContent = state.cuffPanel ? 'Pick Front, Side or another view to see the whole jacket' : state.zoom ? 'Tap again to zoom out'
          : state.viewNote || 'Tap the jacket to zoom into the cloth';   // the angles not shown are said right under the view tabs
        $('#zoomHint').classList.toggle('warn', !state.cuffPanel && !state.zoom && !!state.viewNote);
        if (my === ticket) { busy.hidden = true; clearTimeout(staleT); cv.classList.remove('stale'); }
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
    const w = c.match(/([\d.]+)% wool/), pes = c.match(/([\d.]+)% polyester/);
    if (c.includes('silk') && w && parseFloat(w[1]) >= 50 && !(pes && parseFloat(pes[1]) >= 10)) return 'silk';
    return w && parseFloat(w[1]) >= 50 ? 'blend' : 'other';
  }
  function weightOf(f) { return !f.weight ? 'unknown' : f.weight < 270 ? 'light' : f.weight <= 320 ? 'mid' : 'heavy'; }
  const num = f => f.code || f.id.replace('MB-', '');

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
    $('#count').textContent = list.length === FABRICS.length ? `Showing all ${FABRICS.length} sample fabrics. These are samples, not the full catalogue.`
      : `Showing ${list.length} of the ${FABRICS.length} sample fabrics. These are samples, not the full catalogue.`;
    $('#grid').innerHTML = list.length ? list.map(f => {
      const s = STAFF && STAFF[f.id];
      return `<div class="fab-cell"><button type="button" class="fab${state.fabric && state.fabric.id === f.id && !state.custom && (state.fabricPicked || STAFF) ? ' on' : ''}" data-id="${f.id}">
        <img src="thumbs/${f.id}.jpg?v=${VER}" alt="" loading="lazy" width="160" height="160" onerror="if(!this.dataset.r){this.dataset.r=1;setTimeout(()=>{this.src=this.src+'&r=1'},800)}"><b>No. ${num(f)}</b><small>${esc(f.name)}</small>${s ? `<small class="code">${esc(s.code)}${s.band ? ` · ${esc(s.band)}` : ''}</small>` : ''}</button>` +
        `<button type="button" class="pv-open" data-pv-open="${f.id}" aria-label="See No. ${num(f)} close up${PREV[f.id] ? ' and draped' : ''}"><span class="pv-w">Close-up${PREV[f.id] ? ' · Drape' : ''}</span>${PV_ICONS[PREV[f.id] ? 1 : 0]}</button></div>`;
    }).join('') : '<p class="empty">No fabric matches these filters.</p>';
  }
  function paintChosen() {
    const el = $('#chosen');
    if (state.custom) { el.innerHTML = '<div><b>Your uploaded swatch</b><small>Only on this screen, not saved.</small></div>'; return; }
    const f = state.fabric; if (!f) return;
    const s = STAFF && STAFF[f.id];
    el.innerHTML = `<button type="button" class="sw-open" title="See the swatch photo"><img src="thumbs/${f.id}.jpg?v=${VER}" alt="Swatch"></button><div><b>No. ${num(f)} · ${esc(f.name)}${f.italian ? ' <span class="tag">Italian cloth</span>' : ''}</b>
      <small>${f.composition ? esc(f.composition) : 'Composition to follow'}${f.weight ? ` · ${f.weight} g` : ''} · ${f.use === 'Blazer' ? 'Blazer cloth' : f.use === 'Bekeshe' ? 'Bekeshe cloth' : 'Suit cloth'} · ${SEASONS[f.season] || ''}</small>
      ${f.preview ? `<small class="prev-note">${esc(f.preview)}</small>` : ''}
      <button type="button" class="sw-link">See the real swatch photo</button>
      ${!state.fabricPicked && !STAFF ? '<small class="chosen-wait">Shown on the jacket as an example. Tap a swatch below to choose your fabric.</small>' : ''}
      ${s ? `<small class="staffline">Factory code ${esc(s.code)} · ${s.band ? `Band ${esc(s.band)}` : (s.usd ? `Cost $${esc(s.usd)}/m (band not set yet)` : 'Band not set yet')}${s.origin ? ` · ${esc(s.origin)}` : ''} · ${esc(s.book || '')}</small>` : ''}</div>`;
  }
  let sumRows = [];                                  // the last summary, for the request form hand-over (no codes)
  function paintSummary() {
    const f = state.fabric, s = f && STAFF && STAFF[f.id];
    const rows = [
      ['Design', state.mode === 'online' ? 'Online' : state.mode === 'inperson' ? `In person${state.location ? ', ' + LOCS[state.location] : ''}` : 'Not chosen', ''],
      ['Building', { suit: 'Full suit (jacket now, trousers coming soon)', jacket: 'Jacket only', pants: 'Trousers only', bekeshe: `Bekeshe, $${START_PRICE.bekeshe} (belt included)` }[state.build] || 'Jacket', ''],
      ['Fabric', state.custom ? 'Uploaded swatch' : `No. ${num(f)}, ${f.name}`, s && !state.custom ? `${s.code} · band ${s.band || 'not set yet'}` : ''],
      ['Cloth', state.custom ? '' : `${f.composition || 'Composition to follow'}${f.weight ? `, ${f.weight} g` : ''}`, '']
    ];
    let sec = '';
    const tn = k => state.thread[k] ? threadName(state.thread[k]) : 'Matching the cloth', tc = k => { const yz = trimCode('threads', state.thread[k]); return yz ? `${yz}${STAFF._mono && STAFF._mono.yz[yz] ? ' · ' + STAFF._mono.yz[yz] : ''}` : ''; };
    for (const o of OPTS) {
      const c = choiceOf(o.id) || {};
      const so = STAFF && STAFF._opts ? STAFF._opts[o.id] : null;
      const code = so ? `${so.names[c.code] || c.code}${so.group ? ` · ${so.group} ${c.code}` : ''}` : '', val = c.label;
      if (o.section !== sec) { sec = o.section; rows.push([`<b>${sec}</b>`, '', '', true]); }
      rows.push([o.label, val, code]);
      // the lapel buttonhole thread right after the lapel, as on the Style step (owner, 21 Nov); none without a buttonhole
      if (o.id === 'lapel' && ((choiceOf('lapelHoleStyle') || {}).code || 'A') !== 'A') rows.push(['Lapel buttonhole thread', tn('lapel'), tc('lapel')]);
    }
    const bt = btnByCode(state.button), sbt = btnByCode(sleeveBtn()), ln = state.lining;
    const bc = trimCode('buttons', bt && bt.id), sc = trimCode('buttons', sbt && sbt.id);
    { // where the picture is approximate, the summary says so (the front and the inside views decide it)
      const v0 = state.view, notes = new Set();
      for (const v of isBk() ? ['front'] : ['front', 'open']) { state.view = v; const n = mapName().note; if (n && n.all) n.all.split(/(?<=\.)\s+(?=[A-Z])/).forEach(x => notes.add(x)); }
      state.view = v0;
      const keep = [...notes].filter(x => /Closest photo|Photo for/.test(x));
      if (!state.custom && f && f.preview) keep.push(f.preview);
      if (keep.length) rows.push(['About the picture', keep.join(' '), '']);
    }
    rows.push(['<b>Trims</b>', '', '', true]);
    if (isBk()) rows.push(['Buttons', 'Covered in the bekeshe cloth', '']);
    if (!isBk()) rows.push(['Front buttons', bt ? `${MAT[bt.mat] || 'Button'}, No. ${parseInt(bt.id.slice(1), 10)}` : 'As pictured (to be chosen)', bc ? bc.code : '']);
    if (!isBk()) rows.push(['Sleeve buttons', state.sleeveSame ? 'Same as the front' : (sbt ? `${MAT[sbt.mat] || 'Button'}, No. ${parseInt(sbt.id.slice(1), 10)}` : 'As pictured'),
      sc ? (sc.sleeve || sc.code) : '']);
    if (!isBk()) rows.push(['Button thread', tn('button'), tc('button')]);
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
    if (MONO && !isBk()) monoRows(rows);
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
    sumRows = rows;
    $('#summary').innerHTML = rows.map(([k, v, code, head]) => head ? `<dt class="sum-h">${k}</dt><dd></dd>` :
      `<dt>${k}</dt><dd>${esc(v || '')}${STAFF && code ? ` <span class="code">${esc(code)}</span>` : ''}</dd>`).join('');
  }

  function setupFilters() {
    const used = [...new Set(FABRICS.map(f => f.colour))].sort((a, b) => Object.keys(COLOURS).indexOf(a) - Object.keys(COLOURS).indexOf(b));
    $('#colours').innerHTML = used.map(c => `<button type="button" class="chip" data-c="${c}"><i style="background:${COLOURS[c] || '#999'}"></i>${c[0].toUpperCase() + c.slice(1)}</button>`).join('');
    const pats = [...new Set(FABRICS.map(f => f.pattern))];
    $('#fPattern').innerHTML = '<option value="">All</option>'; $('#fCloth').innerHTML = '<option value="">All</option>';   // rebuilt when the garment changes
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
      const pv = e.target.closest('[data-pv-open]'); if (pv) return openPreview(pv.dataset.pvOpen);
      const b = e.target.closest('[data-id]'); if (!b) return;
      state.fabric = FABRICS.find(f => f.id === b.dataset.id); state.custom = false; state.fabricPicked = true; state.reached = Math.max(state.reached, 1); paintSteps(); paintProgress(); goNext($('[data-next=fabric]'));
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
  const STYLE_HINT = { vent: 'See it in the Back view.', bkBelt: 'The length is made to your measurements.' };
  // every section is a row (current choice + its sketch) that opens into a grid of sketches, like the factory screen
  const skImg = (img, alt, eager) => img ? `<img src="${img.includes('/') ? img : 'sketch/' + img}?v=${VER}" alt=""${eager ? '' : ' loading="lazy"'} onerror="this.replaceWith(document.createTextNode(''))">` : `<span class="sk-none">${esc(alt || '')}</span>`;
  function stepRow(attr, label, cur, list, hint) {
    const c = list.find(x => x.v === cur) || list[0];
    return `<div class="step" ${attr}><button type="button" class="step-head"><span class="step-thumb">${c && c.img ? skImg(c.img, '', true) : ''}</span>` +
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
      if (o.id === 'lapel') html += '<div class="thread-row inline-thread" id="lapelThreadInline" hidden></div>';   // owner, 20 Nov: right after the lapel, before its width
    }
    $('#styleSteps').innerHTML = html;
    paintInlineThread();
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
    head.closest('.step').classList.toggle('open', open); g.hidden = !open;
    // opening another step leaves the construction diagram / cuff close-up behind: the picture returns to the jacket
    const id = head.closest('[data-step]') && head.closest('[data-step]').dataset.step;
    if ((state.diagram && id !== 'canvas') || (state.cuffPanel && !CUFF_STEPS.includes(id))) { state.diagram = null; state.cuffPanel = false; render(); }
    return true;
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
    ticket: ['front', 290, 960, 2.6], namecard: ['open', 512, 940, 1.7], vent: ['back', 512, 1090, 1.55], cuffButtons: SLEEVE, kissing: SLEEVE, sleeveHoleDir: SLEEVE,
    pick: ['front', 420, 560, 1.7], shoulder: ['front', 330, 520, 1.7], canvas: ['front'],
    facing: ['open'], liningStyle: ['open'], brandLabel: ['open', 512, 880, 1.7] };
  // the lapel buttonhole in its thread colour: the close-up of the chosen buttonhole style, or the lapel when none is chosen
  const showLapelThread = () => showPart(((choiceOf('lapelHoleStyle') || {}).code || 'A') !== 'A' ? 'lapelHoleStyle' : 'lapelHole');
  function showPart(id) {
    if (isBk()) {                                   // only the front photo: the lapels, or the sleeve end with its covered buttons
      state.view = 'front'; state.closeup = null; state.zoomAt = null;
      state.zoom = BK_SLEEVE.includes(id) ? zoomBox(215, 860, 2.2) : id === 'bkLapel' ? zoomBox(512, 420, 1.6) : null; return;
    }
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
  // elbow patch (staff): the photographed patch on the side photo, in the chosen suede's colour (its own light kept)
  function drawElbow(st) {
    const c = state.elbowFabric && CONTRAST.find(x => x.id === state.elbowFabric); if (!c || !c.rgb) return;
    if (!st.elbowPx) {                               // the patch: photo pixels (not cloth) inside the sleeve, by the elbow
      st.elbowPx = [];
      for (let y = 660; y < 1020; y++) for (let x = 470; x < 680; x++) { const i = y * W + x; if (!st.A[i] && st.B[i * 4 + 3] === 255 && st.B[i * 4] < 235) st.elbowPx.push(i); }
    }
    if (!st.elbowPx.length) return;
    const img = ctx.getImageData(0, 0, W, H), D = img.data; let m = 0;
    for (const i of st.elbowPx) m += D[i * 4] * 0.299 + D[i * 4 + 1] * 0.587 + D[i * 4 + 2] * 0.114;
    m /= st.elbowPx.length;
    for (const i of st.elbowPx) { const p = i * 4, l = (D[p] * 0.299 + D[p + 1] * 0.587 + D[p + 2] * 0.114) / (m || 1);
      D[p] = Math.min(255, c.rgb[0] * l); D[p + 1] = Math.min(255, c.rgb[1] * l); D[p + 2] = Math.min(255, c.rgb[2] * l); }
    ctx.putImageData(img, 0, 0);
  }
  // the sleeve lining when it differs from the body: the inside photos do not show the inside of the sleeves, so its
  // swatch is shown on the picture, named (owner, 17 Nov)
  let slImg = null, slImgId = '';
  function drawSleeveLining() {
    const id = !state.sleeveLinSame && state.sleeveLining; if (!id) return;
    const l = LININGS.find(x => x.id === id); if (!l) return;
    if (slImgId !== id) { slImgId = id; slImg = new Image(); slImg.onload = () => { if (state.view === 'open') render(); }; slImg.src = `linings/${id}.jpg?v=${VER}`; return; }
    if (!slImg || !slImg.complete || !slImg.naturalWidth) return;
    const x0 = 24, y0 = 24, sw = 150, sh = 105, name = l.name || liningName(id);
    ctx.save(); ctx.font = '600 30px system-ui, sans-serif';
    const tw = Math.max(ctx.measureText('Sleeve lining').width, ctx.measureText(name).width), bw = sw + tw + 56, bh = sh + 24;
    ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fillRect(x0, y0, bw, bh);
    ctx.drawImage(slImg, x0 + 12, y0 + 12, sw, sh); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.strokeRect(x0 + 12, y0 + 12, sw, sh);
    ctx.fillStyle = '#222'; ctx.fillText('Sleeve lining', x0 + sw + 32, y0 + 54); ctx.font = '400 28px system-ui, sans-serif'; ctx.fillText(name, x0 + sw + 32, y0 + 96);
    ctx.restore();
  }
  function drawConstruction(st, kind) {
    const full = /full/i.test(kind), half = !full && /half/i.test(kind), CUT = 820;   // half canvas: chest and lapels, to about the waist
    // tonal washes over the cloth, so its weave still shows (owner, 19 Nov: no flat fills): the canvas a natural linen
    // tone with a fine weave whose density shows the canvas's weight; the fused part a cool grey with a faint dot
    const weight = /ultra/i.test(kind) ? 'ultra' : /light/i.test(kind) ? 'light' : '';
    const LINEN = [205, 192, 166], FUSED = [158, 168, 182];
    const pitch = weight === 'ultra' ? 22 : weight === 'light' ? 15 : 10, wash = weight === 'ultra' ? 0.24 : weight === 'light' ? 0.32 : 0.4;
    const canvasA = (x, y) => wash + ((((x + y) % pitch) === 0 || (!weight && ((x - y + 4096) % pitch) === 0)) ? 0.22 : 0);
    const fusedA = (x, y) => 0.3 + ((x % 9 === 0 && y % 9 === 0) ? 0.25 : 0);
    const img = ctx.getImageData(0, 0, W, H), O = img.data;
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      if (!st.A[i] || x < 175 || x > 850 || st.OVP[i * 4 + 3]) continue;       // front panels only (not the sleeves), never the buttons
      const canvas = full || (half && y < CUT), c = canvas ? LINEN : FUSED;
      const a = st.A[i] * (canvas ? canvasA(x, y) : fusedA(x, y)), p = i * 4;
      for (let ch = 0; ch < 3; ch++) O[p + ch] = O[p + ch] * (1 - a) + c[ch] * a;
      if (half && Math.abs(y - CUT) < 1.5 && x % 12 < 7) { O[p] = O[p + 1] = O[p + 2] = 235; }   // where the canvas ends
    }
    ctx.putImageData(img, 0, 0);
    // the key: a quiet card, swatches drawn with the same washes
    const cn = weight === 'ultra' ? 'Ultra-thin canvas' : weight === 'light' ? 'Light canvas' : 'Canvas';
    const rows = full ? [['canvas', 'Canvas, sewn in: the whole front']]
      : half ? [['canvas', `${cn}, sewn in: chest and lapels`], ['fused', 'Fused (glued): below the chest']] : [['fused', 'Fused (glued): the whole front']];
    ctx.save();
    ctx.font = '400 30px system-ui, sans-serif';
    const tw = Math.max(...rows.map(r => ctx.measureText(r[1]).width), half ? 420 : 0), bw = Math.min(W - 40, tw + 150), bh = 92 + rows.length * 58 + (half ? 52 : 0);
    const bx = (W - bw) / 2, by0 = H - bh - 170;
    ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
    ctx.fillStyle = 'rgba(252,250,246,0.95)'; ctx.beginPath(); ctx.roundRect(bx, by0, bw, bh, 16); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#2b2a28'; ctx.font = '400 38px Georgia, "Times New Roman", serif'; ctx.fillText('Construction', bx + 32, by0 + 56);
    rows.forEach(([kd, t], k) => {
      const y = by0 + 88 + k * 58, sx = bx + 32, c = kd === 'canvas' ? LINEN : FUSED;
      ctx.fillStyle = `rgb(${c.map(v => Math.round(v * 0.82))})`; ctx.beginPath(); ctx.roundRect(sx, y, 56, 38, 8); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.roundRect(sx, y, 56, 38, 8); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
      if (kd === 'canvas') for (let d = -40; d < 100; d += pitch * 0.8) { ctx.beginPath(); ctx.moveTo(sx + d, y + 38); ctx.lineTo(sx + d + 38, y); ctx.stroke(); if (!weight) { ctx.beginPath(); ctx.moveTo(sx + d, y); ctx.lineTo(sx + d + 38, y + 38); ctx.stroke(); } }
      else { ctx.fillStyle = 'rgba(255,255,255,0.5)'; for (let a = 4; a < 56; a += 7) for (let b = 4; b < 38; b += 7) ctx.fillRect(sx + a, y + b, 1.6, 1.6); }
      ctx.restore();
      ctx.fillStyle = '#3a3936'; ctx.font = '400 30px system-ui, sans-serif'; ctx.fillText(t, sx + 76, y + 28);
    });
    if (half) {                                      // the canvas's weight: three bars
      const y = by0 + 88 + rows.length * 58 + 10, n = weight === 'ultra' ? 1 : weight === 'light' ? 2 : 3;
      ctx.fillStyle = '#6b665d'; ctx.font = '400 26px system-ui, sans-serif'; ctx.fillText('Canvas weight', bx + 32, y + 22);
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.roundRect(bx + 230 + k * 40, y + 4, 30, 20, 5);
        if (k < n) { ctx.fillStyle = '#8c7b5a'; ctx.fill(); } else { ctx.strokeStyle = '#b9ae98'; ctx.lineWidth = 2; ctx.stroke(); } }
      ctx.fillStyle = '#6b665d'; ctx.fillText(weight === 'ultra' ? 'ultra-thin' : weight === 'light' ? 'light' : 'standard', bx + 360, y + 22);
    }
    ctx.restore();
  }
  const CUFF_STEPS = ['cuffButtons', 'kissing', 'sleeveHoleDir'];
  function setOpt(id, v) {
    state.opts[id] = v; state.melton = false; state.lastStep = id; state.cuffPanel = !isBk() && CUFF_STEPS.includes(id);
    state.diagram = id === 'canvas' ? (choiceOf('canvas') || {}).label || '' : null;
    if (id === 'cuffButtons') paintThreads();
    showPart(id); render();
  }
  $('#styleSteps').onclick = e => {
    const tc = e.target.closest('#lapelThreadInline [data-c]');
    if (tc) {
      state.thread.lapel = tc.dataset.c || null; paintThreads(); showLapelThread(); render();
      openNext(document.querySelector('[data-step="lapel"]'), '#styleSteps .step', $('[data-next=style]'));
      return;
    }
    if (toggleStep(e)) return;
    const b = e.target.closest('.sk'); if (!b) return;
    const st = b.closest('[data-step]'), id = st.dataset.step;
    st.querySelectorAll('.sk').forEach(x => x.classList.toggle('on', x === b));
    const o = optOf(id), c = o.choices.find(x => x.code === b.dataset.v);
    st.querySelector('.step-txt small').textContent = c ? c.label : '';
    st.querySelector('.step-thumb').innerHTML = c && c.img ? skImg(c.img) : '';
    closeStep(b);
    setOpt(id, b.dataset.v);
    if (id === 'lapelHoleStyle') paintInlineThread();   // 'None' hides the thread colour (no buttonhole)
    if (id === 'lapel') {                           // the lapel buttonhole thread colour comes right after the lapel
      paintInlineThread(); const box = document.getElementById('lapelThreadInline');
      if (box && !box.hidden) { setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120); return; }
    }
    openNext(document.querySelector(`[data-step="${id}"]`), '#styleSteps .step', $('[data-next=style]'));
  };
  // after a choice the next section opens by itself, its options in view (below the picture on phones)
  function openNext(st, sel, last) {
    const all = [...document.querySelectorAll(sel)].filter(x => x.offsetParent !== null), nx = all[all.indexOf(st) + 1];
    if (!nx) return goNext(last);
    nx.classList.add('open'); nx.querySelector('.sk-grid').hidden = false;
    setTimeout(() => nx.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }

  // show a part of the jacket close up (front view), e.g. the buttons right after choosing them
  function zoomTo(x, y) {                          // a lapel / stitching close-up or a diagram from another step must not stay on
    state.closeup = null; state.zoomAt = null; state.diagram = null; state.cuffPanel = false;
    state.view = 'front'; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === 'front'));
    state.zoom = zoomBox(x, y);
  }
  const FRONT_BTN = [500, 940], SLEEVE_BTN = [70, 1250];      // where the buttons sit on the front photos
  // phones: a small copy of the jacket follows the customer down the page while the big picture is out of view
  const onSummary = () => !!document.querySelector('.tabs button.on[data-tab=summary]');
  let stageOff = false;                           // the summary has the big picture on top: no floating copy there
  const updMini = () => { mini.hidden = !(stageOff && innerWidth <= 900 && !$('#designer').hidden && !onSummary()); if (mini.hidden) mini.classList.remove('big'); };
  // the copy shows big for a moment after a change, then shrinks to a small round button in the corner, so it never
  // sits on the options being chosen; scrolling shrinks it at once
  let miniT = 0, popAt = 0;
  function popMini() {
    if (mini.hidden) return;
    popAt = Date.now(); mini.classList.add('big'); clearTimeout(miniT); miniT = setTimeout(() => mini.classList.remove('big'), 2600);
  }
  addEventListener('scroll', () => {                // the customer scrolling (not the page's own move to the next step)
    if (mini.classList.contains('big') && Date.now() - popAt > 1500) { clearTimeout(miniT); miniT = setTimeout(() => mini.classList.remove('big'), 300); }
  }, { passive: true });
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
  $('#sleeveGrid').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; state.sleeveButton = b.dataset.b || null; paintButtons(); if (state.sleeveButton) zoomTo(...SLEEVE_BTN); state.cuffPanel = !isBk(); render(); goNext($('#hThreads')); };
  $('#sleeveSeg').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; state.sleeveSame = b.dataset.v === 'same';
    paintButtons(); paintSummary(); if (!state.sleeveSame) zoomTo(...SLEEVE_BTN); render(); };
  $('#sleeveMat').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; sleeveFilter = b.dataset.m; paintButtons(); };

  const rgbCss = c => `rgb(${c.join(',')})`;
  function palette(cur, key) {
    return `<div class="pal" data-t="${key}"><button type="button" class="match${!cur ? ' on' : ''}" data-c="">Match the cloth</button>` +
      THREADS.map(t => `<button type="button" data-c="${t.id}" title="${threadName(t.id)}${trimCode('threads', t.id) ? ' · ' + trimCode('threads', t.id) : ''}" style="background:${rgbCss(t.rgb)}" class="${t.id === cur ? 'on' : ''}"></button>`).join('') + '</div>';
  }
  // the lapel buttonhole thread colour: right after the lapel (its only place; it left Trims on 20 Nov)
  function paintInlineThread() {
    const box = document.getElementById('lapelThreadInline'); if (!box) return;
    const style = (choiceOf('lapelHoleStyle') || {}).code || 'A';
    box.hidden = style === 'A';                     // 'None': no buttonhole, so no thread to choose
    box.innerHTML = `<b>Lapel buttonhole thread colour</b>${palette(state.thread.lapel, 'lapel')}`;
  }
  function paintThreads() {
    const n = sleeveHoles(), sel = Math.min(state.holeSel, n);
    const dot = c => { const t = THREADS.find(x => x.id === c); return `<i style="background:${t ? rgbCss(t.rgb) : 'transparent'}"></i>`; };
    const holes = `<div class="sleeve-holes"><button type="button" data-h="0" class="${sel === 0 ? 'on' : ''}">All holes</button>` +
      Array.from({ length: n }, (_, i) => `<button type="button" data-h="${i + 1}" class="${sel === i + 1 ? 'on' : ''}">${dot(state.thread.sleeve[i])}Hole ${i + 1}</button>`).join('') + '</div>';
    const cur = sel ? state.thread.sleeve[sel - 1] : (state.thread.sleeve.slice(0, n).every(c => c === state.thread.sleeve[0]) ? state.thread.sleeve[0] : undefined);
    paintInlineThread();
    $('#threadRows').innerHTML =
      `<div class="thread-row"><b>Button thread</b>${!state.button && state.thread.button ? '<p class="hint">Shown on a dark horn button until you choose your buttons above.</p>' : ''}${palette(state.thread.button, 'button')}</div>` +
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
    // show where the thread goes, in the new colour: the front buttons, the lapel buttonhole (zoomed once the photo
    // is loaded), the sleeve holes; then redraw (the lapel and staff-only holes used to update the summary only)
    if (key === 'button' || key === 'front') zoomTo(...FRONT_BTN);
    else if (key === 'lapel') showLapelThread();
    else if (key === 'sleeve') { showPart('cuffButtons'); state.cuffPanel = !isBk(); }
    if (key !== 'sleeve') state.cuffPanel = false;
    render();
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
  $('#sleeveLinSame').onchange = e => { state.sleeveLinSame = e.target.checked; paintLinings(); paintSummary(); showInside(); };
  $('#sleeveLinGrid').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; state.sleeveLining = b.dataset.l || null; paintLinings(); paintSummary(); showInside(); goNext($('#hMono')); };
  function showInside() { state.cuffPanel = false; state.diagram = null; state.view = 'open'; state.zoom = null; $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === 'open')); render(); }
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
  $('#ucGrid').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; state.undercollar = b.dataset.c || null; paintContrast(); paintSummary();
    // the undercollar seen from behind with the collar turned up, in the chosen melton
    state.view = 'back'; state.zoom = null; state.closeup = null; state.melton = true; $$('#views button').forEach(x => x.classList.toggle('on', x.dataset.view === 'back')); render(); };
  $('#elbowSeg').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; state.elbow = b.dataset.v;
    state.view = 'side'; state.zoom = null; $$('#views button').forEach(x => x.classList.toggle('on', x.dataset.view === 'side')); render();
    if (state.elbow && !state.elbowFabric) state.elbowFabric = (CONTRAST.find(c => c.kind === 'suede') || {}).id || null;
    paintContrast(); paintSummary(); };
  $('#elbowGrid').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; state.elbowFabric = b.dataset.c; paintContrast(); paintSummary(); render(); };

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
      html += `<p class="hint">Your own drawing is not shown on the picture. We will contact you to confirm size, colours and placement before ordering.</p>`;
    }
    if (m.type !== 'drawing') html += `<div class="thread-row"><b>Thread colour</b>${palette(m.colour, 'mono')}</div>`;
    html += row('pos', 'Position', m.pos || '', [{ v: '', label: 'Choose a position' }].concat(M.positions.map(p => ({ v: p.id, label: p.name, img: p.img && 'mono/' + p.img }))));
    const H = m.type === 'gallery' ? M.gHeights : M.heights;
    const hk = m.type === 'gallery' ? 'gheight' : 'height';
    html += row(hk, 'Height', m[hk] || '', [{ v: '', label: 'Standard' }].concat(H.map(h => ({ v: h.id, label: h.name, img: h.img && 'mono/' + h.img }))));
    $('#monoBox').innerHTML = html;
  }
  $('#monoType').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; cm().type = b.dataset.v; paintMono(); paintSummary(); render(); };
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
      rows.push(['Thread colour', m.colour ? threadName(m.colour) : 'Matching the cloth', S && m.colour ? `${yz} · ${S.groups['Embroidery Color']} ${S.colour[m.colour] || ''}` : '']);
    }
    rows.push(['Position', pick(M.positions, m.pos) || 'To be chosen', S && m.pos ? `${S.groups['Embroidery Position']} ${S.position[m.pos]}` : '']);
    const hid = m.type === 'gallery' ? m.gheight : m.height, H = m.type === 'gallery' ? M.gHeights : M.heights;
    rows.push(['Height', pick(H, hid) || 'Standard', S && hid ? `${S.groups['Embroidery Height']} ${hid}` : '']);
  }

  // ---------- hand-over to the request form: the design stays in this tab (sessionStorage) and the form opens with
  // ?request=design (window.MAGNOLIA_REQUEST_URL, default ../request-preview/). Public option choices and the customer's
  // summary text only (built with staff mode off): no factory codes. The form adds it to the chosen tailor's request.
  $('#sendToRequest').onclick = () => {
    try {
      const keep = STAFF; let rows = [];             // the customer's summary: staff rows and their codes never travel
      STAFF = null; try { paintSummary(); rows = sumRows; } finally { STAFF = keep; paintSummary(); }
      const plain = x => String(x || '').replace(/<[^>]*>/g, '').trim();
      const lines = rows.map(([k, v, , head]) => head ? `\n${plain(k).toUpperCase()}` : `${plain(k)}: ${plain(v)}`);
      const opts = {}; for (const o of OPTS) if (state.opts[o.id] != null && state.opts[o.id] !== '') opts[o.id] = String(state.opts[o.id]);
      const photos = [...Object.values(state.body), ...state.photos].filter(Boolean).map(x => x.name);
      const design = { garment: { jacket: 'Jacket', bekeshe: 'Bekeshe' }[state.build] || 'Suit', fabric: state.fabric && !state.custom ? { id: state.fabric.id, name: state.fabric.name } : null,
        options: opts, button: state.button, sleeveButton: state.sleeveSame ? state.button : state.sleeveButton, thread: state.thread, lining: state.lining,
        sleeveLining: state.sleeveLinSame ? state.lining : state.sleeveLining, monograms: state.monos.filter(m => m.type), notes: state.remark, photos,
        summary: lines.join('\n').trim(), location: state.mode === 'inperson' ? state.location : '', mode: state.mode };
      sessionStorage.setItem('magnolia_customer_design', JSON.stringify(design));
      location.href = (window.MAGNOLIA_REQUEST_URL || '../request-preview/') + '?request=design';
    } catch (e) { $('#transferError').textContent = 'Could not keep your design in this browser. Keep this page open and copy your choices before going to the request form.'; }
  };

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
  $$('[data-start]').forEach(e => { e.textContent = '$' + START_PRICE[e.dataset.start]; });
  function showWelcome(w) {
    $('#welcome').hidden = false; $('#designer').hidden = true; $('#restartBtn').hidden = true; busy.hidden = true;
    $$('.w-screen').forEach(x => { x.hidden = x.dataset.w !== w; });
    if (w === 'mode') { $$('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode)); $('#wLocs').hidden = state.mode !== 'inperson'; }
    if (w === 'build') {
      const from = START_PRICE[state.mode === 'online' ? 'online' : 'inperson'];
      $('[data-price=suit]').textContent = `From $${from}`;
      $('#wBuildNote').textContent = '';
    }
    window.scrollTo(0, 0); stageCompact(false); placeWa();
  }
  function startDesigner() {
    $('#welcome').hidden = true; $('#designer').hidden = false; $('#restartBtn').hidden = false;
    store.set('mb_flow', JSON.stringify({ mode: state.mode, location: state.location, build: state.build }));
    applyBuild(); paintProgress(); paintSummary(); render(); placeWa();
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
  $('#views').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; if (b.dataset.view === 'cuff') return;
    if (!viewOk(b.dataset.view)) { toast(`There is no ${b.textContent.toLowerCase()} photo of the ${((choiceOf('front') || {}).label || 'chosen front').toLowerCase()} yet, so this angle is not shown (it would show a different jacket). Your choice is saved for the order.`); return; }
    state.view = b.dataset.view; state.cuffPanel = false; state.diagram = null; state.closeup = null; state.zoom = null; state.melton = false; $$('#views button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  // steps in order: a customer cannot open Style before choosing a fabric, Trims before Style, and so on (staff can jump)
  const STEPS_ORDER = ['fabric', 'style', 'trims', 'summary'];
  function showTab(name) {
    const had = state.diagram || state.cuffPanel || state.zoom || state.zoomAt || state.closeup;
    state.diagram = null; state.cuffPanel = false; state.zoom = null; state.zoomAt = null; state.closeup = null;          // a diagram / close-up belongs to its own step: redrawn without it
    const ln = $('#lookNote'); if (ln) ln.hidden = true;
    $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
    updMini();
    $$('.tab').forEach(p => { p.hidden = p.dataset.pane !== name; });
    if (had) render();
    $('.panel').scrollTop = 0;
    if (innerWidth <= 900) {                        // phones: the step starts at its top, right under the (sticky) jacket
      stageCompact(true);
      const panelTop = $('.panel').getBoundingClientRect().top + scrollY, stageH = $('#stage').getBoundingClientRect().height;
      window.scrollTo(0, Math.max(0, panelTop - stageH));
    }
    paintProgress();
  }
  function paintSteps() {
    $$('.tabs button').forEach(b => b.classList.toggle('locked', !STAFF && STEPS_ORDER.indexOf(b.dataset.tab) > state.reached));
    const fb = $('[data-next=fabric]');
    const need = !state.fabricPicked && !STAFF;
    fb.disabled = false; fb.classList.toggle('wait', need); fb.setAttribute('aria-disabled', need ? 'true' : 'false');   // tappable: a tap says why
    fb.nextElementSibling.textContent = need ? 'Choose a fabric first: tap one of the swatches above.' : '';
    fb.nextElementSibling.classList.toggle('need', need);
  }
  $$('.tabs button').forEach(b => b.onclick = () => {
    const i = STEPS_ORDER.indexOf(b.dataset.tab);
    if (!STAFF && i > state.reached) {
      const need = STEPS_ORDER[state.reached];
      if (need === 'fabric') { toast('Choose a fabric first: tap one of the swatches.'); return; }
      toast(`Please finish the ${need[0].toUpperCase() + need.slice(1)} step first, then tap Next.`); return;
    }
    showTab(b.dataset.tab);
  });
  // Back beside Next on every step: the previous step, every choice kept (the state is not touched)
  $$('.back-btn').forEach(b => b.onclick = () => showTab(b.dataset.back));
  $$('.next-btn').forEach(b => b.onclick = () => {
    const i = STEPS_ORDER.indexOf(b.dataset.next);
    if (b.disabled) return;
    if (b.classList.contains('wait')) { toast('Choose a fabric first: tap one of the swatches.'); $('#grid').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }   // the first row, under the picture
    state.reached = Math.max(state.reached, i + 1); paintSteps(); showTab(STEPS_ORDER[i + 1]);
  });
  let toastT;
  // phones: while designing, the WhatsApp button sits in the picture's top corner (floating at the bottom it covered hints
  // and cards); on the welcome screens and wide screens it floats at the bottom right as before
  function placeWa() {
    const wa = $('#wa'); if (!wa) return;
    const inStage = innerWidth <= 900 && !$('#designer').hidden;
    if (inStage !== (wa.parentNode === $('#stage'))) { $('#waMenu').hidden = true; (inStage ? $('#stage') : document.body).appendChild(wa); }
    wa.classList.toggle('in-stage', inStage);
  }
  // phones: the sticky picture is smaller once the page is scrolled (it took about 40% of the screen); the panel's top
  // margin grows by the same amount, so nothing under it moves when it changes
  function stageCompact(on) {
    if (innerWidth > 900) on = false;
    if (on === compact) return; compact = on; document.body.classList.toggle('st-compact', on);
  }
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
  $('#chosen').onclick = e => { if (e.target.closest('.sw-open, .sw-link') && state.fabric && !state.custom) openPreview(state.fabric.id); };

  // ---------- fabric preview: Close-up first (actual swatch photo, zoom and drag), then Draped (the owner's video,
  // labelled when simulated); previous / next through the fabrics in the current filter; "Choose this fabric" selects it.
  // Fabrics without preview files show the swatch close-up and "Draped preview coming". previews.json comes from
  // build/import_previews.py; the videos load only when that fabric's Draped view is opened.
  let pvList = [], pvAt = 0, pvTab = 'close', zs = 1, zx = 0, zy = 0;
  const pvFab = () => FABRICS.concat(BKF).find(f => f.id === pvList[pvAt]);
  function openPreview(id) {
    pvList = FABRICS.filter(matches).map(f => f.id); if (!pvList.includes(id)) pvList = [id];
    pvAt = pvList.indexOf(id); pvTab = 'close'; $('#pvModal').hidden = false; paintPreview();   // the actual swatch first, then the drape (owner, 17 Nov)
    setTimeout(() => $('#pvClose').focus(), 0);
  }
  function closePreview() { const v = $('#pvVideo'); v.pause(); v.removeAttribute('src'); v.load(); $('#pvModal').hidden = true; }
  function zoomSet(s, cx, cy) {
    const box = $('#pvZoom').getBoundingClientRect(), ns = Math.min(4, Math.max(1, s));
    if (cx === undefined) { cx = box.width / 2; cy = box.height / 2; }
    zx = cx - (cx - zx) * ns / zs; zy = cy - (cy - zy) * ns / zs; zs = ns;
    zx = Math.min(0, Math.max(box.width - box.width * zs, zx)); zy = Math.min(0, Math.max(box.height - box.height * zs, zy));
    $('#pvImg').style.transform = `translate(${zx}px, ${zy}px) scale(${zs})`;
  }
  function paintPreview() {
    const f = pvFab(), p = PREV[f.id], v = $('#pvVideo');
    $('#pvTitle').textContent = `No. ${num(f)} · ${f.name}`;
    $('#pvSub').textContent = [f.composition || 'Composition to follow', SEASONS[f.season] || ''].filter(Boolean).join(' · ');
    $$('.pv-tabs button').forEach(b => b.classList.toggle('on', b.dataset.pv === pvTab));
    const drape = pvTab === 'drape';
    v.hidden = !(drape && p); $('#pvZoom').hidden = drape; $('#pvZbtns').hidden = drape;
    $('#pvMissing').hidden = !(drape && !p); $('#pvMissing').textContent = 'Draped preview coming for this fabric. The close-up shows the actual swatch.';
    if (drape && p) {
      v.poster = `${PVB}${p.poster}?v=${VER}`;
      v.onerror = () => { $('#pvNote').textContent = 'The draped video could not be played on this device; showing its still picture. ' + $('#pvNote').textContent; };
      if (v.getAttribute('src') !== `${PVB}${p.drape}?v=${VER}`) { v.src = `${PVB}${p.drape}?v=${VER}`; }
      v.play().catch(() => { /* autoplay refused: the poster stays, the customer can tap play */ });
    } else { v.pause(); }
    if (!drape) {                    // the untouched photo, else the labelled close-up, else the designer's swatch photo
      const img = $('#pvImg'), tries = (p ? [p.source, p.closeup].filter(Boolean).map(x => `${PVB}${x}?v=${VER}`) : []).concat(`swatch/${f.id}.jpg?v=${VER}`);
      let k = 0;
      img.onerror = () => {
        if (++k < tries.length) { img.src = tries[k]; return; }
        $('#pvZoom').hidden = true; $('#pvMissing').hidden = false; $('#pvMissing').textContent = 'The close-up could not be loaded right now. Please try again in a moment.';
      };
      img.dataset.tries = String(tries.length); img.src = tries[0];
      zs = 1; zx = 0; zy = 0; img.style.transform = '';
    }
    $('#pvNote').textContent = drape
      ? (p ? (p.simulated ? 'Simulated drape: the folds and light are simulated, not measured cloth behaviour. ' : '') + (p.colourChecked ? '' : 'Colours are approximate; your tailor shows you the real cloth.') : '')
      : `${f.id} · ${f.name} · ${f.composition || 'Composition to follow'}. Actual swatch photo` + (p && p.source ? ', unchanged' : '') + '. Colours approximate: screens vary, and your tailor shows you the real cloth. Zoom with + / −, a pinch or the mouse wheel; drag to move around.';
    $('#pvPos').textContent = `${pvAt + 1} of ${pvList.length}`;
    $('#pvPrev').disabled = pvAt === 0; $('#pvNext').disabled = pvAt === pvList.length - 1;
    const chosen = state.fabric && state.fabric.id === f.id && !state.custom;
    $('#pvChoose').textContent = chosen ? 'Chosen ✓' : 'Choose this fabric'; $('#pvChoose').disabled = chosen;
  }
  $('#pvClose').onclick = closePreview;
  $('#pvModal').onclick = e => { if (e.target.id === 'pvModal') closePreview(); };
  document.addEventListener('keydown', e => {
    if ($('#pvModal').hidden) return;
    if (e.key === 'Escape') closePreview();
    if (e.key === 'ArrowRight' && pvAt < pvList.length - 1) { pvAt++; paintPreview(); }
    if (e.key === 'ArrowLeft' && pvAt > 0) { pvAt--; paintPreview(); }
  });
  $('.pv-tabs').onclick = e => { const b = e.target.closest('[data-pv]'); if (b) { pvTab = b.dataset.pv; paintPreview(); } };
  $('#pvPrev').onclick = () => { if (pvAt > 0) { pvAt--; paintPreview(); } };
  $('#pvNext').onclick = () => { if (pvAt < pvList.length - 1) { pvAt++; paintPreview(); } };
  $('#pvChoose').onclick = () => {
    const f = pvFab(); state.fabric = f; state.custom = false; state.fabricPicked = true; state.reached = Math.max(state.reached, 1);
    paintSteps(); paintProgress(); store.set('mb_look', ''); paintSugg(); paintTips(); paintGrid(); render(); paintPreview();
  };
  $('#pvZbtns').onclick = e => { const b = e.target.closest('[data-z]'); if (b) zoomSet(zs * (+b.dataset.z > 0 ? 1.6 : 1 / 1.6)); };
  (() => {                                   // close-up: wheel and pinch zoom, drag to move, double tap to zoom in / out
    const z = $('#pvZoom'), pts = new Map(); let last = null, pinch = 0, tapT = 0;
    const rel = e => { const r = z.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    z.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = rel(e); zoomSet(zs * (e.deltaY < 0 ? 1.15 : 1 / 1.15), x, y); }, { passive: false });
    z.addEventListener('pointerdown', e => {
      z.setPointerCapture(e.pointerId); pts.set(e.pointerId, rel(e)); last = rel(e);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      if (pts.size === 1) { const now = Date.now(); if (now - tapT < 300) zoomSet(zs > 1.05 ? 1 : 2.5, ...rel(e)); tapT = now; }
    });
    z.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, rel(e));
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomSet(zs * d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch = d;
      } else if (last && zs > 1) {
        const [x, y] = rel(e); zx += x - last[0]; zy += y - last[1]; last = [x, y]; zoomSet(zs);
      }
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; last = pts.size ? [...pts.values()][0] : null; };
    z.addEventListener('pointerup', up); z.addEventListener('pointercancel', up);
  })();
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
      try { BKF = await get('bk_fabrics.json'); } catch (e) { BKF = []; }
      [FABRICS, OPTS, BUTTONS, SLEEVES, LININGS, THREADS, CONTRAST, MONO] = await Promise.all(['fabrics.json', 'options.json', 'buttons.json', 'sleeve_buttons.json', 'linings.json', 'threads.json', 'contrast.json', 'monogram.json'].map(get));
      try { SUGG = await get('suggestions.json'); } catch (e) { SUGG = null; }
      try { PREV = await get('previews.json'); } catch (e) { PREV = {}; }
      try { EXTRAS = await get('extras.json'); } catch (e) { /* no extra charges listed */ }
    } catch (e) { busy.textContent = 'Could not load the fabrics. Please refresh the page.'; return; }
    const byNo = (a, b) => parseInt(a.id.replace(/\D/g, ''), 10) - parseInt(b.id.replace(/\D/g, ''), 10) || (a.id < b.id ? -1 : 1);
    FABRICS.sort(byNo);                               // in number order, so every fabric is where the customer expects it (bekeshe cloths keep their book order)
    JF = FABRICS; JOPTS = OPTS;
    FABRICS.concat(BKF).forEach(f => { f._cloth = clothOf(f); f._weight = weightOf(f); });
    state.fabric = FABRICS.find(f => f.colour === 'navy' && f.pattern === 'solid' && f.use === 'Suit' && f.composition === '100% wool') || FABRICS[0];
    setupFilters(); paintGrid(); paintStyle(); paintButtons(); paintThreads(); paintLinings(); paintContrast(); paintMono(); paintExtras(); paintSteps(); paintSugg(); paintTips();
    let flow = null; try { flow = JSON.parse(store.get('mb_flow') || 'null'); } catch (e) { flow = null; }
    // the connected demo's start page opens the designer at "What are we building?" with the journey already chosen
    const qs = new URLSearchParams(location.search), jr = qs.get('journey'), jl = qs.get('loc');
    if (jr === 'online' || (jr === 'inperson' && LOCS[jl])) {
      store.set('mb_flow', ''); state.mode = jr; state.location = jr === 'inperson' ? jl : '';
      history.replaceState(null, '', location.pathname); showWelcome('build');
    } else if (flow && flow.build) { Object.assign(state, flow); startDesigner(); } else showWelcome('home');
    const pw = store.get('mb_staff');
    if (pw) { try { staffOn(await unlock(pw), pw); } catch (e) { store.set('mb_staff', ''); } }
  })();

  // floating WhatsApp: opens a small card with both numbers; closes on a click outside or Escape
  (() => {
    const btn = $('#waBtn'), menu = $('#waMenu');
    if (!btn) return;
    const set = open => { menu.hidden = !open; btn.setAttribute('aria-expanded', open); };
    btn.onclick = e => { e.stopPropagation(); set(menu.hidden); };
    document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) set(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  })();
  addEventListener('resize', () => { placeWa(); if (innerWidth > 900) stageCompact(false); });
  addEventListener('scroll', () => {                // phones: the picture shrinks once the options scroll under it, grows back at the top
    if (innerWidth > 900 || $('#designer').hidden) return;
    const top = $('#designer').offsetTop;
    if (!compact && scrollY > top + 40) stageCompact(true); else if (compact && scrollY < top + 8) stageCompact(false);
  }, { passive: true });
  placeWa();
})();
