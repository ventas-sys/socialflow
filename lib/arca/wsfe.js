// WSFEv1 — Factura electrónica (CAE) contra ARCA.
import { XMLParser } from "fast-xml-parser";
import { postXml } from "./http.js";

export const WSFE_URL = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};
const NS = "http://ar.gov.afip.dif.FEV1/";
const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, isArray: (n) => ["Err", "Obs", "Evt", "FECAEDetResponse", "PtoVenta"].includes(n) });

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (name, inner) => `<${name}>${inner}</${name}>`;

/** Serializa un objeto respetando el ORDEN de las claves (el .asmx de ARCA valida secuencia). */
function toXml(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (Array.isArray(v)) return v.map((x) => tag(k, typeof x === "object" ? toXml(x) : esc(x))).join("");
      if (typeof v === "object") return tag(k, toXml(v));
      return tag(k, esc(v));
    })
    .join("");
}

export class WSFE {
  constructor({ ambiente, cuit, credenciales }) {
    this.url = WSFE_URL[ambiente];
    this.cuit = cuit;
    this.cred = credenciales; // { token, sign }
  }

  auth() {
    return { Auth: { Token: this.cred.token, Sign: this.cred.sign, Cuit: this.cuit } };
  }

  async call(method, payload, timeoutMs = 45000) {
    const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method} xmlns="${NS}">${toXml(payload)}</${method}></soap:Body></soap:Envelope>`;
    const r = await postXml(this.url, `${NS}${method}`, body, timeoutMs);
    const env = parser.parse(r.text).Envelope?.Body;
    if (!env) throw new Error(`WSFE ${method}: respuesta inválida (HTTP ${r.status}) ${r.text.slice(0, 200)}`);
    if (env.Fault) throw new Error(`WSFE ${method}: ${env.Fault.faultstring}`);
    return env[`${method}Response`][`${method}Result`];
  }

  async dummy() {
    const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FEDummy xmlns="${NS}"/></soap:Body></soap:Envelope>`;
    const r = await postXml(this.url, `${NS}FEDummy`, body, 20000);
    return parser.parse(r.text).Envelope?.Body?.FEDummyResponse?.FEDummyResult || null;
  }

  static errores(r) {
    const e = r?.Errors?.Err || [];
    return e.map((x) => `${x.Code}: ${x.Msg}`);
  }

  async ultimoAutorizado(ptoVta, cbteTipo) {
    const r = await this.call("FECompUltimoAutorizado", { ...this.auth(), PtoVta: ptoVta, CbteTipo: cbteTipo });
    const errs = WSFE.errores(r);
    if (errs.length) throw new Error(errs.join(" | "));
    return Number(r.CbteNro);
  }

  async consultar(ptoVta, cbteTipo, nro) {
    const r = await this.call("FECompConsultar", { ...this.auth(), FeCompConsReq: { CbteTipo: cbteTipo, CbteNro: nro, PtoVta: ptoVta } });
    if (WSFE.errores(r).length) return null;
    return r.ResultGet;
  }

  async puntosDeVenta() {
    const r = await this.call("FEParamGetPtosVenta", this.auth());
    return r?.ResultGet?.PtoVenta || [];
  }

  /**
   * Pide CAE para UN comprobante. det = campos de FECAEDetRequest (sin CbteDesde/Hasta).
   * El orden de las claves importa: ver buildDet().
   */
  async solicitarCAE(ptoVta, cbteTipo, nro, det) {
    const r = await this.call("FECAESolicitar", {
      ...this.auth(),
      FeCAEReq: {
        FeCabReq: { CantReg: 1, PtoVta: ptoVta, CbteTipo: cbteTipo },
        FeDetReq: { FECAEDetRequest: buildDet(nro, det) },
      },
    });
    const d = r?.FeDetResp?.FECAEDetResponse?.[0] || {};
    const obs = (d.Observaciones?.Obs || []).map((o) => `${o.Code}: ${o.Msg}`);
    return {
      aprobado: d.Resultado === "A",
      cae: d.CAE || null,
      caeVto: d.CAEFchVto || null,
      errores: [...WSFE.errores(r), ...obs],
    };
  }
}

/** Arma FECAEDetRequest con el orden de elementos que exige el WSDL. */
export function buildDet(nro, d) {
  return {
    Concepto: d.Concepto ?? 1, // 1 = productos
    DocTipo: d.DocTipo,
    DocNro: d.DocNro,
    CbteDesde: nro,
    CbteHasta: nro,
    CbteFch: d.CbteFch,
    ImpTotal: d.ImpTotal.toFixed(2),
    ImpTotConc: "0.00",
    ImpNeto: d.ImpNeto.toFixed(2),
    ImpOpEx: "0.00",
    ImpTrib: "0.00",
    ImpIVA: d.ImpIVA.toFixed(2),
    MonId: "PES",
    MonCotiz: 1,
    CondicionIVAReceptorId: d.CondicionIVAReceptorId,
    CbtesAsoc: d.CbtesAsoc?.length ? { CbteAsoc: d.CbtesAsoc } : undefined,
    Iva: { AlicIva: d.Iva.map((a) => ({ Id: a.Id, BaseImp: a.BaseImp.toFixed(2), Importe: a.Importe.toFixed(2) })) },
  };
}

export { toXml };
