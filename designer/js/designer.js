(function () {
  const W = 1024, H = 1536, TILE = 512, VER = '5';      // bump VER when tiles/maps/data change (defeats browser cache)
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
  const state = { view: 'front', lapel: 'notch', closure: 'sb', fabric: null, tile: null, custom: false };
  const views = {}, tiles = {};
  let FABRICS = [], STAFF = null;

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
  function mapName() {
    if (state.view === 'back') return { name: 'back', note: false };
    if (state.view === 'three4' || state.view === 'side') {
      if (state.closure === 'db') return { name: `${state.view}_peak_db`, note: false };
      return { name: state.lapel === 'peak' ? `${state.view}_peak_sb` : state.view, note: false };
    }
    if (state.closure === 'db') return { name: 'front_peak_db', note: false };
    return { name: state.lapel === 'peak' ? 'front_peak_sb' : 'front_notch_sb', note: false };
  }

  async function loadView(name) {
    if (views[name]) return views[name];
    const [base, shade, warp, ov] = await Promise.all(['base', 'shade', 'warp', 'overlay_photo'].map(n => loadImg(`maps/${name}/${n}.webp?v=${VER}`)));
    const B = pixels(base), S = pixels(shade), Wp = pixels(warp);
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
    return (views[name] = { B, U, V, A, SH, ov });
  }
  async function loadTile(f) { return tiles[f.id] || (tiles[f.id] = linearTile(pixels(await loadImg(`tiles/${f.id}.jpg?v=${VER}`)), f.tcm * PX_PER_CM)); }

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
    ctx.putImageData(out, 0, 0); ctx.drawImage(st.ov, 0, 0);
  }

  let ticket = 0;
  async function render() {
    const my = ++ticket, m = mapName();
    busy.hidden = false; busy.textContent = 'Updating…';
    $('#angleNote').hidden = !m.note;
    try {
      const st = await loadView(m.name);
      if (!state.custom) {
        const f = state.fabric;
        state.tile = await loadTile(f);
      }
      if (my !== ticket) return;                    // a newer choice arrived while loading
      requestAnimationFrame(() => { draw(st); if (my === ticket) busy.hidden = true; });
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
    el.innerHTML = `<img src="thumbs/${f.id}.jpg?v=${VER}" alt=""><div><b>No. ${num(f)} · ${esc(f.name)}${f.italian ? '<span class="tag">Italian cloth</span>' : ''}</b>
      <small>${f.composition ? esc(f.composition) : 'Composition to follow'}${f.weight ? ` · ${f.weight} g` : ''} · ${f.use === 'Blazer' ? 'Blazer cloth' : 'Suit cloth'} · ${SEASONS[f.season] || ''}</small>
      ${s ? `<small class="staffline">Factory code ${esc(s.code)} · Band ${esc(s.band || 'not set yet')}${s.origin ? ` · ${esc(s.origin)}` : ''} · ${esc(s.book || '')}</small>` : ''}</div>`;
  }
  function paintSummary() {
    const f = state.fabric, s = f && STAFF && STAFF[f.id];
    const rows = [
      ['Fabric', state.custom ? 'Uploaded swatch' : `No. ${num(f)}, ${f.name}`],
      ['Cloth', state.custom ? '' : `${f.composition || 'Composition to follow'}${f.weight ? `, ${f.weight} g` : ''}`],
      ['Lapel', state.closure === 'db' ? 'Peak' : state.lapel === 'peak' ? 'Peak' : 'Notch'],
      ['Front', state.closure === 'db' ? 'Double-breasted, 6 buttons' : 'Single-breasted, 2 buttons']
    ];
    if (s && !state.custom) rows.push(['Factory code', `${s.code} (band ${s.band || 'not set yet'})`]);
    $('#summary').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
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

  // ---------- style / views / tabs ----------
  function seg(sel, key, after) {
    $(sel).onclick = e => {
      const b = e.target.closest('[data-v]'); if (!b) return; state[key] = b.dataset.v;
      $$(`${sel} button`).forEach(x => x.classList.toggle('on', x === b)); after && after(); render();
    };
  }
  function syncLapel() {                           // double-breasted is offered with a peak lapel
    const db = state.closure === 'db';
    $$('#lapel button').forEach(b => { b.disabled = db && b.dataset.v === 'notch'; b.classList.toggle('on', db ? b.dataset.v === 'peak' : b.dataset.v === state.lapel); });
  }
  seg('#lapel', 'lapel'); seg('#closure', 'closure', syncLapel);
  $('#views').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; state.view = b.dataset.view; $$('#views button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.tab').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  });
  $('#stage').onclick = e => {
    if (e.target !== cv) return;
    const r = cv.getBoundingClientRect();
    cv.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    $('#stage').classList.toggle('zoom');
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
    paintGrid(); paintChosen(); paintSummary();
  }
  function staffOff() {
    STAFF = null; store.set('mb_staff', '');
    $('#staffBadge').hidden = true; $('#staffBtn').textContent = 'Staff';
    $$('.staff-only').forEach(x => { x.hidden = true; });
    $('#q').placeholder = 'Search by number, colour or cloth (e.g. 1042, navy, cashmere)';
    if (state.custom) { state.custom = false; render(); }
    paintGrid(); paintChosen(); paintSummary();
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
      state.tile = linearTile(x.getImageData(0, 0, TILE, TILE).data, 150); state.custom = true;
      $$('#grid .fab').forEach(b => b.classList.remove('on')); URL.revokeObjectURL(img.src); render();
    };
    img.src = URL.createObjectURL(file);
  };

  // ---------- start ----------
  (async function init() {
    try {
      FABRICS = await (await fetch(`fabrics.json?v=${VER}`)).json();
    } catch (e) { busy.textContent = 'Could not load the fabrics. Please refresh the page.'; return; }
    FABRICS.forEach(f => { f._cloth = clothOf(f); f._weight = weightOf(f); });
    state.fabric = FABRICS.find(f => f.colour === 'navy' && f.pattern === 'solid' && f.use === 'Suit' && f.composition === '100% wool') || FABRICS[0];
    setupFilters(); paintGrid(); syncLapel(); render();
    const pw = store.get('mb_staff');
    if (pw) { try { staffOn(await unlock(pw), pw); } catch (e) { store.set('mb_staff', ''); } }
  })();
})();
