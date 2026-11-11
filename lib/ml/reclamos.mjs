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
import { getPackMessages } from './ml-api.js';

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
    out.push(...lista);
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
  return out;
}

// ─── Clasificación (pura, sin red) ──────────────────────────────────────────

// Horarios / retiro por el local.
const RE_RETIRO = /\b(retir\w*|pasar (a|por) (buscar|retirar)|buscar(lo|la)? (por|en) (el )?local|horarios?|a qu[eé] hora|hasta qu[eé] hora|atienden|abren|cierran|s[aá]bados?)\b/i;
// Cambio o pedido de factura.
const RE_FACTURA = /\b(factura\w*|cuit|cuil|raz[oó]n social|a nombre de|condici[oó]n (frente al )?iva|responsable inscripto|monotributo\w*|nota de cr[eé]dito|cambi\w+ (de |la )?factura)\b/i;
// Reclamo con palabras de problema grave: no lo toca un auto-respondedor.
const RE_GRAVE = /\b(estafa|denuncia|defensa del consumidor|abogado|devoluci[oó]n|reembolso|plata|dinero)\b/i;

export function clasificarTexto(texto) {
  const t = String(texto || '');
  if (!t.trim()) return 'otro';
  if (RE_GRAVE.test(t)) return 'otro';
  // Si pide algo de factura, manda la factura: eso lo resuelve una persona.
  if (RE_FACTURA.test(t)) return 'cambio_factura';
  if (RE_RETIRO.test(t)) return 'retiro_horarios';
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
  if (categoria !== 'retiro_horarios') return null;
  if (cuenta?.mode === 'full') {
    return 'Esta compra sale por Mercado Libre Full, así que no tiene retiro por el local: te llega a tu domicilio con el envío de Mercado Libre.';
  }
  return `Sí, podés retirar por el local en ${barrio}, cerca de la estación. Atendemos ${horarios}.`;
}

const AYUDA = {
  cambio_factura: 'Necesita tu ayuda: hay que ver si la factura ya se emitió y rehacerla con los datos nuevos (CUIT, razón social, condición frente al IVA).',
  reclamo: 'Necesita tu ayuda: es un reclamo de ML, hay que responder dentro del plazo.',
  otro: 'Necesita tu ayuda: no es un caso que se pueda resolver con una respuesta fija.',
};

// Une todo en una lista de casos { cuenta, tipo, ... , solo, accion }.
// `entradas` = [{ cuenta, tipo:'reclamo'|'mensaje', id, texto, motivo, vence, producto, pack }]
export function armarCasos(entradas, cuentasPorLabel = {}, negocio = {}) {
  return (entradas || []).map(e => {
    const categoria = e.tipo === 'reclamo' ? 'reclamo' : clasificarTexto(e.texto);
    const cuenta = cuentasPorLabel[e.cuenta] || { label: e.cuenta };
    const sugerida = respuestaSugerida(categoria, cuenta, negocio);
    return {
      ...e,
      categoria,
      solo: categoria === 'retiro_horarios',
      respuesta: sugerida,
      accion: sugerida ? 'Respuesta lista (no se manda sola).' : (AYUDA[categoria] || AYUDA.otro),
    };
  });
}

