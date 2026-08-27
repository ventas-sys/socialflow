// Reporte de medidas por SKU.
//
// Recorre las publicaciones de una cuenta y saca las medidas que cada una
// tiene cargadas en la ficha técnica (atributos de ML). Sirve para dos cosas:
//   1) Tener el Excel con las medidas de cada SKU (lo pidió Rodo el 27-ago).
//   2) Ver de un vistazo qué publicaciones NO tienen medidas cargadas, que son
//      las que generan preguntas de "¿cuánto mide?" sin conversión.
//
// Solo lectura: no toca publicaciones ni el flujo de preguntas.

// Medidas DEL PAQUETE (las que usa el depósito/envíos). ML las guarda como
// atributos aparte (PACKAGE_*) y son las que pidió Rodo para logística: van en
// columnas propias y se detectan ANTES que las de la ficha para que "Largo del
// paquete" no se mezcle con el "Largo" del producto (pasaba en la v1).
const COLUMNAS_PAQUETE = [
  { key: 'paq_largo', titulo: 'Largo paquete', re: /^PACKAGE_LENGTH$/ },
  { key: 'paq_ancho', titulo: 'Ancho paquete', re: /^PACKAGE_WIDTH$/ },
  { key: 'paq_alto',  titulo: 'Alto paquete',  re: /^PACKAGE_HEIGHT$/ },
  { key: 'paq_peso',  titulo: 'Peso paquete',  re: /^PACKAGE_WEIGHT$/ },
];
const NOMBRE_PAQUETE = /del paquete/i;

// Columnas fijas del reporte, con qué atributo de ML alimenta cada una.
const COLUMNAS = [
  { key: 'largo',     titulo: 'Largo',     re: /^(LENGTH|DEPTH)$|largo|profundidad/i },
  { key: 'ancho',     titulo: 'Ancho',     re: /^WIDTH$|ancho/i },
  { key: 'alto',      titulo: 'Alto',      re: /^HEIGHT$|(^|\b)alto|altura/i },
  { key: 'diametro',  titulo: 'Diámetro',  re: /DIAMETER|di[áa]metro/i },
  { key: 'peso',      titulo: 'Peso',      re: /WEIGHT|peso/i },
  { key: 'capacidad', titulo: 'Capacidad', re: /CAPACITY|VOLUME|capacidad|litros/i },
];

// Cualquier otro atributo que huela a medida va a "Otras medidas".
const OTRA_MEDIDA = /THICKNESS|SIZE|GRIT|CALIBER|POWER|VOLTAGE|CURRENT|medida|espesor|grano|pulgada|rosca|calibre|potencia|volt|amper|watt|\bmm\b|\bcm\b/i;

// De la lista de atributos de un item, arma { largo, ancho, ..., otras, tiene }.
export function extraerMedidas(attributes) {
  const out = { otras: [] };
  for (const c of COLUMNAS) out[c.key] = '';
  for (const c of COLUMNAS_PAQUETE) out[c.key] = '';
  for (const a of (attributes || [])) {
    const id = a?.id || '';
    const nombre = a?.name || '';
    const valor = (a?.value_name ?? '').toString().trim();
    if (!valor || valor === '-') continue;
    // Paquete primero: por id exacto (PACKAGE_*) o porque el nombre dice
    // "... del paquete". Si no fuera primero, "Largo del paquete" caería en
    // la columna "Largo" del producto.
    const paq = COLUMNAS_PAQUETE.find(c => c.re.test(id));
    if (paq || NOMBRE_PAQUETE.test(nombre)) {
      const col = paq || COLUMNAS_PAQUETE.find(c =>
        new RegExp(c.titulo.split(' ')[0], 'i').test(nombre));
      if (col && !out[col.key]) out[col.key] = valor;
      else out.otras.push(`${nombre}: ${valor}`);
      continue;
    }
    const col = COLUMNAS.find(c => c.re.test(id) || c.re.test(nombre));
    if (col) {
      if (!out[col.key]) out[col.key] = valor;
      else out.otras.push(`${nombre}: ${valor}`);
      continue;
    }
    if (OTRA_MEDIDA.test(id) || OTRA_MEDIDA.test(nombre)) out.otras.push(`${nombre}: ${valor}`);
  }
  out.tienePaquete = COLUMNAS_PAQUETE.some(c => out[c.key]);
  out.tiene = COLUMNAS.some(c => out[c.key]) || out.otras.length > 0;
  return out;
}

// Una fila del reporte a partir del item ya bajado de ML.
export function filaMedidas(item) {
  const m = extraerMedidas(item.attributes);
  return {
    sku: item.seller_custom_field || item.seller_sku || '',
    item_id: item.id || '',
    titulo: item.title || '',
    estado: item.status === 'active' ? 'activa' : (item.status === 'paused' ? 'pausada' : (item.status || '')),
    largo: m.largo, ancho: m.ancho, alto: m.alto,
    diametro: m.diametro, peso: m.peso, capacidad: m.capacidad,
    paq_largo: m.paq_largo, paq_ancho: m.paq_ancho, paq_alto: m.paq_alto, paq_peso: m.paq_peso,
    otras: m.otras.join(' · '),
    tiene_medidas: m.tiene ? 'SÍ' : 'NO',
    tiene_paquete: m.tienePaquete ? 'SÍ' : 'NO',
    link: item.permalink || '',
  };
}

// Las que NO tienen medidas van primero (son el trabajo pendiente); después por SKU.
export function ordenarFilas(filas) {
  return [...filas].sort((a, b) =>
    (a.tiene_medidas === b.tiene_medidas ? 0 : a.tiene_medidas === 'NO' ? -1 : 1)
    || a.sku.localeCompare(b.sku)
    || a.titulo.localeCompare(b.titulo));
}

// CSV con BOM y ';' para que el Excel en español lo abra bien de un doble clic.
export function medidasCsv(filas, notas = []) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cab = ['SKU', 'Publicación', 'Título', 'Estado',
    ...COLUMNAS.map(c => c.titulo),
    ...COLUMNAS_PAQUETE.map(c => c.titulo),
    'Otras medidas', '¿Tiene medidas?', '¿Tiene paquete?', 'Link'];
  const lineas = [cab.map(esc).join(';')];
  for (const f of filas) {
    lineas.push([f.sku, f.item_id, f.titulo, f.estado,
      f.largo, f.ancho, f.alto, f.diametro, f.peso, f.capacidad,
      f.paq_largo, f.paq_ancho, f.paq_alto, f.paq_peso,
      f.otras, f.tiene_medidas, f.tiene_paquete, f.link].map(esc).join(';'));
  }
  for (const n of notas) lineas.push(esc(n));
  return '\ufeff' + lineas.join('\r\n');
}
