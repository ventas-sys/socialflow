import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, collection, query, where, getDocs, doc, getDoc,
  setDoc, addDoc, writeBatch, Timestamp,
} from 'firebase/firestore';
import { httpRequest, cors } from '../_http.js';
import { fetchOrdersDetailed } from './exchange.js';

// Sincronización del tablero de Envíos EN EL SERVIDOR. La dispara cualquier
// sesión abierta de la app (sin exponer los tokens de ML: acá se usan las
// credenciales del usuario cron, que es admin). Hace lo mismo que hacía el
// cliente: importa FLEX + correo (correo solo para Empaquetado), refresca los
// estados contra ML y revisa los activos viejos fuera de la ventana.
// Un candado en settings/enviosSync evita corridas superpuestas o muy seguidas.

const ORG_ID = 'distribuidora-universo';
const H48 = 48 * 3600 * 1000;

// --- Purga de los envíos de CORREO ---
// Los de correo no van al tablero: se importan sólo para que Empaquetado los
// encuentre al escanear. A los 15 días ya no hacen falta (pedido del usuario el
// 29/10) y eran ~700 por semana que quedaban para siempre. Antes de borrarlos
// se suma su localidad al resumen de settings/correoResumen, así no se pierde
// el dato de DÓNDE enviamos más aunque nadie baje el Excel.
// El borrado automático toca SÓLO los creados a partir de PURGA_DESDE: los
// anteriores los borra el botón "📮 Registro de correo" de la app, que primero
// baja el Excel con el detalle (destinatario, dirección, artículos).
const DIAS_CORREO = 15;
const PURGA_DESDE = Date.parse('2026-10-29T00:00:00Z');

