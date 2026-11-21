// Quién puede usar las acciones de /api/ml/questions.
//
// Ese endpoint está FUERA del middleware (middleware.js) porque Mercado Libre
// le manda los avisos por POST y ML no sabe poner contraseña. El problema es
// que con eso quedaban abiertas TODAS las acciones: cualquiera que tuviera la
// dirección podía leer las preguntas de los clientes y las ventas por
// publicación (diag, conversion, log...) y, peor, publicar una respuesta o
// lanzar el barrido por POST (answer, sweep, postventa).
//
// Ahora toda acción pide una de estas dos credenciales:
//   - la contraseña del sitio (la misma del middleware, por Basic Auth): es la
//     que manda sola el navegador cuando el panel o un link se abren ya logueado;
//   - la key de los crons (?key=ML_SWEEP_KEY): la que usan bridge/ml-sweep.sh y
//     bridge/wa-bridge.mjs desde el VPS.
// Lo único que sigue abierto es el aviso de ML (POST con `resource`) y el
// health-check (GET sin acción): eso se decide en api/ml/questions.js.

import { createHash, timingSafeEqual } from 'crypto';

// Mismos usuarios que acepta middleware.js.
const USUARIOS = new Set(['uniproveedores', 'admin', '']);

// Comparación en tiempo constante: no deja adivinar la clave midiendo demoras.
function igual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function accesoPermitido(req) {
  const password = process.env.SITE_PASSWORD || '';
  const key = (process.env.ML_SWEEP_KEY || '').trim();

  // Igual que el middleware: sin ninguna clave configurada el sitio entero es
  // público, así que acá tampoco se bloquea (si no, no se podría ni diagnosticar).
  if (!password && !key) return true;

  const dada = (req.query?.key || '').toString();
  if (key && dada && igual(dada, key)) return true;

  const auth = (req.headers?.authorization || '').toString();
  if (password && auth.startsWith('Basic ')) {
    let decoded = '';
    try { decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); } catch { decoded = ''; }
    const corte = decoded.indexOf(':');
    const user = corte >= 0 ? decoded.slice(0, corte) : decoded;
    const pass = corte >= 0 ? decoded.slice(corte + 1) : '';
    if (USUARIOS.has(user) && igual(pass, password)) return true;
  }
  return false;
}

// Respuesta 401. El WWW-Authenticate lleva el MISMO realm que el middleware:
// así el navegador que ya entró al sitio reintenta solo con la contraseña que
// tiene guardada, y el que no, muestra el cartel de siempre.
export function rechazar(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Uniproveedores Agencia", charset="UTF-8"');
  return res.status(401).json({
    error: 'Acceso restringido. Entrá con la contraseña del sitio o agregá &key=<ML_SWEEP_KEY>.',
  });
}
