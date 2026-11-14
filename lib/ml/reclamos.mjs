// Reclamos abiertos y mensajes de compradores de Mercado Libre — SOLO LECTURA.
//
// Pedido de Rodo (11-nov-2026): leer los reclamos abiertos de las DOS cuentas y
// los mensajes de clientes que preguntan por horarios de retiro o por cambios de
// factura, y mandarle un resumen de lo que se puede resolver solo y de lo que
// necesita su ayuda.
//
// ⚠️ REGLAS
//   - Acá NO se responde ni se cierra nada: solo se lee y se clasifica. Si algún
//     día se contesta solo, es un cambio aparte y con permiso explícito.
//   - Los mensajes se leen con mark_as_read=false (getPackMessages): leerlos no
//     le marca la conversación como atendida al equipo.
//   - Las respuestas sugeridas NO llevan la dirección exacta del local, ni links,
//     ni datos de contacto (ML los bloquea y es la regla de Rodo): solo "Floresta,
//     cerca de la estación" y los horarios.
//   - Las rutas de reclamos de ML se armaron de la documentación y NO se pudieron
//     probar desde acá (sin credenciales). Por eso existe sondear(): una corrida
//     real dice qué responde ML antes de confiar en el resumen.
import { httpRequest } from '../../api/_http.js';
import { getPackMessages, getOrder } from './ml-api.js';

const ML = 'https://api.mercadolibre.com';

// ─── Lectura ────────────────────────────────────────────────────────────────

async function pedir(token, path) {
  try {
    const r = await httpRequest('GET', ML + path, { Authorization: 'Bearer ' + token, 'x-format-new': 'true' });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e.message };
  }
}

// Reclamos abiertos donde somos el vendedor. ML devuelve la lista en `data`.
export async function buscarReclamos(token, sellerId, maximo = 100) {
  const out = [];
  let offset = 0;
  const limit = 50;
  let ultimo = null;
  while (out.length < maximo) {
    const r = await pedir(token,
      `/post-purchase/v1/claims/search?status=opened&players.role=respondent&players.user_id=${sellerId}&limit=${limit}&offset=${offset}`);
    ultimo = r;
    if (!r.ok) return { ok: false, status: r.status, error: r.body?.message || r.error || ('HTTP ' + r.status), reclamos: out };
    const lista = r.body?.data || r.body?.results || [];
    // Mientras se pagina entran reclamos nuevos y se corren las páginas: el mismo
    // reclamo salió dos veces en la primera corrida real. Se deduplica por id.
    const vistos = new Set(out.map(x => String(x?.id || x?.claim_id)));
    for (const c of lista) { const k = String(c?.id || c?.claim_id); if (!vistos.has(k)) { vistos.add(k); out.push(c); } }
    const total = r.body?.paging?.total ?? lista.length;
    offset += limit;
    if (!lista.length || out.length >= total) break;
  }
  return { ok: true, status: ultimo?.status || 200, reclamos: out.slice(0, maximo) };
}

export async function detalleReclamo(token, claimId) {
  return pedir(token, `/post-purchase/v1/claims/${claimId}`);
}

export async function mensajesReclamo(token, claimId) {
  return pedir(token, `/post-purchase/v1/claims/${claimId}/messages`);
}

// Conversaciones post-venta con mensajes SIN LEER del comprador (sin leerlas).
export async function sinLeerPostVenta(token) {
  return pedir(token, '/messages/unread?role=seller&tag=post_sale');
}

// Qué le responde ML a cada ruta, para corregir lo que haga falta antes de
// depender del resumen. Devuelve un pedacito de cada respuesta.
export async function sondear(token, sellerId) {
  const muestra = (r) => ({ status: r.status, ok: r.ok, error: r.error || null,
    cuerpo: JSON.stringify(r.body ?? null).slice(0, 700) });
  const out = {};
  const busq = await pedir(token,
    `/post-purchase/v1/claims/search?status=opened&players.role=respondent&players.user_id=${sellerId}&limit=3`);
  out.reclamos_abiertos = muestra(busq);
  const primero = (busq.body?.data || busq.body?.results || [])[0];
  const id = primero?.id || primero?.claim_id;
  if (id) {
    out.detalle_primer_reclamo = muestra(await detalleReclamo(token, id));
    out.mensajes_primer_reclamo = muestra(await mensajesReclamo(token, id));
  } else {
    out.detalle_primer_reclamo = 'no hay reclamos abiertos para probar el detalle';
  }
  out.mensajes_sin_leer = muestra(await sinLeerPostVenta(token));
  const cod = primero?.reason_id;
  if (cod) out.nombre_del_motivo = muestra(await pedir(token, `/post-purchase/v1/claims/reasons/${encodeURIComponent(cod)}`));
  return out;
}

