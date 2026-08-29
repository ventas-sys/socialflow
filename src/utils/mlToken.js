import { Timestamp } from 'firebase/firestore'

// Devuelve un access_token válido de una cuenta de ML, renovándolo con el
// refresh_token si está por vencer y guardando el nuevo en Firestore.
// Lo usan la solapa ML y la de Métricas.
export async function ensureMlToken(mlAccounts, key, onSaveAccount) {
  const acc = mlAccounts?.[key]
  if (!acc?.accessToken) throw new Error('La cuenta ' + key.toUpperCase() + ' no está conectada.')
  const expMs = acc.expiresAt?.toMillis ? acc.expiresAt.toMillis() : new Date(acc.expiresAt || 0).getTime()
  if (expMs && expMs - Date.now() > 5 * 60 * 1000) return acc.accessToken

  const r = await fetch('/api/ml/exchange?action=refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: acc.clientId, clientSecret: acc.clientSecret, refreshToken: acc.refreshToken }),
  }).then(x => x.json())
  if (!r.ok) throw new Error('No se pudo renovar el token: ' + (r.error || ''))

  const expiresAt = Timestamp.fromMillis(Date.now() + (r.expiresIn || 21600) * 1000)
  await onSaveAccount(key, { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt })
  return r.accessToken
}