const fechaCorta = (ms) => new Date(ms).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const recorte = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Resumen para WhatsApp. Lo que vence primero, arriba.
export function resumenEnTexto(casos, { max = 8, ahora = Date.now() } = {}) {
  if (!casos.length) return '✅ *Reclamos y mensajes*\nNo hay reclamos abiertos ni mensajes pendientes de retiro o factura.';
  const solos = casos.filter(c => c.solo);
  const ayuda = casos.filter(c => !c.solo)
    .sort((a, b) => (a.vence ?? Infinity) - (b.vence ?? Infinity));
  const L = [`📋 *Reclamos y mensajes (${casos.length})*`, ''];

  if (ayuda.length) {
    L.push(`🔴 *Necesitan tu ayuda (${ayuda.length})*`);
    for (const c of ayuda.slice(0, max)) {
      const tag = c.tipo === 'reclamo' ? '📦 Reclamo' : (c.categoria === 'cambio_factura' ? '🧾 Cambio de factura' : '💬 Mensaje');
      const vence = c.vence ? (c.vence < ahora ? ' ⏰ VENCIDO' : ` ⏰ vence ${fechaCorta(c.vence)}`) : '';
      L.push(`• ${tag} · ${String(c.cuenta || '').toUpperCase()}${vence}`);
      const detalle = c.tipo === 'reclamo' ? c.motivo : recorte(c.texto, 90);
      if (detalle) L.push(`  ${detalle}${c.producto ? ' — ' + recorte(c.producto, 40) : ''}`);
    }
    if (ayuda.length > max) L.push(`  …y ${ayuda.length - max} más`);
    L.push('');
  }
  if (solos.length) {
    L.push(`🟢 *Se pueden resolver solos (${solos.length})* — horarios de retiro`);
    for (const c of solos.slice(0, max)) L.push(`• ${String(c.cuenta || '').toUpperCase()}: "${recorte(c.texto, 70)}"`);
    if (solos.length > max) L.push(`  …y ${solos.length - max} más`);
    L.push('  (Tengo la respuesta lista, pero no se manda sola.)');
  }
  return L.join('\n').trim();
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

// Reúne las entradas de UNA cuenta: reclamos abiertos + mensajes sin leer.
// Nunca tira: si algo falla lo anota en `avisos` y sigue con el resto.
export async function recolectarCuenta(token, acc, { maxReclamos = 40, maxMensajes = 40 } = {}) {
  const entradas = [];
  const avisos = [];

  const rec = await buscarReclamos(token, acc.user_id, maxReclamos);
  if (!rec.ok) avisos.push(`reclamos de ${acc.label}: ${rec.error}`);
  for (let i = 0; i < rec.reclamos.length; i += 5) {
    const tanda = rec.reclamos.slice(i, i + 5);
    const detalles = await Promise.all(tanda.map(async (c) => {
      const id = c?.id || c?.claim_id;
      const d = id ? await detalleReclamo(token, id) : null;
      return { base: c, det: d?.ok ? d.body : null };
    }));
    for (const { base, det } of detalles) {
      const r = det || base;
      entradas.push({
        cuenta: acc.label, tipo: 'reclamo', id: String(r?.id || base?.id || ''),
        motivo: motivoLegible(r?.reason_id), vence: vencimientoReclamo(r),
        pack: r?.resource_id ? String(r.resource_id) : null, texto: '',
      });
    }
  }

  const sl = await sinLeerPostVenta(token);
  if (!sl.ok) {
    avisos.push(`mensajes sin leer de ${acc.label}: HTTP ${sl.status}`);
  } else {
    // ML no documenta del todo la forma de esta lista: se saca el pack de donde esté.
    const lista = sl.body?.results || sl.body?.data || (Array.isArray(sl.body) ? sl.body : []);
    const packs = [...new Set(lista.map(x => (JSON.stringify(x).match(/packs\/(\d{6,})/) || [])[1]).filter(Boolean))]
      .slice(0, maxMensajes);
    for (let i = 0; i < packs.length; i += 5) {
      const textos = await Promise.all(packs.slice(i, i + 5).map(p => ultimoMensajeComprador(token, p, acc.user_id)));
      textos.forEach((t, k) => { if (t) entradas.push({ cuenta: acc.label, tipo: 'mensaje', id: packs[i + k], pack: packs[i + k], texto: t }); });
    }
  }
  // Los mensajes que no son ni retiro ni factura no se muestran: serían todo el ruido de la bandeja.
  return { entradas: entradas.filter(e => e.tipo === 'reclamo' || clasificarTexto(e.texto) !== 'otro'), avisos };
}
