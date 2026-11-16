// Facturación electrónica directa contra ARCA (sin Contabilium).
// Emisor: BP IMPORT S.R.L. — certificado "stockml" — punto de venta 12 (RECE web services).
//
// Variables de entorno (Vercel):
//   ARCA_CERT_B64 / ARCA_KEY_B64  certificado y clave privada en base64 (PEM)
//   ARCA_CUIT=30715327712  ARCA_PV=12  ARCA_AMBIENTE=produccion|homologacion
//   CRON_EMAIL / CRON_PASSWORD     (ya existen) para guardar el ticket de ARCA en Firestore
//
// Seguridad: solo el admin (ventas@) puede usarlo: el cliente manda su idToken de Firebase
// (header X-Firebase-Token) y acá se valida contra Google antes de hacer nada.
//
// Acciones:
//   POST /api/arca?action=estado   → prueba sin emitir: servidores ARCA + último comprobante de cada tipo en el PV
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { cors } from './_http.js';
import { firebaseConfig } from './ml/cron.js';
import { credenciales } from '../lib/arca/wsaa.js';
import { WSFE } from '../lib/arca/wsfe.js';
import { CBTE } from '../lib/arca/fiscal.js';

const ADMIN_EMAIL = 'ventas@distribuidorauniverso.com';

function config() {
  const dec = (v) => Buffer.from(String(v || ''), 'base64').toString('utf8');
  const cfg = {
    certPem: dec(process.env.ARCA_CERT_B64),
    keyPem: dec(process.env.ARCA_KEY_B64),
    cuit: String(process.env.ARCA_CUIT || '').replace(/\D/g, ''),
    ptoVta: Number(process.env.ARCA_PV || 0),
    ambiente: process.env.ARCA_AMBIENTE === 'homologacion' ? 'homologacion' : 'produccion',
  };
  const falta = [];
  if (!cfg.certPem.includes('BEGIN CERTIFICATE')) falta.push('ARCA_CERT_B64');
  if (!cfg.keyPem.includes('PRIVATE KEY')) falta.push('ARCA_KEY_B64');
  if (cfg.cuit.length !== 11) falta.push('ARCA_CUIT');
  if (!cfg.ptoVta) falta.push('ARCA_PV');
  if (falta.length) throw new Error('Faltan variables de entorno: ' + falta.join(', '));
  return cfg;
}

async function emailDelToken(idToken) {
  if (!idToken) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  }).then((x) => x.json()).catch(() => null);
  return r?.users?.[0]?.email?.toLowerCase() || null;
}

let dbPromise = null;
function baseDeDatos() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const app = getApps().find((a) => a.name === 'arca') || initializeApp(firebaseConfig, 'arca');
      await signInWithEmailAndPassword(getAuth(app), process.env.CRON_EMAIL, process.env.CRON_PASSWORD);
      return getFirestore(app);
    })().catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
}

// Ticket de ARCA en ml_accounts (sólo admin lee) y SIN userId, como saldoMP:
// así la app no lo carga como si fuera una cuenta de ML.
async function cacheTicket() {
  const db = await baseDeDatos();
  const ref = doc(db, 'ml_accounts', 'arcaTicket');
  return {
    get: async () => { const s = await getDoc(ref); return s.exists() ? s.data() : null; },
    set: (v) => setDoc(ref, { ...v, guardado: new Date().toISOString() }),
  };
}

async function cliente(cfg) {
  const cred = await credenciales({ ...cfg, cache: await cacheTicket() });
  return new WSFE({ ambiente: cfg.ambiente, cuit: cfg.cuit, credenciales: cred });
}

async function estado(cfg) {
  const ws = await cliente(cfg);
  const servidores = await ws.dummy().catch((e) => ({ error: e.message }));
  const ultimos = {};
  for (const [nombre, tipo] of [['Factura A', CBTE.FA], ['Factura B', CBTE.FB], ['Nota de crédito A', CBTE.NCA], ['Nota de crédito B', CBTE.NCB]]) {
    try { ultimos[nombre] = await ws.ultimoAutorizado(cfg.ptoVta, tipo); } catch (e) { ultimos[nombre] = 'error: ' + e.message; }
  }
  const pvs = await ws.puntosDeVenta().catch((e) => [{ error: e.message }]);
  return { ok: true, ambiente: cfg.ambiente, cuit: cfg.cuit, puntoDeVenta: cfg.ptoVta, servidores, ultimos, puntosDeVentaWebServices: pvs };
}

export default async function handler(req, res) {
  cors(res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    // OJO: Authorization lo usa la contraseña del sitio (middleware.js, Basic). El token va aparte.
    const idToken = req.headers['x-firebase-token'] || '';
    const email = await emailDelToken(idToken);
    if (email !== ADMIN_EMAIL) return res.status(401).json({ ok: false, error: 'Solo el administrador puede usar la facturación.' });

    const cfg = config();
    const action = req.query.action;
    if (action === 'estado') return res.status(200).json(await estado(cfg));
    return res.status(400).json({ ok: false, error: 'Acción desconocida' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
