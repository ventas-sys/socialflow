// Optimizador del presupuesto de Product Ads.
//
// Dado el rendimiento de cada anuncio (el que sale del reporte "Anuncios →
// Estándar" de ML), decide a cuál sacarle presupuesto y a cuál ponerle, y
// devuelve la lista concreta de ajustes para cargar a mano en el panel.
//
// Rodo eligió que el sistema RECOMIENDE y él aplique (15-sep-2026): acá no se
// toca ninguna campaña, solo se calcula.
//
// Las reglas salieron de su realidad: financia la publicidad con un fondo de
// $X por producto vendido, así el producto publicitado no carga con todo el
// costo. Por eso el objetivo por defecto es REDISTRIBUIR sin gastar más.

export const REGLAS = {
  roasMalo: 3,        // por debajo, el anuncio se paga apenas a sí mismo
  roasEstrella: 10,   // a partir de acá conviene ponerle más
  clicsMinimos: 30,   // con menos, los números son ruido y no se decide nada
  subaMaxPct: 30,     // nunca subir más de esto por semana (el ROAS no escala infinito)
  recorteMaxPct: 60,  // tampoco cortar de golpe: puede haber estacionalidad
  roasNuncaPausar: 3, // nada con ROAS por encima se pausa automáticamente
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Normaliza una fila del reporte de ML a lo que necesita el optimizador.
export function normalizarAnuncio(a) {
  const inv = num(a.inversion ?? a.inv);
  const ing = num(a.ingresos ?? a.ing);
  return {
    id: String(a.id ?? a.item_id ?? ''),
    titulo: String(a.titulo ?? a.tit ?? ''),
    estado: String(a.estado ?? a.est ?? ''),
    clics: num(a.clics),
    ventas: num(a.ventas ?? a.ven),
    inversion: inv,
    ingresos: ing,
    // El ROAS del reporte puede venir vacío: lo recalculamos siempre.
    roas: inv > 0 ? ing / inv : 0,
  };
}

// Clasifica un anuncio. Devuelve { accion, motivo }.
export function clasificar(a, reglas = REGLAS) {
  if (a.inversion <= 0) return { accion: 'sin_gasto', motivo: 'No gastó en el período.' };
  if (a.clics < reglas.clicsMinimos) {
    return { accion: 'pocos_datos',
      motivo: `Solo ${a.clics} clic(s): son pocos para decidir. Dejar como está y volver a mirar la semana que viene.` };
  }
  if (a.ventas === 0) {
    return { accion: 'pausar',
      motivo: `${a.clics} clics y NINGUNA venta: está quemando plata. Pausar la pauta y revisar la publicación (precio, fotos, ficha).` };
  }
  if (a.roas < reglas.roasMalo) {
    return { accion: 'bajar',
      motivo: `ROAS ${a.roas.toFixed(1)}: por cada $1 vuelven menos de $${reglas.roasMalo}. Bajarle el presupuesto y mover esa plata a las que rinden.` };
  }
  if (a.roas >= reglas.roasEstrella) {
    return { accion: 'subir',
      motivo: `ROAS ${a.roas.toFixed(1)}: cada peso vuelve multiplicado. Conviene darle más.` };
  }
  return { accion: 'mantener', motivo: `ROAS ${a.roas.toFixed(1)}: rinde bien, dejar como está.` };
}

// Arma el plan de ajustes. `extraPct` permite además subir el gasto total
// (0 = redistribuir sin gastar un peso más, que es el arranque recomendado).
export function planSemanal(anuncios, opts = {}) {
  const reglas = { ...REGLAS, ...(opts.reglas || {}) };
  const extraPct = num(opts.extraPct);

  const lista = (anuncios || []).map(normalizarAnuncio).filter(a => a.id);
  const conGasto = lista.filter(a => a.inversion > 0);
  const gastoActual = conGasto.reduce((s, a) => s + a.inversion, 0);

  const items = conGasto.map(a => ({ ...a, ...clasificar(a, reglas) }));

  // 1) Cuánto se libera de las que no rinden.
  let liberado = 0;
  for (const it of items) {
    if (it.accion === 'pausar') {
      it.sugerido = 0;
      liberado += it.inversion;
    } else if (it.accion === 'bajar') {
      it.sugerido = Math.round(it.inversion * (1 - reglas.recorteMaxPct / 100));
      liberado += it.inversion - it.sugerido;
    }
  }
  // 2) Más lo que el dueño decida sumar de bolsillo.
  const extra = Math.round(gastoActual * extraPct / 100);
  let aRepartir = liberado + extra;

  // 3) Repartir entre las estrellas, proporcional al ROAS (la que más rinde
  //    se lleva más), respetando el tope de suba semanal.
  const estrellas = items.filter(i => i.accion === 'subir');
  const pesoTotal = estrellas.reduce((s, e) => s + e.roas, 0) || 1;
  let repartido = 0;
  for (const e of estrellas) {
    const techo = Math.round(e.inversion * reglas.subaMaxPct / 100);
    const cuota = Math.round(aRepartir * (e.roas / pesoTotal));
    const suba = Math.min(cuota, techo);
    e.sugerido = e.inversion + suba;
    repartido += suba;
  }
  for (const it of items) if (it.sugerido == null) it.sugerido = Math.round(it.inversion);

  // 4) Facturación estimada del movimiento: lo que se mueve pasa de rendir
  //    como rendía (origen) a rendir como las estrellas (destino).
  const roasOrigen = (() => {
    const o = items.filter(i => i.accion === 'pausar' || i.accion === 'bajar');
    const inv = o.reduce((s, x) => s + x.inversion, 0);
    return inv > 0 ? o.reduce((s, x) => s + x.ingresos, 0) / inv : 0;
  })();
  const roasDestino = estrellas.length
    ? estrellas.reduce((s, e) => s + e.ingresos, 0) / (estrellas.reduce((s, e) => s + e.inversion, 0) || 1)
    : 0;

  const gastoNuevo = items.reduce((s, i) => s + i.sugerido, 0);
  return {
    reglas,
    resumen: {
      anuncios_con_gasto: conGasto.length,
      gasto_actual: Math.round(gastoActual),
      gasto_sugerido: Math.round(gastoNuevo),
      liberado: Math.round(liberado),
      extra_agregado: extra,
      reasignado: Math.round(repartido),
      sin_reasignar: Math.round(aRepartir - repartido),
      roas_actual: gastoActual > 0 ? +(conGasto.reduce((s, a) => s + a.ingresos, 0) / gastoActual).toFixed(2) : 0,
      facturacion_estimada_extra: Math.round(repartido * (roasDestino - roasOrigen)),
    },
    ajustes: items
      .filter(i => i.sugerido !== Math.round(i.inversion))
      .sort((a, b) => Math.abs(b.sugerido - b.inversion) - Math.abs(a.sugerido - a.inversion)),
    sin_cambios: items.filter(i => i.sugerido === Math.round(i.inversion)),
  };
}

// Texto listo para mandar por WhatsApp o pegar donde sea.
export function planEnTexto(plan, titulo = 'Ajustes de publicidad') {
  const m = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  const L = [`📊 *${titulo}*`, ''];
  const baja = plan.ajustes.filter(a => a.sugerido < a.inversion);
  const sube = plan.ajustes.filter(a => a.sugerido > a.inversion);
  if (baja.length) {
    L.push('🔴 *BAJAR / PAUSAR*');
    for (const a of baja) {
      L.push(`  • ${a.titulo.slice(0, 44)}`);
      L.push(`    ${m(a.inversion)} → ${a.sugerido === 0 ? 'PAUSAR' : m(a.sugerido)}  (ROAS ${a.roas.toFixed(1)})`);
    }
    L.push('');
  }
  if (sube.length) {
    L.push('🟢 *SUBIR*');
    for (const a of sube) {
      L.push(`  • ${a.titulo.slice(0, 44)}`);
      L.push(`    ${m(a.inversion)} → ${m(a.sugerido)}  (ROAS ${a.roas.toFixed(1)})`);
    }
    L.push('');
  }
  const r = plan.resumen;
  L.push(`Gasto: ${m(r.gasto_actual)} → ${m(r.gasto_sugerido)}`);
  if (r.facturacion_estimada_extra > 0) L.push(`Facturación estimada extra: ${m(r.facturacion_estimada_extra)}`);
  if (r.sin_reasignar > 0) L.push(`⚠️ Quedaron ${m(r.sin_reasignar)} sin reasignar (tope de suba del ${plan.reglas.subaMaxPct}%).`);
  if (!plan.ajustes.length) L.push('✅ Sin cambios: todo está en su lugar esta semana.');
  return L.join('\n');
}
