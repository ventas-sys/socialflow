import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, collection, query, where, getDocs, doc, getDoc,
  setDoc, updateDoc, writeBatch, Timestamp,
} from 'firebase/firestore';
import { httpRequest } from '../_http.js';

// Cron diario (18hs ART / 21:00 UTC): descuenta stock de las ventas del día de
// ambas cuentas de MercadoLibre, EXCLUYENDO la bodega (Full). Usa el SDK cliente
// de Firebase autenticado con una cuenta admin dedicada (CRON_EMAIL/CRON_PASSWORD),
// para no depender de una service account key (bloqueada por política de la org).

const ORG_ID = 'distribuidora-universo';
const isDescontable = (t) => t !== 'fulfillment';

const firebaseConfig = {
  apiKey: 'AIzaSyDnIYGZF37XaTetiG3a_0jrk4DvpKlF8JY',
  authDomain: 'stock-e-inventario.firebaseapp.com',
  projectId: 'stock-e-inventario',
  storageBucket: 'stock-e-inventario.firebasestorage.app',
  messagingSenderId: '189841276349',
  appId: '1:189841276349:web:ed4a4b0f96f49a0a7966d4',
};

const barcodesOf = (x) => (x.barcodes?.length ? x.barcodes : (x.barcode ? [x.barcode] : []));

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

async function fetchOrders(token, fromISO) {
  const auth = { 'Authorization': 'Bearer ' + token };
  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  const sellerId = me.body.id;
  const raw = [];
  let offset = 0;
  for (let p = 0; p < 20; p++) {
    const url = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&sort=date_desc&limit=50&offset=${offset}&order.date_created.from=${encodeURIComponent(fromISO)}`;
    const r = await httpRequest('GET', url, auth);
    const results = r.body?.results || [];
    raw.push(...results);
    if (results.length < 50) break;
    offset += 50;
  }
  const shipCache = new Map();
  const out = [];
  for (const o of raw) {
    const items = (o.order_items || []).map(it => ({
      mla: it.item?.id || null,
      sku: it.item?.seller_sku || it.item?.seller_custom_field || null,
      quantity: it.quantity || 0,
    }));
    let logisticType = null;
    const sid = o.shipping?.id;
    if (sid) {
      if (shipCache.has(sid)) logisticType = shipCache.get(sid);
      else {
        const s = await httpRequest('GET', `https://api.mercadolibre.com/shipments/${sid}`, auth);
        logisticType = s.body?.logistic_type || null;
        shipCache.set(sid, logisticType);
      }
    }
    out.push({ id: String(o.id), logisticType, items });
  }
  return out;
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const authz = req.headers['authorization'] || '';
    if (authz !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    if (!process.env.CRON_EMAIL || !process.env.CRON_PASSWORD) {
      throw new Error('Faltan las variables CRON_EMAIL / CRON_PASSWORD');
    }
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const authClient = getAuth(app);
    await signInWithEmailAndPassword(authClient, process.env.CRON_EMAIL, process.env.CRON_PASSWORD);
    const db = getFirestore(app);

    const [prodSnap, comboSnap] = await Promise.all([
      getDocs(query(collection(db, 'products'), where('userId', '==', ORG_ID))),
      getDocs(query(collection(db, 'combos'), where('userId', '==', ORG_ID))),
    ]);
    const products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const combos = comboSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const findByRef = (ref) => {
      const q = String(ref || '').trim().toLowerCase();
      if (!q) return null;
      const p = products.find(pp => (pp.code && pp.code.toLowerCase() === q) || barcodesOf(pp).some(b => String(b).toLowerCase() === q));
      if (p) return { type: 'product', p };
      const c = combos.find(cc => (cc.code && cc.code.toLowerCase() === q) || barcodesOf(cc).some(b => String(b).toLowerCase() === q));
      if (c) return { type: 'combo', c };
      return null;
    };

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const fromISO = start.toISOString();
    const summary = {};

    for (const key of ['full', 'ferre']) {
      const accDoc = await getDoc(doc(db, 'ml_accounts', key));
      if (!accDoc.exists() || !accDoc.data().accessToken) { summary[key] = 'sin conectar'; continue; }
      const token = await ensureToken(db, key, accDoc.data());
      const orders = await fetchOrders(token, fromISO);

      const deltas = new Map();
      const names = new Map();
      const processed = [];
      let skippedFull = 0;
      for (const o of orders) {
        if (!isDescontable(o.logisticType)) { skippedFull++; continue; }
        const seen = await getDoc(doc(db, 'ml_orders', `${key}_${o.id}`));
        if (seen.exists()) continue;
        for (const it of o.items) {
          const m = findByRef(it.sku) || findByRef(it.mla);
          if (!m) continue;
          const add = (p, d) => { deltas.set(p.id, (deltas.get(p.id) || 0) + d); names.set(p.id, p.name); };
          if (m.type === 'product') add(m.p, -it.quantity);
          else m.c.items?.forEach(ci => {
            const bp = products.find(pp => pp.id === ci.productId);
            if (bp) add(bp, -(ci.quantity * it.quantity));
          });
        }
        processed.push(o.id);
      }

      const ids = [...deltas.keys()];
      for (let i = 0; i < ids.length; i += 200) {
        const batch = writeBatch(db);
        ids.slice(i, i + 200).forEach(pid => {
          const prod = products.find(pp => pp.id === pid);
          const newQ = (prod?.quantity || 0) + deltas.get(pid);
          batch.update(doc(db, 'products', pid), { quantity: newQ, updatedAt: Timestamp.now() });
          batch.set(doc(collection(db, 'movements')), {
            productId: pid, productName: names.get(pid) || '', type: 'salida',
            quantity: Math.abs(deltas.get(pid)), reason: `Venta ML ${key.toUpperCase()} (auto)`,
            reference: 'ML', userId: ORG_ID, date: Timestamp.now(),
            userName: 'Automático 18hs', userEmail: 'cron',
          });
        });
        await batch.commit();
      }
      for (let i = 0; i < processed.length; i += 400) {
        const batch = writeBatch(db);
        processed.slice(i, i + 400).forEach(oid => {
          batch.set(doc(db, 'ml_orders', `${key}_${oid}`), {
            account: key, orderId: oid, userId: ORG_ID, processedAt: Timestamp.now(),
          });
        });
        await batch.commit();
      }
      await setDoc(doc(db, 'ml_accounts', key), { lastSyncAt: Timestamp.now() }, { merge: true });
      summary[key] = { ordenes: processed.length, productos: ids.length, salteadasFull: skippedFull };
    }

    return res.status(200).json({ ok: true, at: new Date().toISOString(), summary });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
