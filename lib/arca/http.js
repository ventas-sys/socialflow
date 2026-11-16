// POST SOAP a ARCA. Los servidores de ARCA usan parámetros TLS viejos (DH chico):
// Node 17+ los rechaza con "dh key too small" salvo que se baje el nivel de seguridad.
import https from 'https';

const agent = new https.Agent({ ciphers: 'DEFAULT@SECLEVEL=0', keepAlive: true });

export function postXml(url, soapAction, body, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST', agent,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: soapAction, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Timeout ARCA ' + timeoutMs / 1000 + 's')); });
    req.write(body);
    req.end();
  });
}
