// Comparación de catálogos entre las dos cuentas.
//
// Qué productos están publicados en una cuenta y NO en la otra. Sirve para
// emparejar los catálogos: lo que vende bien en FULL y falta en FERRE es
// plata que se está dejando pasar (pedido de Rodo, 15-sep-2026).
//
// El problema difícil es el MATCHEO: el mismo producto suele estar publicado
// con títulos distintos en cada cuenta ("10 Guantes Engomados" vs "Guantes
// Engomados X 10"). Se resuelve en tres niveles, del más seguro al más
// flexible, y cada match queda etiquetado con cómo se encontró para que se
// pueda revisar.

// Palabras que no distinguen un producto de otro.
const VACIAS = new Set([
  'para','con','sin','por','del','las','los','una','uno','unidad','unidades',
  'pack','set','kit','x','de','la','el','en','y','o','a','al','su','mas','más',
  'nuevo','nueva','original','calidad','oferta','promo','envio','envío','gratis',
]);

// Deja el título en su forma comparable: sin acentos, sin cantidades, sin ruido.
export function normalizarTitulo(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // saca acentos
    .replace(/[^a-z0-9\s]/g, ' ')                        // saca puntuación
    .replace(/\b\d+\s*(u|un|unid|unidades|pcs|piezas)\b/g, ' ') // "10 unidades"
    .replace(/\bx\s*\d+\b/g, ' ')                        // "x10"
    .replace(/^\s*\d+\s+/, ' ')                          // cantidad al principio
    .replace(/\s+/g, ' ')
    .trim();
}

// Las palabras que de verdad identifican al producto.
export function palabrasClave(titulo) {
  return new Set(
    normalizarTitulo(titulo).split(' ').filter(p => p.length > 3 && !VACIAS.has(p))
  );
}

// Cuánto se parecen dos conjuntos de palabras (0 a 1).
export function similitud(a, b) {
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const p of a) if (b.has(p)) comunes++;
  return comunes / (a.size + b.size - comunes);   // Jaccard
}

// Índice invertido palabra -> publicaciones, para no comparar todo contra todo.
function indexar(items) {
  const porPalabra = new Map();
  for (const it of items) {
    for (const p of it._claves) {
      if (!porPalabra.has(p)) porPalabra.set(p, []);
      porPalabra.get(p).push(it);
    }
  }
  return porPalabra;
}

// Busca `item` dentro de `destino`. Devuelve { match, como, puntaje } o null.
function buscarPar(item, destino, porSku, porTitulo, porPalabra, umbral) {
  const sku = (item.sku || '').trim().toUpperCase();
  if (sku && porSku.has(sku)) return { match: porSku.get(sku), como: 'SKU', puntaje: 1 };

  const tn = item._norm;
  if (tn && porTitulo.has(tn)) return { match: porTitulo.get(tn), como: 'título igual', puntaje: 1 };

  // Candidatos: los que comparten al menos una palabra clave.
  const vistos = new Set();
  let mejor = null, mejorP = 0;
  for (const p of item._claves) {
    for (const cand of (porPalabra.get(p) || [])) {
      if (vistos.has(cand)) continue;
      vistos.add(cand);
      const s = similitud(item._claves, cand._claves);
      if (s > mejorP) { mejorP = s; mejor = cand; }
    }
  }
  if (mejor && mejorP >= umbral) {
    return { match: mejor, como: `parecido ${Math.round(mejorP * 100)}%`, puntaje: mejorP };
  }
  return null;
}

// Compara dos catálogos. Devuelve qué falta en `destino` y qué ya está.
export function compararCatalogos(origen, destino, opts = {}) {
  const umbral = opts.umbral ?? 0.7;
  const prep = (arr) => (arr || []).map(x => ({
    ...x,
    _norm: normalizarTitulo(x.titulo),
    _claves: palabrasClave(x.titulo),
  }));
  const A = prep(origen), B = prep(destino);

  const porSku = new Map();
  for (const b of B) {
    const s = (b.sku || '').trim().toUpperCase();
    if (s) porSku.set(s, b);
  }
  const porTitulo = new Map();
  for (const b of B) if (b._norm) porTitulo.set(b._norm, b);
  const porPalabra = indexar(B);

  const faltan = [], estan = [];
  for (const a of A) {
    const r = buscarPar(a, B, porSku, porTitulo, porPalabra, umbral);
    if (r) estan.push({ ...a, match_titulo: r.match.titulo, match_id: r.match.id, como: r.como });
    else faltan.push(a);
  }
  return {
    total_origen: A.length,
    total_destino: B.length,
    faltan: faltan.map(({ _norm, _claves, ...x }) => x),
    estan: estan.map(({ _norm, _claves, ...x }) => x),
  };
}

// CSV con los faltantes, listo para abrir en Excel.
export function faltantesCsv(faltan, notas = []) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cab = ['Prioridad', 'Unidades vendidas (60d)', 'Título', 'SKU', 'Publicación',
               'Precio', 'Stock', 'Estado', 'Link'];
  const lineas = [cab.map(esc).join(';')];
  for (const f of faltan) {
    lineas.push([f.prioridad || '', f.vendidas ?? 0, f.titulo, f.sku, f.id,
                 f.precio ?? '', f.stock ?? '', f.estado, f.link].map(esc).join(';'));
  }
  for (const n of notas) lineas.push(esc(n));
  return '﻿' + lineas.join('\r\n');
}