// ─── Clasificación (pura, sin red) ──────────────────────────────────────────

// Retiro POR EL LOCAL: tiene que haber intención de ir a buscarlo. "Horario" solo no
// alcanza: en la primera corrida real de FULL (14-nov-2026) las tres consultas que
// decían "horario" eran de entrega a domicilio, no de retiro.
const RE_RETIRO = /\b(retir\w*|pas(ar|o|amos) (a|por) (buscar|retirar)|buscar(lo|la)? (por|en) (el )?(local|negocio|dep[oó]sito)|ir a buscar\w*)\b/i;
// Horario / demora de la ENTREGA (envío de Mercado Libre).
const RE_ENVIO_HORARIO = /\b(hor[aá]rios?|a qu[eé] hora|llegar[ií]a\w*|llegan?|llegar|pas(a|an|ar[aá]n?) por|cu[aá]ndo (llega|viene|pasa|lo traen)|demor\w*|tard\w*)\b/i;
// Cambiar la dirección de entrega: lo resuelve una persona (y a veces ni se puede).
const RE_DOMICILIO = /\b(cambi\w+|modific\w+|corregir|otra)\b[^.?!]{0,25}\b(domicilio|direcci[oó]n)\b/i;
// Factura (pedido o cambio).
const RE_FACTURA = /\b(factura\w*|cuit|cuil|raz[oó]n social|a nombre de|condici[oó]n (frente al )?iva|responsable inscripto|monotributo\w*|nota de cr[eé]dito)\b/i;
// Palabras de problema grave: no lo toca un auto-respondedor.
const RE_GRAVE = /\b(estafa|denuncia|defensa del consumidor|abogado|devoluci[oó]n|reembolso|plata|dinero)\b/i;

export function clasificarTexto(texto) {
  const t = String(texto || '');
  if (!t.trim()) return 'otro';
  if (RE_GRAVE.test(t)) return 'otro';
  // Si pide algo de factura, manda la factura: eso lo resuelve una persona.
  if (RE_FACTURA.test(t)) return 'cambio_factura';
  if (RE_DOMICILIO.test(t)) return 'cambio_domicilio';
  if (RE_RETIRO.test(t)) return 'retiro_horarios';
  if (RE_ENVIO_HORARIO.test(t)) return 'envio_horario';
  return 'otro';
}

const MOTIVOS = [
  [/^PNR/i, 'no le llegó'],
  [/^PDD/i, 'llegó distinto o con defecto'],
  [/^CS/i, 'compra cancelada / sin stock'],
];
export function motivoLegible(reasonId) {
  const id = String(reasonId || '');
  for (const [re, txt] of MOTIVOS) if (re.test(id)) return `${txt} (${id})`;
  return id ? `motivo ${id}` : 'sin motivo informado';
}

// Fecha límite para responder (la más cercana) a partir de las acciones que ML
// le habilita al vendedor.
export function vencimientoReclamo(reclamo) {
  const players = Array.isArray(reclamo?.players) ? reclamo.players : [];
  const fechas = [];
  for (const p of players) {
    if (p?.role && p.role !== 'respondent') continue;
    for (const a of (p?.available_actions || [])) {
      const t = Date.parse(a?.due_date || '');
      if (Number.isFinite(t)) fechas.push(t);
    }
  }
  return fechas.length ? Math.min(...fechas) : null;
}

// Texto que se le podría mandar al comprador. SOLO sugerido: no se manda solo.
export function respuestaSugerida(categoria, cuenta, negocio = {}) {
  const horarios = negocio.horarios || 'de lunes a viernes de 14 a 17:30 y los sábados de 10 a 13';
  const barrio = negocio.barrio || 'Floresta, CABA';
  if (categoria === 'retiro_horarios') {
    if (cuenta?.mode === 'full') {
      return 'Esta compra sale por Mercado Libre Full, así que no tiene retiro por el local: te llega a tu domicilio con el envío de Mercado Libre.';
    }
    return `Sí, podés retirar por el local en ${barrio}, cerca de la estación. Atendemos ${horarios}.`;
  }
  if (categoria === 'envio_horario') {
    // El horario de entrega lo define el correo de ML: no se promete ninguna hora.
    return 'Hola, el horario de entrega lo define Mercado Libre. Actualizá la app de Mercado Libre y mirá el seguimiento en "Mis compras": ahí figura el día y la franja estimada. Si no te sirve esa franja, escribinos por acá y lo vemos.';
  }
  return null;
}

