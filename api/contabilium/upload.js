import { httpRequest, cors } from '../_http.js';

async function getAccessToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  }).toString();
  const r = await httpRequest('POST', 'https://rest.contabilium.com/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  }, body);
  if (r.status !== 200 || !r.body?.access_token) {
    throw new Error(r.body?.error_description || ('Auth failed HTTP ' + r.status));
  }
  return r.body.access_token;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clientId, clientSecret, factura } = req.body || {};
  if (!clientId || !clientSecret) return res.status(400).json({ ok: false, error: 'Falta clientId/clientSecret' });
  if (!factura) return res.status(400).json({ ok: false, error: 'Falta factura' });

  try {
    const token = await getAccessToken(clientId, clientSecret);

    const tipoMap = {
      'Factura A': 'FacturaA',
      'Factura B': 'FacturaB',
      'Factura C': 'FacturaC',
      'Factura E': 'FacturaE',
      'Nota de Credito': 'NotaCreditoA',
      'Ticket': 'Ticket',
      'Recibo': 'Recibo'
    };

    const items = (factura.items || []).map(it => ({
      Concepto: it.descripcion || 'Item',
      Cantidad: Number(it.cantidad || 1),
      Subtotal: Number(it.subtotal || it.precioUnitario || 0),
      Iva: 21
    }));

    if (!items.length) {
      items.push({
        Concepto: factura.observaciones || 'Compra segun comprobante',
        Cantidad: 1,
        Subtotal: Number(factura.totales?.subtotal || factura.totales?.total || 0),
        Iva: 21
      });
    }

    const comprobante = {
      idProveedor: factura.proveedor?.idContabilium || null,
      ProveedorRazonSocial: factura.proveedor?.razonSocial || 'Sin razon social',
      ProveedorCuit: (factura.proveedor?.cuit || '').replace(/-/g, ''),
      Tipo: tipoMap[factura.tipoComprobante] || 'FacturaB',
      Numero: (factura.puntoVenta || '0001') + '-' + (factura.numeroComprobante || '00000001'),
      Fecha: factura.fechaEmision || new Date().toISOString().split('T')[0],
      Subtotal: Number(factura.totales?.subtotal || 0),
      Iva21: Number(factura.totales?.iva21 || 0),
      Iva105: Number(factura.totales?.iva105 || 0),
      Total: Number(factura.totales?.total || 0),
      Moneda: factura.moneda === 'USD' ? 'Dolar' : 'Pesos',
      Observaciones: 'Cargado por Agente Contabilidad Uniproveedores. ' + (factura.observaciones || ''),
      Items: items
    };

    const r = await httpRequest('POST', 'https://rest.contabilium.com/api/comprobantescompras', {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }, comprobante);

    if (r.status >= 400) {
      return res.status(200).json({
        ok: false,
        error: r.body?.Message || r.body?.message || r.body?.error_description || ('HTTP ' + r.status),
        details: r.body
      });
    }

    return res.status(200).json({
      ok: true,
      comprobanteId: r.body?.Id || r.body?.id,
      result: r.body
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
