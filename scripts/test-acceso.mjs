// Pruebas del candado de /api/ml/questions (lib/acceso.js). No tocan Mercado Libre:
// usa solo acciones que no salen a la red (test, webhook de un topic que se descarta).
// Correr: node scripts/test-acceso.mjs
import { pathToFileURL, fileURLToPath } from 'url';
const repo = fileURLToPath(new URL("..", import.meta.url));
process.env.SITE_PASSWORD = 'clave-de-prueba';
process.env.ML_SWEEP_KEY = 'key-de-prueba';
process.env.ML_ACCOUNTS = JSON.stringify([{ label: 'full', user_id: 1, refresh_token: 'x', client_id: '1', client_secret: 'x' }]);
const { default: handler } = await import(pathToFileURL(repo + 'api/ml/questions.js').href);

function basic(user, pass) { return 'Basic ' + Buffer.from(user + ':' + pass).toString('base64'); }
async function llamar({ method = 'GET', query = {}, body = undefined, headers = {} }) {
  const out = { status: 0, headers: {}, body: null };
  const res = {
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
    send(b) { out.body = b; return res; },
    end() { return res; },
  };
  await handler({ method, query, body, headers }, res);
  return out;
}

const casos = [
  ['GET sin accion (ping de ML)',            { }, 200],
  ['GET diag sin credencial',                { query: { action: 'diag' } }, 401],
  ['GET conversion sin credencial',          { query: { action: 'conversion' } }, 401],
  ['GET test sin credencial',                { query: { action: 'test' } }, 401],
  ['POST answer sin credencial',             { method: 'POST', query: { action: 'answer' }, body: { question_id: 1, autopost: true } }, 401],
  ['POST sweep sin credencial',              { method: 'POST', query: { action: 'sweep' }, body: {} }, 401],
  ['POST postventa sin credencial',          { method: 'POST', query: { action: 'postventa' }, body: {} }, 401],
  ['POST accion en el body sin credencial',  { method: 'POST', body: { action: 'log' } }, 401],
  ['POST answer disfrazado de aviso',        { method: 'POST', query: { action: 'answer' }, body: { resource: '/questions/1', question_id: 1 } }, 401],
  ['GET test con key mala',                  { query: { action: 'test', key: 'otra' } }, 401],
  ['GET test con contrasena mala',           { query: { action: 'test' }, headers: { authorization: basic('admin', 'mala') } }, 401],
  ['GET test con usuario no permitido',      { query: { action: 'test' }, headers: { authorization: basic('pepe', 'clave-de-prueba') } }, 401],
  ['GET test con key buena',                 { query: { action: 'test', key: 'key-de-prueba' } }, 200],
  ['GET test con contrasena (admin)',        { query: { action: 'test' }, headers: { authorization: basic('admin', 'clave-de-prueba') } }, 200],
  ['GET test con contrasena (sin usuario)',  { query: { action: 'test' }, headers: { authorization: basic('', 'clave-de-prueba') } }, 200],
  ['POST test con contrasena (panel)',       { method: 'POST', query: { action: 'test' }, body: {}, headers: { authorization: basic('uniproveedores', 'clave-de-prueba') } }, 200],
  ['POST aviso de ML (topic descartado)',    { method: 'POST', body: { resource: '/items/MLA1', user_id: 1, topic: 'items' } }, 200],
  ['POST ping de ML sin nada',               { method: 'POST', body: {} }, 200],
  ['OPTIONS',                                { method: 'OPTIONS' }, 200],
];
let mal = 0;
for (const [nombre, req, esperado] of casos) {
  const r = await llamar(req);
  const ok = r.status === esperado;
  if (!ok) mal++;
  console.log((ok ? 'OK  ' : 'MAL ') + nombre + ' -> ' + r.status + (ok ? '' : ' (esperaba ' + esperado + ') ' + JSON.stringify(r.body).slice(0, 120)));
}
// Sin ninguna clave configurada se comporta como el middleware: abierto.
delete process.env.SITE_PASSWORD; delete process.env.ML_SWEEP_KEY;
const libre = await llamar({ query: { action: 'test' } });
console.log((libre.status === 200 ? 'OK  ' : 'MAL ') + 'sin claves configuradas, test -> ' + libre.status);
if (libre.status !== 200) mal++;
// Solo con contraseña del sitio (sin key): un GET sin credencial no pasa.
process.env.SITE_PASSWORD = 'clave-de-prueba';
const soloPass = await llamar({ query: { action: 'test' } });
console.log((soloPass.status === 401 ? 'OK  ' : 'MAL ') + 'solo SITE_PASSWORD, test sin credencial -> ' + soloPass.status);
if (soloPass.status !== 401) mal++;
console.log(mal ? '\nFALLARON ' + mal : '\nTODO BIEN');
process.exit(mal ? 1 : 0);
