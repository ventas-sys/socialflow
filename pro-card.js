/* ============================================================================
   Cartel Pro — infografía publicitaria dibujada por CÓDIGO (Plan B).
   El texto lo escribe el canvas => siempre perfecto, en castellano, misma
   tipografía y colores de marca. La IA solo aporta el contenido (brief).
   Layout ANCLADO de abajo hacia arriba => nunca se superponen las secciones.
   Marca UNIPROVEEDORES: verde #A4D72B, gris #9AA0A6, negro #0D0D0D, blanco.
   window.renderProCard(cfg) -> Promise<dataURL PNG>
   ============================================================================ */
// Agrega el logo REAL de UNIPROVEEDORES en una BARRA SUPERIOR propia (extiende
// el alto de la imagen), separada del diseño para que NO se superponga con el
// título. gpt-image-1 no dibuja el logo; se agrega acá, exacto y prolijo.
window.stampBrandLogo = function (imgUrl) {
  return new Promise((resolve) => {
    const base = new Image(); base.crossOrigin = 'anonymous';
    base.onload = () => {
      const logo = new Image(); logo.crossOrigin = 'anonymous';
      logo.onload = () => {
        const W = base.width, H = base.height;
        const barH = Math.round(W * 0.14);         // barra propia arriba
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H + barH;
        const ctx = cv.getContext('2d');
        // barra: negro de marca con leve degradé + línea verde de acento
        const g = ctx.createLinearGradient(0, 0, 0, barH);
        g.addColorStop(0, '#0d0d0d'); g.addColorStop(1, '#151515');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, barH);
        ctx.fillStyle = '#A4D72B'; ctx.fillRect(0, barH - Math.round(barH * 0.05), W, Math.round(barH * 0.05));
        // logo centrado en la barra, sin deformar
        const maxW = Math.round(W * 0.52), maxH = Math.round(barH * 0.6);
        const ar = logo.width / logo.height;
        let lw = maxW, lh = lw / ar;
        if (lh > maxH) { lh = maxH; lw = lh * ar; }
        ctx.drawImage(logo, (W - lw) / 2, Math.round((barH - lh) / 2), lw, lh);
        // el diseño de la IA, debajo de la barra
        ctx.drawImage(base, 0, barH, W, H);
        resolve(cv.toDataURL('image/png'));
      };
      logo.onerror = () => resolve(imgUrl);
      logo.src = '/logo-uniproveedores.png';
    };
    base.onerror = () => resolve(imgUrl);
    base.src = imgUrl;
  });
};

// Medidas EXACTAS recomendadas por red social.
window.PLATFORM_SIZE = {
  ig: [1080, 1350],  // Instagram feed 4:5
  fb: [1080, 1350],  // Facebook feed 4:5
  wa: [1080, 1920],  // WhatsApp estado 9:16
  tk: [1080, 1920],  // TikTok 9:16
  li: [1080, 1080],  // LinkedIn 1:1
  tw: [1600, 900],   // X/Twitter 16:9
  yt: [1280, 720],   // YouTube miniatura 16:9
};

// Reformatea una imagen al tamaño EXACTO de la red SIN cortar el diseño:
// dibuja el diseño completo (contain) centrado, y rellena los bordes con una
// copia desenfocada de la misma imagen (nada de barras negras).
window.formatForPlatform = function (url, platform) {
  const [TW, TH] = window.PLATFORM_SIZE[platform] || [1080, 1350];
  return new Promise((resolve) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => {
      const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
      const ctx = cv.getContext('2d');
      const ar = im.width / im.height, tr = TW / TH;
      // Fondo: COVER (llena y recorta) + desenfoque -> tapa los bordes.
      let cw, ch; if (ar > tr) { ch = TH; cw = TH * ar; } else { cw = TW; ch = TW / ar; }
      ctx.filter = 'blur(30px) brightness(0.55)';
      ctx.drawImage(im, (TW - cw) / 2, (TH - ch) / 2, cw, ch);
      ctx.filter = 'none';
      // Diseño completo: CONTAIN (entra entero) centrado y nítido.
      let dw, dh; if (ar > tr) { dw = TW; dh = TW / ar; } else { dh = TH; dw = TH * ar; }
      ctx.drawImage(im, (TW - dw) / 2, (TH - dh) / 2, dw, dh);
      resolve(cv.toDataURL('image/png'));
    };
    im.onerror = () => resolve(url);
    im.src = url;
  });
};

