// Control de conversión de las preguntas de Mercado Libre.
//
// Cruza CADA pregunta con las ventas del período para saber si el que preguntó
// terminó comprando, y agrupa por SKU / publicación para decir qué le falta a
// cada una (fotos, medidas, color, retiro, precio por mayor...).
//
// Todo acá adentro son funciones puras: reciben preguntas + órdenes + items ya
// bajados de la API y devuelven el reporte. Así se puede testear sin red.

// Qué está preguntando el cliente. Una pregunta puede tener varias etiquetas.
// El orden importa solo para el texto del resumen (la 1ª es la "principal").
export const ETIQUETAS = [
  // Ajustadas con 2.025 preguntas reales de las 2 cuentas (jun-jul 2026).
  // Antes el 46% caía en "otro"; estas categorías salieron de leer esas.
  { key: 'foto_publicacion', label: 'Duda sobre la foto / lo publicado',
    re: /\bfotos?\b|\bim[aá]genes?\b|ilustrad|tal cual|(como|igual a lo que) (se ve|aparece|dice|muestra|est[aá])|coincide|segunda foto|primera? foto|\bla publicaci[oó]n dice/i },
  { key: 'link_cantidad', label: 'Pide link o publicación por cantidad',
    re: /\blinks?\b|publicaci[oó]n (por|x|de|con) *\d|arm[aá](r|me|rme)? (un|una|el)|\bhacer (un|una) (link|publicaci)|agregar? *\d|sumar (al|a mi) carrito|\bcarrito\b/i },
  { key: 'repuestos', label: 'Repuestos / accesorios',
    re: /\brepuestos?\b|\baccesorios?\b|recambio|\brefacci/i },
  { key: 'medidas', label: 'Medidas / tamaño',
    re: /\bmedid|\bmide\b|tama[nñ]o|dimension|\blargo\b|\bancho\b|\balto\b|\baltura\b|\bdi[aá]metro|\bespesor|cu[aá]nto pesa|\bpeso\b|\bkilos?\b|capacidad|\blitros?\b|pulgada|\bcm\b|\bmm\b|\bmts?\b|metros?|\brosca\b|encastre|\d ?\/ ?\d|\bamp\b|\bvolts?\b|\bwatts?\b|\bgrano\b|\bcalibre\b/i },
  { key: 'compatibilidad', label: 'Compatibilidad / para qué sirve',
    re: /\bsirven?\b|servir[ií]a|\bsirve\b|\bcompatible|anda en|\bfunciona\b|se puede usar|es apto|\bapto\b|\bpara qu[eé]\b|\bse le puede\b|\bentra en\b/i },
  { key: 'marca_modelo', label: 'Marca / modelo / equivalencia',
    re: /\bmarca\b|\bmodelo\b|es original|gen[eé]ric|equivale|\bmisma?s? (bater[ií]a|medida|rosca)/i },
  { key: 'mayorista', label: 'Cantidad / por mayor',
    re: /\bpor mayor\b|x\s*mayor|al por mayor|mayorista|revend|reventa|docena|\bbulto\b|\bpacks?\b|\bcajas?\b|descuento por cantidad|por cantidad|mejor precio|\bcombo\b/i },
  { key: 'retiro', label: 'Retiro por el local',
    re: /\bretir|\blocal\b|pasar a buscar|sucursal|d[oó]nde est[aá]|direcci[oó]n|ubicaci|\bzona\b|\bbarrio\b|paso a|puedo ir|estaci[oó]n|cerca de|\ba pie\b|floresta|bacacay|\babierto\b|van a cerrar|\bhorario/i },
  { key: 'material', label: 'Material / calidad',
    re: /\bmaterial|de qu[eé] est[aá] hecho|\bpl[aá]stico|\bmetal\b|\bacero|\bmadera|\bhierro|\bcalidad\b|resistente|\bberret|\btrucho/i },
  { key: 'color', label: 'Color',
    re: /\bcolor|\bcolores\b|\bnegro\b|\bblanco\b|\brojo\b|\bazul\b|\bverde\b|\bamarillo\b/i },
  { key: 'stock', label: 'Stock / disponibilidad',
    re: /\bstock\b|disponib|\bquedan?\b|unidades disponibles|hay para entrega/i },
  { key: 'envio', label: 'Envío / demora',
    re: /\benv[ií]|\bllega\b|\bdemora|cu[aá]ndo llega|\bcorreo\b|\bflete\b|\bfull\b|despach|\bdomicilio\b/i },
  { key: 'precio', label: 'Precio / cuotas',
    re: /\bprecio\b|cu[aá]nto (sale|cuesta|vale)|\bcuotas?\b|financia|\bdescuento\b|m[aá]s barato/i },
  { key: 'factura', label: 'Factura / CUIT',
    re: /\bfactura|\bcuit\b|\biva\b|\bremito\b|responsable inscripto/i },
  { key: 'garantia', label: 'Garantía / devolución',
    re: /\bgarant[ií]a|devoluci|\bcambio\b|\bfalla\b|\bservicio t[eé]cnico/i },
  { key: 'posventa', label: 'Ya compró / posventa',
    re: /ya compr|compr[eé]\b|me lleg|no me lleg|hice (la|una|mi) compra|mi pedido|mi compra|\breclamo\b/i },
  { key: 'otro_producto', label: 'Pregunta por otro artículo',
    re: /\botr[oa]s?\b|\baparte\b|\badem[aá]s\b|cat[aá]logo|lista de precio|\bvarios\b|consigu|m[aá]s productos|\bten[eé]s\b|\btienen\b|\btendr[aá]n?\b|\bvend[eé][ns]?\b|\bmanejan\b/i },
];

