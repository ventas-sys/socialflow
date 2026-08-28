import React, { useState } from 'react'
import './Users.css'

// Sección SOLO PC y SOLO para el master (admin): alta/baja de ayudantes y
// permisos por solapa + permiso de modificar. Los cambios aplican cuando el
// ayudante recarga la app (o en su próximo ingreso).
export const PERM_TABS = [
  { key: 'dashboard', label: '📊 Dashboard' },
  { key: 'inventory', label: '🏭 Inventario' },
  { key: 'combos', label: '🧩 Combos' },
  { key: 'movements', label: '🔄 Movimientos' },
  { key: 'shipments', label: '🚚 Envíos' },
  { key: 'packing', label: '🗳️ Empaque' },
  { key: 'mercadolibre', label: '🛒 ML' }, // solo la ve el master — no se asigna a ayudantes
  { key: 'reports', label: '📈 Reportes' },
]

// Columnas del cuadro de permisos (ML queda afuera: es solo del master)
const GRID_TABS = PERM_TABS.filter(t => t.key !== 'mercadolibre')

export default function Users({ members, onAddMember, onRemoveMember, onUpdateMember, adminEmail }) {
  const [newEmail, setNewEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const handleAdd = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      await onAddMember(newEmail)
      setMsg(`✅ ${newEmail.trim().toLowerCase()} agregado. Ajustale los permisos abajo.`)
      setNewEmail('')
    } catch (err) {
      setMsg('❌ ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const tabOf = (m, key) => m.tabs?.[key] !== false
  const toggleTab = (m, key) => onUpdateMember(m.email, { tabs: { ...(m.tabs || {}), [key]: !tabOf(m, key) } })

  return (
    <div className="users-container">
      <div className="users-header">
        <h1>👥 Usuarios y permisos</h1>
        <p>
          Vos ({adminEmail}) sos el <strong>master</strong>: ves y modificás todo.
          Los ayudantes solo ven las solapas tildadas; sin "Puede modificar" no pueden
          crear/editar/borrar productos, combos ni movimientos (Envíos y Empaque siguen operativos).
        </p>
      </div>

      <form onSubmit={handleAdd} className="users-add">
        <input
          type="email"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          placeholder="email del ayudante (Gmail)"
          required
        />
        <button type="submit" disabled={busy}>{busy ? '⏳' : '+ Agregar ayudante'}</button>
      </form>
      {msg && <div className="users-msg">{msg}</div>}

      {members.length === 0 ? (
        <p className="users-empty">Todavía no hay ayudantes cargados.</p>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Ayudante</th>
                <th className="col-edit">✏️ Puede modificar</th>
                {GRID_TABS.map(t => <th key={t.key}>{t.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.email}>
                  <td className="users-email">{m.email}</td>
                  <td className="col-edit">
                    <input
                      type="checkbox"
                      checked={m.canEdit !== false}
                      onChange={() => onUpdateMember(m.email, { canEdit: m.canEdit === false })}
                    />
                  </td>
                  {GRID_TABS.map(t => (
                    <td key={t.key}>
                      <input type="checkbox" checked={tabOf(m, t.key)} onChange={() => toggleTab(m, t.key)} />
                    </td>
                  ))}
                  <td>
                    <button
                      className="users-del"
                      title="Quitar acceso"
                      onClick={() => { if (window.confirm(`¿Quitar el acceso de ${m.email}?`)) onRemoveMember(m.email) }}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
