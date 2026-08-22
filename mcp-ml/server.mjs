#!/usr/bin/env node
/**
 * Servidor MCP (stdio) de Mercado Libre para Uniproveedores.
 *
 * Le da a un asistente de IA acceso de LECTURA a los datos de ML de las
 * cuentas configuradas en ML_ACCOUNTS: info de producto, fotos, descripción,
 * reviews, preguntas, ventas/órdenes y métricas de visitas.
 *
 * IMPORTANTE: este proceso habla JSON-RPC por stdout. Nunca usar
 * console.log acá (rompe el framing del protocolo) - solo console.error
 * (va a stderr) para logs de diagnóstico.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { loadAccounts, findAccountByLabel } from '../lib/ml/qa-config.js';
import {
  getAccessToken,
  getItem,
  getUnanswered,
  getItemQuestions,
  getRecentQuestions,
  itemContext,
  getItemDescription,
  getReviews,
  searchMyItems,
  getOrders,
  getItemVisits,
  getUserItemsVisits,
  getShipment,
} from '../lib/ml/ml-api.js';

// ---------------------------------------------------------------------------
// Helpers de cuenta / token
// ---------------------------------------------------------------------------

// OJO: usa el MISMO store de tokens que el webhook de Vercel (lib/ml/token-store.js).
// ML rota el refresh_token en cada renovación, así que si este MCP renueva por su
// cuenta INVALIDA el refresh_token que usa el agente de preguntas en producción.
// Para que compartan el token, poné en mcp-ml/.env las mismas
// KV_REST_API_URL / KV_REST_API_TOKEN que tenés en Vercel.
async function tokenFor(acc) {
  try {
    return await getAccessToken(acc);
  } catch (err) {
    throw new Error(
      `No se pudo obtener un access_token para la cuenta "${acc.label || acc.user_id}": ${err.message || err}`
    );
  }
}

function resolveAccount(accounts, label) {
  if (!accounts || accounts.length === 0) {
    throw new Error(
      'No hay cuentas de Mercado Libre configuradas. Definí ML_ACCOUNTS en mcp-ml/.env ' +
      '(ver docs/SETUP-MCP-MERCADOLIBRE.md para el formato y cómo obtener las credenciales).'
    );
  }
  if (label) {
    const acc = findAccountByLabel(accounts, label);
    if (!acc) {
      const labels = accounts.map(a => a.label).join(', ');
      throw new Error(`No existe la cuenta "${label}". Cuentas disponibles: ${labels}`);
    }
    return acc;
  }
  if (accounts.length === 1) return accounts[0];
  const labels = accounts.map(a => a.label).join(', ');
  throw new Error(`Hay varias cuentas configuradas, especificá "account". Cuentas disponibles: ${labels}`);
}

// ---------------------------------------------------------------------------
// Definición de tools (JSON Schema plano - API low-level, sin zod)
// ---------------------------------------------------------------------------

const ACCOUNT_PROP = {
  account: {
    type: 'string',
    description: 'Label de la cuenta ML a usar (ver ml_list_accounts). Opcional si solo hay una cuenta configurada.',
  },
};

const TOOLS = [
  {
    name: 'ml_list_accounts',
    description: 'Lista las cuentas de Mercado Libre configuradas (label, modo, user_id). Nunca devuelve credenciales.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ml_get_item',
    description: 'Trae info de un producto/publicación de Mercado Libre: título, precio, stock, estado, fotos, atributos y variaciones.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'ID de la publicación, ej: MLA123456789' },
        ...ACCOUNT_PROP,
      },
      required: ['item_id'],
    },
  },
  {
    name: 'ml_get_item_description',
    description: 'Trae la descripción (texto plano) de una publicación de Mercado Libre.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'ID de la publicación, ej: MLA123456789' },
        ...ACCOUNT_PROP,
      },
      required: ['item_id'],
    },
  },
  {
    name: 'ml_get_item_reviews',
    description: 'Trae las reseñas/calificaciones (rating y comentarios) de una publicación de Mercado Libre.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'ID de la publicación, ej: MLA123456789' },
        ...ACCOUNT_PROP,
      },
      required: ['item_id'],
    },
  },
  {
    name: 'ml_search_my_items',
    description: 'Busca publicaciones propias del catálogo de una cuenta (por texto y/o estado) y devuelve un resumen de cada una. Nota: aunque `limit` acepte hasta 50, el detalle completo (título, precio, stock, etc.) se trae como máximo para las primeras 10 publicaciones encontradas.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ACCOUNT_PROP,
        q: { type: 'string', description: 'Texto de búsqueda (opcional).' },
        status: { type: 'string', description: 'Estado de la publicación: active, paused, closed, etc. (opcional).' },
        limit: { type: 'number', description: 'Cantidad máxima de resultados a devolver (default 10, máx 50). Nota: se traen detalles completos de a lo sumo 10 publicaciones por llamada, aunque limit sea mayor.' },
      },
    },
  },
  {
    name: 'ml_get_questions',
    description: 'Trae preguntas de comprador: de una publicación puntual, o de toda la cuenta (sin responder o recientes).',
    inputSchema: {
      type: 'object',
      properties: {
        ...ACCOUNT_PROP,
        item_id: { type: 'string', description: 'Si se especifica, trae solo las preguntas de esta publicación.' },
        only_unanswered: { type: 'boolean', description: 'Si es true (default), solo preguntas sin responder (ignorado si se pasa item_id).' },
        limit: { type: 'number', description: 'Cantidad máxima de preguntas a devolver (default 20).' },
      },
    },
  },
  {
    name: 'ml_get_orders',
    description: 'Trae órdenes/ventas de una cuenta en un rango de fechas, con el detalle de items e ingreso total.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ACCOUNT_PROP,
        from: { type: 'string', description: 'Fecha desde (ISO 8601), ej: 2026-07-01' },
        to: { type: 'string', description: 'Fecha hasta (ISO 8601), ej: 2026-07-31' },
        limit: { type: 'number', description: 'Cantidad máxima de órdenes a devolver (default 100).' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'ml_get_item_visits',
    description: 'Trae la serie temporal de visitas de una publicación.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'ID de la publicación, ej: MLA123456789' },
        ...ACCOUNT_PROP,
        last: { type: 'number', description: 'Cantidad de unidades hacia atrás (default 30).' },
        unit: { type: 'string', description: 'Unidad de tiempo: day, week, month (default day).' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'ml_get_account_visits',
    description: 'Trae las visitas agregadas de todas las publicaciones de una cuenta en un rango de fechas.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ACCOUNT_PROP,
        from: { type: 'string', description: 'Fecha desde (ISO 8601), ej: 2026-07-01' },
        to: { type: 'string', description: 'Fecha hasta (ISO 8601), ej: 2026-07-31' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'ml_get_shipment',
    description: 'Trae el detalle de un envío de Mercado Envíos por su ID.',
    inputSchema: {
      type: 'object',
      properties: {
        shipment_id: { type: 'string', description: 'ID del envío.' },
        ...ACCOUNT_PROP,
      },
      required: ['shipment_id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Implementación de cada tool
// ---------------------------------------------------------------------------

const handlers = {
  async ml_list_accounts() {
    const accounts = loadAccounts();
    return accounts.map(a => ({ label: a.label, mode: a.mode, user_id: a.user_id }));
  },

  async ml_get_item(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    const item = await getItem(token, args.item_id);
    const pictures = (item.pictures || []).map(p => p.secure_url || p.url).filter(Boolean);
    const attributes = (item.attributes || [])
      .filter(a => a.value_name)
      .map(a => ({ name: a.name, value: a.value_name }));
    const { envio, logistic_type, variantes, tieneColor } = itemContext(item);
    return {
      title: item.title,
      price: item.price,
      currency_id: item.currency_id,
      available_quantity: item.available_quantity,
      condition: item.condition,
      status: item.status,
      permalink: item.permalink,
      pictures,
      attributes,
      envio,
      logistic_type,
      variantes,
      tieneColor,
    };
  },

  async ml_get_item_description(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    const desc = await getItemDescription(token, args.item_id);
    return { plain_text: desc?.plain_text || '' };
  },

  async ml_get_item_reviews(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    const data = await getReviews(token, args.item_id);
    const reviews = (data?.reviews || []).map(r => ({
      rate: r.rate,
      title: r.title,
      comment: r.comment,
      date: r.date,
    }));
    return {
      rating_average: data?.rating_average,
      total_reviews: data?.paging?.total ?? reviews.length,
      reviews,
    };
  },

  async ml_search_my_items(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    const limit = Math.min(args.limit || 10, 50);
    const res = await searchMyItems(token, acc.user_id, { q: args.q, status: args.status, limit });
    const ids = (res.results || []).slice(0, Math.min(limit, 10));
    const items = await Promise.all(ids.map(id => getItem(token, id)));
    return {
      total: res.paging?.total ?? ids.length,
      items: items.map(item => ({
        id: item.id,
        title: item.title,
        price: item.price,
        available_quantity: item.available_quantity,
        status: item.status,
        permalink: item.permalink,
      })),
    };
  },

  async ml_get_questions(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    const limit = args.limit || 20;
    let res;
    if (args.item_id) {
      res = await getItemQuestions(token, args.item_id, limit);
    } else if (args.only_unanswered === false) {
      res = await getRecentQuestions(token, acc.user_id, limit);
    } else {
      res = await getUnanswered(token, acc.user_id, limit);
    }
    const questions = (res.questions || []).map(q => ({
      id: q.id,
      text: q.text,
      date_created: q.date_created,
      status: q.status,
      answer: q.answer?.text || null,
    }));
    return { questions };
  },

  async ml_get_orders(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    const limit = args.limit || 100;
    const orders = await getOrders(token, acc.user_id, args.from, args.to, limit);
    const total_revenue = Math.round(
      orders
        .filter(o => o.status !== 'cancelled' && o.status !== 'invalid')
        .reduce((sum, o) => sum + (o.total_amount || 0), 0) * 100
    ) / 100;
    return {
      count: orders.length,
      total_revenue,
      orders: orders.map(o => ({
        id: o.id,
        status: o.status,
        date_created: o.date_created,
        total_amount: o.total_amount,
        items: (o.order_items || []).map(oi => ({
          title: oi.item?.title,
          quantity: oi.quantity,
          unit_price: oi.unit_price,
        })),
      })),
    };
  },

  async ml_get_item_visits(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    return getItemVisits(token, args.item_id, args.last || 30, args.unit || 'day');
  },

  async ml_get_account_visits(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    return getUserItemsVisits(token, acc.user_id, args.from, args.to);
  },

  async ml_get_shipment(args) {
    const accounts = loadAccounts();
    const acc = resolveAccount(accounts, args.account);
    const token = await tokenFor(acc);
    return getShipment(token, args.shipment_id);
  },
};

// ---------------------------------------------------------------------------
// Servidor MCP
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'socialflow-mercadolibre', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];
  if (!handler) {
    return {
      content: [{ type: 'text', text: `Tool desconocida: ${name}` }],
      isError: true,
    };
  }
  try {
    const result = await handler(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: err?.message || String(err) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('socialflow-mercadolibre MCP server listo (stdio).');
