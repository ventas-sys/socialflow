/* ============================================================================
   Cartel Pro — infografía publicitaria dibujada por CÓDIGO (Plan B).
   El texto lo escribe el canvas => siempre perfecto, en castellano, misma
   tipografía y colores de marca. La IA solo aporta el contenido (brief).
   Layout ANCLADO de abajo hacia arriba => nunca se superponen las secciones.
   Marca UNIPROVEEDORES: verde #A4D72B, gris #9AA0A6, negro #0D0D0D, blanco.
   window.renderProCard(cfg) -> Promise<dataURL PNG>
   ============================================================================ */
(function () {
  const GREEN = '#A4D72B', GRAY = '#9AA0A6', BLACK = '#0D0D0D', WHITE = '#FFFFFF';

  const USO_ICON = [
    [/(hogar|casa|jard)/i, '🏠'], [/(trabajo|taller|obra|laburo)/i, '🛠️'],
    [/(exterior|outdoor|aire|intemperie|jardin|jardín)/i, '🌳'],
    [/(transport|carga|mudanz|flete|reparto)/i, '🚚'],
    [/(almacen|guardar|organiz|deposit|estib)/i, '📦'],
    [/(moto|scooter)/i, '🏍️'], [/(auto|coche|carro|vehic)/i, '🚗'],
    [/(bici|ciclis)/i, '🚲'], [/(camion|camión|trailer|tráiler|acoplad)/i, '🚛'],
    [/(equipaj|mochila|bolso|valija|viaj)/i, '🎒'],
    [/(camping|carpa|acampe|aventur)/i, '⛺'], [/(barco|nautic|náutic|lancha|pesca)/i, '⛵'],
    [/(deporte|gimnasio|gym|fitness)/i, '🏋️'], [/(caja|paquete|encomiend)/i, '📦'],
  ];
  const FEAT_ICON = [
    [/(resist|durad|fuerte|robust|tenaz)/i, '💪'], [/(gancho|hook|broche|traba)/i, '🪝'],
    [/(elast|flex|estir|adaptab)/i, '🔗'], [/(segur|sujec|fij|firme|confiab)/i, '🛡️'],
    [/(color|variad|surtid)/i, '🎨'], [/(facil|fácil|practic|práctic|instal|rapid|rápid)/i, '👍'],
    [/(organiz|orden|acomod)/i, '📦'], [/(liviano|ligero|compact|portat)/i, '🪶'],
    [/(calidad|premium|garant|profesional)/i, '⭐'], [/(versat|versát|multiuso|todo)/i, '🔧'],
  ];
  const pick = (table, txt, def) => { for (const [re, ic] of table) if (re.test(txt)) return ic; return def; };

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im); im.onerror = reject; im.src = src;
    });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawCover(ctx, img, x, y, w, h, r) {
    ctx.save(); roundRect(ctx, x, y, w, h, r); ctx.clip();
    const ar = img.width / img.height, tr = w / h; let dw, dh;
    if (ar > tr) { dh = h; dw = h * ar; } else { dw = w; dh = w / ar; }
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  function setFont(ctx, weight, px, family) {
    ctx.font = `${weight} ${px}px ${family === 'anton' ? 'Anton, Impact, sans-serif' : 'Inter, Arial, sans-serif'}`;
  }
  // px máximo (<= startPx) para que `text` entre en maxW.
  function fitPx(ctx, text, weight, family, maxW, startPx, minPx) {
    for (let px = startPx; px > (minPx || 12); px -= 2) {
      setFont(ctx, weight, px, family);
      if (ctx.measureText(text).width <= maxW) return px;
    }
    return minPx || 12;
  }
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/); const lines = []; let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }
  // Parte el título en 1-2 líneas balanceadas por palabras.
  function titleLines(words) {
    const w = words.filter(Boolean);
    if (w.length <= 1) return [w.join(' ')];
    let best = 1, bestDiff = Infinity;
    for (let i = 1; i < w.length; i++) {
      const a = w.slice(0, i).join(' ').length, b = w.slice(i).join(' ').length;
      if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
    }
    return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
  }
  // Brochazo verde (paralelogramo) para acentos tipo agencia.
  function brush(ctx, x, y, w, h, color) {
    const s = h * 0.5;
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x + s, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - s, y + h); ctx.lineTo(x, y + h);
    ctx.closePath(); ctx.fill();
  }

  window.renderProCard = async function (cfg) {
    const { platform, brief, price, badge, photoB64 } = cfg;
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([document.fonts.load('normal 90px Anton'), document.fonts.load('700 30px Inter'), document.fonts.load('800 30px Inter')]);
        await document.fonts.ready;
      } catch (_) {}
    }

    let W = 1080, H = 1920;
    if (platform === 'fb') { W = 1080; H = 1350; }        // 4:5 feed
    else if (platform === 'yt') { W = 1920; H = 1080; }   // 16:9

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.textBaseline = 'alphabetic';

    // Fondo negro + resplandor verde arriba + viñeta abajo.
    ctx.fillStyle = BLACK; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W / 2, H * 0.10, 30, W / 2, H * 0.10, W);
    g.addColorStop(0, 'rgba(164,215,43,0.16)'); g.addColorStop(1, 'rgba(13,13,13,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const pad = Math.round(W * 0.055);
    const cx = W / 2;
    const contentW = W - pad * 2;

    let prodImg = null, logoImg = null;
    try { if (photoB64) prodImg = await loadImg('data:image/jpeg;base64,' + photoB64); } catch (_) {}
    try { logoImg = await loadImg('/logo-uniproveedores.png'); } catch (_) {}

    // ===== Anclas de abajo hacia arriba (evita superposiciones) =====
    const logoLW = Math.min(contentW, Math.round(W * 0.60));
    // Tope de seguridad: aunque el PNG venga con márgenes raros, el logo nunca
    // ocupa más del 13% del alto (evita que se rompa la maqueta).
    const logoLH = Math.min(
      logoImg ? logoLW * (logoImg.height / logoImg.width) : Math.round(W * 0.12),
      Math.round(H * 0.13)
    );
    const logoTop = H - pad - logoLH;
    const usosH = Math.round(H * 0.11);
    const usosTop = logoTop - usosH - Math.round(H * 0.02);
    const usosLabelY = usosTop - Math.round(H * 0.008);
    const featH = Math.round(H * 0.11);
    const featTop = usosLabelY - Math.round(H * 0.035) - featH;
    const bandH = Math.round(H * 0.042);
    const bandTop = featTop - Math.round(H * 0.02) - bandH;

    // ===== Header (título 2 colores + tagline) =====
    ctx.textAlign = 'center';
    let y = pad + Math.round(H * 0.015);
    const tl = titleLines((brief.product || 'PRODUCTO').toUpperCase().split(/\s+/));
    // fuente común que entre en todas las líneas
    let tpx = Math.round(W * 0.135);
    for (const ln of tl) tpx = Math.min(tpx, fitPx(ctx, ln, 'normal', 'anton', contentW, tpx, 40));
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    tl.forEach((ln, i) => {
      setFont(ctx, 'normal', tpx, 'anton');
      ctx.fillStyle = (tl.length === 2 && i === 1) ? GREEN : WHITE;
      y += tpx; ctx.fillText(ln, cx, y); y += Math.round(tpx * 0.06);
    });
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if (tl.length === 1) { ctx.fillStyle = GREEN; ctx.fillRect(cx - 80, y + 8, 160, 9); y += 18; }

    const tag = (brief.tagline || '').trim();
    if (tag) {
      y += Math.round(H * 0.012);
      let gpx = fitPx(ctx, tag, 'normal', 'anton', contentW, Math.round(W * 0.06), 26);
      setFont(ctx, 'normal', gpx, 'anton'); ctx.fillStyle = GREEN;
      const gl = wrap(ctx, tag, contentW).slice(0, 2);
      for (const ln of gl) { y += gpx; ctx.fillText(ln, cx, y); y += 4; }
    }

    // ===== Producto (llena el espacio entre header y la banda) =====
    const prodTop = y + Math.round(H * 0.02);
    const prodH = Math.max(Math.round(H * 0.20), bandTop - Math.round(H * 0.02) - prodTop);
    if (prodImg) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      roundRect(ctx, pad - 8, prodTop - 8, contentW + 16, prodH + 16, 30); ctx.fill();
      drawCover(ctx, prodImg, pad, prodTop, contentW, prodH, 24);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(164,215,43,0.35)';
      roundRect(ctx, pad, prodTop, contentW, prodH, 24); ctx.stroke();
    }

    // Badge de MEDIDA (caja redondeada arriba-derecha del producto).
    const spec = (brief.spec || '').trim();
    if (spec) {
      const parts = spec.split(/\s+/); const big = parts.shift(); const unit = parts.join(' ').toUpperCase();
      setFont(ctx, 'normal', Math.round(W * 0.075), 'anton');
      const bw = Math.max(ctx.measureText(big).width + 40, Math.round(W * 0.17));
      const bh = Math.round(W * (unit ? 0.15 : 0.11));
      const bx = W - pad - bw - 12, by = prodTop + 16;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 14;
      roundRect(ctx, bx, by, bw, bh, 16); ctx.fillStyle = 'rgba(13,13,13,0.9)'; ctx.fill(); ctx.restore();
      ctx.lineWidth = 4; ctx.strokeStyle = GREEN; roundRect(ctx, bx, by, bw, bh, 16); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = WHITE;
      let bpx = fitPx(ctx, big, 'normal', 'anton', bw - 24, Math.round(W * 0.075), 24);
      setFont(ctx, 'normal', bpx, 'anton');
      ctx.fillText(big, bx + bw / 2, by + (unit ? bh * 0.55 : bh * 0.72));
      if (unit) {
        let upx = fitPx(ctx, unit, '800', 'inter', bw - 20, Math.round(W * 0.032), 12);
        setFont(ctx, '800', upx, 'inter'); ctx.fillStyle = GREEN;
        ctx.fillText(unit, bx + bw / 2, by + bh * 0.86);
      }
    }

    // Badge de OFERTA (círculo verde abajo-derecha del producto).
    const badgeTxt = (badge || '').trim(); const priceTxt = (price || '').trim();
    if (badgeTxt && !/sin|ninguno/i.test(badgeTxt)) {
      const rr = Math.round(W * 0.115);
      const bcx = W - pad - rr - 6, bcy = prodTop + prodH - rr - 6;
      ctx.save(); ctx.beginPath(); ctx.arc(bcx, bcy, rr, 0, Math.PI * 2);
      ctx.fillStyle = GREEN; ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 22; ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.arc(bcx, bcy, rr, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = BLACK;
      setFont(ctx, '800', Math.round(rr * 0.32), 'inter');
      ctx.fillText(badgeTxt.toUpperCase(), bcx, bcy - rr * 0.22);
      if (priceTxt) {
        const pt = '$' + priceTxt.replace(/^\$/, '');
        let ppx = fitPx(ctx, pt, 'normal', 'anton', rr * 1.55, Math.round(rr * 0.62), 20);
        setFont(ctx, 'normal', ppx, 'anton'); ctx.fillText(pt, bcx, bcy + rr * 0.42);
      }
    }

    // ===== Banda de 3 palabras clave =====
    const feats = (brief.features || []).filter(Boolean);
    const band = feats.slice(0, 3).map(f => String(f).toUpperCase()).join('   •   ');
    if (band) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, bandTop, W, bandH);
      brush(ctx, 0, bandTop, W, 5, GREEN); brush(ctx, 0, bandTop + bandH - 5, W, 5, GREEN);
      let kpx = fitPx(ctx, band, 'normal', 'anton', W - pad * 1.4, Math.round(bandH * 0.5), 16);
      setFont(ctx, 'normal', kpx, 'anton'); ctx.fillStyle = WHITE; ctx.textAlign = 'center';
      ctx.fillText(band, cx, bandTop + bandH * 0.68);
    }

    // ===== Fila de FEATURES (círculo verde + emoji + 2 líneas) =====
    const fRow = feats.slice(0, 3);
    if (fRow.length) {
      const colW = contentW / fRow.length; const rr = Math.round(W * 0.055);
      const icY = featTop + rr + 6;
      fRow.forEach((f, i) => {
        const fxc = pad + colW * i + colW / 2;
        if (i > 0) { ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad + colW * i, featTop + 6); ctx.lineTo(pad + colW * i, featTop + featH - 6); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(fxc, icY, rr, 0, Math.PI * 2); ctx.fillStyle = GREEN; ctx.fill();
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(rr * 1.05)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.fillText(pick(FEAT_ICON, f, '✅'), fxc, icY + rr * 0.36);
        ctx.fillStyle = WHITE; setFont(ctx, '700', Math.round(W * 0.028), 'inter');
        const fl = wrap(ctx, String(f), colW - 18).slice(0, 2);
        let ty = icY + rr + Math.round(W * 0.045);
        for (const ln of fl) { ctx.fillText(ln, fxc, ty); ty += Math.round(W * 0.034); }
      });
    }

    // ===== IDEAL PARA + fila de usos =====
    const usos = (brief.usos || []).filter(Boolean).slice(0, 5);
    if (usos.length) {
      ctx.textAlign = 'left';
      setFont(ctx, 'normal', Math.round(W * 0.045), 'anton');
      const lblW = ctx.measureText('IDEAL PARA:').width;
      brush(ctx, pad - 6, usosLabelY - Math.round(W * 0.036), lblW + 34, Math.round(W * 0.05), GREEN);
      ctx.fillStyle = BLACK; ctx.fillText('IDEAL PARA:', pad + 10, usosLabelY);
      const colW = contentW / usos.length; const emY = usosTop + Math.round(W * 0.055);
      usos.forEach((u, i) => {
        const ux = pad + colW * i + colW / 2;
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(W * 0.062)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.fillText(pick(USO_ICON, u, '✅'), ux, emY);
        ctx.fillStyle = WHITE; setFont(ctx, '700', Math.round(W * 0.023), 'inter');
        const ul = wrap(ctx, String(u), colW - 8).slice(0, 1);
        ctx.fillText(ul[0] || String(u), ux, emY + Math.round(W * 0.045));
      });
    }

    // ===== Logo real (abajo, centrado, sin deformar) =====
    if (logoImg) {
      const ar = logoImg.width / logoImg.height;
      let dw = logoLW, dh = dw / ar;
      if (dh > logoLH) { dh = logoLH; dw = dh * ar; }
      ctx.drawImage(logoImg, cx - dw / 2, logoTop + (logoLH - dh) / 2, dw, dh);
    }

    return cv.toDataURL('image/png');
  };
})();
