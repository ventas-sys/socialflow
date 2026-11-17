// Emisión con CAE desde Vercel (Firestore con el SDK cliente, sesión cron@ = admin).
// - Idempotencia: arca_control/origen_{origenId}. El mismo pedido nunca se factura dos veces.
// - Numeración serializada por PV+tipo: arca_control/num_{pv}_{tipo} (lease de 60 s).
// - Si ARCA se cuelga después de autorizar, se recupera el CAE con FECompConsultar.
import { doc, getDoc, setDoc, runTransaction, writeBatch } from 'firebase/firestore';
import { calcularImportes, documentoReceptor, tipoFactura, fechaArca, urlQR, NC_DE, COND_IVA } from './fiscal.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

async function tomarLock(db, clave, ms = 60000) {
  const ref = doc(db, 'arca_control', `num_${clave}`);
  for (let i = 0; i < 40; i++) {
    const ok = await runTransaction(db, async (tx) => {
      const s = await tx.get(ref);
      if (s.exists() && s.data().hasta > Date.now()) return false;
      tx.set(ref, { hasta: Date.now() + ms }, { merge: true });
      return true;
    });
    if (ok) return () => setDoc(ref, { hasta: 0 }, { merge: true });
    await sleep(1500);
  }
  throw new Error('La numeración está ocupada por otra factura en curso. Probá de nuevo en un minuto.');
}

/** Aplica descuento % por línea al precio final. */
export function lineasConDescuento(items) {
  return items.map((it) => ({
    ...it,
    cantidad: Number(it.cantidad),
    precioFinal: r2(Number(it.precioFinal) * (1 - (Number(it.descuento) || 0) / 100)),
    iva: Number(it.iva ?? 21),
  }));
}

/**
 * p: { origenId, receptor{nombre,docTipo,docNro,condicionIva,domicilio,email}, items, condicionVenta,
 *      observaciones, anula?, usuario }
 */
