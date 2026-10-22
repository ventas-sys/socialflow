// Mientras haya algo a medio hacer, la app NO se recarga sola para actualizarse.
//
// Pasó subiendo fotos desde el celular: tocar 📷 manda la PWA al fondo, y al
// volver con la foto se dispara el chequeo de versión. Si en el medio hubo un
// deploy, la app se recargaba ENCIMA del formulario abierto y se perdía la foto
// (y lo que estuviera cargado). Lo mismo con el escaneo del envío a Full.
//
// Es un contador, no un booleano: puede haber dos pantallas marcando trabajo a
// la vez y la que cierra primero no tiene que destrabar a la otra.
let abiertos = 0
const oyentes = new Set()

const avisar = () => oyentes.forEach(f => { try { f(abiertos > 0) } catch {} })

export const marcarTrabajo = () => { abiertos++; avisar() }
export const liberarTrabajo = () => { abiertos = Math.max(0, abiertos - 1); avisar() }
export const hayTrabajoEnCurso = () => abiertos > 0
export const alCambiarTrabajo = (f) => { oyentes.add(f); return () => oyentes.delete(f) }

// Azúcar para usar desde un componente: marca mientras `activo` sea true.
export const usarTrabajoEnCurso = (React, activo) => {
  React.useEffect(() => {
    if (!activo) return
    marcarTrabajo()
    return liberarTrabajo
  }, [activo])
}
