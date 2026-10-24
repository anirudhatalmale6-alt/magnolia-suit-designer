/* Fabric / lining texture generator.
 * Every texture is a seamless 256x256 tile, so it can repeat across the garment.
 * Real fabric photos uploaded in the admin skip this and are used directly. */
(function () {
  const SIZE = 256;
  const cache = new Map();

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  function hexToRgb(hex) {
    const h = (hex || '#777777').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  function noise(ctx, amount, seed) {
    const img = ctx.getImageData(0, 0, SIZE, SIZE);
    const d = img.data;
    const r = rng(seed);
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * amount;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  // diagonal twill wale: period 4px, seamless on a 256 tile
  function twill(ctx, dir, light, dark) {
    ctx.save();
    ctx.lineWidth = 1.3;
    for (let i = -SIZE; i <= SIZE * 2; i += 4) {
      ctx.strokeStyle = light;
      ctx.beginPath();
      if (dir > 0) { ctx.moveTo(i, 0); ctx.lineTo(i + SIZE, SIZE); }
      else { ctx.moveTo(i, SIZE); ctx.lineTo(i + SIZE, 0); }
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.beginPath();
      if (dir > 0) { ctx.moveTo(i + 2, 0); ctx.lineTo(i + 2 + SIZE, SIZE); }
      else { ctx.moveTo(i + 2, SIZE); ctx.lineTo(i + 2 + SIZE, 0); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(p) {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    const base = p.base || '#555555';
    const accent = p.accent || '#999999';
    const accent2 = p.accent2 || accent;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, SIZE, SIZE);

    switch (p.kind) {
      case 'herringbone': {
        const col = 16;
        for (let x = 0; x < SIZE; x += col) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x, 0, col, SIZE); ctx.clip();
          const dir = (x / col) % 2 === 0 ? 1 : -1;
          twill(ctx, dir, rgba(accent, 0.28), 'rgba(0,0,0,0.22)');
          ctx.restore();
          ctx.fillStyle = 'rgba(0,0,0,0.10)';
          ctx.fillRect(x, 0, 1, SIZE);
        }
        noise(ctx, 18, 7);
        break;
      }
      case 'pinstripe':
        twill(ctx, 1, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.10)');
        noise(ctx, 14, 3);
        ctx.fillStyle = rgba(accent, 0.85);
        for (let x = 16; x < SIZE; x += 32) ctx.fillRect(x, 0, 1.3, SIZE);
        break;
      case 'chalkstripe':
        twill(ctx, 1, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.10)');
        noise(ctx, 16, 5);
        ctx.save();
        ctx.filter = 'blur(1.2px)';
        ctx.fillStyle = rgba(accent, 0.55);
        for (let x = 32; x < SIZE; x += 64) {
          ctx.fillRect(x - 1, -4, 3, SIZE + 8);
        }
        ctx.restore();
        break;
      case 'glencheck': {
        twill(ctx, 1, 'rgba(255,255,255,0.04)', 'rgba(0,0,0,0.08)');
        const P = 128;
        const bands = (o, w, a, col) => {
          ctx.fillStyle = rgba(col, a);
          for (let k = 0; k < SIZE; k += P) {
            ctx.fillRect(k + o, 0, w, SIZE);
            ctx.fillRect(0, k + o, SIZE, w);
          }
        };
        bands(0, 44, 0.16, accent);
        bands(52, 3, 0.35, accent);
        bands(60, 3, 0.35, accent);
        bands(68, 3, 0.35, accent);
        bands(100, 2, 0.75, accent2);
        noise(ctx, 16, 11);
        break;
      }
      case 'windowpane':
        twill(ctx, 1, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.10)');
        noise(ctx, 14, 13);
        ctx.fillStyle = rgba(accent, 0.75);
        for (let k = 0; k < SIZE; k += 128) {
          ctx.fillRect(k + 64, 0, 2, SIZE);
          ctx.fillRect(0, k + 64, SIZE, 2);
        }
        break;
      case 'birdseye':
        for (let y = 0; y < SIZE; y += 4)
          for (let x = 0; x < SIZE; x += 4) {
            ctx.fillStyle = ((x + y) / 4) % 2 ? rgba(accent, 0.35) : 'rgba(0,0,0,0.18)';
            ctx.fillRect(x + 1, y + 1, 2, 2);
          }
        noise(ctx, 14, 17);
        break;
      // ---- lining kinds ----
      case 'satin': {
        const g = ctx.createLinearGradient(0, 0, SIZE, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.00)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
        g.addColorStop(1, 'rgba(255,255,255,0.00)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
        noise(ctx, 5, 19);
        break;
      }
      case 'stripe':
        for (let x = 0; x < SIZE; x += 32) {
          ctx.fillStyle = rgba(accent, 0.9); ctx.fillRect(x, 0, 12, SIZE);
          ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 14, 0, 2, SIZE);
        }
        noise(ctx, 5, 23);
        break;
      case 'dot':
        ctx.fillStyle = rgba(accent, 0.9);
        for (let y = 0; y < SIZE; y += 32)
          for (let x = 0; x < SIZE; x += 32) {
            const ox = (y / 32) % 2 ? 16 : 0;
            ctx.beginPath(); ctx.arc(x + ox + 8, y + 8, 3.2, 0, Math.PI * 2); ctx.fill();
          }
        noise(ctx, 5, 29);
        break;
      case 'paisley':
        ctx.strokeStyle = rgba(accent, 0.9);
        ctx.fillStyle = rgba(accent, 0.45);
        ctx.lineWidth = 2;
        for (let y = 0; y < SIZE; y += 64)
          for (let x = 0; x < SIZE; x += 64) {
            const ox = (y / 64) % 2 ? 32 : 0;
            ctx.save();
            ctx.translate(x + ox + 32, y + 32);
            ctx.rotate(-0.6);
            ctx.beginPath();
            ctx.moveTo(0, -18);
            ctx.bezierCurveTo(16, -14, 16, 12, 0, 16);
            ctx.bezierCurveTo(-14, 16, -14, 2, -4, 0);
            ctx.bezierCurveTo(4, -4, 2, -12, 0, -18);
            ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.arc(2, 6, 3.5, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
          }
        noise(ctx, 5, 31);
        break;
      case 'geo':
        ctx.strokeStyle = rgba(accent, 0.85);
        ctx.lineWidth = 1.6;
        for (let y = 0; y <= SIZE; y += 32)
          for (let x = 0; x <= SIZE; x += 32) {
            ctx.beginPath();
            ctx.moveTo(x, y - 12); ctx.lineTo(x + 12, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 12, y);
            ctx.closePath(); ctx.stroke();
          }
        noise(ctx, 5, 37);
        break;
      default: // solid twill worsted
        twill(ctx, 1, 'rgba(255,255,255,0.055)', 'rgba(0,0,0,0.12)');
        noise(ctx, 16, 41);
    }
    return c.toDataURL('image/jpeg', 0.9);
  }

  function key(p) { return JSON.stringify([p.kind, p.base, p.accent, p.accent2]); }

  // item = fabric / lining record. Uploaded photos are used as-is.
  function textureFor(item) {
    if (!item) return null;
    if (item.img) return item.img;
    const p = item.pattern || {};
    const k = key(p);
    if (!cache.has(k)) cache.set(k, draw(p));
    return cache.get(k);
  }

  window.Textures = { textureFor, hexToRgb };
})();
