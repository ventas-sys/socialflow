#!/usr/bin/env node
// Calcula el "Precio de lista" de UNA publicación puntual de Mercado Libre
// y lo compara con el que tiene cargado hoy. Solo lectura: ML no deja
// escribir el precio de lista por API (ver getListPrice en lib/ml/ml-api.js).
//
// Uso:
//   node scripts/ml-preview-list-price.mjs <item_id> [account_label]
//
// Ej: node scripts/ml-preview-list-price.mjs MLA1108642079
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dotenv solo está instalado en mcp-ml/. Si no está (ej: sesión en la nube),
// seguimos con las variables que ya trae el entorno.
try {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: path.join(__dirname, '../mcp-ml/.env') });
} catch {}

const { loadAccounts, findAccountByLabel } = await import('../lib/ml/qa-config.js');
const { getAccessToken, getItem, getListPrice } = await import('../lib/ml/ml-api.js');
const { computeListPrice } = await import('../lib/ml/pricing.js');

const args = process.argv.slice(2);
const [itemId, label] = args.filter(a => !a.startsWith('--'));

if (!itemId) {
  console.error('Uso: node scripts/ml-preview-list-price.mjs <item_id> [account_label]');
  process.exit(1);
}

const accounts = loadAccounts();
if (!accounts.length) {
  console.error('No hay cuentas en ML_ACCOUNTS (revisá que mcp-ml/.env esté creado y completo).');
  process.exit(1);
}
const acc = label ? findAccountByLabel(accounts, label) : accounts[0];
if (!acc) {
  console.error(`No existe la cuenta "${label}". Disponibles: ${accounts.map(a => a.label).join(', ')}`);
  process.exit(1);
}

const token = await getAccessToken(acc);
const item = await getItem(token, itemId);
if (!item?.price) {
  console.error('No se pudo leer el precio de ' + itemId + ': ' + JSON.stringify(item).slice(0, 300));
  process.exit(1);
}

const { original_price, off } = computeListPrice(item.price);
console.log(`Cuenta: ${acc.label}`);
console.log(`Publicación: ${item.title}`);
console.log(`Precio actual: $${item.price}`);
console.log(`Precio de lista propuesto: $${original_price} (${(off * 100).toFixed(1)}% OFF)`);

const actual = await getListPrice(token, itemId);
console.log(`Precio de lista cargado hoy: ${actual ? '$' + actual : 'ninguno'}`);
if (args.includes('--apply')) {
  console.error('\n--apply ya no existe: ML no permite cargar el precio de lista por API. No se escribió nada.');
  process.exit(1);
}
console.log('\n(solo vista previa — no se escribió nada en ML)');
