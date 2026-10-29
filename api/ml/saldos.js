import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { httpRequest } from '../_http.js';
import { firebaseConfig, ensureToken } from './cron.js';
import { REPORTE_BASE, authDelReporte, pedirReporte, traerUltimoSaldo } from './exchange.js';

// SALDO DE MERCADO PAGO AUTOMÁTICO (pedido el 28/10).
// Horario en hora ARGENTINA: cada hora de 7 a 18hs, y a las 0 y a las 6hs.
// Vercel (plan gratis) sólo deja crons de UNA vez por día, así que son 14
// entradas separadas en vercel.json, una por hora. Cada una puede correr en
// cualquier minuto de su hora (precisión de ±59 min del plan gratis).
//
// Qué hace cada corrida, por cuenta:
//   1. pide a MP un archivo nuevo de liberaciones
//   2. espera hasta ~2 min a que aparezca (si no, usa el más nuevo que haya)
//   3. lo lee con la MISMA lectura del botón 💳 Ver saldos (verificada contra
//      el saldo real el 28/10 en las dos cuentas)
//   4. guarda en ml_accounts/saldoMP SÓLO si salió un disponible confirmado
//      (la fila total de MP coincide con el cálculo). Si no, deja el último
//      bueno y anota el error aparte: nunca se pisa un dato bueno con un vacío.
//
// Se guarda en ml_accounts (sólo admin lee) y SIN userId, para que la carga
// de cuentas de App.jsx no lo tome como una tercera cuenta. En `settings` lo
// verían los ayudantes.

const CUENTAS = ['full', 'ferre'];
const ESPERA_MAX_MS = 120 * 1000;
const CADA_MS = 10 * 1000;

const nombresDeArchivos = async (auth) => {
  const r = await httpRequest('GET', REPORTE_BASE + '/list', auth);
  return new Set((Array.isArray(r.body) ? r.body : []).map((f) => f.file_name));
};

async function saldoDeUnaCuenta(db, key) {
  const accDoc = await getDoc(doc(db, 'ml_accounts', key));
  if (!accDoc.exists()) return { ok: false, error: 'La cuenta no está conectada' };
  const acc = accDoc.data();
  const token = await ensureToken(db, key, acc);
  const a = await authDelReporte(token, acc.mpToken);
  if (!a) return { ok: false, error: 'Ningún token puede leer el reporte de liberaciones' };

  const antes = await nombresDeArchivos(a.auth);
  const pedido = await pedirReporte(a.auth, 3);
  let aparecio = false;
  if (pedido.ok) {
    const limite = Date.now() + ESPERA_MAX_MS;
    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, CADA_MS));
      const ahora = await nombresDeArchivos(a.auth);
      if ([...ahora].some((n) => !antes.has(n))) { aparecio = true; break; }
    }
  }

  const r = await traerUltimoSaldo(a.auth);
  if (!r.ok) return { ok: false, error: r.error, pedido: pedido.estado };
  if (!r.saldo || r.saldo.disponible == null) {
    return { ok: false, error: 'El archivo no dio un disponible confirmado', archivo: r.archivo, pedido: pedido.estado };
  }
  return {
    ok: true,
    disponible: r.saldo.disponible,
    hasta: r.hasta || null,
    fuente: r.saldo.fuente,
    archivo: r.archivo,
    archivoNuevo: aparecio,
  };
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
    await signInWithEmailAndPassword(getAuth(app), process.env.CRON_EMAIL, process.env.CRON_PASSWORD);
    const db = getFirestore(app);

    const resultados = await Promise.all(CUENTAS.map(async (key) => {
      try { return [key, await saldoDeUnaCuenta(db, key)]; }
      catch (e) { return [key, { ok: false, error: e.message }]; }
    }));

    const ahora = Timestamp.now();
    const guardar = { ultimaCorrida: ahora };
    for (const [key, r] of resultados) {
      if (r.ok) {
        guardar[key] = { disponible: r.disponible, hasta: r.hasta, fuente: r.fuente, archivo: r.archivo, leidoAt: ahora };
        guardar[`${key}Error`] = null;
      } else {
        // El último saldo bueno de esta cuenta queda como estaba.
        guardar[`${key}Error`] = { mensaje: r.error || 'falló', at: ahora };
      }
    }
    await setDoc(doc(db, 'ml_accounts', 'saldoMP'), guardar, { merge: true });

    return res.status(200).json({ ok: true, resultados: Object.fromEntries(resultados) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
