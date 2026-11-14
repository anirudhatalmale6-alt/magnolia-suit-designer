/* Connected demo guide (test demo only): a small bar at the top of the configurator and the request page that says
   where you are in the journey, what is established / new / not connected, and links back to the start page.
   It only appears after a journey is started from ../start/. On the request page it also applies the journey chosen
   on the start page (tailor, in person, appointment) BEFORE the app reads its saved choices. Nothing is sent. */
(function () {
  var KEY = 'magnolia_demo', ss = window.sessionStorage, demo = null;
  try { demo = JSON.parse(ss.getItem(KEY) || 'null'); } catch (e) { demo = null; }
  var qs = new URLSearchParams(location.search), jr = qs.get('journey'), loc = qs.get('loc'), page = /request-preview/.test(location.pathname) ? 'request' : 'designer';
  if (jr === 'online' || jr === 'inperson') { demo = { journey: jr, loc: loc === 'lakewood' ? 'lakewood' : loc === 'jerusalem' ? 'jerusalem' : '' }; try { ss.setItem(KEY, JSON.stringify(demo)); } catch (e) {} }
  if (!demo) return;
  if (page === 'request' && jr === 'inperson' && demo.loc) {          // the request page opens on this tailor's appointment request
    try { ss.setItem('magnolia_draft:app:location', JSON.stringify(demo.loc)); ss.setItem('magnolia_draft:app:mode', '"inperson"'); ss.setItem('magnolia_draft:app:inperson', JSON.stringify(qs.get('send') === 'order' ? 'order' : 'appointment')); } catch (e) {}
  }
  var online = demo.journey === 'online', fromDesign = qs.get('request') === 'design';
  var where = page === 'designer'
    ? { step: online ? 'Step 2 · Configurator' : 'Optional step · Configurator', name: 'Design your garment',
        next: 'Choose what you are building, then Fabric, Style, Trims and Summary. On Summary, press "Continue to fit & request".',
        est: 'Configurator: fabrics, style options, buttons, thread colours, linings, monograms, summary (phases 1-2).',
        neu: 'Sample-fabric label; the "Continue to fit & request" button that carries your design to the request page.',
        not: 'Prices by fabric (milestone C). Trousers, coat and shirt pictures (in progress).' }
    : online || fromDesign
    ? { step: online ? 'Steps 3-5 · Request page' : 'Steps 3-4 · Request page', name: 'Add your design, fit & contact, review',
        next: 'Press "Add my design", then fill in Fit & contact ("Help me with measurements" shows the measurement guide), then Review.',
        est: 'The order request form for both locations (milestone A).',
        neu: 'Page styling and round logo; the designer hand-over ("Add my design"); the measurement guide and help pictures.',
        not: 'Send is off in this demo: saving the request, the owners\' Requests screen, the order emails and PDFs run on the server version (milestone B, in review).' }
    : { step: 'Step 2 · Request page', name: 'Choose your tailor and request an appointment',
        next: 'Check the tailor, choose WhatsApp or email, then pick a date and time and review your appointment request.',
        est: 'Appointment and order requests for both locations, the calendar and its rules (milestone A).',
        neu: 'Page styling and round logo; the measurement guide (in an order request, Fit & contact).',
        not: 'Send is off in this demo: saving the request, the owners\' Requests screen and the emails run on the server version.' };
  var css = '.mdg{font:13px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#173b3d;color:#f6f3ec;padding:8px 16px;position:relative;z-index:50}'
    + '.mdg a{color:#bfe7e4}.mdg .mdg-row{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;max-width:1440px;margin:auto}'
    + '.mdg b{font-weight:700}.mdg .mdg-j{opacity:.8}.mdg details{max-width:1440px;margin:4px auto 0}.mdg summary{cursor:pointer;color:#bfe7e4}'
    + '.mdg ul{margin:6px 0 2px;padding-left:18px}.mdg li{margin:2px 0}.mdg .t{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;border-radius:99px;padding:0 7px;margin-right:6px}'
    + '.mdg .t-e{background:#d9efe9;color:#173b3d}.mdg .t-n{background:#ffe1a8;color:#4d3b16}.mdg .t-x{background:#e9e2e2;color:#5b2730}';
  function bar() {
    if (document.getElementById('mdg')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var d = document.createElement('div'); d.className = 'mdg'; d.id = 'mdg'; d.setAttribute('role', 'note');
    d.innerHTML = '<div class="mdg-row"><b>Connected demo</b><span class="mdg-j">' + (online ? 'Online journey' : 'In-person journey' + (demo.loc ? ' · ' + (demo.loc === 'lakewood' ? 'Lakewood' : 'Jerusalem') : '')) + '</span>'
      + '<span>' + where.step + ': ' + where.name + '</span><a href="' + (page === 'designer' ? '../start/' : '../start/') + '">Start again</a></div>'
      + '<details><summary>What to do here, and what is built</summary><p style="margin:6px 0 0">' + where.next + '</p><ul>'
      + '<li><span class="t t-e">ESTABLISHED</span>' + where.est + '</li><li><span class="t t-n">NEW</span>' + where.neu + '</li><li><span class="t t-x">NOT CONNECTED</span>' + where.not + '</li></ul></details>';
    document.body.insertBefore(d, document.body.firstChild);
  }
  if (document.body) bar(); else document.addEventListener('DOMContentLoaded', bar);
})();
