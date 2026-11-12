// Ritmo de escritura de Tatiana en WhatsApp (pedido de Rodo, 12-nov-2026).
//
// Un mensaje que aparece al instante, de golpe y perfecto, se siente robótico.
// Acá se arma el "escribiendo…" como lo haría alguien tecleando: arranca a
// escribir un ratito, frena, y retoma hasta terminar. Cuánto tarda depende del
// largo del mensaje, y siempre cae entre MIN_MS y MAX_MS (5 a 15 segundos).
//
// Es solo RITMO: el mensaje que sale es el mismo. NO inventa ni afirma nada
// sobre quién escribe (ver la regla de honestidad en lib/wa/ia-guide.js).
// Decisión pura, sin red ni timers: se prueba con scripts/test-escritura.mjs.

export const MIN_MS = 5000;
export const MAX_MS = 15000;

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// Duración total del "escribiendo". `azar` es un número de 0 a 1 (inyectable
// para poder probar).
export function duracionTotal(largo, azar = Math.random()) {
  const base = 3500 + Math.min(Math.max(0, largo), 220) * 40;   // ~4 s un mensaje corto, ~12 s uno largo
  return Math.round(clamp(base + azar * 3000, MIN_MS, MAX_MS));
}

// Pasos: [{ escribiendo: true|false, ms }]. Siempre empieza escribiendo, hace
// una pausa y termina escribiendo; la suma da `total`.
export function planEscritura(total, azar = Math.random) {
  const t = clamp(Math.round(total), MIN_MS, MAX_MS);
  const primero = Math.round(1500 + azar() * 1500);   // "escribe 2 letras" (1,5 a 3 s)
  const pausa = Math.round(1500 + azar() * 2500);     // frena (1,5 a 4 s)
  const resto = t - primero - pausa;
  if (resto < 1500) {                                 // total muy corto: sin pausa larga
    const p = Math.max(800, t - primero - 1500);
    return [{ escribiendo: true, ms: primero }, { escribiendo: false, ms: p }, { escribiendo: true, ms: t - primero - p }];
  }
  return [{ escribiendo: true, ms: primero }, { escribiendo: false, ms: pausa }, { escribiendo: true, ms: resto }];
}
