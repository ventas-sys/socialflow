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

## Método de precios del usuario en Contabilium (visto 10/2026)
- Arma cada producto Full como **combo** con componentes a costo neto s/IVA: producto + "COSTO ENVIO A FULL" ($250,03 flete reposición) + "AGREGADO CARRITO HASTA 15/25 MIL" (= cargo fijo ML, netos reales: $900,10 y $1.780,10) + "COSTO DIA FULL PEQUEÑO (30DIAS)" ($22,53) + publicidad marca/producto ($10 + $50). Precio automático: costo total × (1+Rentabilidad%) = precio sin IVA → ×1,21.
- **La "Rentabilidad" de Contabilium es markup puro**: NO descuenta la comisión de ML (~13,5% s/ precio final, neta para RI) ni IIBB/otros. Regla: rentabilidad real deseada r → cargar en Contabilium `(1+r)/0,83665 − 1` (sin IIBB) o `(1+r)/0,76665 − 1` (con IIBB 5% + otros 2% del Excel del usuario).
- **Error típico a controlar**: el ítem "agregado carrito" del combo debe corresponder al tramo del PRECIO FINAL, no del costo (ej.: combo armado con "hasta 25 mil" pero precio resultante $26.287 → tramo 25-33k, ~$450 netos más).
- El usuario es RI y trabaja todo a valores netos; el IVA lo compensa débito-crédito en la DDJJ (no es costo). Pendiente: actualizar la hoja "Parámetros" del Excel con los tramos netos reales (la lib ya está).

## Tarifas REALES verificadas (liquidaciones + reportes de facturación Oct/2026, analizados 11/2026)
- **IVA RESUELTO**: la suma de TODAS las líneas de cargos+percepciones del mes coincide al centavo con los débitos automáticos → **los montos de ML son finales CON IVA incluido** (comisión, costo fijo, envíos, colecta, almacenamiento, publicidad). Para RI: costo neto = monto/1,21 (17,36% vuelve como crédito). Comprobación: componente Contabilium $900,10 neto × 1,21 = $1.089 = costo fijo bruto viejo. El "factor" del Excel v2 queda en 0,8264.
- **Comisión por categoría** (final c/IVA): Bazar/tapones 14,35%; Herramientas 14,5% (la más común); Construcción/vehículos/jardín 14%; rango total visto 13,5%–16%.
- **Costo fijo** (final c/IVA, tramo por precio final): <$15.000 = **$1.330** (45 muestras; fin sept ya se vieron $1.370–1.470, ML lo ajusta seguido); $15–25k = **$2.740–2.780** (real, 24 muestras; reemplaza el estimado $2.630); $25–33k = **$3.320** (VERIFICADO en liquidación real 22/09, venta $26.287 por Flex). Los 3 tramos quedan verificados.
- **≥ $33.000: SIN costo fijo**, envío gratis a cargo del vendedor: típico $7.490–8.990 ($8.590 confirmado), hasta $14.190–17.490 en pesados.
- **Flex**: ML acredita al vendedor $4.990/$6.990/$8.990/$10.490 por entrega (<$33k, envío a cargo comprador); en ventas ≥$33k por Flex se vieron acreditaciones de solo el 10% de la tarifa. Oct: +$12,85M bonificado, −$0,68M anulado (devoluciones).
- **Full — colecta (envío a Full)**: tarifa nominal ~$58.851/m³ pero ML bonificó ~95% (efectiva ~$971/m³; mediana de cargo = 4,8% del nominal, varía por producto/rotación). Reales: tapón pico cebador $5,36/u; discos $2–13/u; promedio cuenta $19,21/u. El componente Contabilium "COSTO ENVIO A FULL" $250,03 está MUY sobreestimado para productos chicos.
- **Full — almacenamiento diario por unidad**: Pequeña $0,75 · Mediana $2,40 · Grande $20 · Extragrande $65 (el componente $22,53/30d del usuario para pequeño es correcto). **Stock antiguo**: pequeño $350 (4–6m) / $3.250 (6–12m), mediano $470 / $4.485 — se multiplica ×9 pasados los 6 meses; retiro de stock $175–230/u (conviene retirar antes del 6º mes).
- **Retenciones reales por venta ≈ 0,72% del cobro** (ICD 0,6% + SIRTAC 0,1% + IIBB provincial centavos) — NO el 5%+2% del Excel viejo del usuario.
- **Débito mensual automático** (Oct: $53,5M): 87% son PERCEPCIONES (IVA RG 5319/2023 $26,7M + IVA rég. gral $1,5M + IIBB $18,4M) que NO son costo (a cuenta en DDJJ); costos reales solo $6,8M (publicidad $5,25M + Full $1,58M + Mi página $32k). La comisión/costo fijo/envíos se descuentan en la liquidación de cada venta, no acá.
- Rentabilidad real con IVA resuelto (costos reales por chat, no acá): tapón a $7.226 por Full → ganancia neta ~$1.490 (~60% s/costo); disco TRF-4.5 a $26.287 → ~$1.400 (~10% s/costo).
- **Reparto Flex propio**: el usuario reparte con motoquero propio por zona (tarifas y cifras del negocio SOLO por chat, nunca acá: repo público). Regla validada: en <$33k Flex deja margen positivo por envío; en ≥$33k Flex sigue siendo más barato que pagar el envío de ML ($8.590). El costo del motoquero se resta en la hoja "Mes completo" del Excel.
- El P&L mensual completo (ventas muestreadas con el conector MCP vía `ml_get_orders` — ojo: devuelve máx. `limit` órdenes, mirar el rango de fechas realmente cubierto para extrapolar), el sueldo del armador, publicidad por unidad y márgenes viven en los Excel entregados por chat: `Costos-ML-Detalle-Oct2026.xlsx` (tarifas + calculadora SKU + hoja "Mes completo") y `Costos-por-Producto-Tapon-y-Disco.xlsx` (hoja clara por producto). Hallazgo fiscal: las percepciones de ML (IVA RG 5319 + IIBB) superan por mucho los impuestos devengados → saldos a favor crecientes; sugerido tramitar exclusiones (IVA RG 2226; IIBB por jurisdicción/SIRTAC).
- Pendiente: % real de costo de mercadería (sale de Contabilium); costo del pico cebador suelto.

## Datos sensibles
- Repo **público**: nunca commitear costos/precios de compra reales ni credenciales. Los Excel del usuario van por chat.