const AYUDA = {
  cambio_factura: 'Necesita tu ayuda: pide factura o un cambio de factura; hay que emitirla o rehacerla con los datos (CUIT, razón social, condición frente al IVA).',
  cambio_domicilio: 'Necesita tu ayuda: quiere cambiar el domicilio de entrega; depende de si el envío ya salió.',
  reclamo: 'Necesita tu ayuda: es un reclamo de ML, hay que responder dentro del plazo.',
  otro: 'Necesita tu ayuda: no es un caso que se pueda resolver con una respuesta fija.',
};

// ¿El vendedor puede hacer algo en este reclamo? ML le habilita acciones en
// players[].available_actions del respondent. Con la lista vacía el reclamo está
// en manos de ML (mediación): resolvió él, devuelve la plata y cubre los costos.
// Verificado con reclamos reales de FULL (11-nov-2026): "stage: dispute",
// mediador interno y available_actions vacías en las dos partes.
export function vendedorPuedeActuar(reclamo) {
  const players = Array.isArray(reclamo?.players) ? reclamo.players : [];
  return players.some(p => p?.role === 'respondent' && Array.isArray(p.available_actions) && p.available_actions.length > 0);
}

// Une todo en una lista de casos { cuenta, tipo, ... , solo, ml, accion }.
// `entradas` = [{ cuenta, tipo:'reclamo'|'mensaje', id, texto, motivo, vence, accion_vendedor, orden }]
//   solo -> se resuelve con una respuesta fija (horarios de retiro).
//   ml   -> reclamo en mediación de ML, sin acción del vendedor: solo informar.
export function armarCasos(entradas, cuentasPorLabel = {}, negocio = {}) {
  return (entradas || []).map(e => {
    const categoria = e.tipo === 'reclamo'
      ? (e.accion_vendedor ? 'reclamo' : 'reclamo_ml')
      : clasificarTexto(e.texto);
    const cuenta = cuentasPorLabel[e.cuenta] || { label: e.cuenta };
    const sugerida = respuestaSugerida(categoria, cuenta, negocio);
    return {
      ...e,
      categoria,
      solo: categoria === 'retiro_horarios' || categoria === 'envio_horario',
      ml: categoria === 'reclamo_ml',
      respuesta: sugerida,
      accion: categoria === 'reclamo_ml'
        ? 'ML lo está resolviendo (mediación): no tenés que hacer nada, salvo mirarlo si algo no cierra.'
        : (sugerida ? 'Respuesta lista (no se manda sola).' : (AYUDA[categoria] || AYUDA.otro)),
    };
  });
}

