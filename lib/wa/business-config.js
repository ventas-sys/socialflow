// ============================================================================
//  CONFIG EDITABLE del Agente WhatsApp de Uniproveedores
//  Todo lo que cambia seguido vive acá. Editá este archivo y listo.
// ============================================================================

// --- Tienda de Mercado Libre ---------------------------------------------
export const STORE = {
  slug: 'arbetter-by-uniproveedores',
  // Link de la tienda filtrado por palabra clave (ej: "tapon", "mosqueton").
  // Formato verificado que SÍ filtra dentro de la tienda:
  //   https://listado.mercadolibre.com.ar/<keyword>_Tienda_<slug>
  // La palabra va adelante del "_Tienda_". Espacios -> guiones.
  searchUrl(keyword) {
    const kw = String(keyword || '')
      .trim()
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca acentos
      .replace(/[^a-z0-9\s-]/g, '')                     // limpia símbolos
      .replace(/\s+/g, '-');                            // espacios -> guiones
    return `https://listado.mercadolibre.com.ar/${kw}_Tienda_${this.slug}`;
  },
};

// --- LISTA MAYORISTA (⚠️ SE ACTUALIZA CADA MES) --------------------------
// Cuando cambie la lista, pegá acá el nuevo link del Drive y mantené el mensaje.
export const MAYORISTA = {
  driveUrl: 'https://drive.google.com/file/d/1LHYFl9XE-t77zKPTe_MVAi3-IWkcwQKu/view?usp=sharing',
  // Mes/versión de la lista, para acordarse de actualizar.
  vigencia: '2026-06',
  descuentos:
    `Sobre estos precios de *LISTA MAYORISTA*:\n` +
    `• Te podemos hacer *-20%*\n` +
    `• *-7%* adicional por bulto cerrado\n` +
    `• Y si necesitás factura *+10%*\n\n` +
    `_Recordá: el mínimo son 50mil pesos o un volumen de unidades acorde_ 🤓`,
};

// --- Templates de respuesta ----------------------------------------------
export const TEMPLATES = {
  // Caso producto: el cliente pregunta por un artículo (ej "tapón del termo").
  // keyword = palabra que la IA extrajo (ej "tapon"). url = link de la tienda.
  producto(keyword, url) {
    return (
      `🔎 Te dejo el link con todo lo que tenemos en *${keyword}* por menor, para retirar HOY mismo de nuestro depósito en Floresta:\n` +
      `${url}\n\n` +
      `Te recomiendo comprarlo desde el link *con retiro*, así te queda separado 🙌\n` +
      `Al ser depósito también sale por otros canales de venta al mismo tiempo, y puede que pases sin avisar y justo no quede.`
    );
  },

  // Caso reclamo de compra de ML: primero pedimos datos.
  reclamoPedido:
    `Uy, ¡perdón por el inconveniente! 🙏 Para resolverlo lo más rápido posible necesito que me mandes:\n\n` +
    `📦 Una foto del *paquete* como te llegó\n` +
    `🛍️ Una foto de los *productos*\n` +
    `👤 Tu *usuario de Mercado Libre*\n\n` +
    `Con eso ya lo dejo agendado y un compañero te resuelve 🙌`,

  // A los ~10 segundos del mensaje anterior, mandamos cómo encontrar el usuario.
  reclamoComoVerUsuario:
    `👤 *¿Cómo encontrar tu usuario de Mercado Libre?*\n\n` +
    `📱 *Desde la app:*\n` +
    `1️⃣ Abrí Mercado Libre\n` +
    `2️⃣ Tocá el menú ☰ (arriba a la izquierda)\n` +
    `3️⃣ Tocá tu nombre y foto → *Mi perfil*\n` +
    `4️⃣ Ahí ves tu *apodo*: ese es tu usuario ✅\n\n` +
    `💻 *Desde la compu:*\n` +
    `1️⃣ Entrá a tu cuenta\n` +
    `2️⃣ Pasá el mouse por tu nombre (arriba a la izquierda)\n` +
    `3️⃣ Hacé clic en *Mi perfil*\n` +
    `4️⃣ Tu usuario aparece en tus datos 📋`,

  // Si el cliente manda un MAIL en vez del usuario, lo reencauzamos con cariño.
  reclamoInsistirUsuario:
    `¡Gracias! 🙏 Para encontrar tu compra al toque lo más rápido es con tu *usuario de Mercado Libre* (el apodo), no el mail. ` +
    `Como tenemos muchas ventas, con el usuario lo ubicamos sin error 🙌 ¿Me lo pasás?`,

  // Cuando el cliente ya mandó la foto + su usuario/nombre: confirmación cálida.
  reclamoConfirmacion:
    `¡Gracias! 🙌 Le paso toda la info a mi supervisor y lo solucionamos lo más rápido posible. ` +
    `Y si me demoro, te prometo unos billetitos por las molestias 🤑🙏`,
};

// --- Recordatorio post-contacto (lo dispara el bridge a los 5 días) -------
export const RECORDATORIO = {
  diasDespues: 5,
  mensaje:
    `¡Hola! 👋 Te paso una promo que tenemos esta semana, miralá en nuestros *estados de WhatsApp* y en el *canal* 📲🔥\n\n` +
    `Y si todavía no nos calificaste en *Mercado Libre* o *Google*: te regalamos hasta *$5.000 por transferencia* solo por dejar tu calificación ⭐\n\n` +
    `Y si hacés un *video de 30 segundos* usando el producto para Instagram, te *triplicamos* el valor 🎬 ¡Podés ganar hasta *$20.000 en 1 minuto*! 🤑`,
};

// --- Datos fijos del negocio (para respuestas directas de la IA) ----------
export const NEGOCIO = {
  nombre: 'Uniproveedores',
  direccion: 'Bacacay 4726, Floresta, CABA',
  horarios: 'Lunes a Viernes 14 a 17:30 hs · Sábados 10 a 12:30 hs · Domingos y feriados cerrado',
  tiendaML: 'https://www.mercadolibre.com.ar/tienda/arbetter-by-uniproveedores',
  web: 'https://uniproveedores.com.ar/',
};
