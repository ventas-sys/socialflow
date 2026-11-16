import React, { useState } from 'react'
import { auth } from '../firebase'

// 🧾 Facturación directa a ARCA (sin Contabilium). Solo admin, solo PC.
// Paso 1: probar la conexión con ARCA sin emitir nada.
async function llamarArca(action, body) {
  const token = await auth.currentUser?.getIdToken()
  const r = await fetch('/api/arca?action=' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Firebase-Token': token || '' },
    body: JSON.stringify(body || {}),
  })
  const txt = await r.text()
  try { return JSON.parse(txt) } catch { return { ok: false, error: 'Respuesta inesperada (HTTP ' + r.status + '): ' + txt.slice(0, 200) } }
}

export default function Facturacion() {
  const [cargando, setCargando] = useState(false)
  const [res, setRes] = useState(null)

  const probar = async () => {
    setCargando(true); setRes(null)
    try { setRes(await llamarArca('estado')) } catch (e) { setRes({ ok: false, error: e.message }) }
    setCargando(false)
  }

  const srv = res?.servidores
  const okSrv = srv && srv.AppServer === 'OK' && srv.DbServer === 'OK' && srv.AuthServer === 'OK'

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: 16 }}>
      <h2>🧾 Facturación ARCA</h2>
      <p style={{ color: '#555' }}>
        BP IMPORT S.R.L. · punto de venta 12 (STOCK ML) · certificado <b>stockml</b>.
        Esta prueba <b>no emite nada</b>: solo pregunta a ARCA el último número de cada comprobante.
      </p>
      <button className="btn-primary" onClick={probar} disabled={cargando} style={{ padding: '10px 18px', fontSize: 16 }}>
        {cargando ? 'Consultando a ARCA…' : 'Probar conexión con ARCA'}
      </button>

      {res && !res.ok && (
        <div style={{ marginTop: 16, padding: 12, background: '#fde8e8', borderRadius: 8 }}>
          ❌ <b>No funcionó:</b> {res.error}
        </div>
      )}

      {res?.ok && (
        <div style={{ marginTop: 16 }}>
          <div style={{ padding: 12, background: okSrv ? '#e6f4ea' : '#fff4e5', borderRadius: 8, marginBottom: 12 }}>
            {okSrv ? '✅ Conectado con ARCA' : '⚠️ Conectó, pero ARCA informa servidores con problemas'} — ambiente <b>{res.ambiente}</b>, CUIT {res.cuit}, punto de venta {res.puntoDeVenta}
            {srv && <div style={{ fontSize: 13, color: '#555' }}>Servidores ARCA: app {srv.AppServer} · base {srv.DbServer} · login {srv.AuthServer}</div>}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Comprobante</th><th style={{ textAlign: 'right' }}>Último número emitido en el PV {res.puntoDeVenta}</th></tr></thead>
            <tbody>
              {Object.entries(res.ultimos || {}).map(([k, v]) => (
                <tr key={k}><td style={{ padding: 6, borderTop: '1px solid #eee' }}>{k}</td><td style={{ padding: 6, borderTop: '1px solid #eee', textAlign: 'right' }}>{String(v)}</td></tr>
              ))}
            </tbody>
          </table>
          <details style={{ marginTop: 12 }}>
            <summary>Puntos de venta habilitados para web services</summary>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(res.puntosDeVentaWebServices, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  )
}
