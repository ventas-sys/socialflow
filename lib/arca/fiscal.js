// Reglas fiscales puras (sin red) — se testean solas. Emisor: SRL Responsable Inscripto.

export const CBTE = { FA: 1, NDA: 2, NCA: 3, FB: 6, NDB: 7, NCB: 8 };
export const NC_DE = { 1: 3, 6: 8 }; // factura → su nota de crédito
export const DOC = { CUIT: 80, CUIL: 86, DNI: 96, SIN_ID: 99 };
// Condición IVA del receptor (campo obligatorio CondicionIVAReceptorId, RG 5616)
export const COND_IVA = { RI: 1, EXENTO: 4, CF: 5, MONOTRIBUTO: 6, NO_CATEGORIZADO: 7, MONOTRIBUTO_SOCIAL: 13, IVA_NO_ALCANZADO: 15 };
// Alícuotas de IVA → Id ARCA
export const ALIC_ID = { 0: 3, 10.5: 4, 21: 5, 27: 6, 5: 8, 2.5: 9 };

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Letra del comprobante para emisor RI.
 * RI o Monotributo → A (RG 5003). CF, exento, no categorizado → B.
 */
export function tipoFactura(condicionReceptor) {
  return [COND_IVA.RI, COND_IVA.MONOTRIBUTO, COND_IVA.MONOTRIBUTO_SOCIAL].includes(condicionReceptor) ? CBTE.FA : CBTE.FB;
}

/**
 * Normaliza documento del comprador. Una A exige CUIT: si el comprador es RI y vino DNI/CUIL
 * se rechaza (es el error clásico que termina en B por error).
 */
export function documentoReceptor({ tipo, numero }, condicionReceptor) {
  const n = String(numero || "").replace(/\D/g, "");
  const t = String(tipo || "").toUpperCase();
  if (!n) return { DocTipo: DOC.SIN_ID, DocNro: 0 };
  if (t === "CUIT" || (n.length === 11 && t !== "CUIL")) {
    if (!cuitValido(n)) throw new Error(`CUIT inválido: ${n}`);
    return { DocTipo: DOC.CUIT, DocNro: Number(n) };
  }
  if (tipoFactura(condicionReceptor) === CBTE.FA) throw new Error("Factura A requiere CUIT del comprador.");
  if (t === "CUIL") return { DocTipo: DOC.CUIL, DocNro: Number(n) };
  return { DocTipo: DOC.DNI, DocNro: Number(n) };
}

export function cuitValido(cuit) {
  const s = String(cuit).replace(/\D/g, "");
  if (s.length !== 11) return false;
  const m = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = m.reduce((a, f, i) => a + f * Number(s[i]), 0);
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(s[10]);
}

/**
 * Calcula importes a partir de ítems con PRECIO FINAL (IVA incluido), que es como vende ML.
 * items: [{ sku, descripcion, cantidad, precioFinal, iva }]
 * Devuelve neto, IVA por alícuota y total, cuadrados al centavo (ARCA exige que cierren).
 */
export function calcularImportes(items) {
  const porAlic = new Map();
  let total = 0;
  const lineas = items.map((it) => {
    const alic = Number(it.iva ?? 21);
    if (!(alic in ALIC_ID)) throw new Error(`Alícuota no válida: ${alic}`);
    const bruto = r2(it.cantidad * it.precioFinal);
    const neto = r2(bruto / (1 + alic / 100));
    const iva = r2(bruto - neto);
    const acc = porAlic.get(alic) || { BaseImp: 0, Importe: 0 };
    acc.BaseImp = r2(acc.BaseImp + neto);
    acc.Importe = r2(acc.Importe + iva);
    porAlic.set(alic, acc);
    total = r2(total + bruto);
    return { ...it, neto, ivaImporte: iva, subtotal: bruto };
  });
  const Iva = [...porAlic.entries()].map(([alic, v]) => ({ Id: ALIC_ID[alic], BaseImp: v.BaseImp, Importe: v.Importe }));
  const ImpNeto = r2(Iva.reduce((a, x) => a + x.BaseImp, 0));
  const ImpIVA = r2(Iva.reduce((a, x) => a + x.Importe, 0));
  return { lineas, Iva, ImpNeto, ImpIVA, ImpTotal: r2(ImpNeto + ImpIVA) };
}

export const fechaArca = (d = new Date()) => {
  // fecha en hora argentina (UTC-3) formato yyyymmdd
  const ar = new Date(d.getTime() - 3 * 3600 * 1000);
  return ar.toISOString().slice(0, 10).replace(/-/g, "");
};

/** URL del código QR obligatorio (RG 4291). */
export function urlQR({ fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, tipoDocRec, nroDocRec, cae }) {
  const data = {
    ver: 1,
    fecha: `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`,
    cuit: Number(cuit), ptoVta, tipoCmp, nroCmp, importe, moneda: "PES", ctz: 1,
    tipoDocRec, nroDocRec, tipoCodAut: "E", codAut: Number(cae),
  };
  return "https://www.afip.gob.ar/fe/qr/?p=" + Buffer.from(JSON.stringify(data)).toString("base64");
}
