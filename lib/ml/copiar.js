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
const ATRIBUTOS_QUE_NO_SE_COPIAN = new Set([
  'SELLER_SKU',
  // Medidas del paquete que midió el depósito de FULL y datos internos de ML:
  // no son del vendedor. Las que cargó el vendedor (SELLER_PACKAGE_*) sí van.
  'PACKAGE_HEIGHT', 'PACKAGE_LENGTH', 'PACKAGE_WEIGHT', 'PACKAGE_WIDTH',
  'PACKAGE_DATA_SOURCE', 'SYI_PYMES_ID',
]);

// ML corta el título en 60. Cortar a ciegas deja "...Negr": mejor perder la
// última palabra entera.
export function tituloCorto(t, max = 60) {
  const s = String(t || '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const corte = s.slice(0, max + 1).lastIndexOf(' ');
  return (corte > 0 ? s.slice(0, corte) : s.slice(0, max)).replace(/[\s/,.-]+$/, '');
}

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
    title: tituloCorto(item.title),
    // Modelo nuevo de ML ("user products"): exige el nombre de la familia del
    // producto. Si el origen ya lo tiene se respeta; si no, va el título.
    family_name: tituloCorto(item.family_name || item.title),
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
  const sku = skuDe(item);
  if (sku) cuerpo.seller_custom_field = sku;
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
      ML + `/items?ids=${ids.slice(0, 20).join(',')}&attributes=id,seller_custom_field,attributes,title,permalink,status`,
      { 'Authorization': 'Bearer ' + token });
    for (const e of (Array.isArray(detalle.body) ? detalle.body : [])) {
      const it = e?.body;
      const suSku = skuDe(it);
      if (suSku && String(suSku) === String(sku)) {
        return { item_id: it.id, titulo: it.title, estado: it.status, link: it.permalink };
      }
    }
  } catch { /* si la búsqueda falla seguimos: el ensayo igual sirve */ }
  return null;
}

// Lo que pega Rodo puede ser un ID (MLA123), el link del artículo
// (articulo.mercadolibre.com.ar/MLA-123-...) o el link de producto
// (mercadolibre.com.ar/.../up/MLAU123). El /up/ es un "user product": se busca
// en las cuentas qué publicación propia cuelga de él.
export async function resolverIdPublicacion(entrada) {
  const txt = String(entrada || '').trim();
  const up = txt.match(/MLAU\d+/i);
  if (up) {
    const upId = up[0].toUpperCase();
    for (const acc of loadAccounts()) {
      try {
        const token = await getAccessToken(acc);
        const r = await httpRequest('GET',
          ML + `/users/${acc.user_id}/items/search?user_product_id=${upId}`,
          { 'Authorization': 'Bearer ' + token });
        const id = r.body?.results?.[0];
        if (id) return id;
      } catch { /* probamos con la otra cuenta */ }
    }
    throw new Error(`No encontré ninguna publicación propia del producto ${upId}. Pasá el ID MLA… directo.`);
  }
  const m = txt.match(/MLA-?(\d+)/i);
  if (m) return 'MLA' + m[1];
  throw new Error('No reconozco el ID en: ' + txt.slice(0, 120));
}

// El SKU puede estar en seller_custom_field o en el atributo SELLER_SKU.
function skuDe(item) {
  if (item?.seller_custom_field) return item.seller_custom_field;
  const a = (item?.attributes || []).find(x => x?.id === 'SELLER_SKU');
  return a?.value_name || null;
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

  const variaciones = Array.isArray(item.variations) ? item.variations : [];
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
  const sku = skuDe(item);
  const duplicada = await yaExiste(tokenDestino, destino.user_id, sku);
  if (duplicada && !forzar) {
    return {
      ok: false,
      corta: 'duplicada',
      origen: origen?.label || ('user ' + item.seller_id),
      destino: destino.label,
      titulo: item.title,
      ya_publicada: duplicada,
      error: `En ${destino.label} ya hay una publicación con el SKU ${sku}. Duplicar en ML es peor que no publicar: las dos se compiten entre ellas. Si igual la querés, agregá &forzar=1.`,
    };
  }

  let descripcion = '';
  try {
    const d = await getItemDescription(lector, id);
    descripcion = d?.plain_text || '';
  } catch { aviso.push('No se pudo leer la descripción del origen: la copia va sin descripción.'); }

  const cuerpo = armarCopia(item, descripcion, opts);
  const base = {
    origen: origen?.label || ('user ' + item.seller_id),
    destino: destino.label,
  };
  const headers = { 'Authorization': 'Bearer ' + tokenDestino, 'Content-Type': 'application/json' };

  // Plan A con variaciones: UNA publicación con todas, stock propio en cada una.
  // Plan B (si ML no la acepta, p.ej. cuentas del modelo nuevo "user products"
  // o atributos de variación cargados a mano): UNA publicación POR variación,
  // con sus fotos y el valor de la variación en el título.
  const planes = variaciones.length ? armarVariaciones(item, cuerpo, opts) : null;

  if (!confirmar) {
    const corta = c => ({ ...c, description: c.description ? (c.description.plain_text.slice(0, 300) + '…') : null });
    if (planes) {
      return {
        ok: true, ensayo: true, ...base, avisos: aviso,
        nota: `Tiene ${variaciones.length} variaciones. Se intenta una publicación con todas; si ML no la acepta, se crea una por variación. Si está bien, repetí la dirección con &confirmar=1.`,
        va_a_crear: corta(planes.unica),
        si_ml_rechaza_las_variaciones: planes.separadas.map(c => ({ title: c.title, price: c.price, stock: c.available_quantity, fotos: c.pictures.length })),
      };
    }
    return {
      ok: true, ensayo: true, ...base, avisos: aviso,
      nota: 'Esto es lo que se va a crear. Revisalo y, si está bien, repetí la misma dirección agregando &confirmar=1.',
      va_a_crear: corta(cuerpo),
    };
  }

  const resumen = b => ({
    item_id: b?.id, titulo: b?.title, precio: b?.price, stock: b?.available_quantity,
    variaciones: Array.isArray(b?.variations) ? b.variations.length : 0,
    estado: b?.status, link: b?.permalink,
  });
  const falla = r => ({ error: r.body?.message || ('HTTP ' + r.status), detalle: r.body?.cause || null });

  if (planes) {
    const r = await postear(headers, planes.unica, aviso);
    if (r.status < 400) return { ok: true, creada: true, ...base, avisos: aviso, ...resumen(r.body) };
    aviso.push('ML no aceptó la publicación con variaciones (' + (r.body?.message || r.status) + '): se crea una publicación por variación.');
    const creadas = [], fallidas = [];
    for (const c of planes.separadas) {
      const rr = await postear(headers, c, aviso);
      if (rr.status < 400) creadas.push(resumen(rr.body));
      else fallidas.push({ titulo: c.title, ...falla(rr) });
    }
    return {
      ok: creadas.length > 0 && !fallidas.length, creada: creadas.length > 0, ...base, avisos: aviso,
      intento_con_variaciones: falla(r), creadas, fallidas,
    };
  }

  const r = await postear(headers, cuerpo, aviso);
  if (r.status >= 400) return { ok: false, ...base, avisos: aviso, ...falla(r) };
  return { ok: true, creada: true, ...base, avisos: aviso, ...resumen(r.body) };
}