// Etiquetas que se pisan: si está la primera, la segunda sobra.
const REDUNDANTES = [['mayorista', 'precio']];

// Devuelve las etiquetas que matchean el texto de la pregunta.
export function clasificar(texto) {
  const t = String(texto || '');
  let tags = ETIQUETAS.filter(e => e.re.test(t)).map(e => e.key);
  for (const [gana, pierde] of REDUNDANTES) {
    if (tags.includes(gana)) tags = tags.filter(x => x !== pierde);
  }
  return tags.length ? tags : ['otro'];
}

export function etiquetaLabel(key) {
  return ETIQUETAS.find(e => e.key === key)?.label || 'Otro';
}

// Índice comprador -> compras (para saber si el que preguntó después compró).
function indexarCompras(ordenes) {
  const porComprador = new Map();
  for (const o of ordenes || []) {
    const comprador = o?.buyer?.id;
    if (!comprador) continue;
    for (const oi of (o.order_items || [])) {
      const itemId = oi?.item?.id;
      if (!itemId) continue;
      const lista = porComprador.get(String(comprador)) || [];
      lista.push({
        itemId: String(itemId),
        fecha: o.date_created,
        sku: oi?.item?.seller_sku || oi?.item?.seller_custom_field || '',
        cantidad: Number(oi?.quantity) || 1,
        monto: Number(oi?.unit_price) * (Number(oi?.quantity) || 1) || 0,
      });
      porComprador.set(String(comprador), lista);
    }
  }
  return porComprador;
}

// Ventas totales por publicación (hayan venido de una pregunta o no).
function ventasPorItem(ordenes) {
  const m = new Map();
  for (const o of ordenes || []) {
    for (const oi of (o.order_items || [])) {
      const id = oi?.item?.id;
      if (!id) continue;
      const prev = m.get(String(id)) || { unidades: 0, monto: 0 };
      prev.unidades += Number(oi?.quantity) || 1;
      prev.monto += (Number(oi?.unit_price) || 0) * (Number(oi?.quantity) || 1);
      m.set(String(id), prev);
    }
  }
  return m;
}

