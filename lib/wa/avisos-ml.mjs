// ─── Cuándo avisarle a Rodo de una pregunta de ML sin responder ─────────────
//
// Pedido de Rodo (13-oct-2026), después de que una pregunta quedara sin
// responder y el WhatsApp no llegara:
//
//   "Me tiene que avisar todo el día. De 10 a 17:30 que avise cada 5 min, pero
//    fuera de ese horario o fines de semana también tiene que avisar, con un
//    máximo de 15 min. Y si no respondí a los 30 min tiene que volver a
//    escribirme, y así cada 15 min hasta que no queden preguntas demoradas."
//
// Antes el aviso se callaba fuera de horario (el cliente de WhatsApp entiende
// que la ferretería esté cerrada) y después avisaba UNA vez y no insistía hasta
// las 3 horas. Pero una pregunta de Mercado Libre no espera a que abras: el que
// pregunta a las 21 le compra al que le contesta primero.
//
// El horario NO apaga el aviso: solo cambia cuánto se espera antes del primero.
//   - En horario: a los 12 min sin responder (lo que eligió Rodo).
//   - Fuera de horario: a los 10, para que con el ciclo de 5 min llegue SIEMPRE
//     dentro de los 15 que pidió como máximo.
//
// Y el recordatorio sigue una regla por EDAD de la pregunta, no por reloj:
//   1º aviso -> apenas pasa el umbral
//   2º aviso -> cuando cumple 30 min sin respuesta
//   3º en adelante -> cada 15 min, hasta que alguien la conteste
//
// "Hasta que no queden demoradas" sale solo: la API de ML devuelve únicamente
// las que siguen sin responder, así que al contestarla deja de aparecer.
//
// Vive en su propio archivo para probarlo sin esperar media hora de verdad.

const MIN = 60_000;

export const UMBRAL_EN_HORARIO_MIN = 12;
export const UMBRAL_FUERA_HORARIO_MIN = 10;
export const SEGUNDO_AVISO_MIN = 30;
export const REAVISO_MIN = 15;
// El ciclo corre cada ~5 min pero con jitter: sin tolerancia, un tick que llega
// 20s antes de tiempo se salta el aviso y el recordatorio sale 5 min tarde.
export const TOLERANCIA_MIN = 1;

export function umbralMinutos({ fueraDeHorario, enHorario = UMBRAL_EN_HORARIO_MIN, fuera = UMBRAL_FUERA_HORARIO_MIN }) {
  return fueraDeHorario ? fuera : enHorario;
}

// `atrasadas`: lo que devuelve ?action=atrasadas (cada una con question_id y
//              hace_minutos; las cuentas que fallaron vienen con `error`).
// `previos`:   Map question_id -> { at, edadMin } del último aviso de cada una.
// Devuelve qué avisar ahora y el Map ya actualizado (no muta el que recibe).
export function decidirAvisos({
  atrasadas,
  previos,
  ahora,
  segundoAvisoMin = SEGUNDO_AVISO_MIN,
  reavisoMin = REAVISO_MIN,
  toleranciaMin = TOLERANCIA_MIN,
}) {
  const lista = atrasadas || [];
  const nuevo = new Map(previos || []);
  const avisar = [];
  const vistas = new Set();

  for (const q of lista) {
    if (!q?.question_id) continue;
    const id = String(q.question_id);
    vistas.add(id);
    const edadMin = Number(q.hace_minutos) || 0;
    const prev = nuevo.get(id);

    let toca = false;
    if (!prev) {
      toca = true;                                         // primera vez que se la ve atrasada
    } else if (edadMin >= segundoAvisoMin) {
      const cruzo30 = prev.edadMin < segundoAvisoMin;      // el 2º aviso: justo al cumplir 30
      const pasoElCiclo = ahora - prev.at >= (reavisoMin - toleranciaMin) * MIN;
      toca = cruzo30 || pasoElCiclo;                       // del 3º en adelante: cada 15
    }

    if (toca) {
      avisar.push({ ...q, recordatorio: !!prev });
      nuevo.set(id, { at: ahora, edadMin });
    }
  }

  // Las que ya no aparecen se contestaron: se olvidan, así la memoria no crece.
  // PERO si alguna cuenta falló en esta consulta, sus preguntas tampoco aparecen
  // y no es porque se hayan contestado: borrarlas haría que al volver la cuenta
  // se las tratara como nuevas y se avisara de golpe un montón de repetidos.
  const algunaCuentaFallo = lista.some(q => q?.error);
  if (!algunaCuentaFallo) {
    for (const id of [...nuevo.keys()]) if (!vistas.has(id)) nuevo.delete(id);
  }

  return { avisar, previos: nuevo };
}

// ─── Para qué falló una consulta de red ─────────────────────────────────────
//
// 14-oct-2026: el log del bridge mostró "aviso preguntas ML fail: fetch failed"
// y no decía nada más. En Node, "fetch failed" es el mensaje GENÉRICO de
// cualquier error de red; el motivo de verdad (DNS que no resuelve, conexión
// rechazada, timeout, corte a mitad de camino) viene escondido en `e.cause`, y
// el bridge solo imprimía `e.message`. Quedaba sin poder distinguir un hipo de
// internet de una URL mal armada.
//
// Con varias direcciones por probar (IPv4 e IPv6) la causa puede venir envuelta
// en un AggregateError: en ese caso se mira el primer error de adentro.
export function describirError(e) {
  if (!e) return 's/d';
  const base = e.message || String(e);
  let causa = e.cause;
  if (!causa) return base;
  if (Array.isArray(causa.errors) && causa.errors.length) causa = causa.errors[0] || causa;
  const motivo = causa.code || causa.errno || causa.message || String(causa);
  const donde = causa.hostname || causa.address;
  return `${base} [causa: ${motivo}${donde ? ' en ' + donde : ''}]`;
}
