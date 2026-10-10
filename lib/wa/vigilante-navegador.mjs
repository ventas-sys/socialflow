// ─── Vigilante del navegador: detectar el bot zombi ─────────────────────────
//
// 9-oct-2026, 22:29. El bot dejó de contestar y NADIE se enteró hasta que al
// otro día un cliente reclamó por WhatsApp. pm2 lo veía perfecto: "online",
// 4 días de uptime, 0% de CPU. En el teléfono el dispositivo seguía vinculado.
// Pero en los logs, TODA llamada al navegador se vencía:
//
//     Runtime.callFunctionOn timed out. Increase the 'protocolTimeout'...
//
// El Chromium interno queda colgado: Node sigue vivo, los relojes siguen
// andando y cada tarea falla en silencio. El evento 'disconnected' —que ya
// hace process.exit(1) para que pm2 reviva el proceso— NUNCA se dispara, así
// que el bot se queda mudo para siempre.
//
// ⚠️ Subir `protocolTimeout`, que es lo que sugiere el propio error, NO
// arregla nada: el navegador no está lento, está colgado. Esperar más solo
// hace que falle más tarde. Lo que faltaba era admitir que se murió.
//
// Este vigilante cuenta fallos SEGUIDOS de una sonda (el recuperador, que ya
// le pide la lista de chats cada 60s). Al llegar al tope, el proceso se mata
// solo; pm2 lo levanta en segundos y, como la sesión está guardada en disco,
// vuelve sin pedir QR. Doce horas de silencio pasan a ser cinco minutos.
//
// Vive en su propio archivo para poder probarlo sin arrancar el bot entero.

export function crearVigilante({
  maxFallos = 5,
  alMorir,
  log = console.log,
  error = console.error,
} = {}) {
  if (typeof alMorir !== 'function') throw new Error('crearVigilante necesita alMorir()');
  let fallos = 0;
  let muerto = false;

  return {
    // Una llamada al navegador salió bien: la racha vuelve a cero.
    anduvo() {
      if (fallos > 0) {
        log(`🩹 el navegador volvió a responder (venía de ${fallos} fallo/s seguidos)`);
        fallos = 0;
      }
    },

    // Una llamada al navegador falló. Solo importa la RACHA: un fallo suelto
    // es normal (la librería viene frágil), muchos seguidos es un cuelgue.
    fallo(e) {
      if (muerto) return fallos;            // ya se pidió el reinicio, no insistir
      fallos++;
      if (fallos < maxFallos) return fallos;
      muerto = true;
      error(`💀 el navegador no responde hace ${fallos} intentos seguidos (${e?.message || 's/d'}). ` +
        'El bot está vivo pero mudo: me reinicio para que pm2 me levante con la sesión guardada.');
      alMorir();
      return fallos;
    },

    // Para el diagnóstico y las pruebas.
    get rachaDeFallos() { return fallos; },
  };
}