// Qué hacer con esta publicación, según lo que preguntan y si convierte.
// Devuelve una lista de recomendaciones concretas, la 1ª es la más importante.
export function recomendaciones({ preguntas, convertidas, fotos, motivos }) {
  const out = [];
  const sinConversion = preguntas > 0 && convertidas === 0;

  if (sinConversion) {
    out.push(fotos != null && fotos < 5
      ? `❌ SIN CONVERSIÓN — VER FOTOS: la publicación tiene solo ${fotos} foto(s). Subí 5 o 6, con una que muestre las MEDIDAS y los detalles.`
      : '❌ SIN CONVERSIÓN — VER FOTOS: revisá las fotos de la publicación (que la 3ª muestre medidas y detalles) para mejorar la conversión.');
  } else if (fotos != null && fotos < 5) {
    out.push(`📸 Tiene solo ${fotos} foto(s): sumar más ayuda a que se decidan sin preguntar.`);
  }

  const n = (k) => motivos?.[k] || 0;
  if (n('medidas')) out.push(`📏 ${n('medidas')} pregunta(s) por MEDIDAS: cargalas en la ficha técnica y en una foto. Es lo que más frena la compra.`);
  if (n('compatibilidad')) out.push(`🔧 ${n('compatibilidad')} pregunta(s) de COMPATIBILIDAD: aclarar en la descripción para qué sirve y en qué modelos anda.`);
  if (n('material')) out.push(`🧱 ${n('material')} pregunta(s) por MATERIAL: aclarar de qué está hecho.`);
  if (n('color')) out.push(`🎨 ${n('color')} pregunta(s) por COLOR: aclarar el color (o que es indiferente al uso) en la descripción.`);
  if (n('mayorista')) out.push(`💰 ${n('mayorista')} pregunta(s) POR CANTIDAD / MAYOR: hay demanda mayorista, conviene armar packs o una publicación por mayor.`);
  if (n('retiro')) out.push(`🏪 ${n('retiro')} pregunta(s) por RETIRO POR EL LOCAL: aclarar en la descripción si se puede retirar y los horarios.`);
  if (n('stock')) out.push(`📦 ${n('stock')} pregunta(s) por STOCK: revisar que el stock publicado esté al día.`);
  if (n('envio')) out.push(`🚚 ${n('envio')} pregunta(s) por ENVÍO: aclarar plazos de entrega en la descripción.`);
  if (n('precio')) out.push(`🏷️ ${n('precio')} pregunta(s) por PRECIO/CUOTAS: revisar si el precio está claro y si conviene ofrecer cuotas.`);
  if (n('factura')) out.push(`🧾 ${n('factura')} pregunta(s) por FACTURA: aclarar que se hace factura A o B.`);
  if (n('garantia')) out.push(`🛡️ ${n('garantia')} pregunta(s) por GARANTÍA: aclarar la garantía y la política de cambios.`);

  if (!out.length) out.push('✅ Sin observaciones: convierte y no hay dudas repetidas.');
  return out;
}

