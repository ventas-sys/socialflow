# CRM de preguntas (Mercado Libre + WhatsApp) — plan

**Estado: decidido, sin empezar.** Rodo lo pidió el 25-sep-2026 y se frenó
antes de escribir código para no mezclarlo con otras cosas en curso.

## Qué pidió

Métricas de las preguntas de ML (cuáles terminan en venta, las más
recurrentes, las publicaciones con más preguntas) y del WhatsApp (teléfono,
qué compra, cada cuánto pregunta, mayorista o minorista, si sigue las redes).

## Lo que YA está hecho y hay que reusar

`lib/ml/conversion.js` resuelve tres de las cuatro métricas de ML:

- **Preguntas que terminan en venta**: cruza cada pregunta con las órdenes del
  período.
- **Preguntas más recurrentes**: `clasificar()` con 16 categorías (medidas,
  compatibilidad, retiro, precio, stock, por mayor…) afinadas con 2.025
  preguntas reales de las dos cuentas.
- **Publicaciones con más preguntas**: agrupa por SKU y dice qué le falta a
  cada una.

**No hay que reescribir nada de eso.** Lo que le falta es memoria: hoy se
calcula en vivo pidiéndole los datos a ML en cada request, así que solo se ve
el período que la API deja consultar y no se pueden comparar meses.

## Lo que falta: persistencia

Hoy el almacenamiento es `lib/ml/token-store.js` — KV por REST (Vercel KV o
Upstash) con caída a memoria del proceso. Sirve para guardar un token; no para
acumular miles de preguntas y consultarlas por fecha o por SKU.

Del lado de WhatsApp el estado vive en `.state.json` en el VPS: ya tiene
`firstContactAt`, `lastActivityAt`, `knownContacts` e `histories` por contacto.
El dato está, falta acumularlo donde se pueda consultar.

**Esta es la etapa 1 y es la única que hay que hacer sí o sí**: sin ella, las
otras dos no existen.

## Lo que NO se va a poder

- **"Cuáles nos siguen en redes y no"**: no hay forma. Instagram y Facebook no
  dan la lista de seguidores cruzable con teléfonos; es justamente lo que
  bloquean por privacidad.
- **"Qué compra" por número de WhatsApp**: parcial. ML **no expone el teléfono
  del comprador**, así que un número de WhatsApp no se linkea solo con sus
  compras en ML. Sí se puede con las ventas directas que pasan por
  Contabilium, donde están los datos del cliente.

## Lo que sí, y cómo

- **Mayorista vs. minorista**: sale fácil. El bot ya detecta cuándo alguien
  pide la lista mayorista (`MAYORISTA` en `lib/wa/business-config.js`); se
  etiqueta el contacto la primera vez y queda marcado.
- **Cada cuánto pregunta**: con `firstContactAt` y `lastActivityAt` que el
  bridge ya guarda.

## Las tres etapas

1. **Guardar** — base de datos + escribir cada pregunta de ML y cada contacto
   de WhatsApp. Va en este repo (SocialFlow).
2. **Mostrar** — pestaña nueva al lado de Métricas. Va en la **app de stock**,
   que es otro proyecto y otra rama (`claude/stock-inventory-app-06rlv5`,
   `src/components/Metrics.jsx`), donde ya están las pestañas, los gráficos y
   los rangos de fecha.
3. **Ficha de cliente** — la vista tipo CRM de un contacto: todo lo que
   preguntó, cuándo y qué se le respondió.

## Dos avisos para el que lo retome

- **La etapa 2 toca otra rama**, donde hay otra sesión trabajando (PR #38).
  Coordinar antes de escribir ahí, o se pisan.
- **No hace falta una skill de Salesforce.** Se buscó y no hay ninguna
  disponible en la cuenta. Y no aporta: Salesforce modela equipos de venta con
  vendedores, oportunidades y pipelines, nada de lo cual existe acá. Copiar su
  estructura agregaría complejidad sin dar nada.
