# Brokers MT4/MT5 para BTCUSD: comparativa de costes y regulación

> **Nivel de confianza de este documento: 0,7.** No pude abrir las webs de los brokers directamente (el proxy de esta sesión bloquea pepperstone.com, brokerchooser.com, compareforexbrokers.com, etc.). Los datos salen de resúmenes de búsqueda web de 2026 y pueden estar desactualizados. **Antes de depositar, verifica spread, comisión y swap en la ventana "Especificación" del símbolo en tu MT5 (clic derecho sobre BTCUSD → Especificación).**

## Resumen rápido

| Broker | Regulación principal | Spread BTCUSD (USD) | Comisión | Swap largo / corto | Apalancamiento BTC retail | Notas |
|---|---|---|---|---|---|---|
| **Pepperstone** (Razor, MT4/MT5) | ASIC, FCA, CySEC, DFSA, BaFin, CMA; entidad offshore SCB (Bahamas) | desde ~15 (abril-2026, según Pepperstone); otras fuentes citan 30-40 | 0 en cripto según una fuente; 7 USD/lote ida-vuelta según otra (**contradicción no resuelta**) | −20 %/año largo; **+7,5 %/año crédito en corto** (fuente: doc "Costs and Charges" Pepperstone EU) | 1:2 (EU/AU); mayor en entidad SCB | Lote mín. 0,01. Mejor equilibrio regulación/coste. |
| **Eightcap** (MT4/MT5) | ASIC, FCA, CySEC, SCB | ~12 (rango 10-20) | 0 en cripto (Standard y Raw iguales) | No verificado | 1:2 (EU/AU); mayor en SCB | 120-250+ criptos. Buena opción alternativa. |
| **IC Markets** (Raw, MT4/MT5) | ASIC, CySEC; IC Markets Global = FSA Seychelles | Variable; en volatilidad puede abrir a 100-200 | 0 en cripto (estimado) | ~ −15 %/año; triple swap viernes | 1:2 (EU/AU); hasta 1:200 en Global (estimado) | Cripto 7 días/semana. Swaps por encima de la media según pruebas independientes. |
| **Exness** (Raw Spread, MT4/MT5) | CySEC, FSCA, FSA Seychelles, CMA | No verificado | ~2 USD/lote ida-vuelta en Raw Spread (fuente secundaria) | Cuentas swap-free disponibles (estimado que aplica a cripto) | Alto en entidad Seychelles | Popular en LatAm. Regulación tier-1 solo en CySEC. |
| **Vantage** (MT4/MT5) | ASIC, FCA, CIMA, FSCA | No verificado | No verificado | No verificado | 1:2 (AU); mayor en CIMA | Recomendado en rankings para Argentina 2026. |
| **BlackBull Markets** (MT4/MT5) | FMA (NZ), FSA Seychelles | ~11,9 promedio 24 h (test ago-2026, compareforexbrokers) | 0 en Standard | No verificado | hasta 1:100 | Sin regulación tier-1 europea/australiana. |
| **Bybit MT5 (CFD)** | Infra Capital Ltd, FSC Mauricio (**no tier-1**) | No verificado | ~3 USD/lote en modo Tight-Spread (2026) | No verificado | hasta 1:500 | Es un CFD, no el exchange spot. Menor protección regulatoria. |

## Qué significa para un argentino con 1.000 USD
- Las entidades tier-1 (ASIC, FCA, CySEC) **no aceptan residentes de Argentina como retail** en la mayoría de los casos; te darán de alta en la entidad offshore del mismo grupo (Pepperstone SCB Bahamas, IC Markets Global Seychelles, Eightcap SCB, Exness Seychelles). Ahí el apalancamiento es mayor (1:10 a 1:200) pero la protección (fondo de compensación, ombudsman) es menor. **Estimado, verificar al abrir cuenta.**
- FCA (Reino Unido) prohíbe CFDs de cripto a minoristas desde 2021, así que la entidad UK queda descartada.
- Con apalancamiento 1:2 y BTC a ~80.000 USD, el lote mínimo (0,01 BTC = 800 USD nominal) requiere 400 USD de margen: con 1.000 USD solo puedes tener 0,02 lotes. Eso limita mucho cualquier estrategia. Con 1:10 en entidad offshore el margen baja a 80 USD por 0,01 lote.

## Coste real por operación (0,01 lote, BTC ≈ 80.000 USD)
| Concepto | Pepperstone (estimado) | Eightcap (estimado) | Conservador |
|---|---|---|---|
| Spread ida y vuelta | 0,15 USD | 0,12 USD | 0,30 USD |
| Comisión | 0,07 USD | 0 | 0,07 USD |
| Slippage (2 fills × 5 USD/BTC) | 0,10 USD | 0,10 USD | 0,20 USD |
| Swap por día en largo | 0,44 USD | 0,44 USD | 0,55 USD |
| **Total por trade de 1 día** | **~0,76 USD** | **~0,66 USD** | **~1,12 USD** |

Con 0,02 lotes (máximo a 1:2) el coste diario de mantener un largo es ~0,9 USD: **casi igual al objetivo de 1 USD/hora × 24 h = 24 USD/día es 27 veces el coste**, pero el beneficio bruto necesario sería de 24 USD/día sobre 1.600 USD nominal = 1,5 %/día de movimiento capturado a favor, todos los días. BTC se mueve ~2-3 % al día en promedio (rango alto-bajo), así que habría que capturar más de la mitad del rango diario todos los días sin errores. Ninguna estrategia conocida hace eso.

## Recomendación
1. **Pepperstone** (entidad que te asignen; pide explícitamente cuenta Razor en MT5). Motivo: regulación tier-1 en el grupo, spread bajo publicado, swap corto positivo (útil para estrategias short en mercado bajista).
2. **Eightcap** como alternativa con más criptos y sin comisión.
3. Evitar para este plan: Bybit MT5 y BlackBull (regulación más débil) salvo que necesites apalancamiento alto, que **no** recomiendo con 1.000 USD.

## Fuentes (búsqueda web, sept-2026)
- Pepperstone precios y "Costs and Charges" (swaps cripto 20 %/7,5 %): https://pepperstone.com/en/ways-to-trade/pricing/ , https://pepperstone.com/en/markets/cryptocurrencies/spreads/
- Comparativa MT5 y test de spread cripto ago-2026: https://www.compareforexbrokers.com/cfd-trading/brokers/crypto/ , https://www.compareforexbrokers.com/trading-platforms/mt5/
- Eightcap fees: https://brokerchooser.com/broker-reviews/eightcap-review/eightcap-fees , https://www.forexbrokers.com/reviews/eightcap
- IC Markets cripto: https://brokerchooser.com/cfd/trading/trading-tips-strategies/ic-markets-crypto-cfds , https://cdn.icmarkets.eu/uploads/Cryptocurrency-Specification-Sheet.pdf
- Límites de apalancamiento por regulador: https://liquidityfinder.com/insight/industry/comparison-of-cfd-retail-broker-leverage-limits-by-regulator
- Bybit MT5 (Infra Capital, Mauricio): https://www.datawallet.com/crypto/bybit-review , https://tradersunion.com/brokers/forex/view/bybit/fees-and-spread/
- Brokers en Argentina 2026: https://www.rankia.com.ar/blog/trading-argentina/7231905-mejores-brokers-metatrader-5-argentina , https://mejoresbrokersargentina.com/mejores-brokers-argentina
- Exness cripto: https://get.exness.help/hc/en-us/articles/17854191888540-Cryptocurrencies
