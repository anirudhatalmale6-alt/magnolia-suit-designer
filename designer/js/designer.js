(function () {
  const W = 1024, H = 1536, TILE = 512, VER = '8';      // bump VER when tiles/maps/data change (defeats browser cache)
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
    lining: null, gorge: 'standard', lapelExact: null, holeSel: 0 };
  const views = {}, tiles = {};
  let FABRICS = [], STAFF = null, OPTS = [], BUTTONS = [], LININGS = [], THREADS = [];

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
  function mapName() {
    const s = styleOf(), notes = [];
    if (s.lapel === 'shawl') notes.push('shawl lapel');
    if (!['2', '12'].includes(s.front)) notes.push((choiceOf('front') || {}).label || 'this front');
    const note = notes.length ? `The photo for the ${notes.join(' and ').toLowerCase()} is coming. Shown with the closest style for now.` : '';
    if (state.view === 'back') return { name: 'back', note: '' };
    const peak = s.lapel === 'peak' || s.db;
    if (state.view === 'three4' || state.view === 'side') {
      if (s.db) return { name: `${state.view}_peak_db`, note };
      return { name: peak ? `${state.view}_peak_sb` : state.view, note };
    }
    if (s.db) return { name: 'front_peak_db', note };
    return { name: peak ? 'front_peak_sb' : 'front_notch_sb', note };
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
  const btnByCode = id => BUTTONS.find(b => b.id === id);
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
      const s = STAFF && STAFF[f.id] ? ` ${STAFF[f.id].code} ${STAFF[f.id].band}` : '';
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
      ['Fabric', state.custom ? 'Uploaded swatch' : `No. ${num(f)}, ${f.name}`, s && !state.custom ? `${s.code} · band ${s.band || 'not set yet'}` : ''],
      ['Cloth', state.custom ? '' : `${f.composition || 'Composition to follow'}${f.weight ? `, ${f.weight} g` : ''}`, '']
    ];
    let sec = '';
    for (const o of OPTS) {
      const c = choiceOf(o.id) || {};
      const g = STAFF && STAFF._opts ? STAFF._opts[o.id].group : '';
      let code = g && `${g} ${c.code}`, val = c.label;
      if (o.id === 'lapel') { const lc = lapelCode(); code = g && `${g} ${lc}`; if (state.gorge !== 'standard') val += `, ${state.gorge} gorge`; }
      if (o.section !== sec) { sec = o.section; rows.push([`<b>${sec}</b>`, '', '', true]); }
      rows.push([o.label, val, code]);
    }
    const bt = btnByCode(state.button), sbt = btnByCode(sleeveBtn()), ln = state.lining;
    const bc = trimCode('buttons', bt && bt.id), sc = trimCode('buttons', sbt && sbt.id);
    rows.push(['<b>Trims</b>', '', '', true]);
    rows.push(['Front buttons', bt ? `${MAT[bt.mat] || 'Button'}, No. ${parseInt(bt.id.slice(1), 10)}` : 'As pictured (to be chosen)', bc ? bc.code : '']);
    rows.push(['Sleeve buttons', state.sleeveSame ? 'Same as the front' : (sbt ? `${MAT[sbt.mat] || 'Button'}, No. ${parseInt(sbt.id.slice(1), 10)}` : 'As pictured'),
      sc ? (sc.sleeve || sc.code) : '']);
    const tn = k => state.thread[k] ? threadName(state.thread[k]) : 'Matching the cloth', tc = k => trimCode('threads', state.thread[k]) || '';
    rows.push(['Button thread', tn('button'), tc('button')]);
    rows.push(['Lapel buttonhole', tn('lapel'), tc('lapel')]);
    rows.push(['Front buttonholes', tn('front'), tc('front')]);
    const n = sleeveHoles(), sl = state.thread.sleeve.slice(0, n);
    rows.push(['Sleeve buttonholes', sl.some(Boolean) ? Array.from({ length: n }, (_, i) => `${i + 1}: ${sl[i] ? threadName(sl[i]) + (trimCode('threads', sl[i]) ? ` (${trimCode('threads', sl[i])})` : '') : 'match'}`).join(', ') : 'Matching the cloth', '']);
    rows.push(['Lining', ln ? liningName(ln) : 'Matching (to be chosen)', trimCode('linings', ln) || '']);
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
      state.fabric = FABRICS.find(f => f.id === b.dataset.id); state.custom = false;
      $$('#grid .fab').forEach(x => x.classList.toggle('on', x === b)); render();
    };
  }

  // ---------- style (factory options) ----------
  const optOf = id => OPTS.find(o => o.id === id);
  function choiceOf(id) { const o = optOf(id); return o && o.choices.find(c => c.code === (state.opts[id] || o.default)); }
  function lapelCode() {                           // exact factory lapel for the order sheet
    if (state.lapelExact) return state.lapelExact;
    const l = state.opts.lapel || 'BK';
    if (state.gorge === 'low') return l === 'BK' ? 'BL' : l === '20' ? '17' : l;
    return l;
  }
  const sleeveHoles = () => +((choiceOf('cuffButtons') || {}).code || 4) || 4;
  const STYLE_HINT = { lowerPocket: 'Pictures of other pocket styles are coming; your choice goes on the order sheet now.',
    chestPocket: 'Pictures of other pocket styles are coming; your choice goes on the order sheet now.',
    vent: 'The back view shows side vents for now; your choice goes on the order sheet.' };
  function paintStyle() {
    let sec = '', html = '';
    for (const o of OPTS) {
      if (o.section !== sec) { sec = o.section; html += `<p class="sec-title">${esc(sec)}</p>`; }
      const cur = state.opts[o.id] || o.default;
      const list = o.show.map(code => o.choices.find(c => c.code === code)).filter(Boolean);
      html += `<div class="step" data-step="${o.id}"><h3>${esc(o.label)}</h3>`;
      if (list.length <= 6) html += `<div class="seg">${list.map(c => `<button type="button" data-v="${esc(c.code)}" class="${c.code === cur ? 'on' : ''}">${esc(c.label)}</button>`).join('')}</div>`;
      else html += `<select data-sel="${o.id}">${list.slice().sort((a, b) => a.label.localeCompare(b.label)).map(c => `<option value="${esc(c.code)}"${c.code === cur ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`;
      if (STYLE_HINT[o.id]) html += `<p class="hint">${STYLE_HINT[o.id]}</p>`;
      html += '</div>';
    }
    $('#styleSteps').innerHTML = html;
    const names = STAFF && STAFF._opts ? STAFF._opts.lapel.names : {};
    $('#lapelExact').innerHTML = '<option value="">Follow the lapel above</option>' +
      Object.keys(names).filter(c => c !== 'Z998').map(c => `<option value="${esc(c)}"${c === state.lapelExact ? ' selected' : ''}>${esc(c)} · ${esc(names[c])}</option>`).join('');
  }
  function setOpt(id, v) {
    state.opts[id] = v;
    if (id === 'front' && DB_FRONTS.includes(v) && (state.opts.lapel || 'BK') === 'BK') { state.opts.lapel = '20'; paintStyle(); }   // double-breasted comes with a peak lapel
    if (id === 'cuffButtons') paintThreads();
    if (id === 'front' || id === 'lapel') render(); else paintSummary();
  }
  $('#styleSteps').onclick = e => {
    const b = e.target.closest('.seg [data-v]'); if (!b) return;
    b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    setOpt(b.closest('[data-step]').dataset.step, b.dataset.v);
  };
  $('#styleSteps').onchange = e => { const s = e.target.closest('[data-sel]'); if (s) setOpt(s.dataset.sel, s.value); };
  $('#gorge').onchange = e => { state.gorge = e.target.value; paintSummary(); };
  $('#lapelExact').onchange = e => { state.lapelExact = e.target.value || null; paintSummary(); };

  // ---------- trims: buttons, thread colours, lining ----------
  const MAT = { Horn: 'Horn', Shell: 'Shell', Metal: 'Metal', Pes: 'Polyester', Bone: 'Bone', Fabric: 'Covered', '': 'Button' };
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
    if (!state.sleeveSame) $('#sleeveGrid').innerHTML = btnTiles(BUTTONS.filter(b => b.sleeve), state.sleeveButton);
  }
  $('#btnMat').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; btnFilter = b.dataset.m; paintButtons(); };
  $('#btnGrid').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; state.button = b.dataset.b || null; paintButtons(); render(); };
  $('#sleeveGrid').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; state.sleeveButton = b.dataset.b || null; paintButtons(); render(); };
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
      `<div class="thread-row"><b>Front buttonholes</b>${palette(state.thread.front, 'front')}</div>` +
      `<div class="thread-row"><b>Sleeve buttonholes</b><p class="hint">Pick a colour for all holes, or choose a hole first to give it its own colour.</p>${holes}${palette(cur, 'sleeve')}</div>`;
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
    if (key === 'button') render(); else paintSummary();
  };
  const liningName = id => `Lining ${parseInt(id.slice(1), 10)}`;
  function paintLinings() {
    $('#linGrid').innerHTML = `<button type="button" class="fab${!state.lining ? ' on' : ''}" data-l=""><span class="ph">Tone on tone</span><b>Matching</b><small>We choose a tone to suit the cloth</small></button>` +
      LININGS.filter(l => l.body).map(l => `<button type="button" class="fab${l.id === state.lining ? ' on' : ''}" data-l="${l.id}"><img src="linings/${l.id}.jpg?v=${VER}" alt="" loading="lazy" width="150" height="105"><b>${liningName(l.id)}</b>${trimCode('linings', l.id) ? `<small class="code">${esc(trimCode('linings', l.id))}</small>` : ''}</button>`).join('');
  }
  $('#linGrid').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; state.lining = b.dataset.l || null; paintLinings(); paintSummary(); };

  // ---------- views / tabs ----------
  $('#views').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; state.view = b.dataset.view; $$('#views button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.tab').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  });
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
    paintGrid(); paintChosen(); paintSummary(); paintButtons(); paintLinings(); paintThreads(); paintStyle();
  }
  function staffOff() {
    STAFF = null; store.set('mb_staff', '');
    $('#staffBadge').hidden = true; $('#staffBtn').textContent = 'Staff';
    $$('.staff-only').forEach(x => { x.hidden = true; });
    $('#q').placeholder = 'Search by number, colour or cloth (e.g. 1042, navy, cashmere)';
    if (state.custom) { state.custom = false; render(); }
    paintGrid(); paintChosen(); paintSummary(); paintButtons(); paintLinings(); paintThreads(); paintStyle();
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
      [FABRICS, OPTS, BUTTONS, LININGS, THREADS] = await Promise.all(['fabrics.json', 'options.json', 'buttons.json', 'linings.json', 'threads.json'].map(get));
    } catch (e) { busy.textContent = 'Could not load the fabrics. Please refresh the page.'; return; }
    FABRICS.forEach(f => { f._cloth = clothOf(f); f._weight = weightOf(f); });
    state.fabric = FABRICS.find(f => f.colour === 'navy' && f.pattern === 'solid' && f.use === 'Suit' && f.composition === '100% wool') || FABRICS[0];
    setupFilters(); paintGrid(); paintStyle(); paintButtons(); paintThreads(); paintLinings(); render();
    const pw = store.get('mb_staff');
    if (pw) { try { staffOn(await unlock(pw), pw); } catch (e) { store.set('mb_staff', ''); } }
  })();
})();
