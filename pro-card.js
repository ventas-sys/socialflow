/* ============================================================================
   Cartel Pro — plantilla publicitaria dibujada por CÓDIGO (Plan B).
   El texto NO lo dibuja la IA: lo escribe el canvas => siempre perfecto, en
   castellano, misma tipografía y colores de marca. La IA solo aporta el
   contenido (producto, medida, virtudes, usos) vía el "brief".
   Marca UNIPROVEEDORES: verde #A4D72B, gris #9AA0A6, negro #0D0D0D, blanco.
   window.renderProCard(cfg) -> Promise<dataURL PNG>
   ============================================================================ */
(function () {
  const GREEN = '#A4D72B', GRAY = '#9AA0A6', BLACK = '#0D0D0D', WHITE = '#FFFFFF';

  // Emojis por palabra clave (íconos claros y siempre correctos).
  const USO_ICON = [
    [/(moto|scooter)/i, '🏍️'], [/(auto|coche|carro|vehic)/i, '🚗'],
    [/(bici|bicicleta|ciclis)/i, '🚲'], [/(camion|camión|trailer|tráiler|acoplad)/i, '🚚'],
    [/(equipaj|mochila|bolso|valija)/i, '🎒'], [/(caja|paquete|carga|mudanz)/i, '📦'],
    [/(barco|nautic|náutic|lancha)/i, '⛵'], [/(camping|carpa|acampe|outdoor|aventur)/i, '⛺'],
    [/(hogar|casa|jardin|jardín)/i, '🏠'], [/(taller|obra|trabajo|industri)/i, '🔧'],
  ];
  const FEAT_ICON = [
    [/(resist|durable|durader|fuerte|robust)/i, '💪'], [/(gancho|hook|broche)/i, '🪝'],
    [/(elast|flex|estir)/i, '🔗'], [/(segur|sujec|fij|firme)/i, '🔒'],
    [/(color|variad|surtid)/i, '🎨'], [/(facil|fácil|practic|práctic|versat|versát)/i, '👍'],
    [/(liviano|ligero|compact)/i, '🪶'], [/(calidad|premium|garant)/i, '⭐'],
  ];
  const pick = (table, txt, def) => { for (const [re, ic] of table) if (re.test(txt)) return ic; return def; };

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = src;
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

  // Dibuja img cubriendo (cover) el rect x,y,w,h con esquinas redondeadas r.
  function drawCover(ctx, img, x, y, w, h, r) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r); ctx.clip();
    const ar = img.width / img.height, tr = w / h;
    let dw, dh;
    if (ar > tr) { dh = h; dw = h * ar; } else { dw = w; dh = w / ar; }
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  // Baja el tamaño de fuente hasta que el texto entre en maxWidth.
  function fitFont(ctx, text, font, maxW, startPx, minPx) {
    let px = startPx;
    for (; px >= (minPx || 12); px -= 2) {
      ctx.font = `${font} ${px}px Anton, Impact, sans-serif`;
      if (ctx.measureText(text).width <= maxW) break;
    }
    return px;
  }

  // Envuelve `text` en líneas que entren en maxW (para una fuente ya seteada).
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = []; let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
      else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  window.renderProCard = async function (cfg) {
    const { platform, brief, price, badge, photoB64 } = cfg;
    // Asegurar que las tipografías estén cargadas antes de dibujar en el canvas.
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load('normal 80px Anton'),
          document.fonts.load('700 30px Inter'),
          document.fonts.load('800 30px Inter'),
        ]);
        await document.fonts.ready;
      } catch (_) {}
    }

    // Formato por red: vertical (default), cuadrado (fb), horizontal (yt).
    let W = 1080, H = 1920;
    if (platform === 'fb') { W = 1080; H = 1080; }
    else if (platform === 'yt') { W = 1920; H = 1080; }
    const vertical = H >= W;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.textBaseline = 'alphabetic';

    // --- Fondo: negro con viñeta y un leve resplandor verde arriba ---
    ctx.fillStyle = BLACK; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W / 2, H * 0.12, 40, W / 2, H * 0.12, W * 0.9);
    g.addColorStop(0, 'rgba(164,215,43,0.18)'); g.addColorStop(1, 'rgba(13,13,13,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createLinearGradient(0, H * 0.6, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const pad = Math.round(W * 0.06);
    const cx = W / 2;
    let y = pad + Math.round(H * 0.02);

    // Cargas de imágenes (producto + logo real).
    let prodImg = null, logoImg = null;
    try { if (photoB64) prodImg = await loadImg('data:image/jpeg;base64,' + photoB64); } catch (_) {}
    try { logoImg = await loadImg('/logo-uniproveedores.png'); } catch (_) {}

    // ---- TÍTULO (producto, en MAYÚSCULAS) ----
    const title = (brief.product || 'PRODUCTO').toUpperCase();
    const titleMaxW = W - pad * 2;
    let tpx = fitFont(ctx, title, 'normal', titleMaxW, Math.round(W * 0.115), 40);
    ctx.font = `normal ${tpx}px Anton, Impact, sans-serif`;
    const tLines = wrap(ctx, title, titleMaxW);
    ctx.textAlign = 'center'; ctx.fillStyle = WHITE;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    for (const ln of tLines) { y += tpx; ctx.fillText(ln, cx, y); y += 6; }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // acento verde bajo el título
    ctx.fillStyle = GREEN; ctx.fillRect(cx - 70, y + 6, 140, 8); y += 30;

    // ---- TAGLINE (verde) ----
    const tag = (brief.tagline || '').trim();
    if (tag) {
      let gpx = fitFont(ctx, tag, 'normal', W - pad * 2, Math.round(W * 0.058), 26);
      ctx.font = `normal ${gpx}px Anton, Impact, sans-serif`;
      const gLines = wrap(ctx, tag, W - pad * 2).slice(0, 2);
      ctx.fillStyle = GREEN;
      for (const ln of gLines) { y += gpx; ctx.fillText(ln, cx, y); y += 4; }
      y += 16;
    }

    // ---- PRODUCTO (foto real dentro de una tarjeta) ----
    const imgH = Math.round(H * (vertical ? 0.40 : 0.34));
    const imgY = y;
    if (prodImg) {
      // sutil panel detrás
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      roundRect(ctx, pad - 6, imgY - 6, W - (pad - 6) * 2, imgH + 12, 28); ctx.fill();
      drawCover(ctx, prodImg, pad, imgY, W - pad * 2, imgH, 24);
    }

    // ---- MEDALLA de medida (spec) arriba-derecha del producto ----
    const spec = (brief.spec || '').trim();
    if (spec) {
      const parts = spec.split(/\s+/);
      const big = parts.shift();
      const small = parts.join(' ').toUpperCase();
      const rr = Math.round(W * 0.085);
      const mcx = W - pad - rr - 6, mcy = imgY + rr + 10;
      ctx.beginPath(); ctx.arc(mcx, mcy, rr, 0, Math.PI * 2);
      ctx.fillStyle = GREEN; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
      ctx.fillStyle = BLACK; ctx.textAlign = 'center';
      let bpx = fitFont(ctx, big, 'normal', rr * 1.6, Math.round(rr * 0.9), 22);
      ctx.font = `normal ${bpx}px Anton, Impact, sans-serif`;
      ctx.fillText(big, mcx, mcy + (small ? 2 : bpx * 0.35));
      if (small) {
        let spx = fitFont(ctx, small, 'bold', rr * 1.7, Math.round(rr * 0.32), 12);
        ctx.font = `bold ${spx}px Inter, Arial, sans-serif`;
        ctx.fillText(small, mcx, mcy + rr * 0.5);
      }
    }

    // ---- BADGE de oferta (abajo-derecha del producto) ----
    const badgeTxt = (badge || '').trim();
    const priceTxt = (price || '').trim();
    if (badgeTxt && !/sin|ninguno/i.test(badgeTxt)) {
      const rr = Math.round(W * 0.11);
      const bcx = W - pad - rr, bcy = imgY + imgH - rr + 4;
      ctx.save();
      ctx.beginPath(); ctx.arc(bcx, bcy, rr, 0, Math.PI * 2);
      ctx.fillStyle = GREEN; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 20; ctx.fill();
      ctx.restore();
      ctx.fillStyle = BLACK; ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(rr * 0.32)}px Inter, Arial, sans-serif`;
      ctx.fillText(badgeTxt.toUpperCase(), bcx, bcy - rr * 0.18);
      if (priceTxt) {
        const pt = '$' + priceTxt.replace(/^\$/, '');
        let ppx = fitFont(ctx, pt, 'normal', rr * 1.5, Math.round(rr * 0.6), 20);
        ctx.font = `normal ${ppx}px Anton, Impact, sans-serif`;
        ctx.fillText(pt, bcx, bcy + rr * 0.4);
      }
    }

    y = imgY + imgH + 40;

    // ---- BANDA de 3 palabras clave (de las features) ----
    const feats = (brief.features || []).filter(Boolean);
    const band = feats.slice(0, 3).map(f => String(f).toUpperCase()).join('   ·   ');
    if (band) {
      const bh = Math.round(H * 0.045);
      ctx.fillStyle = '#000'; ctx.fillRect(0, y, W, bh);
      ctx.fillStyle = GREEN; ctx.fillRect(0, y, W, 4);
      ctx.fillStyle = GREEN; ctx.fillRect(0, y + bh - 4, W, 4);
      let kpx = fitFont(ctx, band, 'normal', W - pad * 1.2, Math.round(bh * 0.5), 18);
      ctx.font = `normal ${kpx}px Anton, Impact, sans-serif`;
      ctx.fillStyle = WHITE; ctx.textAlign = 'center';
      ctx.fillText(band, cx, y + bh * 0.68);
      y += bh + 40;
    }

    // ---- FILA de FEATURES (círculo verde + emoji + texto) ----
    const fRow = feats.slice(0, 3);
    if (fRow.length) {
      const colW = (W - pad * 2) / fRow.length;
      const rr = Math.round(W * 0.052);
      fRow.forEach((f, i) => {
        const fx = pad + colW * i + colW / 2;
        ctx.beginPath(); ctx.arc(fx, y + rr, rr, 0, Math.PI * 2);
        ctx.fillStyle = GREEN; ctx.fill();
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(rr * 1.05)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
        ctx.fillText(pick(FEAT_ICON, f, '✅'), fx, y + rr + rr * 0.38);
        // texto (2 líneas)
        ctx.fillStyle = WHITE;
        ctx.font = `700 ${Math.round(W * 0.028)}px Inter, Arial, sans-serif`;
        const fl = wrap(ctx, String(f), colW - 16).slice(0, 2);
        let ty = y + rr * 2 + 34;
        for (const ln of fl) { ctx.fillText(ln, fx, ty); ty += Math.round(W * 0.033); }
      });
      y += rr * 2 + 110;
    }

    // ---- IDEAL PARA: (emoji + label) ----
    const usos = (brief.usos || []).filter(Boolean).slice(0, 5);
    if (usos.length) {
      ctx.textAlign = 'left'; ctx.fillStyle = GREEN;
      ctx.font = `normal ${Math.round(W * 0.045)}px Anton, Impact, sans-serif`;
      ctx.fillText('IDEAL PARA:', pad, y);
      y += Math.round(W * 0.02);
      const colW = (W - pad * 2) / usos.length;
      usos.forEach((u, i) => {
        const ux = pad + colW * i + colW / 2;
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(W * 0.06)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
        ctx.fillText(pick(USO_ICON, u, '🔧'), ux, y + Math.round(W * 0.06));
        ctx.fillStyle = WHITE;
        ctx.font = `700 ${Math.round(W * 0.024)}px Inter, Arial, sans-serif`;
        const ul = wrap(ctx, String(u), colW - 10).slice(0, 1);
        ctx.fillText(ul[0] || String(u), ux, y + Math.round(W * 0.105));
        ctx.fillStyle = WHITE;
      });
      y += Math.round(W * 0.14);
    }

    // ---- LOGO real (abajo, centrado) ----
    if (logoImg) {
      const lw = Math.min(W - pad * 2, Math.round(W * 0.62));
      const lh = lw * (logoImg.height / logoImg.width);
      const ly = Math.min(y + 10, H - lh - pad * 0.6);
      ctx.drawImage(logoImg, cx - lw / 2, ly, lw, lh);
    }

    return cv.toDataURL('image/png');
  };
})();
