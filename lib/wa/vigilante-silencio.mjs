// ─── Vigilante del silencio: "hace 3 horas que no le contesto a nadie" ──────
//
// Pedido de Rodo el 10-oct-2026, después de que el bot estuviera 12 horas mudo
// sin que nadie se enterara: "que me avise si se pasa más de 3hs sin responder".
//
// Es un aviso distinto al del navegador colgado (vigilante-navegador.mjs). Ese
// detecta que el bot se murió y lo reinicia. Éste detecta algo más amplio: el
// bot está VIVO pero no le contesta a nadie. Puede ser la IA caída, el webhook
// que no responde, o cualquier cosa que todavía no vimos. No lo arregla: avisa.
//
// ⚠️ EL RELOJ SOLO CORRE CON EL LOCAL ABIERTO. De noche el bot no contesta
// porque no escribe nadie, no porque esté roto: si el reloj corriera siempre,
// el aviso saltaría todas las mañanas y en dos días Rodo lo ignoraría. Mientras
// está cerrado, la cuenta se reinicia sola; arranca de cero en la apertura.
//
// Avisa UNA vez y no vuelve a insistir hasta pasado el enfriamiento: un bot
// roto a las 13:00 no tiene que mandar un mensaje cada quince minutos.

const HORA = 3_600_000;

export function crearVigilanteSilencio({
  horasMax = 3,
  horasEnfriamiento = 3,
  estaAbierto,
  avisar,
  ahora = () => Date.now(),
} = {}) {
  if (typeof estaAbierto !== 'function') throw new Error('crearVigilanteSilencio necesita estaAbierto()');
  if (typeof avisar !== 'function') throw new Error('crearVigilanteSilencio necesita avisar()');

  let desde = ahora();      // desde cuándo cuenta el silencio
  let ultimoAviso = 0;

  return {
    // El bot le contestó a alguien: el reloj vuelve a cero.
    respondio(t = ahora()) {
      desde = t;
    },

    // Lo llama un intervalo. Devuelve qué pasó, para el log y las pruebas.
    revisar(t = ahora()) {
      if (!estaAbierto()) {
        // Cerrado: que no conteste es lo esperado. La cuenta se reinicia sola,
        // así que en la apertura arranca de cero y no hereda la noche entera.
        desde = t;
        return 'cerrado';
      }
      const silencioMs = t - desde;
      if (silencioMs < horasMax * HORA) return 'ok';
      if (t - ultimoAviso < horasEnfriamiento * HORA) return 'ya avisado';
      ultimoAviso = t;
      avisar(Math.round(silencioMs / 60_000));
      return 'avisado';
    },

    // Para el diagnóstico y las pruebas.
    silencioMinutos(t = ahora()) { return Math.round((t - desde) / 60_000); },
  };
}
