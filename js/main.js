/* Router, modal and toast. */
(function () {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');

  window.Modal = {
    open(html, size) {
      body.innerHTML = html;
      modal.querySelector('.modal-card').className = 'modal-card' + (size ? ' ' + size : '');
      modal.hidden = false;
      document.body.classList.add('no-scroll');
    },
    close() { modal.hidden = true; body.innerHTML = ''; document.body.classList.remove('no-scroll'); }
  };
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('.modal-x') || e.target.closest('[data-close]')) Modal.close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) Modal.close(); });

  let tt;
  window.Toast = {
    show(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.hidden = false;
      clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 1800);
    }
  };

  function route() {
    const app = document.getElementById('app');
    const h = location.hash;
    Modal.close();
    document.body.classList.toggle('is-admin', h.startsWith('#admin'));
    if (h.startsWith('#admin')) { Admin.mount(app); return; }
    let cfg = null;
    if (h.startsWith('#d=')) {
      try { cfg = JSON.parse(decodeURIComponent(escape(atob(h.slice(3))))); cfg.__review = true; } catch (e) { cfg = null; }
    }
    Designer.mount(app, cfg);
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-nav=design]');
    if (a) { e.preventDefault(); if (location.hash) location.hash = ''; else route(); }
  });
  window.addEventListener('hashchange', route);
  route();
})();