(function () {
  const GREEN = '#A4D72B', GRAY = '#9AA0A6', BLACK = '#0D0D0D', WHITE = '#FFFFFF';

  // Cada palabra clave -> nombre de un ícono VECTORIAL (dibujado, no emoji).
  const USO_ICON = [
    [/(hogar|casa|jard)/i, 'home'], [/(trabajo|taller|obra|laburo|bricolaj|reparac)/i, 'gear'],
    [/(exterior|outdoor|aire|intemperie)/i, 'tree'],
    [/(transport|camion|camión|trailer|tráiler|acoplad|flete|reparto|mudanz)/i, 'truck'],
    [/(almacen|guardar|organiz|deposit|estib|caja|paquete|carga)/i, 'box'],
    [/(moto|scooter)/i, 'moto'], [/(auto|coche|carro|vehic)/i, 'car'],
    [/(bici|ciclis)/i, 'bike'], [/(equipaj|mochila|bolso|valija|viaj)/i, 'backpack'],
    [/(camping|carpa|acampe|aventur)/i, 'tent'], [/(barco|nautic|náutic|lancha|pesca)/i, 'boat'],
    [/(deporte|gimnasio|gym|fitness)/i, 'star'],
  ];
  const FEAT_ICON = [
    [/(resist|durad|fuerte|robust|tenaz)/i, 'shield'], [/(gancho|hook|broche|traba)/i, 'hook'],
    [/(elast|flex|estir|adaptab)/i, 'link'], [/(segur|sujec|fij|firme|confiab)/i, 'shield'],
    [/(color|variad|surtid)/i, 'palette'], [/(facil|fácil|practic|práctic|instal|rapid|rápid)/i, 'check'],
    [/(organiz|orden|acomod)/i, 'box'], [/(liviano|ligero|compact|portat)/i, 'feather'],
    [/(calidad|premium|garant|profesional)/i, 'star'], [/(versat|versát|multiuso|todo)/i, 'gear'],
  ];
  const pick = (table, txt, def) => { for (const [re, ic] of table) if (re.test(txt)) return ic; return def; };

  // Dibuja un ícono monolínea (estilo agencia) centrado en (x,y), radio r.
  function drawIcon(ctx, name, x, y, r, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = Math.max(3, r * 0.15);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const u = r * 0.62; const L = (ax, ay, bx, by) => { ctx.beginPath(); ctx.moveTo(x + ax, y + ay); ctx.lineTo(x + bx, y + by); ctx.stroke(); };
    const circle = (cxo, cyo, rr, fill) => { ctx.beginPath(); ctx.arc(x + cxo, y + cyo, rr, 0, Math.PI * 2); fill ? ctx.fill() : ctx.stroke(); };
    switch (name) {
      case 'check':
        ctx.beginPath(); ctx.moveTo(x - u * 0.8, y); ctx.lineTo(x - u * 0.15, y + u * 0.65); ctx.lineTo(x + u * 0.9, y - u * 0.7); ctx.stroke(); break;
      case 'shield':
        ctx.beginPath(); ctx.moveTo(x, y - u); ctx.lineTo(x + u * 0.85, y - u * 0.55);
        ctx.lineTo(x + u * 0.85, y + u * 0.15); ctx.quadraticCurveTo(x + u * 0.8, y + u * 0.8, x, y + u);
        ctx.quadraticCurveTo(x - u * 0.8, y + u * 0.8, x - u * 0.85, y + u * 0.15);
        ctx.lineTo(x - u * 0.85, y - u * 0.55); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - u * 0.35, y + u * 0.02); ctx.lineTo(x - u * 0.05, y + u * 0.32); ctx.lineTo(x + u * 0.45, y - u * 0.35); ctx.stroke(); break;
      case 'hook':
        ctx.beginPath(); ctx.arc(x, y - u * 0.35, u * 0.55, Math.PI * 0.9, Math.PI * 2.15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + u * 0.5, y - u * 0.35); ctx.lineTo(x + u * 0.5, y + u * 0.35);
        ctx.arc(x + u * 0.15, y + u * 0.35, u * 0.35, 0, Math.PI); ctx.stroke(); break;
      case 'link':
        ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 4);
        ctx.beginPath(); ctx.ellipse(-u * 0.35, 0, u * 0.5, u * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(u * 0.35, 0, u * 0.5, u * 0.32, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); break;
      case 'palette':
        ctx.beginPath(); ctx.arc(x, y, u * 0.9, 0, Math.PI * 2); ctx.stroke();
        circle(-u * 0.4, -u * 0.35, u * 0.14, true); circle(u * 0.35, -u * 0.35, u * 0.14, true);
        circle(u * 0.5, u * 0.2, u * 0.14, true); circle(-u * 0.1, u * 0.45, u * 0.14, true); break;
      case 'feather':
        ctx.beginPath(); ctx.moveTo(x + u * 0.7, y - u * 0.7); ctx.quadraticCurveTo(x - u * 0.9, y - u * 0.4, x - u * 0.5, y + u * 0.8);
        ctx.quadraticCurveTo(x + u * 0.6, y + u * 0.4, x + u * 0.7, y - u * 0.7); ctx.closePath(); ctx.stroke();
        L(0.1 * u, 0.6 * u, 0.5 * u, -0.4 * u); break;
      case 'gear':
        ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const r1 = u * 0.95, r2 = u * 0.62; ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.lineTo(x + Math.cos(a + 0.35) * r2, y + Math.sin(a + 0.35) * r2); } ctx.closePath(); ctx.stroke(); circle(0, 0, u * 0.3, false); break;
      case 'star':
        ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; const a2 = a + Math.PI / 5; ctx.lineTo(x + Math.cos(a) * u, y + Math.sin(a) * u); ctx.lineTo(x + Math.cos(a2) * u * 0.45, y + Math.sin(a2) * u * 0.45); } ctx.closePath(); ctx.fill(); break;
      case 'box':
        ctx.beginPath(); ctx.moveTo(x - u * 0.8, y - u * 0.35); ctx.lineTo(x, y - u * 0.75); ctx.lineTo(x + u * 0.8, y - u * 0.35);
        ctx.lineTo(x + u * 0.8, y + u * 0.55); ctx.lineTo(x, y + u * 0.95); ctx.lineTo(x - u * 0.8, y + u * 0.55); ctx.closePath(); ctx.stroke();
        L(-0.8 * u, -0.35 * u, 0, 0.05 * u); L(0.8 * u, -0.35 * u, 0, 0.05 * u); L(0, 0.05 * u, 0, 0.95 * u); break;
      case 'home':
        ctx.beginPath(); ctx.moveTo(x - u * 0.9, y - u * 0.05); ctx.lineTo(x, y - u * 0.85); ctx.lineTo(x + u * 0.9, y - u * 0.05); ctx.stroke();
        ctx.strokeRect(x - u * 0.6, y - u * 0.05, u * 1.2, u * 0.9);
        ctx.strokeRect(x - u * 0.18, y + u * 0.35, u * 0.36, u * 0.5); break;
      case 'truck':
        ctx.strokeRect(x - u * 0.9, y - u * 0.45, u * 1.15, u * 0.8);
        ctx.beginPath(); ctx.moveTo(x + u * 0.25, y - u * 0.1); ctx.lineTo(x + u * 0.6, y - u * 0.1); ctx.lineTo(x + u * 0.9, y + u * 0.15); ctx.lineTo(x + u * 0.9, y + u * 0.35); ctx.lineTo(x + u * 0.25, y + u * 0.35); ctx.stroke();
        circle(-u * 0.45, u * 0.5, u * 0.22, false); circle(u * 0.55, u * 0.5, u * 0.22, false); break;
      case 'car':
        ctx.beginPath(); ctx.moveTo(x - u * 0.95, y + u * 0.25); ctx.lineTo(x - u * 0.7, y - u * 0.15); ctx.lineTo(x - u * 0.3, y - u * 0.15); ctx.lineTo(x - u * 0.05, y - u * 0.5); ctx.lineTo(x + u * 0.5, y - u * 0.5); ctx.lineTo(x + u * 0.75, y - u * 0.15); ctx.lineTo(x + u * 0.95, y + u * 0.05); ctx.lineTo(x + u * 0.95, y + u * 0.25); ctx.stroke();
        circle(-u * 0.5, u * 0.3, u * 0.22, false); circle(u * 0.5, u * 0.3, u * 0.22, false); break;
      case 'bike':
        circle(-u * 0.55, u * 0.25, u * 0.42, false); circle(u * 0.55, u * 0.25, u * 0.42, false);
        ctx.beginPath(); ctx.moveTo(x - u * 0.55, y + u * 0.25); ctx.lineTo(x - u * 0.05, y + u * 0.25); ctx.lineTo(x + u * 0.25, y - u * 0.4); ctx.lineTo(x + u * 0.55, y + u * 0.25); ctx.moveTo(x - u * 0.05, y + u * 0.25); ctx.lineTo(x + u * 0.1, y - u * 0.4); ctx.lineTo(x + u * 0.45, y - u * 0.4); ctx.stroke(); break;
      case 'backpack':
        ctx.beginPath(); ctx.moveTo(x - u * 0.6, y + u * 0.9); ctx.lineTo(x - u * 0.6, y - u * 0.2); ctx.quadraticCurveTo(x, y - u, x + u * 0.6, y - u * 0.2); ctx.lineTo(x + u * 0.6, y + u * 0.9); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - u * 0.25, y - u * 0.55); ctx.quadraticCurveTo(x, y - u * 0.35, x + u * 0.25, y - u * 0.55); ctx.stroke();
        ctx.strokeRect(x - u * 0.35, y + u * 0.15, u * 0.7, u * 0.5); break;
      case 'tree':
        ctx.beginPath(); ctx.arc(x, y - u * 0.2, u * 0.7, 0, Math.PI * 2); ctx.stroke(); L(0, 0.4 * u, 0, 0.95 * u); break;
      case 'tent':
        ctx.beginPath(); ctx.moveTo(x - u * 0.9, y + u * 0.7); ctx.lineTo(x, y - u * 0.8); ctx.lineTo(x + u * 0.9, y + u * 0.7); ctx.closePath(); ctx.stroke(); L(0, -0.8 * u, 0, 0.7 * u); break;
      case 'boat':
        ctx.beginPath(); ctx.moveTo(x - u * 0.9, y + u * 0.2); ctx.lineTo(x + u * 0.9, y + u * 0.2); ctx.lineTo(x + u * 0.5, y + u * 0.75); ctx.lineTo(x - u * 0.5, y + u * 0.75); ctx.closePath(); ctx.stroke();
        L(0, -0.8 * u, 0, 0.2 * u); ctx.beginPath(); ctx.moveTo(x, y - u * 0.8); ctx.lineTo(x + u * 0.6, y - u * 0.05); ctx.lineTo(x, y - u * 0.05); ctx.stroke(); break;
      case 'tools':
        ctx.beginPath(); ctx.moveTo(x - u * 0.7, y - u * 0.7); ctx.lineTo(x + u * 0.4, y + u * 0.4); ctx.stroke();
        ctx.beginPath(); ctx.arc(x - u * 0.6, y - u * 0.6, u * 0.28, Math.PI * 0.6, Math.PI * 2.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + u * 0.15, y + u * 0.7); ctx.lineTo(x + u * 0.75, y + u * 0.1); ctx.lineTo(x + u * 0.55, y - u * 0.1); ctx.lineTo(x - u * 0.05, y + u * 0.5); ctx.stroke(); break;
      default:
        circle(0, 0, u * 0.5, true);
    }
    ctx.restore();
  }

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

    // Badge de MEDIDA: solo si es una medida REAL (número + unidad).
    // Evita cosas feas como "x4 unidades" (que ya está en el título).
    const specRaw = (brief.spec || '').trim();
    const isMeasure = /\d/.test(specRaw) && /(m|mm|cm|mts?|metros?|kg|grs?|gramos?|lt?s?|litros?|ml|"|''|pulg|w|kw|v|amp|ah|mah|pcs?|piez)\b/i.test(specRaw);
    const spec = isMeasure ? specRaw : '';
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
        drawIcon(ctx, pick(FEAT_ICON, f, 'check'), fxc, icY, rr * 0.6, BLACK);
        ctx.textAlign = 'center';
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
      brush(ctx, pad, usosLabelY - Math.round(W * 0.038), lblW + 52, Math.round(W * 0.052), GREEN);
      ctx.fillStyle = BLACK; ctx.fillText('IDEAL PARA:', pad + 28, usosLabelY);
      const colW = contentW / usos.length; const emY = usosTop + Math.round(W * 0.055);
      usos.forEach((u, i) => {
        const ux = pad + colW * i + colW / 2;
        drawIcon(ctx, pick(USO_ICON, u, 'box'), ux, emY - Math.round(W * 0.02), Math.round(W * 0.036), GREEN);
        ctx.textAlign = 'center';
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

  // ===== HÍBRIDO: overlay de texto+logo por CÓDIGO sobre la escena de la IA ====
  // La IA entrega solo producto+fondo (sin texto). Acá dibujamos, integrado:
  // logo arriba, título 2 colores, subtítulo, y abajo checklist + sello + badges.
  // Texto SIEMPRE perfecto (castellano AR), tipografía y colores de marca.
  window.composeAdOverlay = async function (aiUrl, brief, opts) {
    brief = brief || {}; opts = opts || {};
    if (document.fonts && document.fonts.load) {
      try { await Promise.all([document.fonts.load('normal 90px Anton'), document.fonts.load('700 30px Inter'), document.fonts.load('800 30px Inter')]); await document.fonts.ready; } catch (_) {}
    }
    const base = await loadImgSafe(aiUrl); if (!base) return aiUrl;
    const logoImg = await loadImgSafe('/logo-uniproveedores.png');
    const W = base.width, H = base.height, cx = W / 2, pad = Math.round(W * 0.055);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); ctx.textBaseline = 'alphabetic';
    ctx.drawImage(base, 0, 0, W, H);

    // Scrims (degradés) arriba y abajo para que el texto se lea sobre cualquier fondo.
    // El de arriba es alto y oscuro: la IA deja esa zona vacía para el título.
    let g = ctx.createLinearGradient(0, 0, 0, H * 0.46);
    g.addColorStop(0, 'rgba(6,6,6,0.96)'); g.addColorStop(0.7, 'rgba(6,6,6,0.75)'); g.addColorStop(1, 'rgba(6,6,6,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.46);
    g = ctx.createLinearGradient(0, H * 0.52, 0, H);
    g.addColorStop(0, 'rgba(6,6,6,0)'); g.addColorStop(1, 'rgba(6,6,6,0.96)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.52, W, H * 0.48);

    // ---- LOGO integrado arriba-izquierda ----
    let y = pad;
    if (logoImg) {
      const lw = Math.min(W * 0.46, W - pad * 2), lh = lw * (logoImg.height / logoImg.width);
      ctx.drawImage(logoImg, pad, y, lw, lh); y += lh + Math.round(H * 0.012);
    }

    // ---- TÍTULO (2 colores, blanco/verde) ----
    const tl = titleLines((brief.titulo || 'PRODUCTO').toUpperCase().split(/\s+/));
    let tpx = Math.round(W * 0.11);
    for (const ln of tl) tpx = Math.min(tpx, fitPx(ctx, ln, 'normal', 'anton', W - pad * 2, tpx, 34));
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    tl.forEach((ln, i) => {
      setFont(ctx, 'normal', tpx, 'anton');
      ctx.fillStyle = (tl.length === 2 && i === 1) ? GREEN : WHITE;
      y += tpx; ctx.fillText(ln, pad, y); y += Math.round(tpx * 0.05);
    });
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    // ---- Cinta de subtítulo (pastilla verde) ----
    const sub = (brief.subtitulo || '').trim();
    if (sub) {
      setFont(ctx, '800', Math.round(W * 0.032), 'inter');
      const tw = ctx.measureText(sub.toUpperCase()).width, ph = Math.round(W * 0.055);
      y += Math.round(H * 0.005);
      roundRect(ctx, pad, y, tw + Math.round(W * 0.06), ph, 10); ctx.fillStyle = GREEN; ctx.fill();
      ctx.fillStyle = BLACK; ctx.textAlign = 'left';
      ctx.fillText(sub.toUpperCase(), pad + Math.round(W * 0.03), y + ph * 0.68);
      y += ph;
    }

    // ================= ZONA INFERIOR =================
    // Checklist (virtudes) con tilde verde, sobre el scrim de abajo.
    const virt = (Array.isArray(brief.virtudes) && brief.virtudes.length ? brief.virtudes.map(v => v.t || v) : (brief.features || [])).filter(Boolean).slice(0, 4);
    const priceTxt = (brief.price || '').trim();
    const badgeTxt = (brief.badge || '').trim();
    const showSello = badgeTxt && !/sin|ninguno/i.test(badgeTxt);

    // Sello circular abajo-derecha.
    let listRight = W - pad;
    if (showSello) {
      const rr = Math.round(W * 0.13);
      const bcx = W - pad - rr, bcy = H - pad - rr;
      ctx.beginPath(); ctx.arc(bcx, bcy, rr, 0, Math.PI * 2);
      ctx.fillStyle = GREEN; ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 20; ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.arc(bcx, bcy, rr, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
      ctx.fillStyle = BLACK; ctx.textAlign = 'center';
      setFont(ctx, '800', Math.round(rr * 0.34), 'inter'); ctx.fillText(badgeTxt.toUpperCase(), bcx, bcy - rr * 0.2);
      if (priceTxt) { const pt = '$' + priceTxt.replace(/^\$/, ''); let ppx = fitPx(ctx, pt, 'normal', 'anton', rr * 1.5, Math.round(rr * 0.62), 20); setFont(ctx, 'normal', ppx, 'anton'); ctx.fillText(pt, bcx, bcy + rr * 0.42); }
      listRight = bcx - rr - Math.round(W * 0.03);
    }

    // Dibujar checklist de abajo hacia arriba.
    let ly = H - pad - Math.round(H * 0.02);
    const rowH = Math.round(H * 0.055), icoR = Math.round(W * 0.03);
    for (let i = virt.length - 1; i >= 0; i--) {
      const t = String(virt[i]);
      ctx.beginPath(); ctx.arc(pad + icoR, ly - rowH * 0.3, icoR, 0, Math.PI * 2); ctx.fillStyle = GREEN; ctx.fill();
      drawIcon(ctx, 'check', pad + icoR, ly - rowH * 0.3, icoR * 0.6, BLACK);
      ctx.fillStyle = WHITE; ctx.textAlign = 'left';
      let fpx = fitPx(ctx, t, '700', 'inter', listRight - (pad + icoR * 2 + 18), Math.round(W * 0.036), 18);
      setFont(ctx, '700', fpx, 'inter');
      ctx.fillText(t, pad + icoR * 2 + 18, ly - rowH * 0.15);
      ly -= rowH;
    }

    return cv.toDataURL('image/png');
  };

  function loadImgSafe(src) {
    return new Promise((resolve) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = src; });
  }
})();
