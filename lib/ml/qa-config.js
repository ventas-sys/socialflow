// Configuración del Agente de Preguntas de Mercado Libre.
// Datos del negocio + carga de las cuentas desde variable de entorno.

export const NEGOCIO = {
  nombre: 'Uniproveedores',
  agente: 'Tatiana',                 // nombre con el que responde la IA
  firma: 'Uniproveedores',           // con qué firma cierra
  barrio: 'Floresta, CABA',          // referencia pública para el retiro
  direccion: 'Bacacay 4726, CABA',   // dirección exacta (para quien pasa a retirar)
  whatsapp: '011 3551-0715',
  // Retiro por el local: SOLO disponible en la cuenta LOCAL.
  horarios: 'de lunes a viernes de 14 a 17:30 y los sábados de 10 a 13',
};

// Mensaje que se manda 5 minutos después de que el envío queda ENTREGADO.
// Va por la mensajería post-venta de Mercado Libre. Placeholders: {agente},
// {negocio}, {producto}.
//
// ⚠️ NO agregar acá: pedidos de calificación POSITIVA, promesas de plata o
// premios a cambio de una reseña, ni links a redes/WhatsApp. Todo eso está
// prohibido por Mercado Libre (reseñas incentivadas + uso de datos del
// comprador) y hace caer la reputación de la cuenta. Las redes van en el
// folleto con QR adentro del paquete, que es un canal propio.
export const MENSAJE_POSTVENTA =
  '¡Hola! Soy {agente} de {negocio}. Vi que ya te llegó {producto}. ' +
  '¿Llegó todo bien? Si algo no salió como esperabas, escribime por acá y lo resolvemos enseguida. ' +
  'Cuando puedas, dejá tu opinión en la publicación: nos ayuda a mejorar y a que otros compradores se decidan. ' +
  '¡Gracias por elegirnos!';

// Catálogo público de cada cuenta (por CustId = user_id). Agregando una palabra
// filtra los productos, ej: https://listado.mercadolibre.com.ar/disco_CustId_46539072
// El agente arma este link solo con acc.user_id (ver catalogUrl en api/ml/questions.js).
//   LOCAL (46539072): https://listado.mercadolibre.com.ar/_CustId_46539072
//   FULL  (80460157): https://listado.mercadolibre.com.ar/_CustId_80460157

// Las cuentas se cargan desde la variable de entorno ML_ACCOUNTS (JSON).
// Formato (array):
// [
//   { "label":"full",  "mode":"full",  "user_id":123456,
//     "client_id":"...", "client_secret":"...", "refresh_token":"..." },
//   { "label":"local", "mode":"local", "user_id":789012,
//     "client_id":"...", "client_secret":"...", "refresh_token":"..." }
// ]
//   mode "full"  -> Envíos Full (sin retiro por local en esa publicación)
//   mode "local" -> Envío normal + retiro por el local
export function loadAccounts() {
  try {
    const arr = JSON.parse(process.env.ML_ACCOUNTS || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function findAccountByUser(accounts, userId) {
  return accounts.find(a => String(a.user_id) === String(userId)) || null;
}

export function findAccountByLabel(accounts, label) {
  return accounts.find(a => a.label === label) || null;
}

// La "otra" cuenta (para cross-account: buscar el mismo producto con retiro por local).
export function otherAccount(accounts, acc) {
  if (!acc) return null;
  return accounts.find(a => a.label !== acc.label) || null;
}
