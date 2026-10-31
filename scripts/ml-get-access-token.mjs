#!/usr/bin/env node
// Imprime un access_token de Mercado Libre válido para pegar en la variable
// ML_ACCESS_TOKEN (la usa el servidor MCP OFICIAL de ML, mcp.mercadolibre.com,
// registrado en .mcp.json como "mercadolibre-oficial").
//
// Usa el MISMO store compartido (KV) que el Agente de Preguntas y el MCP
// propio (mcp-ml/) a través de getAccessToken() en lib/ml/ml-api.js. Esto es
// IMPORTANTE: ML rota el refresh_token en cada renovación (es de un solo
// uso) — pedir el token de cualquier otra forma puede invalidar el que usa
// el Agente de Preguntas en producción (ver el aviso del 22-ago-2026 en
// docs/SETUP-MCP-MERCADOLIBRE.md).
//
// Uso: node scripts/ml-get-access-token.mjs [label]
//   Sin label, usa la primera cuenta configurada en ML_ACCOUNTS.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../mcp-ml/.env') });

const { loadAccounts, findAccountByLabel } = await import('../lib/ml/qa-config.js');
const { getAccessToken } = await import('../lib/ml/ml-api.js');

const label = process.argv[2];
const accounts = loadAccounts();
if (!accounts.length) {
  console.error('No hay cuentas en ML_ACCOUNTS (revisá que mcp-ml/.env esté creado y completo).');
  process.exit(1);
}
const acc = label ? findAccountByLabel(accounts, label) : accounts[0];
if (!acc) {
  console.error(`No existe la cuenta "${label}". Cuentas disponibles: ${accounts.map(a => a.label).join(', ')}`);
  process.exit(1);
}

const token = await getAccessToken(acc);
console.log(token);
console.error(`\n✅ Token de la cuenta "${acc.label}" listo (válido ~6 horas). Pegalo en ML_ACCESS_TOKEN y volvé a correr este comando cuando el MCP oficial deje de responder.`);
