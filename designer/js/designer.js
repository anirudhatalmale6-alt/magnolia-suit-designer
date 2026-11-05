(function () {
  const W = 1024, H = 1536, TILE = 512, VER = '25';      // bump VER when tiles/maps/data change (defeats browser cache)
  const PX_PER_CM = 150 / 9.8;               // jacket pixels per cm of cloth on these mannequin photos
  const ANG = new Float32Array(16); ANG[2] = 0.30; ANG[3] = -0.30;   // lapel grain (part id in warp.blue)
  const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = Math.pow(i / 255, 2.2);
  const OUTN = 4096, GAM = new Uint8Array(OUTN + 1); for (let i = 0; i <= OUTN; i++) GAM[i] = Math.round(255 * Math.pow(i / OUTN, 1 / 2.2));
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
    remark: '', photos: [null, null, null], prefit: 'No', urgent: 'normal' };
  const views = {}, tiles = {};
  let FABRICS = [], STAFF = null, OPTS = [], BUTTONS = [], SLEEVES = [], LININGS = [], THREADS = [], CONTRAST = [], MONO = null;

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
      const y0 = y * r, y1 = y0 + r;
      for (let x = 0; x < n; x++) {
        const x0 = x * r, x1 = x0 + r; let R = 0, G = 0, Bc = 0, wsum = 0;
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
    return { T: t, n };
  }

  // ---------- which photo to show ----------
  // what the customer picked, reduced to the photos we have
  const DB_FRONTS = ['8', '9', '10', '11', '12', '13'];
  function styleOf() {
    const lap = OPTS.length ? (choiceOf('lapel') || {}).label || '' : 'Notch';
    const lapel = /shawl/i.test(lap) ? 'shawl' : /peak/i.test(lap) ? 'peak' : 'notch';
    const front = state.opts.front || '2';
    return { lapel, db: DB_FRONTS.includes(front), front };
  }
  // factory pocket / vent codes grouped by the look we have a photo for
  const POCKET = { slant: 'G H I 9 10 23 25Y O Q R 13 14 24', jet: 'D E F K L N P T U V Y J S',
    patch: '15 18 19 20 233 234 235 236 237 238 5 6 7 BE DJ HMD M S1' };
  const pocketLook = c => Object.keys(POCKET).find(k => POCKET[k].split(' ').includes(c)) || 'flap';
  const ticketLook = c => c === 'D' ? '' : 'F G H I J'.split(' ').includes(c) ? 'flap' : 'jet';
  // photos by angle: [lapel, front, lower pocket look, ticket look] -> map folder
  const PHOTOS = {
    front: [['notch', '2', 'flap', '', 'front_notch_sb'], ['notch', '2', 'slant', '', 'front_notch_sb_slant'], ['notch', '2', 'patch', '', 'front_notch_sb_patch'],
      ['notch', '2', 'jet', '', 'front_notch_sb_jet'], ['notch', '2', 'flap', 'jet', 'front_notch_sb_tjet'], ['notch', '2', 'flap', 'flap', 'front_notch_sb_tflap'],
      ['notch', '3', 'flap', '', 'front_notch_sb3'], ['notch', '3', 'patch', '', 'front_notch_sb3_patch'], ['notch', '3', 'jet', 'jet', 'front_notch_sb3_jet_tjet'],
      ['notch', '5', 'flap', '', 'front_notch_sb3r2'], ['notch', '1', 'flap', '', 'front_notch_sb1'],
      ['shawl', '1', 'flap', '', 'front_shawl_sb1'], ['shawl', '3', 'jet', 'jet', 'front_shawl_sb3_jet_tjet'],
      ['peak', '2', 'flap', '', 'front_peak_sb'], ['peak', '3', 'flap', '', 'front_peak_sb3'], ['peak', '3', 'jet', 'jet', 'front_peak_sb3_jet_tjet'],
      ['peak', 'db', 'flap', '', 'front_peak_db'], ['peak', 'db4', 'flap', '', 'front_peak_db4'],
      // 5-nov photos (jetted pockets)
      ['peak', '5', 'jet', '', 'front_peak_sb3r2'], ['peak', '1', 'jet', '', 'front_peak_sb1'], ['shawl', '5', 'jet', '', 'front_shawl_sb3r2'],
      ['shawl', '2', 'jet', '', 'front_shawl_sb'], ['shawl', 'db', 'jet', '', 'front_shawl_db'], ['shawl', 'db4', 'jet', '', 'front_shawl_db4']],
    three4: [['notch', '2', 'flap', '', 'three4'], ['notch', '2', 'slant', '', 'three4_slant'], ['notch', '2', 'patch', '', 'three4_patch'],
      ['notch', '2', 'jet', '', 'three4_jet'], ['notch', '2', 'jet', 'jet', 'three4_jet_tjet'], ['notch', '2', 'flap', 'flap', 'three4_tflap'],
      ['notch', '3', 'flap', '', 'three4_notch_sb3'], ['shawl', '1', 'flap', '', 'three4_shawl_sb1'],
      ['peak', '2', 'flap', '', 'three4_peak_sb'], ['peak', '3', 'flap', '', 'three4_peak_sb3'], ['peak', 'db', 'flap', '', 'three4_peak_db'],
      ['notch', '1', 'jet', '', 'three4_notch_sb1'], ['notch', '5', 'jet', '', 'three4_notch_sb3r2'], ['notch', 'db', 'jet', '', 'three4_notch_db'],
      ['notch', 'db4', 'jet', '', 'three4_notch_db4'], ['peak', '1', 'jet', '', 'three4_peak_sb1'], ['peak', '5', 'jet', '', 'three4_peak_sb3r2'],
      ['peak', 'db4', 'jet', '', 'three4_peak_db4'], ['shawl', '2', 'jet', '', 'three4_shawl_sb'], ['shawl', '3', 'jet', '', 'three4_shawl_sb3'],
      ['shawl', '5', 'jet', '', 'three4_shawl_sb3r2'], ['shawl', 'db4', 'jet', '', 'three4_shawl_db4'], ['shawl', 'db', 'jet', '', 'three4_shawl_db']],
    side: [['notch', '2', 'flap', '', 'side'], ['peak', '2', 'flap', '', 'side_peak_sb'], ['peak', 'db', 'flap', '', 'side_peak_db'],
      ['notch', '1', 'jet', '', 'side_notch_sb1'], ['notch', '3', 'jet', '', 'side_notch_sb3'], ['notch', '5', 'jet', '', 'side_notch_sb3r2'],
      ['notch', 'db', 'jet', '', 'side_notch_db'], ['notch', 'db4', 'jet', '', 'side_notch_db4'], ['peak', '1', 'jet', '', 'side_peak_sb1'],
      ['peak', '3', 'jet', '', 'side_peak_sb3'], ['peak', '5', 'jet', '', 'side_peak_sb3r2'], ['peak', 'db4', 'jet', '', 'side_peak_db4'],
      ['shawl', '1', 'jet', '', 'side_shawl_sb1'], ['shawl', '2', 'jet', '', 'side_shawl_sb'], ['shawl', '3', 'jet', '', 'side_shawl_sb3'],
      ['shawl', '5', 'jet', '', 'side_shawl_sb3r2'], ['shawl', 'db4', 'jet', '', 'side_shawl_db4'], ['shawl', 'db', 'jet', '', 'side_shawl_db']]
  };
  function mapName() {
    const s = styleOf();
    if (state.view === 'back') {
      const v = state.opts.vent || 'C';
      return { name: v === 'A' ? 'back_none' : v === 'B' ? 'back_centre' : 'back', note: '' };
    }
    const want = { lapel: s.lapel, front: s.db ? (['8', '9', '11'].includes(s.front) ? 'db4' : 'db') : s.front,
      pocket: pocketLook(state.opts.lowerPocket || 'B'), ticket: ticketLook(state.opts.ticket || 'D') };
    // the lapel and closure matter most, then the pocket shape, then the ticket pocket
    let best = null, bestScore = -1;
    for (const [l, f, p, t, name] of PHOTOS[state.view]) {
      const sc = (l === want.lapel) * 100 + (f === want.front) * 60 + (f.startsWith('db') === want.front.startsWith('db')) * 50 + (f.startsWith('db') && want.front.startsWith('db')) * 20 + (p === want.pocket) * 10 + (t === want.ticket) * 3;
      if (sc > bestScore) { bestScore = sc; best = { l, f, p, t, name }; }
    }
    const miss = [];
    if (best.l !== want.lapel) miss.push(`${want.lapel} lapel`);
    if (best.f !== want.front) miss.push(((choiceOf('front') || {}).label || 'this front').toLowerCase());
    if (best.p !== want.pocket || best.t !== want.ticket) miss.push('these pockets');
    const note = miss.length ? `Closest photo shown. Photo for ${miss.join(' + ')} is coming. Your choice is saved for the order.` : '';
    return { name: best.name, note };
  }
  async function loadView(name) {
    if (views[name]) return views[name];
    const [base, shade, warp, ov] = await Promise.all(['base', 'shade', 'warp', 'overlay_photo'].map(n => loadImg(`maps/${name}/${n}.webp?v=${VER}`)));
    const B = pixels(base), S = pixels(shade), Wp = pixels(warp), OVP = pixels(ov);
    let meta = { frontal: [] };
    try { meta = await (await fetch(`maps/${name}/buttons.json?v=${VER}`)).json(); } catch (e) { /* no frontal buttons */ }
    let lsum = 0, lcnt = 0;
    for (let p = 0; p < OVP.length; p += 4) if (OVP[p + 3] > 128) { lsum += 0.299 * OVP[p] + 0.587 * OVP[p + 1] + 0.114 * OVP[p + 2]; lcnt++; }
    const n = W * H, U = new Float32Array(n), V = new Float32Array(n), A = new Float32Array(n), SH = new Float32Array(n);
    const cx = W / 2, cy = H * 0.35;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = B[p + 3];
      if (a === 255) continue;
      const x = i % W, y = (i / W) | 0, u = x + (Wp[p] - 128), v = y + (Wp[p + 1] - 128);
      const t = ANG[Wp[p + 2]] || 0, c = Math.cos(t), s = Math.sin(t);
      U[i] = (u - cx) * c - (v - cy) * s + cx; V[i] = (u - cx) * s + (v - cy) * c + cy;
      A[i] = 1 - a / 255; SH[i] = S[p] / 128;
    }
    return (views[name] = { B, S, Wp, U, V, A, SH, ov, OVP, meta, Lo: lcnt ? lsum / lcnt : 40, ovCache: {} });
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
    const T = state.tile.T, N = state.tile.n;
    const out = ctx.createImageData(W, H), O = out.data, B = st.B, n = W * H;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const k = st.A[i];
      if (!k) { O[p] = B[p]; O[p + 1] = B[p + 1]; O[p + 2] = B[p + 2]; O[p + 3] = 255; continue; }
      let u = st.U[i] % N, v = st.V[i] % N; if (u < 0) u += N; if (v < 0) v += N;
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
      const a = (y0 * N + x0) * 3, b = (y0 * N + x1) * 3, c = (y1 * N + x0) * 3, d = (y1 * N + x1) * 3, sh = st.SH[i];
      for (let ch = 0; ch < 3; ch++) {
        const top = T[a + ch] + (T[b + ch] - T[a + ch]) * fx, bot = T[c + ch] + (T[d + ch] - T[c + ch]) * fx;
        let lin = (top + (bot - top) * fy) * sh; if (lin > 1) lin = 1;
        O[p + ch] = B[p + ch] * (1 - k) + GAM[(lin * OUTN) | 0] * k;
      }
      O[p + 3] = 255;
    }
    ctx.putImageData(out, 0, 0); ctx.drawImage(overlayFor(st), 0, 0); drawDiscs(st, 0, 0, 1);
  }

  // Zoomed view: redraw only the tapped area at ZOOM x the resolution, sampling the maps between pixels and a
  // finer copy of the fabric, so the weave shows real detail instead of enlarged pixels.
  const ZOOM = 3;
  function drawZoom(st, tile, zx, zy) {
    const T = tile.T, N = tile.n, Z = ZOOM, cx = W / 2, cy = H * 0.35;
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
          if (u < 0) u += N; if (v < 0) v += N;
          const tx0 = u | 0, ty0 = v | 0, tfx = u - tx0, tfy = v - ty0, tx1 = (tx0 + 1) % N, ty1 = (ty0 + 1) % N;
          const a = (ty0 * N + tx0) * 3, b = (ty0 * N + tx1) * 3, c = (ty1 * N + tx0) * 3, d = (ty1 * N + tx1) * 3;
          const sh = (S[i00] * w00 + S[i01] * w01 + S[i10] * w10 + S[i11] * w11) / 128;
          const f = ch => {
            const top = T[a + ch] + (T[b + ch] - T[a + ch]) * tfx, bot = T[c + ch] + (T[d + ch] - T[c + ch]) * tfx;
            let lin = (top + (bot - top) * tfy) * sh; if (lin > 1) lin = 1;
            return GAM[(lin * OUTN) | 0] * k;
          };
          r += f(0); g += f(1); bl += f(2);
        }
        O[p] = r; O[p + 1] = g; O[p + 2] = bl; O[p + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    ctx.drawImage(overlayFor(st), zx, zy, W / Z, H / Z, 0, 0, W, H); drawDiscs(st, zx, zy, Z);
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
    $('#angleNote').hidden = !m.note; $('#angleNote').textContent = m.note || '';
    try {
      const st = await loadView(m.name);
      if (!state.custom) {
        const f = state.fabric;
        state.tile = await loadTile(f);
        if (state.zoom) state.ztile = await loadTile(f, ZOOM);
      }
      if (state.button) await loadBtn(state.button);
      if (my !== ticket) return;                    // a newer choice arrived while loading
      if (state.zoom) busy.textContent = 'Zooming in…';
      requestAnimationFrame(() => setTimeout(() => {
        if (state.zoom) drawZoom(st, state.custom ? state.ctile : state.ztile, state.zoom.zx, state.zoom.zy); else draw(st);
        paintMini();
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
    rows.push(['<b>Remarks</b>', '', '', true]);
    rows.push(['Remark', state.remark || 'None', '']);
    const np = state.photos.filter(Boolean).length; if (np) rows.push(['Photos', `${np} added`, '']);
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
      $$('#grid .fab').forEach(x => x.classList.toggle('on', x === b)); render();
    };
  }

  // ---------- style (factory options) ----------
  const optOf = id => OPTS.find(o => o.id === id);
  function choiceOf(id) { const o = optOf(id); return o && o.choices.find(c => c.code === (state.opts[id] || o.default)); }
  const sleeveHoles = () => +((choiceOf('cuffButtons') || {}).code || 4) || 4;
  const STYLE_HINT = { lowerPocket: 'Flap, slanted, patch and jetted pockets show in the picture. Every style goes on the order sheet.',
    chestPocket: 'The picture shows the standard chest pocket. Your choice goes on the order sheet.',
    vent: 'See it in the Back view.' };
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
      const list = o.show.map(code => o.choices.find(c => c.code === code)).filter(Boolean).map(c => ({ v: c.code, label: c.label, img: c.img }));
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
    paintHidden(); paintSummary(); goNext(document.querySelector(`[data-hstep="${hi + 1}"]`) || $('[data-next=style]'));
  };
  function setOpt(id, v) {
    state.opts[id] = v;
    if (id === 'front' && DB_FRONTS.includes(v) && (state.opts.lapel || 'BK') === 'BK') { state.opts.lapel = '20'; paintStyle(); }   // double-breasted comes with a peak lapel
    if (id === 'cuffButtons') paintThreads();
    if (['front', 'lapel', 'lowerPocket', 'ticket', 'vent'].includes(id)) render(); else paintSummary();
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
    const Z = ZOOM; state.zoom = { zx: Math.max(0, Math.min(W - W / Z, x - W / Z / 2)), zy: Math.max(0, Math.min(H - H / Z, y - H / Z / 2)) };
  }
  const FRONT_BTN = [500, 940], SLEEVE_BTN = [70, 1250];      // where the buttons sit on the front photos
  // phones: a small copy of the jacket follows the customer down the page while the big picture is out of view
  const mini = document.createElement('button'); mini.type = 'button'; mini.className = 'mini'; mini.hidden = true;
  mini.setAttribute('aria-label', 'Back to the jacket picture');
  const miniCv = document.createElement('canvas'); miniCv.width = 240; miniCv.height = 360; mini.appendChild(miniCv); document.body.appendChild(mini);
  function paintMini() { miniCv.getContext('2d').drawImage(cv, 0, 0, 240, 360); }
  mini.onclick = () => $('#stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if ('IntersectionObserver' in window) new IntersectionObserver(es => {
    const off = !es[0].isIntersecting;
    mini.hidden = !(off && innerWidth <= 900 && !$('#designer').hidden);
  }, { threshold: 0.15 }).observe($('#stage'));

  // ---------- trims: buttons, thread colours, lining ----------
  const MAT = { Horn: 'Horn', Corozo: 'Corozo', Shell: 'Shell', Metal: 'Metal', Pes: 'Polyester', Bone: 'Bone', Wood: 'Wood', Fabric: 'Covered', '': 'Button' };
  let btnFilter = '';
  function btnTiles(list, cur) {
    return `<button type="button" class="fab${!cur ? ' on' : ''}" data-b=""><span class="ph round">Standard</span><b>As pictured</b></button>` +
      list.map(b => `<button type="button" class="fab${b.id === cur ? ' on' : ''}" data-b="${b.id}"><img src="buttons/${b.id}.png?v=${VER}" alt="" loading="lazy" width="96" height="96"><b>${esc(MAT[b.mat] || 'Button')}</b>${trimCode('buttons', b.id) ? `<small class="code">${esc(trimCode('buttons', b.id).code)}</small>` : ''}</button>`).join('');
  }
  function paintButtons() {
    const mats = Object.keys(MAT).filter(m => BUTTONS.some(b => b.mat === m));
    $('#btnMat').innerHTML = ['<button type="button" class="chip' + (!btnFilter ? ' on' : '') + '" data-m="">All</button>']
      .concat(mats.map(m => `<button type="button" class="chip${btnFilter === m ? ' on' : ''}" data-m="${m}">${m ? MAT[m] : 'Other'}</button>`)).join('');
    const list = BUTTONS.filter(b => !btnFilter || b.mat === btnFilter);
    $('#btnGrid').innerHTML = btnTiles(list, state.button);
    $('#sleeveBtnBox').hidden = state.sleeveSame;
    if (!state.sleeveSame) $('#sleeveGrid').innerHTML = btnTiles(SLEEVES, state.sleeveButton);
  }
  $('#btnMat').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; btnFilter = b.dataset.m; paintButtons(); };
  $('#btnGrid').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; state.button = b.dataset.b || null; paintButtons(); if (state.button) zoomTo(...FRONT_BTN); render(); goNext($('#sleeveSame').closest('label')); };
  $('#sleeveGrid').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; state.sleeveButton = b.dataset.b || null; paintButtons(); if (state.sleeveButton) zoomTo(...SLEEVE_BTN); render(); goNext($('#hThreads')); };
  $('#sleeveSame').onchange = e => { state.sleeveSame = e.target.checked; paintButtons(); render(); };

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
    return `<button type="button" class="fab${l.id === cur ? ' on' : ''}" data-l="${l.id}"><img src="linings/${l.id}.jpg?v=${VER}" alt="" loading="lazy" width="150" height="105"><b>${l.name ? esc(l.name) : liningName(l.id)}</b>${code ? `<small class="code">${esc(code)}</small>` : ''}</button>`;
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
  $('#linGrid').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; state.lining = b.dataset.l || null; paintLinings(); paintSummary(); goNext($('#sleeveLinSame').closest('label')); };

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
  $('#monoBox').oninput = e => { if (e.target.id !== 'monoText') return; cm().text = e.target.value; $('#monoCount').textContent = `${cm().text.length}/${MONO.maxText}`; paintSummary(); };
  $('#monoBox').onchange = e => { if (e.target.id !== 'monoDraw' || !e.target.files[0]) return; cm().drawing = e.target.files[0].name; paintMono(); paintSummary(); };
  $('#monoBox').onclick = e => {
    if (toggleStep(e)) return;
    const sk = e.target.closest('.sk');
    const parts = () => [...document.querySelectorAll('#monoBox [data-mstep], #monoBox .thread-row')];
    if (sk) { const k = sk.closest('[data-mstep]').dataset.mstep; cm()[k] = sk.dataset.v || null; paintMono(); paintSummary();
      const ps = parts(), i = ps.findIndex(x => x.dataset.mstep === k); goNext(ps[i + 1] || $('[data-next=trims]')); return; }
    const c = e.target.closest('.pal [data-c]'); if (c) { cm().colour = c.dataset.c || null; paintMono(); paintSummary();
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
  function paintExtras() {
    $('#photoSlots').innerHTML = state.photos.map((p, i) => `<label class="photo-slot">${p ? `<img src="${p.url}" alt="">` : '<span>+ Photo</span>'}<input type="file" accept="image/*" data-ph="${i}"></label>`).join('');
    $('#prefitSeg').innerHTML = PREFIT.map(v => `<button type="button" data-v="${esc(v)}" class="${state.prefit === v ? 'on' : ''}">${esc(v)}</button>`).join('');
    $('#urgentSeg').innerHTML = URGENT.map(([v, l]) => `<button type="button" data-v="${v}" class="${state.urgent === v ? 'on' : ''}">${l}</button>`).join('');
  }
  $('#remark').oninput = e => { state.remark = e.target.value; $('#remarkCount').textContent = `${state.remark.length}/400`; paintSummary(); };
  $('#photoSlots').onchange = e => { const i = e.target.dataset.ph, f = e.target.files[0]; if (i == null || !f) return;
    if (state.photos[i]) URL.revokeObjectURL(state.photos[i].url);
    state.photos[i] = { name: f.name, url: URL.createObjectURL(f) }; paintExtras(); paintSummary(); };
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
  $('#views').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; state.view = b.dataset.view; $$('#views button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  // steps in order: a customer cannot open Style before choosing a fabric, Trims before Style, and so on (staff can jump)
  const STEPS_ORDER = ['fabric', 'style', 'trims', 'summary'];
  function showTab(name) {
    $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
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
    if (state.zoom) { state.zoom = null; render(); return; }
    const r = cv.getBoundingClientRect(), Z = ZOOM;
    const bx = (e.clientX - r.left) / r.width * W, by = (e.clientY - r.top) / r.height * H;
    state.zoom = { zx: Math.max(0, Math.min(W - W / Z, bx - W / Z / 2)), zy: Math.max(0, Math.min(H - H / Z, by - H / Z / 2)) };
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
      state.tile = linearTile(up, 150); state.ctile = linearTile(up, 150 * ZOOM); state.custom = true;
      $$('#grid .fab').forEach(b => b.classList.remove('on')); URL.revokeObjectURL(img.src); render();
    };
    img.src = URL.createObjectURL(file);
  };

  // ---------- start ----------
  (async function init() {
    try {
      const get = async n => (await fetch(`${n}?v=${VER}`)).json();
      [FABRICS, OPTS, BUTTONS, SLEEVES, LININGS, THREADS, CONTRAST, MONO] = await Promise.all(['fabrics.json', 'options.json', 'buttons.json', 'sleeve_buttons.json', 'linings.json', 'threads.json', 'contrast.json', 'monogram.json'].map(get));
    } catch (e) { busy.textContent = 'Could not load the fabrics. Please refresh the page.'; return; }
    FABRICS.forEach(f => { f._cloth = clothOf(f); f._weight = weightOf(f); });
    state.fabric = FABRICS.find(f => f.colour === 'navy' && f.pattern === 'solid' && f.use === 'Suit' && f.composition === '100% wool') || FABRICS[0];
    setupFilters(); paintGrid(); paintStyle(); paintButtons(); paintThreads(); paintLinings(); paintContrast(); paintMono(); paintExtras(); paintSteps();
    let flow = null; try { flow = JSON.parse(store.get('mb_flow') || 'null'); } catch (e) { flow = null; }
    if (flow && flow.build) { Object.assign(state, flow); startDesigner(); } else showWelcome('home');
    const pw = store.get('mb_staff');
    if (pw) { try { staffOn(await unlock(pw), pw); } catch (e) { store.set('mb_staff', ''); } }
  })();
})();
