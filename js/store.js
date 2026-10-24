/* Storage layer. In the demo everything lives in this browser (localStorage).
 * In the real build these same calls go to the server database behind the admin login. */
(function () {
  const K = { cat: 'mb_catalog', subs: 'mb_submissions', draft: 'mb_draft' };

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.warn('storage failed', e); return false; }
  }
  const clone = o => JSON.parse(JSON.stringify(o));

  let catalog = read(K.cat, null);
  if (!catalog || catalog.version !== DEFAULT_CATALOG.version) catalog = clone(DEFAULT_CATALOG);

  window.Store = {
    catalog: () => catalog,
    saveCatalog() { return write(K.cat, catalog); },
    resetCatalog() { catalog = clone(DEFAULT_CATALOG); write(K.cat, catalog); },
    submissions: () => read(K.subs, []),
    saveSubmissions(list) { return write(K.subs, list); },
    addSubmission(s) { const l = read(K.subs, []); l.unshift(s); return write(K.subs, l); },
    draft: () => read(K.draft, null),
    saveDraft(cfg) { write(K.draft, cfg); },
    clone,
    uid: (p) => p + '-' + Math.random().toString(36).slice(2, 8)
  };
})();
