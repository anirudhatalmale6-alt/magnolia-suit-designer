/* Layered suit renderer.
 * Builds an SVG from the customer's selections. The fabric texture is mapped onto every
 * garment panel, then shading, seams and shadows are drawn on top so the cloth reads in 3D.
 * Geometry is drawn for the viewer's left half and mirrored for the right half. */
(function () {
  const W = 500;
  const f = n => +(+n).toFixed(1);
  const MIRROR = `matrix(-1 0 0 1 ${W} 0)`;

  function byId(list, id) {
    return (list || []).find(x => x.id === id) || (list || []).find(x => x.visible !== false) || (list || [])[0];
  }

  // ---------- shared defs ----------
  function defs(u, fab, pantsFab, lining, btn, threadCol) {
    const pat = (id, item) => {
      const s = (item && item.scale) || 48;
      const href = Textures.textureFor(item);
      return `<pattern id="${u}${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}">
        <image href="${href}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice"/></pattern>`;
    };
    const lg = (id, x1, y1, x2, y2, stops) =>
      `<linearGradient id="${u}${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${
        stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
    const b = btn || { color: '#3b2a1e' };
    const bc = b.color || '#3b2a1e';
    const btnGrad = b.style === 'fabric'
      ? ''
      : `<radialGradient id="${u}btn" cx="38%" cy="32%" r="75%">
          <stop offset="0" stop-color="${b.style === 'metal' ? '#fff8e0' : b.style === 'pearl' ? '#ffffff' : lighten(bc, 0.35)}"/>
          <stop offset="0.45" stop-color="${bc}"/>
          <stop offset="1" stop-color="${darken(bc, 0.45)}"/></radialGradient>`;
    return `<defs>
      ${pat('fab', fab)}${pat('pfab', pantsFab)}${pat('lin', lining)}
      ${btnGrad}
      ${lg('shBody', 142, 0, 258, 0, [[0, 'rgba(0,0,0,.46)'], [0.16, 'rgba(0,0,0,.18)'], [0.5, 'rgba(255,255,255,.06)'], [0.82, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.16)']])}
      ${lg('shV', 0, 50, 0, 480, [[0, 'rgba(255,255,255,.07)'], [0.45, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.22)']])}
      ${lg('shSleeve', 90, 0, 152, 0, [[0, 'rgba(0,0,0,.5)'], [0.32, 'rgba(255,255,255,.07)'], [0.62, 'rgba(0,0,0,.08)'], [1, 'rgba(0,0,0,.55)']])}
      ${lg('shLapel', 160, 0, 256, 0, [[0, 'rgba(0,0,0,.22)'], [0.55, 'rgba(255,255,255,.05)'], [0.9, 'rgba(255,255,255,.10)'], [1, 'rgba(0,0,0,.10)']])}
      ${lg('shLeg', 150, 0, 252, 0, [[0, 'rgba(0,0,0,.42)'], [0.25, 'rgba(0,0,0,.06)'], [0.52, 'rgba(255,255,255,.09)'], [0.6, 'rgba(0,0,0,.06)'], [1, 'rgba(0,0,0,.4)']])}
      ${lg('shLegP', 136, 0, 252, 0, [[0, 'rgba(0,0,0,.42)'], [0.25, 'rgba(0,0,0,.06)'], [0.52, 'rgba(255,255,255,.09)'], [0.6, 'rgba(0,0,0,.06)'], [1, 'rgba(0,0,0,.4)']])}
      ${lg('shLegV', 0, 100, 0, 860, [[0, 'rgba(0,0,0,.12)'], [0.3, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.2)']])}
      ${lg('shInside', 0, 50, 0, 480, [[0, 'rgba(0,0,0,.30)'], [0.5, 'rgba(0,0,0,.12)'], [1, 'rgba(0,0,0,.28)']])}
      ${lg('shirt', 222, 0, 278, 0, [[0, '#d9dde2'], [0.5, '#ffffff'], [1, '#d9dde2']])}
      ${lg('tie', 240, 0, 260, 0, [[0, '#142033'], [0.5, '#24385a'], [1, '#142033']])}
      <filter id="${u}ds" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.2" dy="2" stdDeviation="1.8" flood-color="#000" flood-opacity=".45"/></filter>
      <filter id="${u}dsBig" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".35"/></filter>
    </defs>`;
    function lighten(h, a) { return mix(h, '#ffffff', a); }
    function darken(h, a) { return mix(h, '#000000', a); }
    function mix(h1, h2, a) {
      const c1 = Textures.hexToRgb(h1), c2 = Textures.hexToRgb(h2);
      return 'rgb(' + c1.map((v, i) => Math.round(v + (c2[i] - v) * a)).join(',') + ')';
    }
  }

  // fabric fill + shading overlays + seam stroke
  function panel(u, d, fill, shades, opts = {}) {
    const stroke = opts.noStroke ? '' : `<path d="${d}" fill="none" stroke="rgba(0,0,0,.38)" stroke-width="${opts.sw || 0.9}" stroke-linejoin="round"/>`;
    return `<g${opts.filter ? ` filter="url(#${u}${opts.filter})"` : ''}>
      <path d="${d}" fill="url(#${u}${fill})"/>
      ${shades.map(s => `<path d="${d}" fill="url(#${u}${s})"/>`).join('')}
      ${stroke}</g>`;
  }

  // ---------- jacket geometry ----------
  function frontParams(cfg) {
    const fb = cfg.frontButtons || 'sb2';
    if (fb === 'db6') return { db: true, frontX: 292, breakY: 300, buttons: [[214, 308], [286, 308], [220, 362], [280, 362], [220, 414], [280, 414]] };
    if (fb === 'sb1') return { db: false, frontX: 256, breakY: 336, buttons: [[250, 350]] };
    if (fb === 'sb3') return { db: false, frontX: 256, breakY: 252, buttons: [[250, 266], [250, 322], [250, 378]] };
    return { db: false, frontX: 256, breakY: 304, buttons: [[250, 318], [250, 378]] };
  }

  const HEM = 458;

  function bodyPath(p) {
    const { frontX: x, breakY: by, db } = p;
    let d = `M214,60 Q168,68 122,84 C114,130 132,190 142,214 C152,262 154,300 152,332 C150,384 147,424 147,${HEM} `;
    if (db) d += `C190,${HEM + 6} 240,${HEM + 10} ${x - 6},${HEM + 10} Q${x},${HEM + 10} ${x},${HEM + 2} `;
    else d += `C178,${HEM + 8} 214,${HEM + 12} 232,${HEM + 12} C246,${HEM + 10} ${x},${HEM - 24} ${x},${HEM - 62} `;
    d += `L${x},${by} Q${x - 8},${f((by + 64) / 2)} 222,64 Z`;
    return d;
  }

  function rollX(p, y) {
    // matches the quadratic roll line in bodyPath closely enough for lapel construction
    const t = (y - 64) / (p.breakY - 64);
    const x0 = 222, x2 = p.frontX, x1 = p.frontX - 8;
    const s = 1 - t; // param along curve from break(0) to neck(1) reversed
    return s * s * x0 + 2 * s * t * x1 + t * t * x2;
  }

  function lapelWidth(cfg) {
    return { slim: 29, standard: 37, wide: 47 }[cfg.lapelWidth] || 37;
  }

  function lapelAndCollar(cfg, p) {
    const w = lapelWidth(cfg);
    const B = [p.frontX, p.breakY];
    const style = cfg.lapelStyle || 'notch';
    const Rg = [f(rollX(p, 100)), 100];
    let lapel, collar = '';
    if (style === 'shawl') {
      const tx = rollX(p, 140) - w - 2;
      lapel = `M${B} C${f(B[0] - w * 0.55)},${f(B[1] - (B[1] - 150) * 0.45)} ${f(tx - 2)},${190} ${f(tx)},${140}
               C${f(tx + 2)},${104} 200,${84} 204,66 Q212,54 226,55 Q${f(rollX(p, 72) - 2)},62 ${f(rollX(p, 72))},72
               L${f(rollX(p, 90))},90 L${B} Z`;
    } else if (style === 'peak') {
      const T = [f(rollX(p, 116) - w - 12), 110];
      const G = [f(T[0] + w * 0.7), 131];
      lapel = `M${B} C${f(B[0] - w * 0.5)},${f(B[1] - (B[1] - 142) * 0.38)} ${f(T[0] + 2)},${f(142 + (B[1] - 142) * 0.4)} ${f(T[0] + 5)},142
               L${T} L${G} L${Rg} L${B} Z`;
      const K = [f(G[0] - 6), f(G[1] - 6)];
      collar = `M${K} L${G} L${Rg} L${f(rollX(p, 70))},70 Q216,54 206,58 C198,72 ${f(K[0] - 8)},${f(K[1] - 14)} ${K} Z`;
    } else {
      const T = [f(rollX(p, 142) - w), 142];
      const G = [f(T[0] + w * 0.56), 129];
      lapel = `M${B} C${f(B[0] - w * 0.5)},${f(B[1] - (B[1] - T[1]) * 0.36)} ${f(T[0] - 3)},${f(T[1] + (B[1] - T[1]) * 0.45)} ${T}
               L${G} L${Rg} L${B} Z`;
      const K = [f(T[0] + w * 0.3), f(T[1] - 25)];
      collar = `M${K} L${G} L${Rg} L${f(rollX(p, 70))},70 Q216,54 206,58 C198,70 ${f(K[0] - 6)},${f(K[1] - 10)} ${K} Z`;
    }
    return { lapel, collar, w };
  }

  function lowerPockets(u, cfg, side) {
    const t = cfg.lowerPockets || 'flap';
    const y = 372;
    let s = '';
    const flap = (x1, x2, yy, h, slant) =>
      `M${x1},${yy + slant} L${x2},${yy - slant} L${x2},${yy - slant + h} Q${x2},${yy - slant + h + 4} ${x2 - 4},${yy - slant + h + 4} L${x1 + 4},${yy + slant + h + 4} Q${x1},${yy + slant + h + 4} ${x1},${yy + slant + h} Z`;
    if (t === 'jetted') {
      s += `<path d="M157,${y} L223,${y - 1} L223,${y + 5} L157,${y + 6} Z" fill="rgba(0,0,0,.55)"/>
            <path d="M157,${y + 3} L223,${y + 2}" stroke="rgba(255,255,255,.18)" stroke-width=".8"/>`;
    } else if (t === 'patch') {
      const d = `M154,${y - 16} L226,${y - 18} L226,${y + 44} Q226,${y + 56} 214,${y + 56} L166,${y + 58} Q154,${y + 58} 154,${y + 46} Z`;
      s += panel(u, d, 'fab', ['shV'], { filter: 'ds' });
      s += `<path d="M157,${y - 10} L223,${y - 12} L223,${y + 43} Q223,${y + 53} 213,${y + 53} L167,${y + 55} Q157,${y + 55} 157,${y + 45} Z" fill="none" stroke="rgba(255,255,255,.28)" stroke-width=".6" stroke-dasharray="1.4 1.6"/>
            <path d="M154,${y - 8} L226,${y - 10}" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>`;
    } else {
      const slant = t === 'slanted' ? 5 : 0;
      s += panel(u, flap(157, 223, y, 20, slant), 'fab', ['shV'], { filter: 'ds' });
      if (t === 'ticket' && side === 'L') s += panel(u, flap(168, 216, y - 34, 15, 0), 'fab', ['shV'], { filter: 'ds' });
    }
    return s;
  }

  function chestPocket(u, cfg) {
    // drawn in left-half coordinates, used only on the mirrored (wearer's left) side
    const t = cfg.chestPocket || 'welt';
    if (t === 'none') return '';
    if (t === 'patch') {
      const d = 'M160,182 L204,178 L205,222 Q205,230 197,230 L168,232 Q160,232 160,224 Z';
      return panel(u, d, 'fab', ['shV'], { filter: 'ds' }) +
        '<path d="M162,186 L202,182 L203,221 Q203,228 196,228 L169,229 Q162,229 162,223 Z" fill="none" stroke="rgba(255,255,255,.28)" stroke-width=".6" stroke-dasharray="1.4 1.6"/>';
    }
    return panel(u, 'M160,192 L204,184 L204,196 L160,204 Z', 'fab', ['shV'], { filter: 'ds' });
  }

  function button(u, x, y, r, btn, thread) {
    const fill = btn && btn.style === 'fabric' ? `url(#${u}fab)` : `url(#${u}btn)`;
    const tc = thread || 'rgba(0,0,0,.55)';
    const o = r * 0.28;
    return `<g>
      <circle cx="${x}" cy="${y + 0.8}" r="${r}" fill="rgba(0,0,0,.35)"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="rgba(0,0,0,.45)" stroke-width=".5"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.72}" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>
      <path d="M${x - o},${y - o} L${x + o},${y + o} M${x + o},${y - o} L${x - o},${y + o}" stroke="${tc}" stroke-width="${r * 0.16}" stroke-linecap="round"/>
    </g>`;
  }

  function sleevePath(cfg) {
    const roped = cfg.shoulder === 'roped';
    const top = roped ? 'M123,81 C111,83 103,96 101,120' : 'M122,84 C108,94 102,112 101,130';
    return `${top} C98,220 95,330 92,428 Q116,436 141,434 C143,360 147,280 151,216 C147,170 140,120 ${roped ? '128,84' : '124,86'} Z`;
  }

  // ---------- front view ----------
  function jacketFront(u, cfg, cat, ctx) {
    const p = frontParams(cfg);
    const { lapel, collar } = lapelAndCollar(cfg, p);
    const body = bodyPath(p);
    const sleeve = sleevePath(cfg);
    const thread = ctx.threadCol;
    const pick = cfg.pickStitch === 'yes';
    let s = '';

    // back collar + shirt + tie (visible in the V)
    s += panel(u, 'M204,60 Q250,44 296,60 L292,74 Q250,62 208,74 Z', 'fab', ['shInside']);
    s += `<path d="M222,64 Q250,58 278,64 L276,${p.breakY + 20} L224,${p.breakY + 20} Z" fill="url(#${u}shirt)"/>
          <path d="M223,62 L236,57 L250,76 L239,101 Z" fill="#ffffff" stroke="rgba(0,0,0,.22)" stroke-width=".7"/>
          <path d="M277,62 L264,57 L250,76 L261,101 Z" fill="#ffffff" stroke="rgba(0,0,0,.22)" stroke-width=".7"/>
          <path d="M250,78 L243,95 L238,${p.breakY + 20} L262,${p.breakY + 20} L257,95 Z" fill="url(#${u}tie)" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>
          <path d="M244,74 L256,74 L259,86 L250,96 L241,86 Z" fill="url(#${u}tie)" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>`;

    const half = (side) => {
      let h = panel(u, body, 'fab', ['shBody', 'shV'], { filter: side === 'R' ? 'ds' : null });
      // waist dart / front seam
      h += '<path d="M196,250 C200,300 201,350 199,400" fill="none" stroke="rgba(0,0,0,.18)" stroke-width=".8"/>';
      h += lowerPockets(u, cfg, side);
      if (side === 'R') h += chestPocket(u, cfg);
      if (collar) h += panel(u, collar, 'fab', ['shLapel']);
      h += panel(u, lapel, 'fab', ['shLapel'], { filter: 'ds' });
      if (pick) h += `<path d="${lapel}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".5" stroke-dasharray="1 2.2" transform="translate(1.2,0)"/>`;
      if (side === 'R' && cfg.lapelButtonhole === 'yes') {
        h += `<path d="M${f(rollX(p, 150) - 24)},150 l11,-3" stroke="${thread || 'rgba(0,0,0,.5)'}" stroke-width="2.2" stroke-linecap="round"/>`;
      }
      return h;
    };

    s += half('L');
    s += `<g transform="${MIRROR}">${half('R')}</g>`;

    const sleeveG = (side) => {
      let g = panel(u, sleeve, 'fab', ['shSleeve', 'shV'], { filter: 'ds' });
      const n = cfg.sleeveButtons === '3' ? 3 : 4;
      for (let i = 0; i < n; i++) g += button(u, 101.5 + i * 0.4, 418 - i * 7, 3.1, ctx.btn, thread);
      return g;
    };
    s += sleeveG('L');
    s += `<g transform="${MIRROR}">${sleeveG('R')}</g>`;

    p.buttons.forEach(([x, y]) => { s += button(u, x, y, 6.2, ctx.btn, thread); });
    return s;
  }

  function pantsUnderJacket(u, cfg) {
    const leg = 'M150,410 L249,410 L249,505 C247,600 245,720 244,858 L165,858 C161,720 156,560 150,410 Z';
    const cuff = cfg.bottoms === 'cuffed';
    const g = () => {
      let s = panel(u, leg, 'pfab', ['shLeg', 'shLegV']);
      s += '<path d="M205,470 C204,600 204,740 204,856" stroke="rgba(255,255,255,.12)" stroke-width="1.4" fill="none"/>';
      s += '<path d="M207,470 C206,600 206,740 206,856" stroke="rgba(0,0,0,.12)" stroke-width="1" fill="none"/>';
      if (cuff) s += '<path d="M165,834 L244,834" stroke="rgba(0,0,0,.5)" stroke-width="1.2"/><path d="M165,836 L244,836" stroke="rgba(255,255,255,.12)" stroke-width="1"/>';
      return s;
    };
    return g() + `<g transform="${MIRROR}">${g()}</g>`;
  }

  // ---------- back view ----------
  function jacketBack(u, cfg) {
    const body = `M214,58 Q168,68 122,84 C114,130 132,190 142,214 C152,262 154,300 152,332 C150,384 147,424 147,${HEM + 4} L250,${HEM + 4} L250,62 Q232,56 214,58 Z`;
    const sleeve = sleevePath(cfg);
    let s = '';
    const vent = cfg.vent || 'side';
    const half = () => {
      let h = panel(u, body, 'fab', ['shBody', 'shV'], { sw: 0.8 });
      h += '<path d="M178,150 C186,240 190,330 186,' + (HEM + 4) + '" fill="none" stroke="rgba(0,0,0,.16)" stroke-width=".8"/>';
      if (vent === 'side') {
        h += `<path d="M149,${HEM + 4} L151,382" stroke="rgba(0,0,0,.55)" stroke-width="1.3"/>
              <path d="M152,${HEM + 4} L153,382 L160,382 L158,${HEM + 4} Z" fill="rgba(0,0,0,.18)"/>`;
      }
      return h;
    };
    s += half();
    s += `<g transform="${MIRROR}">${half()}</g>`;
    s += '<path d="M250,62 L250,' + (HEM + 4) + '" stroke="rgba(0,0,0,.4)" stroke-width="1"/>';
    if (vent === 'center') {
      s += `<path d="M250,${HEM + 4} L250,378" stroke="rgba(0,0,0,.6)" stroke-width="1.4"/>
            <path d="M251,${HEM + 4} L251,380 L258,382 L258,${HEM + 4} Z" fill="rgba(0,0,0,.16)"/>`;
    }
    // collar
    s += panel(u, 'M206,56 Q250,40 294,56 L296,76 Q250,66 204,76 Z', 'fab', ['shV'], { filter: 'ds' });
    s += panel(u, sleeve, 'fab', ['shSleeve', 'shV'], { filter: 'ds' });
    s += `<g transform="${MIRROR}">${panel(u, sleeve, 'fab', ['shSleeve', 'shV'], { filter: 'ds' })}</g>`;
    return s;
  }

  // ---------- inside view ----------
  function jacketInside(u, cfg, cat, ctx) {
    const p = { frontX: 250, breakY: 304, db: false };
    const body = bodyPath({ frontX: 250, breakY: 470, db: true }).replace(/Q[\d.]+,[\d.]+ 222,64 Z$/, 'L250,64 L222,64 Z');
    const half = cfg.liningStyle === 'half';
    const sleeve = sleevePath(cfg);
    let s = '';
    const side = (sd) => {
      let h = '';
      // lining (or bare fabric below a half lining)
      h += panel(u, body, half ? 'fab' : 'lin', ['shInside', 'shBody']);
      if (half) {
        h += `<clipPath id="${u}hl${sd}"><rect x="0" y="0" width="500" height="290"/></clipPath>
              <g clip-path="url(#${u}hl${sd})">${panel(u, body, 'lin', ['shInside', 'shBody'])}</g>
              <path d="M146,290 L250,290" stroke="rgba(0,0,0,.35)" stroke-width="1"/>`;
      }
      // facing strip in suit fabric along the front edge
      const facing = `M222,64 Q236,62 250,64 L250,${HEM + 10} L235,${HEM + 10} C233,380 227,300 222,220 C219,160 217,110 222,64 Z`;
      h += panel(u, facing, 'fab', ['shV']);
      // inside pocket welt
      const ip = cfg.insidePockets || '2';
      h += '<path d="M168,232 L210,230 L210,236 L168,238 Z" fill="rgba(0,0,0,.55)"/>';
      if (ip !== '1') h += '<path d="M174,330 L212,328 L212,333 L174,335 Z" fill="rgba(0,0,0,.5)"/>';
      if (sd === 'L' && cfg.monogram && cfg.monogramPlace !== 'none') {
        const y = cfg.monogramPlace === 'collar' ? 0 : 258;
        if (y) h += `<text x="189" y="${y}" text-anchor="middle" font-family="'Great Vibes','Brush Script MT',cursive" font-size="17" fill="${ctx.threadCol || '#f1e6c8'}" opacity=".95">${esc(cfg.monogram)}</text>`;
      }
      return h;
    };
    // back neck seen from inside, with under-collar felt
    const felt = (cat.felts || []).find(x => x.id === cfg.felt);
    s += `<path d="M204,56 Q250,42 296,56 L294,78 Q250,68 206,78 Z" fill="${felt && felt.color !== 'match' ? felt.color : `url(#${u}fab)`}" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>`;
    s += panel(u, sleeve, 'lin', ['shSleeve']);
    s += `<g transform="${MIRROR}">${panel(u, sleeve, 'lin', ['shSleeve'])}</g>`;
    s += side('L');
    s += `<g transform="${MIRROR}">${side('R')}</g>`;
    s += '<path d="M244,62 Q250,72 256,62" stroke="rgba(0,0,0,.5)" stroke-width="2" fill="none"/>';
    if (cfg.monogram && cfg.monogramPlace === 'collar') {
      s += `<text x="250" y="72" text-anchor="middle" font-family="'Great Vibes','Brush Script MT',cursive" font-size="12" fill="${ctx.threadCol || '#f1e6c8'}">${esc(cfg.monogram)}</text>`;
    }
    return s;
  }

  // ---------- pants view ----------
  function pantsView(u, cfg, ctx) {
    const leg = 'M141,104 L250,104 L250,300 Q248,322 247,342 C246,520 245,700 244,850 L158,850 C152,700 146,520 142,380 C138,280 137,180 141,104 Z';
    const wb = 'M140,70 L250,70 L250,104 L141,104 Z';
    const cuff = cfg.bottoms === 'cuffed';
    const g = (sd) => {
      let s = panel(u, leg, 'pfab', ['shLegP', 'shLegV']);
      // front pocket
      if ((cfg.frontPockets || 'slanted') === 'slanted') s += '<path d="M168,104 L146,196" stroke="rgba(0,0,0,.5)" stroke-width="1.4"/><path d="M170,104 L148,196" stroke="rgba(255,255,255,.12)" stroke-width="1"/>';
      else s += '<path d="M141,112 C139,140 139,170 141,206" stroke="rgba(0,0,0,.5)" stroke-width="1.4" fill="none"/>';
      // pleats
      const pl = cfg.pleats || 'flat';
      if (pl !== 'flat') s += '<path d="M200,104 C199,130 200,150 202,178" stroke="rgba(0,0,0,.42)" stroke-width="1.2" fill="none"/><path d="M203,104 C202,130 203,150 205,176" stroke="rgba(255,255,255,.14)" stroke-width="2" fill="none"/>';
      if (pl === 'double') s += '<path d="M224,104 C224,122 224,136 226,152" stroke="rgba(0,0,0,.38)" stroke-width="1.1" fill="none"/>';
      // crease
      s += `<path d="M${pl === 'flat' ? 201 : 202},${pl === 'flat' ? 140 : 178} C201,420 201,640 201,848" stroke="rgba(255,255,255,.14)" stroke-width="1.6" fill="none"/>`;
      if (cuff) s += '<path d="M156,816 L245,816" stroke="rgba(0,0,0,.55)" stroke-width="1.3"/><path d="M156,818 L245,818" stroke="rgba(255,255,255,.14)" stroke-width="1"/>';
      // waistband
      s += panel(u, wb, 'pfab', ['shV'], { filter: 'ds' });
      if ((cfg.waistband || 'loops') === 'loops') {
        [162, 214].forEach(x => { s += panel(u, `M${x},66 L${x + 8},66 L${x + 8},110 L${x},110 Z`, 'pfab', [], { filter: 'ds' }); });
      } else {
        s += panel(u, 'M134,80 L170,80 L170,94 L134,94 Z', 'pfab', [], { filter: 'ds' });
        s += '<rect x="158" y="78" width="10" height="18" rx="1.5" fill="none" stroke="#c9ccd1" stroke-width="2.2"/><path d="M163,78 L163,96" stroke="#9fa4ab" stroke-width="1.5"/>';
      }
      return s;
    };
    let s = g('L') + `<g transform="${MIRROR}">${g('R')}</g>`;
    // fly
    s += '<path d="M236,104 L236,196 Q237,212 250,218" stroke="rgba(0,0,0,.4)" stroke-width="1" stroke-dasharray="2 1.6" fill="none"/>';
    if (cfg.closure === 'tab') {
      s += panel(u, 'M250,70 L270,70 L278,87 L270,104 L250,104 Z', 'pfab', ['shV'], { filter: 'ds' });
      s += button(u, 268, 87, 5, ctx.btn, ctx.threadCol);
    } else {
      s += '<path d="M250,70 L250,104" stroke="rgba(0,0,0,.45)" stroke-width="1"/>';
    }
    return s;
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  let counter = 0;
  function render(cfg, cat, opts = {}) {
    const u = 'r' + (++counter) + '_';
    const view = opts.view || 'front';
    const fab = byId(cat.fabrics, cfg.fabric);
    const pantsFab = cfg.pantsFabric && cfg.pantsFabric !== 'same' ? byId(cat.fabrics, cfg.pantsFabric) : fab;
    const lining = byId(cat.linings, cfg.lining);
    const btn = byId(cat.buttons, cfg.buttons);
    const thr = (cat.threads || []).find(t => t.id === cfg.thread);
    const threadCol = thr && thr.color !== 'match' ? thr.color : null;
    const ctx = { btn, threadCol };
    const piece = cfg.piece || 'suit';
    let body = '';
    let vb = opts.viewBox;
    if (view === 'pants' || piece === 'pants') {
      body = pantsView(u, cfg, ctx);
      vb = vb || '60 40 380 830';
    } else if (view === 'back') {
      if (piece === 'suit') body += pantsUnderJacket(u, cfg);
      body += jacketBack(u, cfg);
      vb = vb || (piece === 'suit' ? '40 30 420 840' : '60 30 380 450');
    } else if (view === 'inside') {
      body = jacketInside(u, cfg, cat, ctx);
      vb = vb || '60 30 380 450';
    } else {
      if (piece === 'suit') body += pantsUnderJacket(u, cfg);
      body += `<g>${jacketFront(u, cfg, cat, ctx)}</g>`;
      vb = vb || (piece === 'suit' ? '40 30 420 840' : '60 30 380 450');
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="${opts.cls || ''}" role="img" aria-label="Suit preview">
      ${defs(u, fab, pantsFab, lining, btn, threadCol)}${body}</svg>`;
  }

  window.SuitRender = { render, byId };
})();
