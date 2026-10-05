// ─── COPIAR UNA PUBLICACIÓN DE UNA CUENTA A LA OTRA ──────────────────────────
//
// El informe de faltantes encontró ~196 productos que están publicados en una
// cuenta y no en la otra: cada uno es una venta que no se puede hacer porque el
// producto no está donde el cliente lo busca. Publicarlos a mano es título,
// categoría, fotos, ficha técnica, descripción y precio, uno por uno; por eso
// llevan meses ahí.
//
// Esto lee la publicación de origen y arma la de destino con todo adentro.
//
// ⚠️ CREA PUBLICACIONES REALES. Por eso:
//   - NO publica salvo que le pases &confirmar=1. Sin eso solo muestra qué haría.
//   - Se planta si la publicación tiene VARIACIONES (talles/colores): copiarlas
//     mal deja una publicación que no se puede vender. Mejor cortar que mentir.
//   - Se planta si en el destino ya hay algo con el mismo SKU, salvo &forzar=1.
//   - NUNCA copia el envío FULL: una publicación de fulfillment en la cuenta
//     local queda imposible de cumplir. El tipo de envío lo decide el destino.
//   - El stock arranca en 1, no se copia: el stock de una cuenta no es el de
//     la otra, y un número inventado vende lo que no hay.
//
//   GET ?action=copiar&id=MLA123&destino=ferre            -> ensayo
//   GET ?action=copiar&id=MLA123&destino=ferre&confirmar=1 -> la crea
//   &stock=5   &precio=12500   &ajuste=10 (sube 10%)   &forzar=1
import { httpRequest } from '../../api/_http.js';
import { loadAccounts, findAccountByUser, findAccountByLabel, otherAccount } from './qa-config.js';
import { getAccessToken, getItem, getItemDescription, searchMyItems } from './ml-api.js';

const ML = 'https://api.mercadolibre.com';

// Atributos que pone Mercado Libre, no el vendedor: mandarlos de vuelta hace
// que ML rechace la publicación entera por "atributo de solo lectura".
const ATRIBUTOS_QUE_NO_SE_COPIAN = new Set(['SELLER_SKU']);

function limpiarAtributos(attrs) {
  return (attrs || [])
    .filter(a => a?.id && !ATRIBUTOS_QUE_NO_SE_COPIAN.has(a.id))
    // Solo lo que el vendedor cargó: lo que ML dedujo viene sin value_name ni
    // value_id y mandarlo vacío es peor que no mandarlo.
    .filter(a => a.value_id || a.value_name || (Array.isArray(a.values) && a.values.length))
    .map(a => (a.value_id ? { id: a.id, value_id: a.value_id } : { id: a.id, value_name: a.value_name }));
}

function fotos(item) {
  return (item?.pictures || [])
    .map(p => p?.secure_url || p?.url)
    .filter(Boolean)
    .map(url => ({ source: url }));
}

// El envío NO se copia. Un item de FULL trae logistic_type: "fulfillment", y
// esa publicación en la cuenta local es imposible de cumplir: la mercadería
// está en el depósito de ML, no en Floresta. Se manda solo el modo y si el
// comprador puede retirar; el resto lo resuelve la cuenta de destino.
function envio(item) {
  const s = item?.shipping || {};
  return {
    mode: s.mode === 'custom' ? 'custom' : 'me2',
    local_pick_up: !!s.local_pick_up,
    free_shipping: !!s.free_shipping,
  };
}

export function armarCopia(item, descripcion, opts = {}) {
  const { stock = 1, precio = null, ajuste = 0, tipo = null } = opts;
  const base = precio != null ? Number(precio) : Number(item.price);
  const final = ajuste ? Math.round(base * (1 + Number(ajuste) / 100)) : base;
  const cuerpo = {
    title: String(item.title || '').slice(0, 60),
    category_id: item.category_id,
    price: final,
    currency_id: item.currency_id || 'ARS',
    available_quantity: Number(stock),
    buying_mode: item.buying_mode || 'buy_it_now',
    condition: item.condition || 'new',
    listing_type_id: tipo || item.listing_type_id || 'gold_special',
    pictures: fotos(item),
    attributes: limpiarAtributos(item.attributes),
    shipping: envio(item),
  };
  // El SKU va en su campo propio, no como atributo.
  if (item.seller_custom_field) cuerpo.seller_custom_field = item.seller_custom_field;
  // Garantía y facturación: si no van, la publicación nace con menos calidad.
  if (Array.isArray(item.sale_terms) && item.sale_terms.length) {
    cuerpo.sale_terms = item.sale_terms
      .filter(t => t?.id && (t.value_id || t.value_name))
      .map(t => (t.value_id ? { id: t.id, value_id: t.value_id } : { id: t.id, value_name: t.value_name }));
  }
  if (descripcion) cuerpo.description = { plain_text: String(descripcion).slice(0, 50000) };
  return cuerpo;
}

