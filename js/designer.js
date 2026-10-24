/* Customer-facing suit designer. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PIECES = [
    { id: 'suit', name: 'Full Suit', sub: 'Jacket & Pants' },
    { id: 'jacket', name: 'Jacket Only', sub: 'Blazer / sport coat' },
    { id: 'pants', name: 'Pants Only', sub: 'Trousers' }
  ];
  const KIND_VIEW = { linings: 'inside', felts: 'inside', monogram: 'inside', pantsFabric: 'pants', buttons: 'front', threads: 'front', fabric: null };

  let cfg, idx = 0, view = 'front', zoom = false, root;

  const cat = () => Store.catalog();
  const money = n => cat().settings.currency + Math.round(n).toLocaleString('en-US');
  const visible = l => (l || []).filter(x => x.visible !== false);

  // ---------- step list ----------
  function steps() {
    const all = cat().steps.filter(s => s.visible !== false);
    const piece = cfg.piece;
    let list = [{ id: 'start', group: 'start', title: 'Start' }];
    if (piece === 'pants') {
      list.push(Object.assign({}, all.find(s => s.id === 'fabric'), { group: 'pants' }));
      list = list.concat(all.filter(s => s.group === 'pants' && s.id !== 'pantsFabric'));
    } else {
      list = list.concat(all.filter(s => s.group === 'jacket'));
      if (piece === 'suit') list = list.concat(all.filter(s => s.group === 'pants'));
    }
    list.push({ id: 'review', group: 'review', title: 'Review & Send' });
    return list;
  }

  // ---------- pricing ----------
  function price(c, ct) {
    ct = ct || cat();
    const s = ct.settings;
    const fab = SuitRender.byId(ct.fabrics, c.fabric) || { price: 0 };
    const pf = c.pantsFabric && c.pantsFabric !== 'same' ? SuitRender.byId(ct.fabrics, c.pantsFabric) : fab;
    let base;
    if (c.piece === 'jacket') base = fab.price * s.jacketOnlyPct / 100;
    else if (c.piece === 'pants') base = fab.price * s.pantsOnlyPct / 100;
    else if (pf !== fab) base = fab.price * s.jacketOnlyPct / 100 + pf.price * s.pantsOnlyPct / 100;
    else base = fab.price;
    const lines = [];
    const groups = c.piece === 'pants' ? ['pants'] : c.piece === 'jacket' ? ['jacket'] : ['jacket', 'pants'];
    ct.steps.forEach(st => {
      if (!groups.includes(st.group) || !st.choices || st.visible === false) return;
      const ch = st.choices.find(x => x.id === c[st.id]);
      if (ch && ch.price) lines.push({ label: `${st.title}: ${ch.name}`, price: ch.price });
    });
    if (c.piece !== 'pants') {
      const lin = SuitRender.byId(ct.linings, c.lining);
      if (lin && lin.price) lines.push({ label: `Lining: ${lin.name}`, price: lin.price });
      const b = SuitRender.byId(ct.buttons, c.buttons);
      if (b && b.price) lines.push({ label: `Buttons: ${b.name}`, price: b.price });
    }
    const extras = lines.reduce((a, l) => a + l.price, 0);
    return { base, lines, extras, total: base + extras };
  }

  function labelFor(st, c, ct) {
    ct = ct || cat();
    const v = c[st.id];
    switch (st.kind) {
      case 'fabric': { const x = SuitRender.byId(ct.fabrics, c.fabric); return x ? `${x.name} (${x.type || 'Fabric'})` : '—'; }
      case 'pantsFabric': { if (!v || v === 'same') return 'Same as jacket'; const x = SuitRender.byId(ct.fabrics, v); return x ? x.name : '—'; }
      case 'linings': return (SuitRender.byId(ct.linings, v) || {}).name || '—';
      case 'buttons': return (SuitRender.byId(ct.buttons, v) || {}).name || '—';
      case 'threads': return ((ct.threads || []).find(x => x.id === v) || {}).name || '—';
      case 'felts': return ((ct.felts || []).find(x => x.id === v) || {}).name || '—';
      case 'monogram': return c.monogram ? `"${c.monogram}" — ${{ pocket: 'Inside pocket', collar: 'Under collar', none: 'None' }[c.monogramPlace] || ''}` : 'No monogram';
      default: { const ch = (st.choices || []).find(x => x.id === v); return ch ? ch.name : '—'; }
    }
  }

  function summary(c, ct) {
    ct = ct || cat();
    const piece = PIECES.find(p => p.id === c.piece) || PIECES[0];
    const rows = [{ group: 'Order', title: 'Piece', value: piece.name }];
    const groups = c.piece === 'pants' ? ['pants'] : c.piece === 'jacket' ? ['jacket'] : ['jacket', 'pants'];
    ct.steps.forEach(st => {
      if (st.visible === false) return;
      if (c.piece === 'pants' && st.id === 'fabric') { rows.push({ group: 'Pants', title: 'Fabric', value: labelFor(st, c, ct), id: st.id }); return; }
      if (!groups.includes(st.group)) return;
      if (c.piece === 'pants' && st.id === 'pantsFabric') return;
      rows.push({ group: st.group === 'jacket' ? 'Jacket' : 'Pants', title: st.title, value: labelFor(st, c, ct), id: st.id });
    });
    return rows;
  }

  // ---------- swatches ----------
  function fabricSwatch(item, size = 64) {
    const s = item.img ? (item.scale || 48) * 1.6 : 96;
    return `<span class="sw" style="background-image:url('${Textures.textureFor(item)}');background-size:${s}px"></span>`;
  }
  function buttonSwatch(b) {
    const id = 'bs' + b.id.replace(/\W/g, '');
    const fill = b.style === 'fabric' ? `url(#${id}p)` : `url(#${id})`;
    const fab = SuitRender.byId(cat().fabrics, cfg.fabric);
    const light = b.style === 'metal' ? '#fff8e0' : b.style === 'pearl' ? '#ffffff' : '#ffffff';
    return `<svg viewBox="0 0 40 40" class="btn-sw"><defs>
      <radialGradient id="${id}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="${light}" stop-opacity="${b.style === 'horn' ? 0.45 : 1}"/><stop offset=".45" stop-color="${b.color}"/><stop offset="1" stop-color="#000" stop-opacity=".9"/></radialGradient>
      <pattern id="${id}p" patternUnits="userSpaceOnUse" width="30" height="30"><image href="${Textures.textureFor(fab)}" width="30" height="30"/></pattern></defs>
      <circle cx="20" cy="20.8" r="15" fill="rgba(0,0,0,.25)"/>
      ${b.style === 'horn' ? `<circle cx="20" cy="20" r="15" fill="${b.color}"/>` : ''}
      <circle cx="20" cy="20" r="15" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width=".6"/>
      <circle cx="20" cy="20" r="11" fill="none" stroke="rgba(0,0,0,.25)"/>
      ${[[16.5, 16.5], [23.5, 16.5], [16.5, 23.5], [23.5, 23.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7" fill="rgba(0,0,0,.55)"/>`).join('')}
    </svg>`;
  }
  const colorDot = (col, fab) => col === 'match'
    ? fabricSwatch(fab || SuitRender.byId(cat().fabrics, cfg.fabric))
    : `<span class="sw" style="background:${col}"></span>`;

  // ---------- rendering ----------
  function mount(el, initialCfg) {
    root = el;
    cfg = Object.assign({}, DEFAULT_CONFIG, initialCfg || Store.draft() || {});
    idx = initialCfg && initialCfg.__review ? steps().length - 1 : (Store.draft() || initialCfg ? 1 : 0);
    delete cfg.__review;
    view = 'front';
    root.innerHTML = `
      <section class="designer">
        <div class="stage">
          <div class="stage-top">
            <div class="view-tabs" role="tablist"></div>
            <button class="icon-btn" data-act="zoom" title="Zoom in">
              <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6"/></svg>
            </button>
          </div>
          <div class="preview" id="preview"></div>
          <div class="stage-foot" id="stage-foot"></div>
        </div>
        <div class="panel">
          <div class="groups" id="groups"></div>
          <div class="chips" id="chips"></div>
          <div class="step-body" id="step-body"></div>
          <div class="panel-foot">
            <button class="btn ghost" data-act="back">&larr; Back</button>
            <div class="foot-price"><small>Estimated total</small><strong id="foot-price"></strong></div>
            <button class="btn primary" data-act="next">Next &rarr;</button>
          </div>
        </div>
      </section>`;
    root.onclick = onClick;
    root.oninput = onInput;
    go(idx, true);
  }

  function currentViews() {
    if (cfg.piece === 'pants') return [['pants', 'Pants']];
    const v = [['front', 'Front'], ['back', 'Back'], ['inside', 'Inside']];
    if (cfg.piece === 'suit') v.push(['pants', 'Pants']);
    return v;
  }

  function drawPreview() {
    const views = currentViews();
    if (!views.find(v => v[0] === view)) view = views[0][0];
    $('.view-tabs', root).innerHTML = views.map(([id, n]) =>
      `<button role="tab" class="${id === view ? 'on' : ''}" data-view="${id}">${n}</button>`).join('');
    let vb;
    if (zoom) vb = view === 'pants' || cfg.piece === 'pants' ? '110 40 280 300' : '110 40 280 300';
    $('#preview', root).innerHTML = SuitRender.render(cfg, cat(), { view, viewBox: vb });
    $('#preview', root).classList.toggle('zoomed', zoom);
    const fab = SuitRender.byId(cat().fabrics, cfg.fabric);
    const p = price(cfg);
    $('#stage-foot', root).innerHTML = `<span>${esc(fab ? fab.name : '')}</span><span class="dot">•</span><span>${esc((PIECES.find(x => x.id === cfg.piece) || {}).name)}</span><span class="grow"></span>
      <button class="link" data-act="share">Save design</button>`;
    $('#foot-price', root).textContent = money(p.total);
    Store.saveDraft(cfg);
  }

  function drawNav() {
    const list = steps();
    const st = list[idx];
    const groups = [['jacket', 'Jacket'], ['pants', 'Pants'], ['review', 'Review']].filter(([g]) => list.some(s => s.group === g));
    $('#groups', root).innerHTML = groups.map(([g, n]) => {
      const first = list.findIndex(s => s.group === g);
      return `<button class="${st.group === g ? 'on' : ''}" data-go="${first}">${n}</button>`;
    }).join('');
    const inGroup = list.map((s, i) => [s, i]).filter(([s]) => s.group === st.group && st.group !== 'start' && st.group !== 'review');
    $('#chips', root).innerHTML = inGroup.map(([s, i]) =>
      `<button class="${i === idx ? 'on' : ''}" data-go="${i}">${esc(s.title)}</button>`).join('');
    $('#chips', root).hidden = !inGroup.length;
    const on = $('#chips .on', root);
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    $('[data-act=back]', root).style.visibility = idx === 0 ? 'hidden' : 'visible';
    const nx = $('[data-act=next]', root);
    nx.style.display = st.id === 'review' ? 'none' : '';
    nx.innerHTML = list[idx + 1] && list[idx + 1].id === 'review' ? 'Review &rarr;' : 'Next &rarr;';
  }

  function go(i, first) {
    const list = steps();
    idx = Math.max(0, Math.min(i, list.length - 1));
    const st = list[idx];
    const v = st.view || KIND_VIEW[st.kind];
    if (v && currentViews().find(x => x[0] === v)) view = v;
    else if (st.group === 'jacket' && !v && view === 'pants') view = 'front';
    if (st.group === 'pants' && cfg.piece === 'suit' && !st.view && st.kind === 'fabric') view = 'pants';
    if (st.id === 'review' || st.id === 'start') view = cfg.piece === 'pants' ? 'pants' : 'front';
    drawNav();
    drawBody();
    drawPreview();
    if (!first && window.innerWidth < 900) $('.panel', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function choiceThumb(st, ch) {
    if (!st.zoom) return '';
    const c = Object.assign({}, cfg, { [st.id]: ch.id });
    if (st.view === 'pants' && c.piece === 'jacket') c.piece = 'suit';
    return SuitRender.render(c, cat(), { view: st.view, viewBox: st.zoom, cls: 'thumb-svg' });
  }

  function drawBody() {
    const st = steps()[idx];
    const body = $('#step-body', root);
    const head = `<div class="step-head"><h2>${esc(st.title)}</h2>${st.desc ? `<p>${esc(st.desc)}</p>` : ''}</div>`;
    let html = '';
    if (st.id === 'start') {
      const ct = cat();
      const fab = visible(ct.fabrics).reduce((a, b) => (a && a.price <= b.price ? a : b), null) || { price: 0 };
      html = `<div class="step-head"><h2 class="script">Let's begin</h2><p>What are we making? You can design another piece afterwards.</p></div>
        <div class="grid pieces">${PIECES.map(p => {
          const c = Object.assign({}, cfg, { piece: p.id });
          const from = p.id === 'suit' ? fab.price : fab.price * (p.id === 'jacket' ? ct.settings.jacketOnlyPct : ct.settings.pantsOnlyPct) / 100;
          return `<button class="opt piece ${cfg.piece === p.id ? 'on' : ''}" data-piece="${p.id}">
            <span class="thumb tall">${SuitRender.render(c, ct, { view: p.id === 'pants' ? 'pants' : 'front', cls: 'thumb-svg' })}</span>
            <b>${p.name}</b><small>${p.sub}</small><em>From ${money(from)}</em></button>`;
        }).join('')}</div>`;
    } else if (st.id === 'review') {
      html = reviewHtml();
    } else if (st.kind === 'fabric' || st.kind === 'pantsFabric') {
      const key = st.kind === 'fabric' ? 'fabric' : 'pantsFabric';
      const fabs = visible(cat().fabrics).slice().sort((a, b) => a.price - b.price);
      const tiers = [...new Set(fabs.map(f => f.price))];
      html = head;
      if (key === 'pantsFabric') {
        const jf = SuitRender.byId(cat().fabrics, cfg.fabric);
        html += `<div class="grid swatches"><button class="opt sw-opt ${cfg.pantsFabric === 'same' ? 'on' : ''}" data-set="pantsFabric" data-val="same">${fabricSwatch(jf)}<b>Same as Jacket</b><small>${esc(jf.name)}</small></button></div>`;
      }
      const label = cfg.piece === 'jacket' ? 'Jacket' : cfg.piece === 'pants' ? 'Pants' : 'Suit';
      const pct = cfg.piece === 'jacket' ? cat().settings.jacketOnlyPct / 100 : cfg.piece === 'pants' ? cat().settings.pantsOnlyPct / 100 : 1;
      tiers.forEach(t => {
        html += `<h3 class="tier">${key === 'pantsFabric' ? 'Contrast pants' : label} ${key === 'pantsFabric' ? '' : money(t * pct)}</h3><div class="grid swatches">` +
          fabs.filter(x => x.price === t).map(x => `
            <button class="opt sw-opt ${cfg[key] === x.id ? 'on' : ''}" data-set="${key}" data-val="${x.id}">
              ${fabricSwatch(x)}<b>${esc(x.name)}</b><small>${esc(x.type || '')}</small>
              <span class="mag" data-mag="${x.id}" title="Zoom in on this fabric">
                <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg></span>
            </button>`).join('') + '</div>';
      });
    } else if (st.kind === 'linings') {
      html = head + `<div class="grid swatches">${visible(cat().linings).map(x => `
        <button class="opt sw-opt ${cfg.lining === x.id ? 'on' : ''}" data-set="lining" data-val="${x.id}">
          ${fabricSwatch(x)}<b>${esc(x.name)}</b><small>${x.price ? '+' + money(x.price) : 'Included'}</small></button>`).join('')}</div>`;
    } else if (st.kind === 'buttons') {
      html = head + `<div class="grid swatches">${visible(cat().buttons).map(x => `
        <button class="opt sw-opt ${cfg.buttons === x.id ? 'on' : ''}" data-set="buttons" data-val="${x.id}">
          ${buttonSwatch(x)}<b>${esc(x.name)}</b><small>${x.price ? '+' + money(x.price) : 'Included'}</small></button>`).join('')}</div>`;
    } else if (st.kind === 'threads' || st.kind === 'felts') {
      const key = st.kind === 'threads' ? 'thread' : 'felt';
      html = head + `<div class="grid swatches">${visible(cat()[st.kind]).map(x => `
        <button class="opt sw-opt ${cfg[key] === x.id ? 'on' : ''}" data-set="${key}" data-val="${x.id}">
          ${x.color === 'match' && key === 'thread' ? buttonSwatch(SuitRender.byId(cat().buttons, cfg.buttons)) : colorDot(x.color)}<b>${esc(x.name)}</b></button>`).join('')}</div>`;
    } else if (st.kind === 'monogram') {
      html = head + `<label class="field"><span>Your initials (up to 4 characters)</span>
          <input type="text" maxlength="4" value="${esc(cfg.monogram)}" data-input="monogram" placeholder="e.g. J.M."></label>
        <h3 class="tier">Placement</h3>
        <div class="grid">${[['pocket', 'Inside Pocket'], ['collar', 'Under Collar'], ['none', 'No Monogram']].map(([v, n]) =>
          `<button class="opt text-opt ${cfg.monogramPlace === v ? 'on' : ''}" data-set="monogramPlace" data-val="${v}"><b>${n}</b></button>`).join('')}</div>
        <p class="hint">The monogram is stitched in your button thread colour.</p>`;
    } else if (st.choices) {
      const chs = visible(st.choices);
      html = head + `<div class="grid ${st.zoom ? 'thumbs' : ''}">${chs.map(ch => `
        <button class="opt ${st.zoom ? '' : 'text-opt'} ${cfg[st.id] === ch.id ? 'on' : ''}" data-set="${st.id}" data-val="${ch.id}">
          ${st.zoom ? `<span class="thumb">${choiceThumb(st, ch)}</span>` : ''}
          <b>${esc(ch.name)}</b>${ch.note ? `<small>${esc(ch.note)}</small>` : ''}
          <em>${ch.price ? '+' + money(ch.price) : 'Included'}</em></button>`).join('')}</div>`;
    }
    body.innerHTML = html;
    body.scrollTop = 0;
  }

  function reviewHtml() {
    const rows = summary(cfg);
    const p = price(cfg);
    let cur = '';
    let table = '';
    rows.forEach(r => {
      if (r.group !== cur) { cur = r.group; table += `<tr class="grp"><th colspan="3">${r.group}</th></tr>`; }
      const si = r.id ? steps().findIndex(s => s.id === r.id) : 0;
      table += `<tr><td>${esc(r.title)}</td><td>${esc(r.value)}</td><td><button class="link" data-go="${si}">Edit</button></td></tr>`;
    });
    return `<div class="step-head"><h2>Review your design</h2><p>Check your choices, then send the design to Magnolia Bespoke. We'll be in touch to book your fitting — no payment is taken online.</p></div>
      <table class="summary">${table}</table>
      <div class="totals">
        <div><span>Base price</span><span>${money(p.base)}</span></div>
        ${p.lines.map(l => `<div><span>${esc(l.label)}</span><span>+${money(l.price)}</span></div>`).join('')}
        <div class="total"><span>Estimated total</span><span>${money(p.total)}</span></div>
        <p class="hint">Estimate only. Your final price is confirmed with you at your fitting.</p>
      </div>
      <form class="send-form" id="send-form" novalidate>
        <h3 class="tier">Your details</h3>
        <div class="two">
          <label class="field"><span>Full name *</span><input name="name" required autocomplete="name"></label>
          <label class="field"><span>Phone *</span><input name="phone" required autocomplete="tel" inputmode="tel"></label>
        </div>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email"></label>
        <label class="field"><span>Measurements</span>
          <select name="measure">
            <option value="appointment">Please measure me at my appointment</option>
            <option value="have">I have my measurements and will send them</option>
          </select></label>
        <label class="field"><span>Occasion or notes</span><textarea name="notes" rows="3" placeholder="Wedding in June, prefer a slim fit…"></textarea></label>
        <div class="form-actions">
          <button type="button" class="btn ghost" data-act="share">Save design for later</button>
          <button type="submit" class="btn primary">Send my design</button>
        </div>
        <p class="form-err" id="form-err" hidden></p>
      </form>`;
  }

  function submit(form) {
    const fd = new FormData(form);
    const name = (fd.get('name') || '').trim();
    const phone = (fd.get('phone') || '').trim();
    const err = $('#form-err', root);
    if (!name || phone.replace(/\D/g, '').length < 7) {
      err.hidden = false;
      err.textContent = !name ? 'Please enter your name.' : 'Please enter a phone number we can reach you on.';
      return;
    }
    const ref = 'MB-' + Date.now().toString(36).toUpperCase().slice(-6);
    const p = price(cfg);
    Store.addSubmission({
      ref, date: new Date().toISOString(), status: 'New',
      customer: { name, phone, email: (fd.get('email') || '').trim(), measure: fd.get('measure'), notes: (fd.get('notes') || '').trim() },
      cfg: Store.clone(cfg), total: Math.round(p.total), summary: summary(cfg)
    });
    $('#step-body', root).innerHTML = `<div class="done">
      <div class="done-mark">&#10003;</div>
      <h2 class="script">Thank you, ${esc(name.split(' ')[0])}!</h2>
      <p>Your design <b>${ref}</b> has been sent to Magnolia Bespoke. We'll review it and call you to arrange your fitting.</p>
      <div class="done-actions"><button class="btn ghost" data-act="new">Design another piece</button>
      <a class="btn primary" href="#admin">See it in the admin dashboard</a></div>
      <p class="hint">Demo note: in the live version you also get an instant notification for every new design.</p></div>`;
    $('.panel-foot', root).style.display = 'none';
  }

  function share() {
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
    const url = location.href.split('#')[0] + '#d=' + data;
    Modal.open(`<h2>Save your design</h2><p>Bookmark or send yourself this link. It opens your suit exactly as you left it.</p>
      <div class="copy-row"><input readonly value="${esc(url)}" id="share-url"><button class="btn primary" id="copy-btn">Copy link</button></div>`);
    $('#copy-btn').onclick = () => {
      const i = $('#share-url'); i.select();
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).catch(() => document.execCommand('copy'));
      Toast.show('Link copied');
    };
  }

  function magnify(id) {
    const x = SuitRender.byId(cat().fabrics, id);
    const c = Object.assign({}, cfg, { fabric: id, piece: cfg.piece === 'pants' ? 'pants' : 'jacket' });
    Modal.open(`<div class="mag-view">
      <div class="mag-swatch" style="background-image:url('${Textures.textureFor(x)}');background-size:${x.img ? (x.scale || 48) * 4 : 240}px"></div>
      <div class="mag-render">${SuitRender.render(c, cat(), { view: c.piece === 'pants' ? 'pants' : 'front' })}</div></div>
      <h2>${esc(x.name)}</h2><p>${esc(x.type || '')} · Suit ${money(x.price)}</p>
      <button class="btn primary" data-pick="${x.id}">Choose this fabric</button>`);
    $('[data-pick]', $('#modal')).onclick = () => { set(steps()[idx].kind === 'pantsFabric' ? 'pantsFabric' : 'fabric', x.id); Modal.close(); };
  }

  function set(key, val) {
    cfg[key] = val;
    if (key === 'piece') { go(1); return; }
    drawBody(); drawPreview();
  }

  function onClick(e) {
    const t = e.target.closest('button, a, [data-mag]');
    if (!t || !root.contains(t)) return;
    if (t.dataset.mag) { e.preventDefault(); e.stopPropagation(); magnify(t.dataset.mag); return; }
    if (t.dataset.piece) { set('piece', t.dataset.piece); return; }
    if (t.dataset.set) { set(t.dataset.set, t.dataset.val); return; }
    if (t.dataset.go != null) { go(+t.dataset.go); return; }
    if (t.dataset.view) { view = t.dataset.view; drawPreview(); return; }
    const act = t.dataset.act;
    if (act === 'next') go(idx + 1);
    else if (act === 'back') go(idx - 1);
    else if (act === 'zoom') { zoom = !zoom; drawPreview(); }
    else if (act === 'share') share();
    else if (act === 'new') { cfg = Object.assign({}, DEFAULT_CONFIG, { piece: cfg.piece }); $('.panel-foot', root).style.display = ''; go(0); }
  }
  function onInput(e) {
    const t = e.target;
    if (t.dataset.input === 'monogram') {
      cfg.monogram = t.value.slice(0, 4);
      if (cfg.monogram && cfg.monogramPlace === 'none') cfg.monogramPlace = 'pocket';
      view = 'inside';
      drawPreview();
    }
  }
  document.addEventListener('submit', e => {
    if (e.target.id === 'send-form') { e.preventDefault(); submit(e.target); }
  });

  window.Designer = { mount, price, summary, PIECES };
})();