// Reporte completo de una cuenta.
//  preguntas: array de /questions/search (con from.id, item_id, date_created, answer)
//  ordenes:   array de /orders/search
//  items:     Map item_id -> { title, permalink, sku, fotos, price }
export function construirReporte({ cuenta, preguntas, ordenes, items, desde, hasta }) {
  const comprasPorComprador = indexarCompras(ordenes);
  const ventas = ventasPorItem(ordenes);
  const itemsMap = items instanceof Map ? items : new Map(Object.entries(items || {}));

  const detalle = [];
  const porItem = new Map();

  for (const q of preguntas || []) {
    const itemId = String(q.item_id || '');
    const info = itemsMap.get(itemId) || {};
    const tags = clasificar(q.text);
    const fechaPregunta = new Date(q.date_created).getTime();

    // ¿El que preguntó compró DESPUÉS de preguntar?
    const compras = (comprasPorComprador.get(String(q?.from?.id)) || [])
      .filter(c => new Date(c.fecha).getTime() >= fechaPregunta - 60000); // 1 min de tolerancia
    const compraMismoItem = compras.find(c => c.itemId === itemId) || null;
    const compraOtroItem = compras.find(c => c.itemId !== itemId) || null;
    // ¿Ya lo había comprado ANTES de preguntar? Entonces la pregunta es de
    // posventa ("¿cuándo llega?") y no cuenta como conversión perdida.
    const postVenta = !compraMismoItem && (comprasPorComprador.get(String(q?.from?.id)) || [])
      .some(c => c.itemId === itemId && new Date(c.fecha).getTime() < fechaPregunta - 60000);

    const fila = {
      cuenta,
      fecha: q.date_created,
      item_id: itemId,
      sku: info.sku || compraMismoItem?.sku || '',
      titulo: info.title || '',
      pregunta: q.text || '',
      respuesta: q.answer?.text || '',
      respondida: !!q.answer?.text,
      etiquetas: tags,
      motivos: tags.map(etiquetaLabel).join(' + '),
      convirtio: !!compraMismoItem,
      post_venta: postVenta,
      compro_otro: !compraMismoItem && !postVenta && !!compraOtroItem,
      fecha_venta: compraMismoItem?.fecha || compraOtroItem?.fecha || '',
      monto_venta: compraMismoItem?.monto || 0,
    };
    detalle.push(fila);

    const acc = porItem.get(itemId) || {
      item_id: itemId,
      sku: info.sku || '',
      titulo: info.title || '',
      permalink: info.permalink || '',
      precio: info.price ?? null,
      fotos: info.fotos ?? null,
      preguntas: 0,
      post_venta: 0,
      sin_responder: 0,
      convertidas: 0,
      compraron_otro: 0,
      motivos: {},
      monto: 0,
    };
    acc.preguntas++;
    if (fila.post_venta) acc.post_venta++;
    if (!fila.respondida) acc.sin_responder++;
    if (fila.convirtio) { acc.convertidas++; acc.monto += fila.monto_venta; }
    if (fila.compro_otro) acc.compraron_otro++;
    for (const t of tags) acc.motivos[t] = (acc.motivos[t] || 0) + 1;
    if (!acc.sku && fila.sku) acc.sku = fila.sku;
    porItem.set(itemId, acc);
  }

  const por_sku = [...porItem.values()].map(a => {
    const v = ventas.get(a.item_id) || { unidades: 0, monto: 0 };
    const preventa = a.preguntas - a.post_venta;
    return {
      ...a,
      convierte: a.convertidas > 0 ? 'SÍ' : 'NO',
      preguntas_preventa: preventa,
      tasa_conversion: preventa > 0 ? Math.round((a.convertidas / preventa) * 100) : 0,
      ventas_del_periodo: v.unidades,
      monto_del_periodo: Math.round(v.monto),
      // La recomendación mira solo las preguntas de PREVENTA: un "¿cuándo llega?"
      // de alguien que ya compró no es una conversión perdida.
      recomendaciones: recomendaciones({ ...a, preguntas: preventa }),
    };
  }).sort((x, y) => {
    // Primero lo que más duele: muchas preguntas y ninguna venta.
    if ((x.convertidas === 0) !== (y.convertidas === 0)) return x.convertidas === 0 ? -1 : 1;
    return y.preguntas - x.preguntas;
  });

  const totalPreguntas = detalle.length;
  const postVentaTotal = detalle.filter(d => d.post_venta).length;
  const preventa = totalPreguntas - postVentaTotal;
  const convertidas = detalle.filter(d => d.convirtio).length;
  const motivosGlobales = {};
  for (const d of detalle) for (const t of d.etiquetas) motivosGlobales[t] = (motivosGlobales[t] || 0) + 1;

  return {
    cuenta,
    desde,
    hasta,
    resumen: {
      preguntas: totalPreguntas,
      preguntas_preventa: preventa,
      post_venta: postVentaTotal,
      respondidas: detalle.filter(d => d.respondida).length,
      sin_responder: detalle.filter(d => !d.respondida).length,
      convertidas,
      compraron_otro: detalle.filter(d => d.compro_otro).length,
      tasa_conversion: preventa ? Math.round((convertidas / preventa) * 100) : 0,
      publicaciones_con_preguntas: por_sku.length,
      publicaciones_sin_conversion: por_sku.filter(s => s.convertidas === 0).length,
      motivos: Object.fromEntries(
        Object.entries(motivosGlobales).sort((a, b) => b[1] - a[1]).map(([k, v]) => [etiquetaLabel(k), v])
      ),
    },
    por_sku,
    detalle,
  };
}