// Localidad y provincia salen de la dirección que arma ML:
// "<calle y número>, <ciudad>, <provincia>"
const partesDir = (dir) => String(dir || '').split(',').map(x => x.trim()).filter(Boolean);
export const localidadDe = (dir) => {
  const p = partesDir(dir);
  return p.length > 1 ? p.slice(1).join(', ') : '— sin localidad —';
};
// Las claves de un mapa de Firestore no pueden tener punto ni los caracteres
// que se usan en las rutas de campo
const claveOk = (t) => String(t).replace(/[.~*/[\]`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '—';

// Suma al resumen mensual los envíos de correo que están por borrarse
async function sumarResumenCorreo(db, envios) {
  const ref = doc(db, 'settings', 'correoResumen');
  const actual = (await getDoc(ref)).data()?.meses || {};
  for (const s of envios) {
    const ms = s.createdAt?.toMillis ? s.createdAt.toMillis() : new Date(s.createdAt || 0).getTime();
    if (!ms) continue;
    const mes = new Date(ms).toISOString().slice(0, 7);
    const m = actual[mes] || { total: 0, porLocalidad: {}, porCuenta: {} };
    const loc = claveOk(localidadDe(s.address));
    const cta = claveOk(s.account || 'sin cuenta');
    m.total = (m.total || 0) + 1;
    m.porLocalidad[loc] = (m.porLocalidad[loc] || 0) + 1;
    m.porCuenta[cta] = (m.porCuenta[cta] || 0) + 1;
    actual[mes] = m;
  }
  // Se guardan los últimos 24 meses para que el documento no crezca sin fin
  const meses = Object.fromEntries(
    Object.entries(actual).sort((a, b) => a[0].localeCompare(b[0])).slice(-24));
  await setDoc(ref, { meses, userId: ORG_ID, actualizadoAt: Timestamp.now() }, { merge: true });
}

const firebaseConfig = {
  apiKey: 'AIzaSyDnIYGZF37XaTetiG3a_0jrk4DvpKlF8JY',
  authDomain: 'stock-e-inventario.firebaseapp.com',
  projectId: 'stock-e-inventario',
  storageBucket: 'stock-e-inventario.firebasestorage.app',
  messagingSenderId: '189841276349',
  appId: '1:189841276349:web:ed4a4b0f96f49a0a7966d4',
};

const toMillis = (t) => (t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0));

async function ensureToken(db, key, acc) {
  const expMs = acc.expiresAt?.toMillis ? acc.expiresAt.toMillis() : new Date(acc.expiresAt || 0).getTime();
  if (expMs && expMs - Date.now() > 10 * 60 * 1000) return acc.accessToken;
  const body = new URLSearchParams({
    grant_type: 'refresh_token', client_id: acc.clientId,
    client_secret: acc.clientSecret, refresh_token: acc.refreshToken,
  }).toString();
  const r = await httpRequest('POST', 'https://api.mercadolibre.com/oauth/token',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body);
  if (r.status !== 200) throw new Error('No se pudo renovar el token: ' + (r.body?.message || r.status));
  await setDoc(doc(db, 'ml_accounts', key), {
    accessToken: r.body.access_token, refreshToken: r.body.refresh_token,
    expiresAt: Timestamp.fromMillis(Date.now() + (r.body.expires_in || 21600) * 1000),
  }, { merge: true });
  return r.body.access_token;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    if (!process.env.CRON_EMAIL || !process.env.CRON_PASSWORD) {
      throw new Error('Faltan las variables CRON_EMAIL / CRON_PASSWORD');
    }
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    await signInWithEmailAndPassword(getAuth(app), process.env.CRON_EMAIL, process.env.CRON_PASSWORD);
    const db = getFirestore(app);

    // Candado: manual (force) respeta 90s; automático, 8 minutos
    const force = !!req.body?.force;
    const guardRef = doc(db, 'settings', 'enviosSync');
    const guard = await getDoc(guardRef);
    const last = guard.exists() ? toMillis(guard.data().lastRunAt) : 0;
    const minGap = (force ? 90 : 8 * 60) * 1000;
    if (Date.now() - last < minGap) {
      return res.status(200).json({ ok: true, skipped: true, summary: guard.data()?.lastSummary || null });
    }
    await setDoc(guardRef, { lastRunAt: Timestamp.now(), userId: ORG_ID }, { merge: true });

    // Envíos existentes (para dedup y refresco de estados). NO se lee el
    // histórico entero: la colección crece ~250 documentos por día entre FLEX y
    // correo. Alcanza con los últimos 60 días (el dedup mira ventas de 7 días y
    // el autoarchivado, entregados de 7) más todo lo que siga sin cerrarse,
    // tenga la fecha que tenga. Las dos consultas son por un solo campo, así que
    // no hacen falta índices compuestos; el userId se filtra acá.
    const desdeMs = Timestamp.fromMillis(Date.now() - 60 * 24 * 3600 * 1000);
    const ABIERTOS = ['pendiente', 'armado', 'camino', 'demorado', 'entregado'];
    const [recientesSnap, abiertosSnap] = await Promise.all([
      getDocs(query(collection(db, 'shipments'), where('createdAt', '>=', desdeMs))),
      getDocs(query(collection(db, 'shipments'), where('status', 'in', ABIERTOS))),
    ]);
    const porId = new Map();
    for (const snap of [recientesSnap, abiertosSnap]) {
      snap.docs.forEach(d => {
        const s = { id: d.id, ...d.data() };
        if (s.userId === ORG_ID) porId.set(d.id, s);
      });
    }
    const existing = [...porId.values()];
    const seen = new Set(existing.map(s => String(s.packId || s.code)));

    const summary = {
      created: 0, nPend: 0, nCamino: 0, nEntregado: 0, nDemorado: 0, nCorreo: 0,
      updEnt: 0, updDem: 0, updArc: 0, oldEnt: 0, oldDem: 0, oldArc: 0,
      flex: 0, correo: 0, total: 0,
    };
    const mlStatus = new Map();
    const tokenByKey = {};
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 7);

    for (const key of ['full', 'ferre']) {
      const accDoc = await getDoc(doc(db, 'ml_accounts', key));
      if (!accDoc.exists() || !accDoc.data().accessToken) continue;
      const token = await ensureToken(db, key, accDoc.data());
      tokenByKey[key] = token;
      const { orders } = await fetchOrdersDetailed(token, from.toISOString());
      summary.total += orders.length;

      const groups = new Map();
      for (const o of orders) {
        const isCorreo = ['cross_docking', 'drop_off', 'xd_drop_off'].includes(o.logisticType);
        if (o.logisticType !== 'self_service' && !isCorreo) continue;
        if (isCorreo) {
          summary.correo++;
        } else {
          summary.flex++;
          const info = {
            st: o.status === 'cancelled' ? 'cancelled' : o.shipmentStatus,
            tn: o.trackingNumber || null,
          };
          if (o.shipmentId) mlStatus.set(String(o.shipmentId), info);
          if (o.packId) mlStatus.set(String(o.packId), info);
        }
        if (o.status === 'cancelled' || ['cancelled', 'to_be_agreed'].includes(o.shipmentStatus)) continue;
        const gkey = String(o.packId || o.shipmentId || '');
        if (!gkey || seen.has(gkey)) continue;
        const g = groups.get(gkey);
        if (g) g.items = [...(g.items || []), ...(o.items || [])];
        else groups.set(gkey, { ...o, correo: isCorreo, items: [...(o.items || [])] });
      }

      // Lo que ML cobró/pagó por cada envío nuevo. Antes el reporte estimaba el
      // "Cobro ML" con una tabla de zonas que había que actualizar a mano cada
      // vez que ML cambiaba las tarifas; ahora se guarda el número REAL:
      // receiver.cost = lo que pagó el comprador, senders[0].cost = lo que nos
      // cobró/pagó ML a nosotros. Si el pedido falla, la fila sigue igual y el
      // reporte cae en la tabla como antes.
      const costos = new Map();
      const idsCosto = [...groups.values()].filter(o => !o.correo && o.shipmentId).map(o => String(o.shipmentId));
      for (let i = 0; i < idsCosto.length; i += 10) {
        await Promise.all(idsCosto.slice(i, i + 10).map(async (sid) => {
          try {
            const r = await httpRequest('GET', `https://api.mercadolibre.com/shipments/${sid}/costs`,
              { 'Authorization': 'Bearer ' + token });
            if (r.status !== 200 || !r.body) return;
            const vendedor = (r.body.senders || [])[0] || {};
            costos.set(sid, {
              costoML: vendedor.cost ?? null,
              costoComprador: r.body.receiver?.cost ?? null,
              bonificacionML: (vendedor.compensation ?? 0) + (vendedor.save ?? 0),
            });
          } catch { /* sin costo: el reporte usa la tabla de zonas */ }
        }));
      }

      for (const o of groups.values()) {
        seen.add(String(o.packId || o.shipmentId));
        const base = {
          code: String(o.shipmentId || o.packId), packId: o.packId || null,
          recipient: o.recipient || '', address: o.address || '',
          lat: o.lat ?? null, lng: o.lng ?? null, cost: 0, account: key,
          items: o.items || [], dims: o.dimensions || null,
          trackingNumber: o.trackingNumber || null, notes: o.notes || null,
          ...(costos.get(String(o.shipmentId)) || {}),
          userId: ORG_ID, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        };
        if (o.correo) {
          await addDoc(collection(db, 'shipments'), {
            ...base, channel: 'correo', status: 'archivado', archivedAt: Timestamp.now(),
          });
          summary.nCorreo++;
          continue;
        }
        const ageMs = Date.now() - new Date(o.date).getTime();
        let status;
        if (o.shipmentStatus === 'delivered') status = 'entregado';
        else if (o.shipmentStatus === 'shipped') status = ageMs <= H48 ? 'camino' : 'demorado';
        else if (o.shipmentStatus === 'not_delivered') status = 'demorado';
        else status = ageMs <= H48 ? 'pendiente' : 'demorado';
        await addDoc(collection(db, 'shipments'), {
          ...base, status,
          ...(status === 'camino' ? { assignedAt: Timestamp.fromDate(new Date(o.date)) } : {}),
          ...(status === 'demorado' ? { demoradoAt: Timestamp.now() } : {}),
          ...(status === 'entregado' ? { deliveredAt: Timestamp.fromDate(new Date(o.date)) } : {}),
        });
        summary.created++;
        if (status === 'pendiente') summary.nPend++;
        else if (status === 'camino') summary.nCamino++;
        else if (status === 'entregado') summary.nEntregado++;
        else summary.nDemorado++;
      }
    }

    // Refresco de los ya cargados (solo FLEX): entregado/cancelado/demorado
    const actives = existing.filter(s =>
      s.channel !== 'correo' && !['entregado', 'archivado'].includes(s.status || 'pendiente'));
    const updates = [];
    for (const s of actives) {
      const info = mlStatus.get(String(s.code)) || (s.packId && mlStatus.get(String(s.packId)));
      if (!info) continue;
      const st = s.status || 'pendiente';
      const patch = {};
      if (!s.trackingNumber && info.tn) patch.trackingNumber = info.tn;
      if (info.st === 'delivered') { patch.status = 'entregado'; patch.deliveredAt = Timestamp.now(); summary.updEnt++; }
      else if (info.st === 'cancelled') { patch.status = 'archivado'; patch.archivedAt = Timestamp.now(); summary.updArc++; }
      else if (info.st === 'not_delivered' && st !== 'demorado') { patch.status = 'demorado'; patch.demoradoAt = Timestamp.now(); summary.updDem++; }
      else if (info.st === 'shipped' && st === 'camino' && toMillis(s.assignedAt) && Date.now() - toMillis(s.assignedAt) > H48) {
        patch.status = 'demorado'; patch.demoradoAt = Timestamp.now(); summary.updDem++;
      }
      if (Object.keys(patch).length) updates.push([s.id, patch]);
    }

    // Activos VIEJOS fuera de la ventana: consultarlos uno por uno contra ML
    const stale = actives.filter(s =>
      !mlStatus.has(String(s.code)) && !(s.packId && mlStatus.has(String(s.packId)))).slice(0, 400);
    if (stale.length) {
      const pending = new Map(stale.map(s => [String(s.code), s]));
      for (const key of Object.keys(tokenByKey)) {
        if (!pending.size) continue;
        const ids = [...pending.values()].filter(s => !s.account || s.account === key).map(s => String(s.code));
        const auth = { 'Authorization': 'Bearer ' + tokenByKey[key] };
        for (let i = 0; i < ids.length; i += 10) {
          await Promise.all(ids.slice(i, i + 10).map(async (id) => {
            try {
              const r = await httpRequest('GET', 'https://api.mercadolibre.com/shipments/' + id, auth);
              if (r.status !== 200 || !r.body?.status) return;
              const s = pending.get(id);
              if (!s) return;
              pending.delete(id);
              const st = s.status || 'pendiente';
              const patch = {};
              if (!s.trackingNumber && r.body.tracking_number) patch.trackingNumber = r.body.tracking_number;
              if (r.body.status === 'delivered') { patch.status = 'entregado'; patch.deliveredAt = Timestamp.now(); summary.oldEnt++; }
              else if (r.body.status === 'cancelled') { patch.status = 'archivado'; patch.archivedAt = Timestamp.now(); summary.oldArc++; }
              else if (['not_delivered', 'shipped'].includes(r.body.status) && st !== 'demorado' && st !== 'camino') {
                patch.status = 'demorado'; patch.demoradoAt = Timestamp.now(); summary.oldDem++;
              }
              if (Object.keys(patch).length) updates.push([s.id, patch]);
            } catch { /* envío de la otra cuenta o error puntual */ }
          }));
        }
      }
    }

    // Entregados con más de 7 días → Archivado. El tablero es del día a día:
    // una vez entregado y pasada una semana no hay nada que hacer con ese
    // envío, y si queda a la vista solo infla el contador. En el reporte
    // (incluido el filtro por fechas) se siguen viendo igual.
    const HACE_7_DIAS = Date.now() - 7 * 24 * 3600 * 1000;
    const toMs = (t) => (t?.toMillis ? t.toMillis() : new Date(t || 0).getTime());
    summary.autoArchivados = 0;
    for (const s of existing) {
      if ((s.status || '') !== 'entregado') continue;
      const cuando = toMs(s.deliveredAt) || toMs(s.updatedAt) || toMs(s.createdAt);
      if (!cuando || cuando > HACE_7_DIAS) continue;
      updates.push([s.id, { status: 'archivado', archivedAt: Timestamp.now() }]);
      summary.autoArchivados++;
    }

    for (let i = 0; i < updates.length; i += 400) {
      const batch = writeBatch(db);
      updates.slice(i, i + 400).forEach(([id, patch]) =>
        batch.update(doc(db, 'shipments', id), { ...patch, updatedAt: Timestamp.now() }));
      await batch.commit();
    }

    // Envíos de correo cumplidos: al resumen y afuera (ver DIAS_CORREO arriba)
    const limiteCorreo = Date.now() - DIAS_CORREO * 24 * 3600 * 1000;
    const correoViejo = existing.filter((s) => {
      if (s.channel !== 'correo') return false;
      const ms = toMs(s.createdAt);
      return ms > PURGA_DESDE && ms < limiteCorreo;
    });
    // Primero el resumen, y SOLO si se pudo guardar se borra: si el resumen
    // falla preferimos dejarlos y que el sync siga andando, antes que borrar
    // sin registro o cortar la sincronización entera.
    summary.correoBorrados = 0;
    if (correoViejo.length) {
      try {
        await sumarResumenCorreo(db, correoViejo);
        for (let i = 0; i < correoViejo.length; i += 400) {
          const batch = writeBatch(db);
          correoViejo.slice(i, i + 400).forEach(s => batch.delete(doc(db, 'shipments', s.id)));
          await batch.commit();
        }
        summary.correoBorrados = correoViejo.length;
      } catch (e) {
        summary.correoError = e?.message || String(e);
      }
    }

    await setDoc(guardRef, { lastRunAt: Timestamp.now(), lastSummary: summary, userId: ORG_ID }, { merge: true });
    return res.status(200).json({ ok: true, summary });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
