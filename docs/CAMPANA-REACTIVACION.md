# Campaña de reactivación de clientes viejos (PENDIENTE)

**Estado:** pospuesta el 12/8/2026. Recordatorio en Google Calendar (ventas@distribuidorauniverso.com) para el **1/9/2026**.

## La idea
El cliente tiene listas de contactos de otros celulares (agendados y sin agendar), muchos son ex-compradores que hace mucho no compran. Quiere mandarles un mensaje preguntando si quieren volver a comprar.

## Decisiones ya acordadas (12/8)
- **NO mandar desde el número del bot** (011-3551-0715): si WhatsApp lo banea se pierde el canal principal con 480+ clientes. El ban depende más de reportes/bloqueos de los destinatarios que de la velocidad de envío.
- Usar un **número aparte** (chip nuevo/secundario), calentarlo unos días con uso normal.
- **Tandas chicas: 30–50 por día** (no por hora), horarios repartidos.
- **Mensaje personalizado** con nombre + frase de salida ("si no querés recibir novedades, respondé NO y listo").
- **Solo ex-clientes reales** (que compraron alguna vez), no números fríos.
- A quien no responde, **no se le insiste**.
- Alternativa seria si se quiere hacer recurrente: WhatsApp Business API (Meta) con plantillas aprobadas (sin riesgo de ban, costo por mensaje).

## Para retomar hace falta
1. Confirmar el número aparte disponible.
2. La lista de contactos (CSV/Excel/export del celular) con nombre + teléfono.
3. Definir el texto base del mensaje.

## Contexto técnico relacionado (ya resuelto)
- El bot agenda automáticamente clientes/mayoristas/proveedores en Google Contactos de **ventas@uniproveedores.com.ar** (PRs #107–#110).
- Chats con formato viejo (`@c.us`): se agendan con teléfono real.
- Chats con formato nuevo (`@lid`): WhatsApp oculta el número al bot (confirmado `hasStore:false`, sin vía en whatsapp-web.js 1.27); se agendan sin número, con nota para completarlo desde el celular. Dedup persistente por chatId en `bridge/.state.json` (`agendadosGoogle`).
