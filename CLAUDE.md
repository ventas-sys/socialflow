# Memoria del proyecto — socialflow (Uniproveedores)

## Entorno remoto (Claude Code cloud) — estado 10/2026
- **Red ABIERTA** desde el sandbox: `rest.contabilium.com`, `api.mercadolibre.com` y `*.vercel.app` responden (antes el proxy daba 403; el usuario amplió el Network access del entorno). `listado.mercadolibre.com.ar` puede seguir bloqueado o con anti-bot: verificar antes de usar.
- **La API pública de ML ahora exige token**: sin auth devuelve `{"code":"PA_UNAUTHORIZED_RESULT_FROM_POLICIES","blocked_by":"PolicyAgent","message":"At least one policy returned UNAUTHORIZED."}` — si aparece ese mensaje, es de Mercado Libre, no del proxy.
- **Conector MCP `mercadolibre`** (cuenta "full", user_id 80460157, ~2.179 publicaciones): sirve para LA CUENTA PROPIA — `ml_search_my_items` (ojo: el parámetro de búsqueda por texto no filtra), `ml_get_item` (solo ítems propios; ajenos dan 403), `ml_get_orders`, `ml_get_questions`, `ml_get_shipment`, visitas y reviews. No sirve para espiar competencia.
- **Contabilium**: OAuth client_credentials contra `https://rest.contabilium.com/token` (ver `getContaToken` en `api/contabilium.js`). Las credenciales viven en el navegador del usuario (localStorage, página /contabilidad), NO en el repo; leer env vars de Vercel para buscarlas está bloqueado por permisos — pedirlas al usuario o que las cargue como secret del entorno.
- El scratchpad y el contenedor son efímeros: todo lo que valga la pena va al repo o al chat.

## Vercel (plan Hobby) — límites
- **Máx. 12 funciones serverless**: cuenta cada `.js` bajo `api/` SALVO los que empiezan con `_` (p. ej. `api/_http.js` es helper y no cuenta). Estamos EN 12: para sumar un endpoint hay que fusionar con el patrón `mode:` (así se fusionaron `category` y `costos` en `api/ml/costos.js`).
- Segundo proyecto `stock-inventario` vinculado al mismo repo con Ignored Build Step: ignorar sus checks.
- Si Vercel no publica status de un commit, un commit vacío fuerza el build.

## Rama / PR de la calculadora
- PR **#66**, rama `claude/mercado-libre-cost-calculator-w0w1c6`. OJO: otros flujos (PRs de "mercado-libre-preguntas") **pisan esta rama con force-push** cada tanto; si faltan los archivos de la calculadora, se recuperan con `git fetch origin <sha>` de los commits del PR (último completo: 18c3a5e) y `git checkout FETCH_HEAD -- <archivos>`.

## Calculadora de costos ML
- `lib/ml/costos.js` (lógica pura) + `api/ml/costos.js` (`mode: 'item' | 'articulo' | 'categoria'`) + `calculadora-ml.html` (2 pestañas: por link y por artículo; muestra $ y %, precio sugerido para ganar X% s/ costo, y análisis de mercado) + Excel en `recursos/` (mantener la hoja "Parámetros" sincronizada con la lib).
- Resolución de links ML en cascada (los formatos cambian): `item_id:`/`wid=` del querystring primero, luego `/items/`, `/user-products/` (MLAU), `/products/` (buy box).
- Análisis de mercado: API search de ML (necesita token) con fallback a scraping del listado público (JSON-LD).
- Reglas validadas (tarifas AR 2026): costo fijo por unidad si precio < $33.000 en todo despacho por Mercado Envíos aunque el envío lo pague el comprador (solo retiro en persona lo evita); envío gratis obligatorio ≥ $33.000; Full con descuento por reputación (~50% verde / 40% amarilla); comisión sobre el precio final + IVA 21% sobre comisión/costos ML; si es Responsable Inscripto ese IVA es crédito recuperable (se suma de vuelta en Ganancia, no en el neto); IIBB es percepción/anticipo (informativo, no resta de la ganancia). Margen = ganancia/precio; Rentabilidad = ganancia/costo.

## Caso de referencia: tapón para termo Stanley
- Costo neto $2.100; para que queden **$1.000 netos**: vender a **~$5.300** por Mercado Envíos con envío a cargo del comprador (comisión 13,5% + costo fijo ~$1.100 + IVA), ~$4.860 si Responsable Inscripto, ~$3.710 con retiro en persona, ~$7.460 por Full con envío gratis. Mercado (09/2026): genéricos < $4.500, grueso $4.500–7.500, originales > $7.500.
- El usuario revisó su Excel propio (COSTO_ML_35): tenía el envío al 35% en el precio pero al 100% en los costos, el IVA a pagar con signo invertido y doble castigo en la ganancia final — corregido y entregado por chat (no commitear: datos reales).

## Datos sensibles
- Repo **público**: nunca commitear costos/precios de compra reales ni credenciales. Los Excel del usuario van por chat.
