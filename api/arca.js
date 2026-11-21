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
//   POST /api/arca?action=estado        → prueba sin emitir: servidores ARCA + último comprobante de cada tipo en el PV
//   POST /api/arca?action=emitir        → factura A/B con CAE { origenId, receptor, items, condicionVenta, observaciones }
//   POST /api/arca?action=nc            → nota de crédito total { comprobanteId }
//   POST /api/arca?action=presupuesto   → guarda presupuesto (no va a ARCA)
//   POST /api/arca?action=pdf           → { comprobanteId } → PDF en base64
//   POST /api/arca?action=remito        → nuevo remito (expreso A4 + etiquetas, o micro 15x10) → PDFs
//   POST /api/arca?action=remitoPdf     → { remitoId } → vuelve a generar los PDFs
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { emitirComprobante, guardarPresupuesto } from '../lib/arca/emitir.js';
import { generarPDF } from '../lib/arca/pdf.js';
import { generarRemito } from '../lib/arca/remito.js';
import { runTransaction } from 'firebase/firestore';
import { cors } from './_http.js';
import { firebaseConfig } from './ml/cron.js';
import { credenciales } from '../lib/arca/wsaa.js';
import { WSFE } from '../lib/arca/wsfe.js';
import { CBTE } from '../lib/arca/fiscal.js';

const ADMIN_EMAIL = 'ventas@distribuidorauniverso.com';
const EMPRESA = {
  razonSocial: 'BP IMPORT S.R.L.',
  cuit: '30-71532771-2',
  domicilio: 'Bacacay 4726 - CABA',
  iibb: '30-71532771-2',
  inicioActividades: '',
};