const fechaCorta = (ms) => new Date(ms).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const recorte = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Resumen para WhatsApp. Grupos: reclamos que necesitan a Rodo (lo que vence
// primero, arriba), pedidos de factura, lo que ML ya está resolviendo (solo se
// cuenta) y lo que se resuelve solo.
export function resumenEnTexto(casos, { max = 8, ahora = Date.now() } = {}) {
  if (!casos.length) return '✅ *Reclamos y mensajes*\nNo hay reclamos abiertos ni mensajes pendientes.';
  const solos = casos.filter(c => c.solo);
  const enML = casos.filter(c => c.ml);
  const reclamos = casos.filter(c => c.tipo === 'reclamo' && !c.ml)
    .sort((a, b) => (a.vence ?? Infinity) - (b.vence ?? Infinity));
  const facturas = casos.filter(c => c.categoria === 'cambio_factura');
  const otros = casos.filter(c => c.tipo === 'mensaje' && !c.solo && c.categoria !== 'cambio_factura');
  const L = [`📋 *Reclamos y mensajes*`, ''];
  const urgente = (c) => c.vence && c.vence < ahora + 48 * 3600_000;

  if (reclamos.length) {
    const urgentes = reclamos.filter(urgente).length;
    L.push(`🔴 *Reclamos que necesitan tu respuesta (${reclamos.length})*${urgentes ? ` — ${urgentes} vencen en 48 h` : ''}`);
    for (const c of reclamos.slice(0, max)) {
      const vence = c.vence ? (c.vence < ahora ? '⏰ VENCIDO' : `⏰ vence ${fechaCorta(c.vence)}`) : 'sin fecha límite';
      L.push(`• ${String(c.cuenta || '').toUpperCase()} · ${vence}`);
      L.push(`  ${c.motivo}${c.producto ? ' — ' + recorte(c.producto, 45) : ''}${c.orden ? ' · orden ' + c.orden : ''}`);
    }
    if (reclamos.length > max) L.push(`  …y ${reclamos.length - max} más`);
    L.push('');
  } else {
    L.push('✅ Ningún reclamo necesita tu respuesta ahora.', '');
  }
  if (facturas.length) {
    L.push(`🧾 *Piden factura o cambio de factura (${facturas.length})*`);
    for (const c of facturas.slice(0, 5)) L.push(`• ${String(c.cuenta || '').toUpperCase()}: "${recorte(c.texto, 70)}"`);
    if (facturas.length > 5) L.push(`  …y ${facturas.length - 5} más`);
    L.push('');
  }
  if (otros.length) {
    L.push(`💬 *Otros mensajes que necesitan a una persona (${otros.length})*`);
    for (const c of otros.slice(0, 5)) L.push(`• ${String(c.cuenta || '').toUpperCase()}: "${recorte(c.texto, 80)}"`);
    L.push('');
  }
  if (enML.length) {
    const porCuenta = {};
    for (const c of enML) porCuenta[c.cuenta] = (porCuenta[c.cuenta] || 0) + 1;
    L.push(`🟡 *En mediación de ML, sin acción tuya (${enML.length})*`);
    L.push('  ' + Object.entries(porCuenta).map(([k, n]) => `${String(k).toUpperCase()}: ${n}`).join(' · '));
    L.push('  ML ya lo está resolviendo y cubre los costos de las devoluciones.');
    L.push('');
  }
  if (solos.length) {
    L.push(`🟢 *Se pueden resolver con una respuesta fija (${solos.length})*`);
    for (const c of solos.slice(0, max)) L.push(`• ${String(c.cuenta || '').toUpperCase()}: "${recorte(c.texto, 70)}"`);
    if (solos.length > max) L.push(`  …y ${solos.length - max} más`);
    L.push('  (Tengo la respuesta lista, pero no se manda sola.)');
  }
  const productos = productosConMasReclamos(casos);
  if (productos.length) {
    L.push('', '📊 *Productos con más reclamos*');
    for (const [titulo, n] of productos) L.push(`• ${n} × ${recorte(titulo, 55)}`);
  }
  return L.join('\n').trim();
}

// Qué productos aparecen más en los reclamos (para encontrar el problema de fondo:
// ficha, medida, calidad). Solo cuenta los que tienen título conocido.
export function productosConMasReclamos(casos, top = 5, minimo = 2) {
  const cuenta = new Map();
  for (const c of casos) if (c.tipo === 'reclamo' && c.producto) cuenta.set(c.producto, (cuenta.get(c.producto) || 0) + 1);
  return [...cuenta.entries()].filter(([, n]) => n >= minimo).sort((a, b) => b[1] - a[1]).slice(0, top);
}

// ─── Armado completo para una cuenta ────────────────────────────────────────

const textoDe = (m) => {
  const t = m?.text;
  return typeof t === 'string' ? t : (t?.plain || m?.message || '');
};

// Último mensaje del COMPRADOR en una conversación (sin marcarla como leída).
export async function ultimoMensajeComprador(token, packId, sellerId) {
  let data;
  try { data = await getPackMessages(token, packId, sellerId); } catch { return null; }
  const msgs = Array.isArray(data?.messages) ? data.messages : [];
  const buyer = msgs.filter(m => String(m?.from?.user_id) !== String(sellerId));
  return buyer.length ? textoDe(buyer[buyer.length - 1]) : null;
}

// Nombres de las acciones que ML le habilita al vendedor en un reclamo.
export function accionesDelVendedor(reclamo) {
  const players = Array.isArray(reclamo?.players) ? reclamo.players : [];
  const out = [];
  for (const p of players) if (p?.role === 'respondent') for (const a of (p.available_actions || [])) if (a?.action) out.push(String(a.action));
  return [...new Set(out)];
}

// Nombre legible del motivo (PDD9939, PNR9567…) pidiéndoselo a ML UNA vez por
// código distinto. Ruta tomada de la documentación y SIN verificar: si falla se
// queda con el código solo.
async function nombresDeMotivos(token, codigos) {
  const out = {};
  await Promise.all([...new Set(codigos.filter(Boolean))].slice(0, 20).map(async (id) => {
    const r = await pedir(token, `/post-purchase/v1/claims/reasons/${encodeURIComponent(id)}`);
    const nombre = r.ok ? (r.body?.name || r.body?.detail || r.body?.reason_detail || null) : null;
    if (nombre) out[id] = String(nombre).replace(/\s+/g, ' ').trim().slice(0, 80);
  }));
  return out;
}

// Título del producto de una orden (solo órdenes con id largo de ML).
async function tituloDeOrden(token, ordenId) {
  try {
    const o = await getOrder(token, ordenId);
    return o?.order_items?.[0]?.item?.title || null;
  } catch { return null; }
}

// Reúne las entradas de UNA cuenta: reclamos abiertos + mensajes sin leer.
// Nunca tira: si algo falla lo anota en `avisos` y sigue con el resto.
// La búsqueda de reclamos YA trae lo principal (motivo, etapa, partes y acciones
// del vendedor): no se pide el detalle de cada uno. Sí se pide, de a 10, el título
// del producto de cada orden para ver qué productos concentran los reclamos.
export async function recolectarCuenta(token, acc, { maxReclamos = 100, maxMensajes = 150 } = {}) {
  const entradas = [];
  const avisos = [];

  const rec = await buscarReclamos(token, acc.user_id, maxReclamos);
  if (!rec.ok) avisos.push(`reclamos de ${acc.label}: ${rec.error}`);
  const nombres = await nombresDeMotivos(token, rec.reclamos.map(r => r?.reason_id));
  for (const r of rec.reclamos) {
    const cod = r?.reason_id;
    entradas.push({
      cuenta: acc.label, tipo: 'reclamo', id: String(r?.id || r?.claim_id || ''),
      motivo: nombres[cod] ? `${nombres[cod]} (${cod})` : motivoLegible(cod),
      etapa: r?.stage || null, vence: vencimientoReclamo(r),
      accion_vendedor: vendedorPuedeActuar(r), acciones: accionesDelVendedor(r),
      orden: r?.resource_id ? String(r.resource_id) : null, texto: '',
    });
  }
  const conOrden = entradas.filter(e => e.tipo === 'reclamo' && /^\d{15,}$/.test(e.orden || ''));
  for (let i = 0; i < conOrden.length; i += 10) {
    const titulos = await Promise.all(conOrden.slice(i, i + 10).map(e => tituloDeOrden(token, e.orden)));
    titulos.forEach((t, k) => { if (t) conOrden[i + k].producto = t; });
  }

  const sl = await sinLeerPostVenta(token);
  if (!sl.ok) {
    avisos.push(`mensajes sin leer de ${acc.label}: HTTP ${sl.status}`);
  } else {
    // Forma verificada (FULL, 11-nov-2026): { user_id, total, results: [{ resource: "/packs/<pack>/sellers/<id>", count }] }
    const lista = sl.body?.results || sl.body?.data || (Array.isArray(sl.body) ? sl.body : []);
    const packs = [...new Set(lista.map(x => (JSON.stringify(x).match(/packs\/(\d{6,})/) || [])[1]).filter(Boolean))]
      .slice(0, maxMensajes);
    for (let i = 0; i < packs.length; i += 10) {
      const textos = await Promise.all(packs.slice(i, i + 10).map(p => ultimoMensajeComprador(token, p, acc.user_id)));
      textos.forEach((t, k) => { if (t) entradas.push({ cuenta: acc.label, tipo: 'mensaje', id: packs[i + k], pack: packs[i + k], texto: t }); });
    }
    if (lista.length > packs.length) avisos.push(`${acc.label}: ${lista.length} conversaciones sin leer, se miraron las primeras ${packs.length}`);
  }
  // Los mensajes que no son ni retiro, ni envío, ni factura, ni domicilio no se muestran: serían todo el ruido de la bandeja.
  return { entradas: entradas.filter(e => e.tipo === 'reclamo' || clasificarTexto(e.texto) !== 'otro'), avisos };
}