export async function emitirComprobante(db, ws, cfg, p) {
  const origenRef = doc(db, 'arca_control', `origen_${p.origenId}`);
  const previo = await runTransaction(db, async (tx) => {
    const s = await tx.get(origenRef);
    if (s.exists()) {
      const d = s.data();
      if (d.estado === 'autorizado') return d;
      if (d.estado === 'en_proceso' && Date.now() - d.desde < 5 * 60000) throw new Error('Esta venta ya se está facturando. Esperá unos segundos y revisá Comprobantes.');
    }
    tx.set(origenRef, { estado: 'en_proceso', desde: Date.now() }, { merge: true });
    return null;
  });
  if (previo) {
    const c = await getDoc(doc(db, 'comprobantes', previo.comprobanteId));
    return { ...c.data(), yaExistia: true };
  }

  const cond = Number(p.receptor?.condicionIva ?? COND_IVA.CF);
  const cbteTipo = p.anula ? NC_DE[p.anula.cbteTipo] : tipoFactura(cond);
  const docR = documentoReceptor({ tipo: p.receptor?.docTipo, numero: p.receptor?.docNro }, cond);
  const imp = calcularImportes(lineasConDescuento(p.items));
  if (!(imp.ImpTotal > 0)) throw new Error('El total tiene que ser mayor a cero.');
  const CbteFch = fechaArca();
  const det = {
    ...docR, CbteFch,
    ImpTotal: imp.ImpTotal, ImpNeto: imp.ImpNeto, ImpIVA: imp.ImpIVA, Iva: imp.Iva,
    CondicionIVAReceptorId: cond,
    CbtesAsoc: p.anula ? [{ Tipo: p.anula.cbteTipo, PtoVta: p.anula.ptoVta, Nro: p.anula.nro, Cuit: cfg.cuit, CbteFch: p.anula.fecha }] : undefined,
  };

  const liberar = await tomarLock(db, `${cfg.ptoVta}_${cbteTipo}`);
  let res, nro;
  try {
    nro = (await ws.ultimoAutorizado(cfg.ptoVta, cbteTipo)) + 1;
    try {
      res = await ws.solicitarCAE(cfg.ptoVta, cbteTipo, nro, det);
    } catch (errRed) {
      await sleep(4000);
      const ult = await ws.ultimoAutorizado(cfg.ptoVta, cbteTipo);
      const c = ult >= nro ? await ws.consultar(cfg.ptoVta, cbteTipo, nro) : null;
      if (c && Number(c.DocNro) === Number(det.DocNro) && Math.abs(Number(c.ImpTotal) - det.ImpTotal) < 0.01) {
        res = { aprobado: true, cae: c.CodAutorizacion, caeVto: c.FchVto, errores: [] };
      } else throw errRed;
    }
  } catch (e) {
    await setDoc(origenRef, { estado: 'error', error: String(e.message || e), desde: 0 }, { merge: true });
    throw e;
  } finally {
    await liberar();
  }

  if (!res.aprobado) {
    await setDoc(origenRef, { estado: 'rechazado', error: res.errores.join(' | '), desde: 0 }, { merge: true });
    return { estado: 'rechazado', errores: res.errores };
  }

  const id = `${cbteTipo}-${String(cfg.ptoVta).padStart(5, '0')}-${String(nro).padStart(8, '0')}`;
  const comprobante = {
    id, origenId: p.origenId, estado: 'autorizado', cbteTipo, ptoVta: cfg.ptoVta, nro, fecha: CbteFch,
    cae: res.cae, caeVto: res.caeVto, avisosArca: res.errores,
    receptor: { nombre: p.receptor?.nombre || 'Consumidor Final', domicilio: p.receptor?.domicilio || '', email: p.receptor?.email || '', ...docR, condicionIva: cond },
    items: imp.lineas, iva: imp.Iva, neto: imp.ImpNeto, ivaTotal: imp.ImpIVA, total: imp.ImpTotal,
    condicionVenta: p.condicionVenta || 'Contado', observaciones: p.observaciones || '',
    anula: p.anula || null, ambiente: cfg.ambiente, cuitEmisor: cfg.cuit,
    qr: urlQR({ fecha: CbteFch, cuit: cfg.cuit, ptoVta: cfg.ptoVta, tipoCmp: cbteTipo, nroCmp: nro, importe: imp.ImpTotal, tipoDocRec: docR.DocTipo, nroDocRec: docR.DocNro, cae: res.cae }),
    usuario: p.usuario || '', creado: new Date().toISOString(),
  };
  const b = writeBatch(db);
  b.set(doc(db, 'comprobantes', id), comprobante);
  b.set(origenRef, { estado: 'autorizado', comprobanteId: id, cae: res.cae }, { merge: true });
  if (p.anula?.id) b.set(doc(db, 'comprobantes', p.anula.id), { anuladoPor: id }, { merge: true });
  await b.commit();
  return comprobante;
}

/** Presupuesto: no va a ARCA. Numeración propia correlativa. */
export async function guardarPresupuesto(db, cfg, p) {
  const imp = calcularImportes(lineasConDescuento(p.items));
  const cRef = doc(db, 'arca_control', 'presupuestos');
  const nro = await runTransaction(db, async (tx) => {
    const s = await tx.get(cRef);
    const n = (s.exists() ? s.data().ultimo || 0 : 0) + 1;
    tx.set(cRef, { ultimo: n }, { merge: true });
    return n;
  });
  const id = `P-${String(nro).padStart(8, '0')}`;
  const cond = Number(p.receptor?.condicionIva ?? COND_IVA.CF);
  const n = String(p.receptor?.docNro || '').replace(/\D/g, '');
  const pres = {
    id, estado: 'presupuesto', cbteTipo: 0, ptoVta: 0, nro, fecha: fechaArca(),
    receptor: { nombre: p.receptor?.nombre || 'Consumidor Final', domicilio: p.receptor?.domicilio || '', email: p.receptor?.email || '', DocTipo: n.length === 11 ? 80 : n ? 96 : 99, DocNro: Number(n || 0), condicionIva: cond },
    items: imp.lineas, iva: imp.Iva, neto: imp.ImpNeto, ivaTotal: imp.ImpIVA, total: imp.ImpTotal,
    condicionVenta: p.condicionVenta || 'Contado', observaciones: p.observaciones || '', validez: p.validez || '7 días',
    usuario: p.usuario || '', creado: new Date().toISOString(),
  };
  await setDoc(doc(db, 'comprobantes', id), pres);
  return pres;
}