async function guardarCliente(db, r) {
  const n = String(r?.docNro || '').replace(/\D/g, '');
  if (!n || n === '0') return;
  await setDoc(doc(db, 'clientes', n), {
    nombre: r.nombre || '', docTipo: n.length === 11 ? 'CUIT' : (r.docTipo || 'DNI'), docNro: n,
    condicionIva: Number(r.condicionIva ?? 5), domicilio: r.domicilio || '', email: r.email || '',
    telefono: r.telefono || '', ultimoUso: new Date().toISOString(),
  }, { merge: true });
}

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
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const db = await baseDeDatos();
    if (action === 'emitir') {
      if (!body.origenId || !Array.isArray(body.items) || !body.items.length) throw new Error('Faltan datos de la venta.');
      const ws = await cliente(cfg);
      const c = await emitirComprobante(db, ws, cfg, { ...body, usuario: email });
      if (c.estado === 'autorizado') await guardarCliente(db, body.receptor).catch(() => {});
      return res.status(200).json({ ok: c.estado === 'autorizado', comprobante: c, error: c.errores?.join(' | ') });
    }
    if (action === 'nc') {
      const s0 = await getDoc(doc(db, 'comprobantes', String(body.comprobanteId || '')));
      if (!s0.exists()) throw new Error('No encontré ese comprobante.');
      const o = s0.data();
      if (![1, 6].includes(o.cbteTipo)) throw new Error('Solo se puede anular una factura A o B.');
      if (o.anuladoPor) throw new Error('Esa factura ya tiene nota de crédito: ' + o.anuladoPor);
      const ws = await cliente(cfg);
      const c = await emitirComprobante(db, ws, cfg, {
        origenId: 'nc_' + o.id,
        receptor: { nombre: o.receptor.nombre, docTipo: o.receptor.DocTipo === 80 ? 'CUIT' : o.receptor.DocTipo === 86 ? 'CUIL' : 'DNI', docNro: o.receptor.DocNro, condicionIva: o.receptor.condicionIva, domicilio: o.receptor.domicilio },
        items: o.items.map(({ sku, descripcion, cantidad, precioFinal, iva }) => ({ sku, descripcion, cantidad, precioFinal, iva })),
        condicionVenta: o.condicionVenta, observaciones: body.motivo || '',
        anula: { id: o.id, cbteTipo: o.cbteTipo, ptoVta: o.ptoVta, nro: o.nro, fecha: o.fecha },
        usuario: email,
      });
      return res.status(200).json({ ok: c.estado === 'autorizado', comprobante: c, error: c.errores?.join(' | ') });
    }
    if (action === 'presupuesto') {
      if (!Array.isArray(body.items) || !body.items.length) throw new Error('El presupuesto no tiene artículos.');
      const pres = await guardarPresupuesto(db, cfg, { ...body, usuario: email });
      await guardarCliente(db, body.receptor).catch(() => {});
      return res.status(200).json({ ok: true, comprobante: pres });
    }
    if (action === 'remito') {
      if (!body.destinatario?.nombre) throw new Error('Falta el destinatario.');
      if (!Array.isArray(body.items) || !body.items.length) throw new Error('El remito no tiene artículos.');
      const cRef = doc(db, 'arca_control', 'remitos');
      const nro = await runTransaction(db, async (tx) => {
        const s1 = await tx.get(cRef);
        const n = (s1.exists() ? s1.data().ultimo || 0 : 0) + 1;
        tx.set(cRef, { ultimo: n }, { merge: true });
        return n;
      });
      const r = {
        id: 'R-' + String(nro).padStart(8, '0'), cbteTipo: 91, estado: 'remito', nro,
        tipo: body.tipo === 'micro' ? 'micro' : 'expreso',
        destinatario: body.destinatario, transporte: body.transporte || {},
        bultos: Math.max(1, Number(body.bultos) || 1), peso: body.peso || '', valorDeclarado: body.valorDeclarado || '',
        fragil: !!body.fragil, comprobante: body.comprobante || '', observaciones: body.observaciones || '',
        items: body.items.map(({ sku, descripcion, cantidad }) => ({ sku: sku || '', descripcion: String(descripcion || ''), cantidad: Number(cantidad) || 1 })),
        receptor: { nombre: body.destinatario.nombre, DocNro: body.destinatario.docNro || '' },
        total: 0, fecha: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        usuario: email, creado: new Date().toISOString(),
      };
      await setDoc(doc(db, 'comprobantes', r.id), r);
      const out = await generarRemito(r, EMPRESA);
      return res.status(200).json({ ok: true, remito: r, pdf: out.remito.toString('base64'), etiquetas: out.etiquetas?.toString('base64') || null });
    }
    if (action === 'remitoPdf') {
      const s0 = await getDoc(doc(db, 'comprobantes', String(body.remitoId || '')));
      if (!s0.exists()) throw new Error('No encontré ese remito.');
      const out = await generarRemito(s0.data(), EMPRESA);
      return res.status(200).json({ ok: true, remito: s0.data(), pdf: out.remito.toString('base64'), etiquetas: out.etiquetas?.toString('base64') || null });
    }
    if (action === 'pdf') {
      const s0 = await getDoc(doc(db, 'comprobantes', String(body.comprobanteId || '')));
      if (!s0.exists()) throw new Error('No encontré ese comprobante.');
      const pdf = await generarPDF(s0.data(), EMPRESA);
      const c0 = s0.data();
      const TIPOS = { 0: 'Presupuesto', 1: 'Factura A', 6: 'Factura B', 3: 'NC A', 8: 'NC B' };
      const num = c0.cbteTipo ? `${String(c0.ptoVta).padStart(5, '0')}-${String(c0.nro).padStart(8, '0')}` : String(c0.nro).padStart(8, '0');
      const cli = String(c0.receptor?.nombre || '').replace(/[^\w áéíóúñÁÉÍÓÚÑ.-]/g, '').trim().slice(0, 40);
      return res.status(200).json({ ok: true, nombre: `${TIPOS[c0.cbteTipo] || 'Comprobante'} ${num}${cli ? ' - ' + cli : ''}.pdf`, base64: pdf.toString('base64') });
    }
    return res.status(400).json({ ok: false, error: 'Acción desconocida' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
