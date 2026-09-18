import https from 'https';

export function httpRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        'Accept': 'application/json',
        ...(headers || {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch(e) { parsed = { raw: data.substring(0,500) }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout 20s')); });
    if (payload) req.write(payload);
    req.end();
  });
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Igual que httpRequest pero devuelve el cuerpo COMPLETO como texto, sin
// intentar parsearlo ni recortarlo. Hace falta para bajar los reportes CSV de
// Mercado Pago, que no son JSON y pueden pesar varios miles de líneas.
export function httpText(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        'Accept': '*/*',
        ...(headers || {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: data, tipo: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('Timeout 45s')); });
    if (payload) req.write(payload);
    req.end();
  });
}
