// Agenda contactos en Google Contactos (People API) desde el bot de WhatsApp.
// Sin dependencias externas: usa https nativo.
//
// Requiere en el entorno (una sola cuenta de Google autorizada, ver panel):
//   GOOGLE_CONTACTS_CLIENT_ID
//   GOOGLE_CONTACTS_CLIENT_SECRET
//   GOOGLE_CONTACTS_REFRESH_TOKEN
// Si falta la config, agendarContacto() no hace nada (el bot sigue igual).
import https from 'node:https';

const GRUPOS = { cliente: 'Clientes', mayorista: 'Mayoristas', proveedor: 'Proveedores' };

function reqJson(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout google')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function cfg() {
  return {
    id: (process.env.GOOGLE_CONTACTS_CLIENT_ID || '').trim(),
    secret: (process.env.GOOGLE_CONTACTS_CLIENT_SECRET || '').trim(),
    refresh: (process.env.GOOGLE_CONTACTS_REFRESH_TOKEN || '').trim(),
  };
}

async function getToken() {
  const c = cfg();
  const body = new URLSearchParams({
    client_id: c.id, client_secret: c.secret,
    refresh_token: c.refresh, grant_type: 'refresh_token',
  }).toString();
  const r = await reqJson('POST', 'https://oauth2.googleapis.com/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
  if (!r.body?.access_token) throw new Error('token google: ' + JSON.stringify(r.body).slice(0, 150));
  return r.body.access_token;
}

const soloDigitos = s => String(s || '').replace(/\D/g, '');

// ¿Ya está agendado este teléfono? (evita duplicados)
async function yaAgendado(token, phone) {
  const q = encodeURIComponent(soloDigitos(phone).slice(-8)); // últimos 8 dígitos
  const r = await reqJson('GET',
    `https://people.googleapis.com/v1/people:searchContacts?query=${q}&readMask=phoneNumbers&pageSize=10`,
    { Authorization: 'Bearer ' + token });
  const results = r.body?.results || [];
  const target = soloDigitos(phone).slice(-8);
  return results.some(x => (x.person?.phoneNumbers || [])
    .some(p => soloDigitos(p.value).slice(-8) === target));
}

// Busca (o crea) el grupo/etiqueta y devuelve { resourceName, memberCount }.
async function getGrupo(token, nombre) {
  const list = await reqJson('GET',
    'https://people.googleapis.com/v1/contactGroups?pageSize=200',
    { Authorization: 'Bearer ' + token });
  let g = (list.body?.contactGroups || []).find(x => x.name === nombre);
  if (!g) {
    const c = await reqJson('POST', 'https://people.googleapis.com/v1/contactGroups',
      { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      { contactGroup: { name: nombre } });
    g = c.body;
  }
  // Releer para tener el memberCount fresco.
  const got = await reqJson('GET',
    `https://people.googleapis.com/v1/${g.resourceName}?maxMembers=0`,
    { Authorization: 'Bearer ' + token });
  return { resourceName: g.resourceName, memberCount: got.body?.memberCount || 0 };
}

function nombreAgenda(categoria, nombre, n) {
  const nn = String(n).padStart(2, '0');
  if (categoria === 'mayorista') return `${nombre || 'Mayorista'} x Mayor ${nn}`;
  if (categoria === 'proveedor') return `${nombre || 'Proveedor'} - Proveedor ${nn} (atendido)`;
  return nombre ? `${nombre} - Cliente ${nn}` : `Cliente ${nn}`;
}

// Punto de entrada: agenda el contacto según su categoría. No lanza (loguea y sigue).
export async function agendarContacto({ categoria, nombre, cuit, compra, phone }) {
  const c = cfg();
  if (!c.id || !c.secret || !c.refresh) return { skipped: 'sin config google' };
  if (!phone) return { skipped: 'sin telefono' };
  const cat = ['cliente', 'mayorista', 'proveedor'].includes(categoria) ? categoria : 'cliente';
  try {
    const token = await getToken();
    if (await yaAgendado(token, phone)) return { skipped: 'ya agendado' };

    const grupo = await getGrupo(token, GRUPOS[cat]);
    const displayName = nombreAgenda(cat, nombre, grupo.memberCount + 1);

    const notas = [
      `Categoría: ${cat}`,
      cuit ? `CUIT: ${cuit}` : null,
      compra ? `Compra: ${compra}` : null,
      `WhatsApp: ${phone}`,
      'Agendado por Tatiana (bot).',
    ].filter(Boolean).join('\n');

    const created = await reqJson('POST',
      'https://people.googleapis.com/v1/people:createContact',
      { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      {
        names: [{ unstructuredName: displayName }],
        phoneNumbers: [{ value: phone }],
        biographies: [{ value: notas, contentType: 'TEXT_PLAIN' }],
      });
    const personResource = created.body?.resourceName;
    if (!personResource) return { error: 'no se creó: ' + JSON.stringify(created.body).slice(0, 150) };

    // Agregar al grupo/etiqueta.
    await reqJson('POST',
      `https://people.googleapis.com/v1/${grupo.resourceName}/members:modify`,
      { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      { resourceNamesToAdd: [personResource] });

    return { ok: true, categoria: cat, nombre: displayName };
  } catch (e) {
    return { error: e.message };
  }
}
