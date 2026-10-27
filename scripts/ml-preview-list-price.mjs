#!/usr/bin/env node
// Calcula (y opcionalmente carga) el "Precio de lista" de UNA publicación
// puntual de Mercado Libre, para probar antes de aplicarlo en bloque.
//
// Uso:
//   node scripts/ml-preview-list-price.mjs <item_id> [account_label]
//     -> solo muestra el cálculo, no escribe nada en ML
//   node scripts/ml-preview-list-price.mjs <item_id> [account_label] --apply
//     -> además lo carga de verdad en la publicación
//
// Ej: node scripts/ml-preview-list-price.mjs MLA1108642079
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../mcp-ml/.env') });

const { loadAccounts, findAccountByLabel } = await import('../lib/ml/qa-config.js');
const { getAccessToken, getItem, setOriginalPrice } = await import('../lib/ml/ml-api.js');
const { computeListPrice } = await import('../lib/ml/pricing.js');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [itemId, label] = args.filter(a => !a.startsWith('--'));

if (!itemId) {
  console.error('Uso: node scripts/ml-preview-list-price.mjs <item_id> [account_label] [--apply]');
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

if (apply) {
  const res = await setOriginalPrice(token, itemId, original_price);
  console.log('\n✅ Aplicado en Mercado Libre.');
  console.log(JSON.stringify({ id: res.id, price: res.price, original_price: res.original_price }, null, 2));
} else {
  console.log('\n(vista previa — no se escribió nada. Agregá --apply al final para cargarlo de verdad)');
}