// ¿El destino ya tiene algo con este SKU? Evita duplicar, que en ML es peor que
// no publicar: dos publicaciones del mismo producto se compiten entre ellas.
async function yaExiste(token, userId, sku) {
  if (!sku) return null;
  try {
    const r = await searchMyItems(token, userId, { q: sku, limit: 20 });
    const ids = r?.results || [];
    if (!ids.length) return null;
    const detalle = await httpRequest('GET',
      ML + `/items?ids=${ids.slice(0, 20).join(',')}&attributes=id,seller_custom_field,title,permalink,status`,
      { 'Authorization': 'Bearer ' + token });
    for (const e of (Array.isArray(detalle.body) ? detalle.body : [])) {
      const it = e?.body;
      if (it?.seller_custom_field && String(it.seller_custom_field) === String(sku)) {
        return { item_id: it.id, titulo: it.title, estado: it.status, link: it.permalink };
      }
    }
  } catch { /* si la búsqueda falla seguimos: el ensayo igual sirve */ }
  return null;
}

export async function copiarPublicacion({ id, destinoLabel, opts = {}, confirmar = false, forzar = false }) {
  const accounts = loadAccounts();
  if (accounts.length < 2) throw new Error('Hacen falta las 2 cuentas en ML_ACCOUNTS.');

  // Leemos el item con la primera cuenta que tenga token: los datos de una
  // publicación son públicos, el token es solo para que ML no limite.
  const lector = await getAccessToken(accounts[0]);
  const item = await getItem(lector, id);
  if (!item?.id) throw new Error('No se encontró la publicación ' + id);

  const origen = findAccountByUser(accounts, item.seller_id);
  const destino = destinoLabel
    ? findAccountByLabel(accounts, destinoLabel)
    : (origen ? otherAccount(accounts, origen) : null);
  if (!destino) throw new Error('No sé a qué cuenta copiarla: pasá &destino=full o &destino=ferre');
  if (origen && destino.label === origen.label) throw new Error('El origen y el destino son la misma cuenta.');

  const aviso = [];

  // Variaciones: cortar antes de crear algo roto.
  if (Array.isArray(item.variations) && item.variations.length) {
    return {
      ok: false,
      corta: 'variaciones',
      origen: origen?.label || ('user ' + item.seller_id),
      destino: destino.label,
      titulo: item.title,
      error: `La publicación tiene ${item.variations.length} variaciones (talles, colores, medidas). Copiarlas mal deja una publicación que no se puede vender, así que esta hay que hacerla a mano en Mercado Libre.`,
    };
  }
  if (item.catalog_listing || item.catalog_product_id) {
    aviso.push('Es una publicación de CATÁLOGO. Se copia como publicación normal, no queda compitiendo en el catálogo.');
  }
  if (item.shipping?.logistic_type === 'fulfillment' && destino.mode !== 'full') {
    aviso.push('El origen es FULL: la copia NO lleva el envío por depósito de ML. La vas a despachar vos.');
  }
  if (destino.mode === 'full') {
    aviso.push('⚠️ El destino es la cuenta FULL: una publicación de FULL necesita stock YA ENVIADO al depósito de Mercado Libre. Si no lo mandaste, la publicación no va a poder vender.');
  }

  const tokenDestino = await getAccessToken(destino);
  const duplicada = await yaExiste(tokenDestino, destino.user_id, item.seller_custom_field);
  if (duplicada && !forzar) {
    return {
      ok: false,
      corta: 'duplicada',
      origen: origen?.label || ('user ' + item.seller_id),
      destino: destino.label,
      titulo: item.title,
      ya_publicada: duplicada,
      error: `En ${destino.label} ya hay una publicación con el SKU ${item.seller_custom_field}. Duplicar en ML es peor que no publicar: las dos se compiten entre ellas. Si igual la querés, agregá &forzar=1.`,
    };
  }

  let descripcion = '';
  try {
    const d = await getItemDescription(lector, id);
    descripcion = d?.plain_text || '';
  } catch { aviso.push('No se pudo leer la descripción del origen: la copia va sin descripción.'); }

  const cuerpo = armarCopia(item, descripcion, opts);

  if (!confirmar) {
    return {
      ok: true,
      ensayo: true,
      origen: origen?.label || ('user ' + item.seller_id),
      destino: destino.label,
      avisos: aviso,
      nota: 'Esto es lo que se va a crear. Revisalo y, si está bien, repetí la misma dirección agregando &confirmar=1.',
      va_a_crear: { ...cuerpo, description: cuerpo.description ? (cuerpo.description.plain_text.slice(0, 300) + '…') : null },
    };
  }

  const r = await httpRequest('POST', ML + '/items',
    { 'Authorization': 'Bearer ' + tokenDestino, 'Content-Type': 'application/json' }, cuerpo);
  if (r.status >= 400) {
    return {
      ok: false,
      origen: origen?.label || ('user ' + item.seller_id),
      destino: destino.label,
      avisos: aviso,
      error: r.body?.message || ('HTTP ' + r.status),
      // ML dice exactamente qué campo no le gustó; sin esto hay que adivinar.
      detalle: r.body?.cause || null,
    };
  }
  return {
    ok: true,
    creada: true,
    origen: origen?.label || ('user ' + item.seller_id),
    destino: destino.label,
    avisos: aviso,
    item_id: r.body?.id,
    titulo: r.body?.title,
    precio: r.body?.price,
    stock: r.body?.available_quantity,
    estado: r.body?.status,
    link: r.body?.permalink,
  };
}