// POST /items. Con family_name, ML a veces arma el título solo y rechaza el
// que mandamos: en ese caso se reintenta una vez sin título.
async function postear(headers, cuerpo, aviso) {
  let r = await httpRequest('POST', ML + '/items', headers, cuerpo);
  const habla = (x, w) => JSON.stringify(x?.body || {}).toLowerCase().includes(w);
  if (r.status >= 400 && habla(r, 'title') && cuerpo.title) {
    const { title, ...sinTitulo } = cuerpo;
    r = await httpRequest('POST', ML + '/items', headers, sinTitulo);
    if (r.status < 400) aviso.push('ML armó el título a partir del nombre del producto.');
  }
  return r;
}

function combinacion(a) {
  return a.value_id && a.id ? { id: a.id, value_id: a.value_id } : (a.id ? { id: a.id, value_name: a.value_name } : { name: a.name, value_name: a.value_name });
}

export function armarVariaciones(item, cuerpo, opts = {}) {
  const stock = Number(opts.stock ?? 1);
  const urlDe = new Map((item.pictures || []).map(p => [p.id, p.secure_url || p.url]));
  const precioDe = v => (opts.precio != null || opts.ajuste) ? cuerpo.price : (Number(v.price) || cuerpo.price);
  const vars = item.variations.map(v => ({
    v,
    fotos: (v.picture_ids || []).map(id => urlDe.get(id)).filter(Boolean),
    nombre: (v.attribute_combinations || []).map(a => a.value_name).filter(Boolean).join(' '),
  }));

  const { available_quantity, ...sinStock } = cuerpo;
  const unica = {
    ...sinStock,
    variations: vars.map(({ v, fotos }) => ({
      attribute_combinations: (v.attribute_combinations || []).map(combinacion),
      price: precioDe(v),
      available_quantity: stock,
      picture_ids: fotos,
    })),
  };

  const separadas = vars.map(({ v, fotos, nombre }) => ({
    ...cuerpo,
    title: nombre ? `${tituloCorto(item.title, 59 - nombre.length)} ${nombre}`.trim() : cuerpo.title,
    // ML arma el título desde family_name e ignora el nuestro: si la familia
    // es la misma, las N publicaciones quedan con el mismo título y no se sabe
    // cuál medida es cuál. Cada variación lleva su valor en la familia.
    family_name: nombre ? `${tituloCorto(item.title, 59 - nombre.length)} ${nombre}`.trim() : cuerpo.family_name,
    price: precioDe(v),
    available_quantity: stock,
    pictures: fotos.length ? fotos.map(u => ({ source: u })) : cuerpo.pictures,
  }));
  return { unica, separadas };
}

// Ajuste puntual de una publicación propia: título o estado (pausar/cerrar).
// Solo esos campos, para no abrir una puerta a cambiar cualquier cosa.
export async function ajustarPublicacion({ cuentaLabel, id, titulo, estado }) {
  const acc = findAccountByLabel(loadAccounts(), cuentaLabel);
  if (!acc) throw new Error('Cuenta desconocida: ' + cuentaLabel);
  const token = await getAccessToken(acc);
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  const out = {};
  if (titulo) {
    const r = await httpRequest('PUT', ML + '/items/' + id, headers, { title: tituloCorto(titulo) });
    out.titulo = r.status < 400 ? { ok: true, nuevo: r.body?.title } : { ok: false, error: r.body?.message, detalle: r.body?.cause || null };
  }
  if (estado) {
    if (!['paused', 'closed', 'active'].includes(estado)) throw new Error('estado: paused, closed o active');
    const r = await httpRequest('PUT', ML + '/items/' + id, headers, { status: estado });
    out.estado = r.status < 400 ? { ok: true, nuevo: r.body?.status } : { ok: false, error: r.body?.message, detalle: r.body?.cause || null };
  }
  return { id, cuenta: acc.label, ...out };
}
