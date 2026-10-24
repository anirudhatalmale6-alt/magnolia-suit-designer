/* Admin dashboard: manage the catalogue and review submitted designs. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PASS = 'magnolia';
  const FABRIC_KINDS = [['solid', 'Solid / Twill'], ['pinstripe', 'Pinstripe'], ['chalkstripe', 'Chalk Stripe'], ['herringbone', 'Herringbone'], ['glencheck', 'Glen Check'], ['windowpane', 'Windowpane'], ['birdseye', 'Birdseye']];
  const LINING_KINDS = [['satin', 'Satin'], ['stripe', 'Stripe'], ['dot', 'Polka Dot'], ['paisley', 'Paisley'], ['geo', 'Geometric']];
  const TABS = [['subs', 'Submissions'], ['fabrics', 'Fabrics'], ['linings', 'Linings'], ['buttons', 'Buttons'], ['colours', 'Thread & Felt'], ['options', 'Style Options'], ['settings', 'Prices & Settings']];

  let root, tab = 'subs';
  const cat = () => Store.catalog();
  const money = n => cat().settings.currency + Math.round(n).toLocaleString('en-US');
  const save = () => { if (!Store.saveCatalog()) Toast.show('Browser storage is full — try a smaller photo'); else Toast.show('Saved'); };

  function mount(el) {
    root = el;
    let ok = false;
    try { ok = sessionStorage.getItem('mb_admin') === '1'; } catch (e) { /* private mode */ }
    if (!ok) return login();
    root.innerHTML = `<section class="admin">
      <aside class="admin-nav">
        <h2>Dashboard</h2>
        ${TABS.map(([id, n]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${n}${id === 'subs' ? ` <span class="badge">${Store.submissions().filter(s => s.status === 'New').length || ''}</span>` : ''}</button>`).join('')}
        <a class="btn ghost small" href="#">&larr; Back to designer</a>
        <button class="link" data-act="logout">Log out</button>
      </aside>
      <div class="admin-main" id="admin-main"></div></section>`;
    root.onclick = onClick;
    root.onchange = onChange;
    draw();
  }

  function login() {
    root.innerHTML = `<section class="login"><form id="login-form" class="card">
      <img src="logo.jpg" alt="" class="login-logo">
      <h2>Admin login</h2>
      <label class="field"><span>Password</span><input type="password" name="pw" autofocus></label>
      <button class="btn primary" type="submit">Log in</button>
      <p class="hint">Demo password: <b>${PASS}</b></p>
      <p class="form-err" hidden>Wrong password</p></form></section>`;
    $('#login-form').onsubmit = e => {
      e.preventDefault();
      if (e.target.pw.value.trim() === PASS) {
        try { sessionStorage.setItem('mb_admin', '1'); } catch (er) { /* ignore */ }
        mount(root);
      } else $('.form-err', root).hidden = false;
    };
  }

  function draw() {
    root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const m = $('#admin-main', root);
    m.innerHTML = ({ subs: subsHtml, fabrics: () => itemsHtml('fabrics'), linings: () => itemsHtml('linings'), buttons: buttonsHtml, colours: coloursHtml, options: optionsHtml, settings: settingsHtml })[tab]();
  }

  // ---------- submissions ----------
  function subsHtml() {
    const list = Store.submissions();
    if (!list.length) return `<h1>Submissions</h1><div class="empty card"><p>No designs submitted yet.</p><p class="hint">Open the designer, design a suit and press <b>Send my design</b> — it appears here instantly.</p><a class="btn primary" href="#">Open the designer</a></div>`;
    return `<h1>Submissions <small>${list.length}</small></h1>
      <div class="sub-list">${list.map((s, i) => `
        <div class="sub card">
          <div class="sub-thumb">${SuitRender.render(s.cfg, cat(), { view: s.cfg.piece === 'pants' ? 'pants' : 'front' })}</div>
          <div class="sub-info">
            <div class="sub-top"><b>${esc(s.customer.name)}</b><span class="ref">${esc(s.ref)}</span></div>
            <div class="muted">${new Date(s.date).toLocaleString()} · ${esc(s.customer.phone)}${s.customer.email ? ' · ' + esc(s.customer.email) : ''}</div>
            <div>${esc((Designer.PIECES.find(p => p.id === s.cfg.piece) || {}).name)} · ${esc(fabName(s.cfg.fabric))} · <b>${money(s.total)}</b></div>
            ${s.customer.notes ? `<div class="note">“${esc(s.customer.notes)}”</div>` : ''}
            <div class="sub-actions">
              <select data-status="${i}">${['New', 'Contacted', 'Fitting booked', 'In production', 'Completed'].map(o => `<option ${s.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
              <button class="btn small primary" data-view-sub="${i}">View full spec</button>
              <button class="btn small ghost" data-del-sub="${i}">Delete</button>
            </div>
          </div>
        </div>`).join('')}</div>`;
  }
  const fabName = id => (SuitRender.byId(cat().fabrics, id) || {}).name || id;

  function viewSub(i) {
    const s = Store.submissions()[i];
    let cur = '', rows = '';
    s.summary.forEach(r => {
      if (r.group !== cur) { cur = r.group; rows += `<tr class="grp"><th colspan="2">${r.group}</th></tr>`; }
      rows += `<tr><td>${esc(r.title)}</td><td>${esc(r.value)}</td></tr>`;
    });
    const views = s.cfg.piece === 'pants' ? ['pants'] : s.cfg.piece === 'jacket' ? ['front', 'back', 'inside'] : ['front', 'back', 'inside', 'pants'];
    Modal.open(`<div class="spec printable">
      <div class="spec-head"><img src="logo.jpg" alt=""><div><h2>Design ${esc(s.ref)}</h2><p>${new Date(s.date).toLocaleString()}</p></div></div>
      <div class="spec-renders">${views.map(v => SuitRender.render(s.cfg, cat(), { view: v })).join('')}</div>
      <div class="spec-cols">
        <div><h3>Customer</h3><table class="summary">
          <tr><td>Name</td><td>${esc(s.customer.name)}</td></tr>
          <tr><td>Phone</td><td>${esc(s.customer.phone)}</td></tr>
          ${s.customer.email ? `<tr><td>Email</td><td>${esc(s.customer.email)}</td></tr>` : ''}
          <tr><td>Measurements</td><td>${s.customer.measure === 'have' ? 'Will send own measurements' : 'Measure at appointment'}</td></tr>
          ${s.customer.notes ? `<tr><td>Notes</td><td>${esc(s.customer.notes)}</td></tr>` : ''}
          <tr><td>Estimate</td><td><b>${money(s.total)}</b></td></tr></table></div>
        <div><h3>Specification</h3><table class="summary">${rows}</table></div>
      </div></div>
      <div class="form-actions"><button class="btn ghost" onclick="window.print()">Print / Save PDF</button></div>`, 'wide');
  }

  // ---------- fabrics & linings ----------
  function itemsHtml(kind) {
    const list = cat()[kind];
    const isF = kind === 'fabrics';
    return `<h1>${isF ? 'Fabrics' : 'Linings'} <small>${list.length}</small></h1>
      <p class="muted">${isF ? 'Upload a photo of each fabric swatch — it is mapped onto the suit preview automatically. The price is for a full suit; jacket-only and pants-only prices are worked out from the percentages in Prices & Settings.' : 'Upload a photo of each lining. The price is added on top of the suit price (0 = included).'}</p>
      <button class="btn primary" data-edit="${kind}" data-id="">+ Add ${isF ? 'fabric' : 'lining'}</button>
      <div class="item-grid">${list.map(x => `
        <div class="item card ${x.visible === false ? 'hidden-item' : ''}">
          <span class="item-sw" style="background-image:url('${Textures.textureFor(x)}');background-size:${x.img ? (x.scale || 48) * 1.6 : 96}px"></span>
          <div class="item-info"><b>${esc(x.name)}</b><span class="muted">${esc(x.type || (x.img ? 'Photo' : ''))}</span>
          <span>${isF ? 'Suit ' + money(x.price) : x.price ? '+' + money(x.price) : 'Included'}</span></div>
          <label class="switch" title="Show to customers"><input type="checkbox" data-vis="${kind}" data-id="${x.id}" ${x.visible !== false ? 'checked' : ''}><span></span></label>
          <div class="item-actions"><button class="btn small ghost" data-edit="${kind}" data-id="${x.id}">Edit</button>
          <button class="btn small ghost" data-del="${kind}" data-id="${x.id}">Delete</button></div>
        </div>`).join('')}</div>`;
  }

  function editItem(kind, id) {
    const isF = kind === 'fabrics';
    const list = cat()[kind];
    const orig = list.find(x => x.id === id);
    const it = orig ? Store.clone(orig) : { id: Store.uid(isF ? 'f' : 'l'), name: '', type: isF ? 'Solid' : '', price: isF ? 695 : 0, visible: true, pattern: { kind: isF ? 'solid' : 'satin', base: isF ? '#2b3550' : '#2f9fa4', accent: '#c9ccd6' } };
    const kinds = isF ? FABRIC_KINDS : LINING_KINDS;
    let src = it.img || !orig ? 'photo' : 'pattern';
    Modal.open(`<h2>${orig ? 'Edit' : 'Add'} ${isF ? 'fabric' : 'lining'}</h2>
      <div class="editor">
        <form class="editor-form" id="ed-form">
          <label class="field"><span>Name *</span><input name="name" value="${esc(it.name)}" required></label>
          ${isF ? `<label class="field"><span>Type (shown to customers)</span><input name="type" value="${esc(it.type)}" placeholder="Solid, Herringbone, Check…"></label>` : ''}
          <label class="field"><span>${isF ? 'Full suit price' : 'Extra price (0 = included)'}</span><input name="price" type="number" min="0" step="5" value="${it.price}"></label>
          <div class="seg" id="src-seg"><button type="button" data-src="photo" class="${src === 'photo' ? 'on' : ''}">Upload photo</button><button type="button" data-src="pattern" class="${src === 'pattern' ? 'on' : ''}">Colour &amp; pattern</button></div>
          <div id="src-photo" ${src === 'photo' ? '' : 'hidden'}>
            <label class="field"><span>Swatch photo (JPG/PNG, a flat close-up works best)</span><input type="file" accept="image/*" name="file"></label>
            <label class="field"><span>Pattern size on the suit</span><input type="range" name="scale" min="16" max="140" value="${it.scale || 48}"></label>
          </div>
          <div id="src-pattern" ${src === 'pattern' ? '' : 'hidden'}>
            <label class="field"><span>Pattern</span><select name="kind">${kinds.map(([k, n]) => `<option value="${k}" ${it.pattern && it.pattern.kind === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <div class="two">
              <label class="field"><span>Main colour</span><input type="color" name="base" value="${(it.pattern && it.pattern.base) || '#333333'}"></label>
              <label class="field"><span>Stripe / pattern colour</span><input type="color" name="accent" value="${(it.pattern && it.pattern.accent) || '#999999'}"></label>
            </div>
          </div>
          <label class="check"><input type="checkbox" name="visible" ${it.visible !== false ? 'checked' : ''}> Show to customers</label>
          <div class="form-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
          <p class="form-err" hidden></p>
        </form>
        <div class="editor-preview"><div class="ed-sw" id="ed-sw"></div><div id="ed-render"></div></div>
      </div>`, 'wide');
    const form = $('#ed-form');
    const refresh = () => {
      const cfg = Object.assign({}, DEFAULT_CONFIG, isF ? { fabric: it.id, piece: 'jacket' } : { lining: it.id, piece: 'jacket' });
      const tmp = Store.clone(cat());
      const arr = tmp[kind]; const k = arr.findIndex(x => x.id === it.id);
      if (k >= 0) arr[k] = it; else arr.push(it);
      $('#ed-render').innerHTML = SuitRender.render(cfg, tmp, { view: isF ? 'front' : 'inside' });
      $('#ed-sw').style.backgroundImage = `url('${Textures.textureFor(it)}')`;
      $('#ed-sw').style.backgroundSize = it.img ? (it.scale || 48) * 2.4 + 'px' : '144px';
    };
    const readForm = () => {
      it.name = form.name.value.trim();
      if (isF) it.type = form.type.value.trim();
      it.price = Math.max(0, +form.price.value || 0);
      it.visible = form.visible.checked;
      it.scale = +form.scale.value;
      if (src === 'pattern') { delete it.img; it.pattern = { kind: form.kind.value, base: form.base.value, accent: form.accent.value }; }
    };
    form.oninput = e => { if (e.target.name !== 'file') { readForm(); refresh(); } };
    $('#src-seg').onclick = e => {
      const b = e.target.closest('[data-src]'); if (!b) return;
      src = b.dataset.src;
      $('#src-seg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      $('#src-photo').hidden = src !== 'photo'; $('#src-pattern').hidden = src !== 'pattern';
      readForm(); refresh();
    };
    form.file.onchange = () => {
      const file = form.file.files[0]; if (!file) return;
      src = 'photo';
      $('#src-seg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.src === 'photo'));
      $('#src-photo').hidden = false; $('#src-pattern').hidden = true;
      const img = new Image();
      img.onload = () => {
        const max = 512, r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        const sz = Math.min(c.width, c.height);
        c.width = c.height = sz; // square crop from the centre, so the tile repeats evenly
        c.getContext('2d').drawImage(img, (img.width - sz / r) / 2, (img.height - sz / r) / 2, sz / r, sz / r, 0, 0, sz, sz);
        it.img = c.toDataURL('image/jpeg', 0.86);
        URL.revokeObjectURL(img.src);
        readForm(); refresh();
      };
      img.src = URL.createObjectURL(file);
    };
    form.onsubmit = e => {
      e.preventDefault(); readForm();
      if (!it.name) { const er = $('.form-err', form); er.hidden = false; er.textContent = 'Please give it a name.'; return; }
      if (src === 'photo' && !it.img) { const er = $('.form-err', form); er.hidden = false; er.textContent = 'Please choose a photo, or switch to Colour & pattern.'; return; }
      const k = list.findIndex(x => x.id === it.id);
      if (k >= 0) list[k] = it; else list.push(it);
      save(); Modal.close(); draw();
    };
    refresh();
  }

  // ---------- buttons ----------
  function buttonsHtml() {
    const list = cat().buttons;
    return `<h1>Buttons <small>${list.length}</small></h1>
      <p class="muted">Each button has a colour and finish. In the live version you can also upload a photo of the real button.</p>
      <table class="admin-table"><thead><tr><th>Name</th><th>Finish</th><th>Colour</th><th>Extra price</th><th>Show</th><th></th></tr></thead><tbody>
      ${list.map((b, i) => `<tr>
        <td><input data-btn="${i}" data-k="name" value="${esc(b.name)}"></td>
        <td><select data-btn="${i}" data-k="style">${[['horn', 'Horn / Corozo'], ['metal', 'Metal'], ['pearl', 'Mother of Pearl'], ['fabric', 'Covered in fabric']].map(([v, n]) => `<option value="${v}" ${b.style === v ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
        <td><input type="color" data-btn="${i}" data-k="color" value="${b.color}"></td>
        <td><input type="number" min="0" step="5" data-btn="${i}" data-k="price" value="${b.price}"></td>
        <td><label class="switch"><input type="checkbox" data-btn="${i}" data-k="visible" ${b.visible !== false ? 'checked' : ''}><span></span></label></td>
        <td><button class="btn small ghost" data-del-btn="${i}">Delete</button></td></tr>`).join('')}
      </tbody></table>
      <button class="btn primary" data-act="add-btn">+ Add button</button>`;
  }

  function coloursHtml() {
    const block = (key, title) => `<h2>${title}</h2><table class="admin-table"><thead><tr><th>Name</th><th>Colour</th><th>Show</th><th></th></tr></thead><tbody>
      ${cat()[key].map((t, i) => `<tr><td><input data-col="${key}" data-i="${i}" data-k="name" value="${esc(t.name)}"></td>
        <td>${t.color === 'match' ? '<span class="muted">Matches automatically</span>' : `<input type="color" data-col="${key}" data-i="${i}" data-k="color" value="${t.color}">`}</td>
        <td><label class="switch"><input type="checkbox" data-col="${key}" data-i="${i}" data-k="visible" ${t.visible !== false ? 'checked' : ''}><span></span></label></td>
        <td>${t.color === 'match' ? '' : `<button class="btn small ghost" data-del-col="${key}" data-i="${i}">Delete</button>`}</td></tr>`).join('')}
      </tbody></table><button class="btn primary" data-add-col="${key}">+ Add colour</button>`;
    return `<h1>Thread &amp; Felt Colours</h1>${block('threads', 'Button thread / monogram colours')}${block('felts', 'Under-collar felt')}`;
  }

  // ---------- style options ----------
  function optionsHtml() {
    const g = { jacket: 'Jacket', pants: 'Pants' };
    return `<h1>Style Options</h1>
      <p class="muted">Rename steps, change prices, hide options you don't offer, or add new ones. Hidden options disappear from the designer straight away.</p>
      ${['jacket', 'pants'].map(grp => `<h2>${g[grp]}</h2>` + cat().steps.map((st, si) => st.group !== grp ? '' : `
        <details class="card step-card" ${st._open ? 'open' : ''}>
          <summary><b>${esc(st.title)}</b><span class="muted">${st.choices ? st.choices.length + ' options' : ({ fabric: 'Managed in Fabrics', pantsFabric: 'Uses your fabrics', linings: 'Managed in Linings', buttons: 'Managed in Buttons', threads: 'Managed in Thread & Felt', felts: 'Managed in Thread & Felt', monogram: 'Text entry' }[st.kind] || '')}</span>
            ${st.visible === false ? '<span class="off-tag">Hidden</span>' : ''}</summary>
          <div class="step-edit">
            <label class="check"><input type="checkbox" data-step="${si}" data-k="visible" ${st.visible !== false ? 'checked' : ''}> Show this step to customers</label>
            <div class="two"><label class="field"><span>Step title</span><input data-step="${si}" data-k="title" value="${esc(st.title)}"></label>
            <label class="field"><span>Description</span><input data-step="${si}" data-k="desc" value="${esc(st.desc || '')}"></label></div>
            ${st.choices ? `<table class="admin-table"><thead><tr><th>Option</th><th>Extra price</th><th>Show</th><th></th></tr></thead><tbody>
              ${st.choices.map((c, ci) => `<tr><td><input data-ch="${si}" data-i="${ci}" data-k="name" value="${esc(c.name)}"></td>
                <td><input type="number" min="0" step="5" data-ch="${si}" data-i="${ci}" data-k="price" value="${c.price || 0}"></td>
                <td><label class="switch"><input type="checkbox" data-ch="${si}" data-i="${ci}" data-k="visible" ${c.visible !== false ? 'checked' : ''}><span></span></label></td>
                <td>${c.custom ? `<button class="btn small ghost" data-del-ch="${si}" data-i="${ci}">Delete</button>` : ''}</td></tr>`).join('')}
              </tbody></table>
              <button class="btn small primary" data-add-ch="${si}">+ Add option</button>` : ''}
          </div>
        </details>`).join('')).join('')}`;
  }

  function settingsHtml() {
    const s = cat().settings;
    return `<h1>Prices &amp; Settings</h1>
      <div class="card pad">
        <div class="two">
          <label class="field"><span>Currency symbol</span><input data-set="currency" value="${esc(s.currency)}"></label>
          <span></span>
          <label class="field"><span>Jacket-only price (% of the suit price)</span><input type="number" min="1" max="100" data-set="jacketOnlyPct" value="${s.jacketOnlyPct}"></label>
          <label class="field"><span>Pants-only price (% of the suit price)</span><input type="number" min="1" max="100" data-set="pantsOnlyPct" value="${s.pantsOnlyPct}"></label>
        </div>
        <p class="hint">Example: with a ${money(695)} suit fabric, a jacket costs ${money(695 * s.jacketOnlyPct / 100)} and pants ${money(695 * s.pantsOnlyPct / 100)}.</p>
      </div>
      <div class="card pad">
        <h2>Backup</h2>
        <p class="muted">Download everything (fabrics, options, prices) as a file, or restore from one.</p>
        <div class="form-actions left"><button class="btn ghost" data-act="export">Download backup</button>
        <label class="btn ghost">Restore backup<input type="file" accept="application/json" id="import-file" hidden></label></div>
      </div>
      <div class="card pad">
        <h2>Reset demo</h2>
        <p class="muted">Puts the sample fabrics and options back. Submissions are kept.</p>
        <button class="btn ghost danger" data-act="reset">Reset sample data</button>
      </div>`;
  }

  // ---------- events ----------
  function onClick(e) {
    const t = e.target.closest('button, [data-tab]');
    if (!t) return;
    const d = t.dataset;
    if (d.tab) { tab = d.tab; draw(); return; }
    if (d.act === 'logout') { try { sessionStorage.removeItem('mb_admin'); } catch (er) { /* ignore */ } location.hash = ''; return; }
    if (d.viewSub != null) return viewSub(+d.viewSub);
    if (d.delSub != null) { if (confirm('Delete this submission?')) { const l = Store.submissions(); l.splice(+d.delSub, 1); Store.saveSubmissions(l); draw(); } return; }
    if (d.edit) return editItem(d.edit, d.id);
    if (d.del) {
      const list = cat()[d.del];
      if (list.filter(x => x.visible !== false).length <= 1 && list.find(x => x.id === d.id).visible !== false) { Toast.show('Keep at least one visible'); return; }
      if (confirm('Delete this item? Customers will no longer see it.')) { cat()[d.del] = list.filter(x => x.id !== d.id); save(); draw(); }
      return;
    }
    if (d.act === 'add-btn') { cat().buttons.push({ id: Store.uid('b'), name: 'New button', style: 'horn', color: '#555555', price: 0, visible: true }); save(); draw(); return; }
    if (d.delBtn != null) { if (confirm('Delete this button?')) { cat().buttons.splice(+d.delBtn, 1); save(); draw(); } return; }
    if (d.addCol) { cat()[d.addCol].push({ id: Store.uid('c'), name: 'New colour', color: '#888888', visible: true }); save(); draw(); return; }
    if (d.delCol) { cat()[d.delCol].splice(+d.i, 1); save(); draw(); return; }
    if (d.addCh != null) {
      const st = cat().steps[+d.addCh];
      const name = prompt('Name of the new option (e.g. "Ticket pocket on both sides")');
      if (!name) return;
      st.choices.push({ id: Store.uid('c'), name: name.trim(), price: 0, visible: true, custom: true });
      st._open = true; save(); draw(); return;
    }
    if (d.delCh != null) { const st = cat().steps[+d.delCh]; st.choices.splice(+d.i, 1); st._open = true; save(); draw(); return; }
    if (d.act === 'export') {
      const blob = new Blob([JSON.stringify(cat(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'magnolia-catalogue-backup.json'; a.click();
      return;
    }
    if (d.act === 'reset') { if (confirm('Reset fabrics, options and prices to the samples?')) { Store.resetCatalog(); draw(); Toast.show('Sample data restored'); } }
  }

  function onChange(e) {
    const t = e.target, d = t.dataset;
    const val = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(0, +t.value || 0) : t.value;
    if (d.status != null) { const l = Store.submissions(); l[+d.status].status = t.value; Store.saveSubmissions(l); Toast.show('Status updated'); return; }
    if (d.vis) { const it = cat()[d.vis].find(x => x.id === d.id); it.visible = t.checked; save(); draw(); return; }
    if (d.btn != null) { cat().buttons[+d.btn][d.k] = val; save(); return; }
    if (d.col) { cat()[d.col][+d.i][d.k] = val; save(); return; }
    if (d.step != null) { const st = cat().steps[+d.step]; st[d.k] = val; st._open = true; save(); if (d.k === 'visible') draw(); return; }
    if (d.ch != null) { cat().steps[+d.ch].choices[+d.i][d.k] = val; cat().steps[+d.ch]._open = true; save(); return; }
    if (d.set) { cat().settings[d.set] = t.type === 'number' ? Math.min(100, Math.max(1, +t.value || 1)) : t.value; save(); draw(); return; }
    if (t.id === 'import-file' && t.files[0]) {
      t.files[0].text().then(txt => {
        try {
          const o = JSON.parse(txt);
          if (!o.fabrics || !o.steps) throw new Error('not a catalogue');
          Object.assign(cat(), o); save(); draw();
        } catch (er) { Toast.show('That file is not a valid backup'); }
      });
    }
  }

  window.Admin = { mount };
})();
