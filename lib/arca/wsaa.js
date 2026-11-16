// WSAA: login con el certificado de BP IMPORT S.R.L. Devuelve { token, sign, expira }.
// El ticket dura 12 h y ARCA NO da otro mientras el anterior siga vigente, así que
// se guarda (cache.get / cache.set) y se reutiliza entre llamadas.
import forge from 'node-forge';
import { XMLParser } from 'fast-xml-parser';
import { postXml } from './http.js';

export const WSAA_URL = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};
const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

export function buildTRA(service = 'wsfe', now = new Date()) {
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, '-00:00');
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId><generationTime>${iso(new Date(now - 600000))}</generationTime><expirationTime>${iso(new Date(+now + 600000))}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
}

export function signTRA(tra, certPem, keyPem) {
  const cert = forge.pki.certificateFromPem(certPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(keyPem), certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

export function parseLogin(xml) {
  const body = parser.parse(xml).Envelope?.Body;
  if (body?.Fault) {
    const e = new Error('WSAA: ' + (body.Fault.faultstring || JSON.stringify(body.Fault)));
    e.code = String(body.Fault.faultcode || '');
    throw e;
  }
  const t = parser.parse(body.loginCmsResponse.loginCmsReturn).loginTicketResponse;
  return { token: t.credentials.token, sign: t.credentials.sign, expira: t.header.expirationTime };
}

export async function credenciales({ ambiente, certPem, keyPem, cache, service = 'wsfe' }) {
  const prev = await cache.get();
  if (prev?.token && prev.ambiente === ambiente && new Date(prev.expira).getTime() - Date.now() > 10 * 60000) return prev;
  const cms = signTRA(buildTRA(service), certPem, keyPem);
  const r = await postXml(WSAA_URL[ambiente], '',
    `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`);
  const cred = { ...parseLogin(r.text), ambiente };
  await cache.set(cred);
  return cred;
}
