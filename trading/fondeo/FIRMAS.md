# Prop firms de trading minorista — reglas reales (septiembre 2026)

**Para:** trader residente en Argentina que opera en MT5.
**Fecha de corte de la investigación:** 7 de septiembre de 2026.
**Método:** solo búsquedas web (WebSearch). No se pudo abrir directamente las webs de las firmas (proxy bloquea WebFetch), así que cada dato lleva la URL de la fuente donde apareció. Muchas fuentes son sitios de reseñas/afiliados que a su vez citan los help centers oficiales; cuando la fuente es la firma misma se indica **[oficial]**.

**Convención de fechas:**
- **[2026]** = la fuente está fechada o actualizada en 2026.
- **[2024-25]** = la fuente es de 2024 o 2025 → posiblemente desactualizada.
- **"no encontrado"** = ningún resultado de búsqueda dio el dato. No se inventó nada.

> Advertencia general: las prop firms cambian precios y reglas sin aviso (varias fuentes lo dicen explícitamente, p. ej. FundedNext "revisa precios sin aviso" — https://proptradingvibes.com/blog/fundednext-pricing). Antes de pagar, confirmar todo en el checkout y en el help center oficial.

---

## 1. Tabla comparativa (resumen)

| Firma | Tipo | Objetivo (fase 1 / fase 2) | DD diario | DD máximo (tipo) | Tiempo límite | Días mín. | Precio 100k (USD aprox.) | Split | Primer payout | MT5 | Argentina |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **FTMO** | 2 fases / 1 fase (feb-2026) | 10% / 5% (2-step); 10% (1-step) | 5% (2-step) / 3% (1-step) | 10% estático s/balance inicial (2-step); 10% trailing (1-step, según fuentes) | Sin límite | 4 por fase (2-step); 0 (1-step) | ≈ €499–540 (2-step), €499 (1-step) | 80% → 90% (2-step); 90% desde el día 1 (1-step) | 14 días (calendario) desde el 1er trade | Sí | Sí (no restringido) |
| **FundedNext** | Stellar 2-step / 1-step / Lite / Instant | 8% / 5% (2-step); 10% (1-step) | 5% (2-step) / 3% (1-step) | 10% estático s/balance (2-step); 6% (1-step) | Sin límite | 5 por fase | $549.99 (Stellar 2-step) | hasta 95% (+15% "reward" en challenge) | 5 días (1-step) / 21 días (2-step) | Sí | Sí (no restringido) |
| **The5ers** | High Stakes 2 fases / Hyper Growth 1 fase / Bootcamp 3 fases | 8–10% / 5% (HS); 10% (HG); 6% ×3 (BC) | 5% (HS) / 3% (HG) | 10% estático (HS); 6% (HG); 5% (BC) | Sin límite (con actividad cada 30 días) | 3 días rentables (HG/Pro Growth); HS ver sección | HS 100k: no encontrado (5k = $45) | 80% → 100% | 14 días | Sí | Sí (no restringido) |
| **FundingPips** | 2-Step Std / 2-Step Pro / 2-Step Flex / 1-Step Flex / Zero (instant) | 8% / 5% (Std); 10% (1-step) | 5% (Std) / 3% (1-step) | 10% (Std); 6% (1-step); 12% (Flex); trailing s/balance cerrado (según fuentes) | Sin límite | 3 (Std), 1 (Pro), 0 (Flex) | $499 (2-Step Std, jul-2026); $500 (1-Step) | 60–100% según ciclo elegido | < 2 semanas (weekly/on-demand) | Sí (volvió en 2026) | Sí (lista restringida: Irán, Vietnam, EAU) |
| **Alpha Capital** | Alpha One (1 fase) / Pro (2) / Swing / Three (3) | var. | 4% (One); 3–5% (Pro) | One: 6% trailing; Pro: 6/8/10% estático | no encontrado | 5 (para 1er payout) | Alpha Swing 100k $577; Direct 100k $457 | 80% | ~1 semana / 5 días | Sí | No confirmado (203 países selec.; lista no encontrada) |
| **E8 Markets** | E8 One (1 fase, configurable) / Pro / Signature | 1,5× el DD elegido (6–21%) | según DD elegido | 4/6/8/10/14% elegible, EOD dinámico | Sin límite | 0 | $260 (100k) | hasta 100% (tiers) | 14 días, luego on-demand | Sí | Sí (permitido) |
| **Blue Guardian** | 1-step / 2-step / Instant / Guardian X | 9% (1-step); 2-step ver sección | 3–4% | 6% trailing (mayoría); 8% (2-step std) | Sin límite | 3 (desde 20-ago) / 5 | Instant 100k $467 | 100% hasta $15k, luego 90% | 24–48 h tras cumplir cond. | Sí | Sí (no en lista restringida) |
| **Maven Trading** | 1-step / 2-step / 3-step / Instant | 8% | 3–4% | 5% trailing (1-step); 8% estático (2-step) | no encontrado | ver sección | $299 (100k) | 80% | 14 días; luego cada 10 días hábiles | Sí (más barato) | Sí (permitido; payout vía Rise) |
| **Goat Funded Trader** | 1-step / 2-step / 3-step / Instant | 10% (1-step); 8%/4% (2-step GOAT) | 4% | 10% trailing (2-step GOAT); 6 modelos distintos | Sin límite | 3 | ~$263–499 (eval 100k); Instant 100k $489 | hasta 100% (95% típico) | 3–4 días rentables (≥0,5%) | Sí | Sí (no en lista de 26) |
| **Topstep** (futuros) | Combine 1 fase (suscripción mensual) | $3k/$6k/$9k (50/100/150k) | $1k/$2k/$3k | $2k/$3k/$4.5k trailing EOD | Mensual (renovable) | 0 (2 días típico) | $99/mes (100k) + $149 activación | 90/10 (cuentas desde 12-ene-2026) | tras 5 días ganadores ≥$150 | No (TopstepX/NinjaTrader/Tradovate) | No confirmado (no aparece en listas restringidas) |
| **Apex** (futuros) | Evaluación 1 fase, pago único (4.0, mar-2026) | $3k/$6k/$9k | EOD Trail: sí; Intraday: no | $2.5k/$3k/$5k trailing | 30 días | 0 | 25k $167 / 50k $207 (Rithmic, según fuente) + activación $59–159 | 100% (marketing) | 5 días rentables, mín. $500 | No (Rithmic/Tradovate) | Sí (fuente en español: acepta Argentina; payout vía Plane/Deel) |
| **MyFundedFutures** | Builder / Rapid / Pro (1 fase) | ~6% ($3k/$6k/$9k) | Ninguno | $2k (50k, 4%) / $3k (100k, 3%) trailing EOD o intradía | no encontrado | 1 (Builder) / 2 (resto) | $105 (Builder 25k) – $477 (Pro 150k) | 80/20 (Pro) / 90/10 (Rapid) | 14 días (Pro) | No (futuros) | Sí (solo OFAC restringidos) |

Fuentes de la tabla: ver secciones por firma.

---

## 2. Secciones por firma

### 2.1 FTMO (Praga, República Checa; desde 2015)

**Evaluación** [2026]
- 2-Step: fase 1 objetivo 10%, fase 2 objetivo 5%; pérdida diaria máx. 5% y pérdida total máx. 10% del balance inicial (estático). La pérdida diaria incluye P&L flotante. Mínimo 4 días de trading por fase. — https://ftmo.com/en/trading-objectives/ [oficial]; https://merlintrade.io/prop-firms/ftmo; https://www.jptradingcapital.com/blog/en/ftmo-rules
- 1-Step (lanzado febrero 2026): objetivo 10%, pérdida diaria 3%, pérdida máxima 10% **trailing** (según fuentes de terceros), sin días mínimos, split 90% desde el día 1, incluye "Best Day Rule". — https://tradetanto.com/learn/ftmo-rules-evaluation-process; https://ftmo.com/en/1-step-challenge/ [oficial]; https://propfirmkey.com/en/blog/ftmo-challenge-cost-2026
- Sin límite de tiempo en ninguna fase. — https://propfirmkey.com/en/blog/ftmo-challenge-cost-2026

**Reglas que matan el intento / bloquean payout** [2026]
- **Best Day Rule (consistencia):** el mejor día no puede superar el 50% del "Positive Days' Profit". Aplica al 1-Step y a las cuentas FTMO fondeadas; **no aplica en la fase de challenge del 2-Step**. Romperla no cierra la cuenta: retiene el payout hasta que el ratio baje. — https://propvator.com/blog/does-ftmo-have-a-consistency-rule/; https://tradetanto.com/learn/ftmo-rules-evaluation-process
- **Noticias:** en evaluación no hay restricción. En cuenta fondeada **Standard**: prohibido abrir/cerrar trades (incluye SL/TP y pendientes) 2 min antes y 2 min después de noticias seleccionadas, sólo en el instrumento afectado. Cuenta **Swing**: sin restricción de noticias. — https://ftmo.com/en/faq/can-i-trade-news/ [oficial]
- **Fin de semana:** en evaluación se puede mantener. En fondeada Standard no; Swing sí. — https://ftmo.com/en/faq/do-i-have-to-close-my-positions-overnight/ [oficial]
- **Apalancamiento:** 1:100 Standard, 1:30 Swing. — https://brokeranalysis.com/prop-trading-firms/ftmo/platforms/
- **Lotes/posiciones:** sin tope fijo de lotes; límite de plataforma 200 órdenes / 2.000 posiciones por día; tope de capital total $400k por trader/estrategia. Una fuente menciona 50 lotes por posición (dato en conflicto). Regla de margen del 40% sólo para cuentas compradas antes del 8-jun-2026. — https://propvator.com/blog/ftmo-max-lot-size/; https://www.jptradingcapital.com/blog/en/ftmo-rules
- **Martingala/grid:** no hay regla explícita de estilo; se prohíbe "gambling" o all-in en noticias. — https://propvator.com/blog/ftmo-max-lot-size/
- **EAs / copy:** EAs permitidos; MT4/MT5/cTrader/DXtrade (US sólo DXtrade). — https://tradingfinder.com/props/ftmo/rules/; https://brokeranalysis.com/prop-trading-firms/ftmo/platforms/

**Precio** [2026]
- 2-Step (en EUR, FTMO cobra en euros): 10k ≈ €155 (≈$183), 25k €250, 50k €345, 100k €439–540 según fuente (conflicto entre fuentes; una lista USD: $155/$250/$345/$540). — https://propfirmdealfinder.com/seo-pages/ftmo-challenge-cost-breakdown-2026.html; https://propfirmkey.com/en/blog/ftmo-challenge-cost-2026; https://brokeranalysis.com/prop-trading-firms/ftmo/pricing/
- 1-Step: 10k €79, 25k €199, 50k €319, 100k €499. — https://propfirmkey.com/en/blog/ftmo-challenge-cost-2026
- Fee 100% reembolsado con el primer payout. Un reintento gratis de fase 2 si se falla. — https://traderssecondbrain.com/guides/ftmo-review; https://www.jptradingcapital.com/blog/en/ftmo-challenge-cost
- Descuentos: raros; código "FTMO10" 10% citado por afiliados, no acumulable. — https://www.quantvps.com/blog/forex-prop-firm-discounts

**Plataformas e instrumentos** [2026]
- MT4, MT5, cTrader, DXtrade. Forex, índices, materias primas (XAUUSD), cripto (BTCUSD); ~93 instrumentos. — https://brokeranalysis.com/prop-trading-firms/ftmo/platforms/; https://tradingfinder.com/props/ftmo/
- Comisión forex ≈ $3 por lote round-turn; spreads 0,2–0,7 pips en mayores; metales 0,0010% por lote (dato de terceros). — https://www.quantvps.com/blog/list-of-top-prop-firms

**Payouts y Argentina** [2026]
- Split 80/20; sube a 90/10 al activar scaling. Primer payout 14 días calendario desde el primer trade en cuenta FTMO (una fuente dice 21 días — conflicto). Luego on-demand; procesado en 1–2 días hábiles. — https://lunefi.com/blog/ftmo-payouts; https://tradersunion.com/brokers/prop/view/ftmo/payout-and-withdrawal-rules/
- Métodos: transferencia bancaria (mín. $20), Skrill, cripto (USDT TRC-20/ERC-20, BTC; mín. $50), Visa Direct/Mastercard Send. — https://tradersunion.com/brokers/prop/view/ftmo/payout-and-withdrawal-rules/; https://ftmo.com/es/faq/what-payment-methods-are-available/ [oficial]
- **Argentina: NO está en la lista restringida.** Restringidos: Cuba, varios caribeños, Afganistán, Irán, Irak, India, Indonesia, Myanmar, Corea del Norte, Kazajistán, etc. Transferencias bancarias no disponibles para payouts en Venezuela, Cuba, Sudán y Ucrania (Argentina no). — https://thepayoutreport.com/ftmo-restricted-countries/; https://vettedpropfirms.com/ftmo-banned-countries-list/; https://trading-latam.com/verdades-y-mentiras-sobre-ftmo/

**Reputación 2025-2026**
- FTMO completó la compra de OANDA el 1-dic-2025 (regulado en varias jurisdicciones). — https://www.oanda.com/group/press-release/oanda-acquired-by-ftmo/ [oficial]
- OANDA (ya bajo FTMO) multada $600k por la NFA por fallas de cumplimiento 2023. — https://www.financemagnates.com/forex/oanda-fined-600000-by-us-regulator-over-compliance-failures/
- Queja concreta (15-ene-2026): payout denegado en cuenta 100k por exceder en $70 una restricción de riesgo 1% por trade impuesta tras el primer payout (slippage). — https://www.sikayetvar.com/en/ftmo-us/ftmo-denied-my-payout-for-slightly-exceeding-the-1-percent-rule; https://www.propscorer.com/blog/ftmo-payout-denial-slippage-excuse. **No se encontró confirmación oficial de una "regla del 1%" en FTMO**; tratar como caso individual.
- Un monitor de la industria reporta cero incidentes significativos, sin congelamiento de payouts ni cambios de reglas a mitad de evaluación en 2025-26. — https://track360.io/blog/ftmo-review-2026-operator-trader-perspective
- "OANDA Prop Trader" cerrado para concentrar en FTMO. — https://ftmo.com/en/press-release/oanda-prop-trader-to-conclude-as-ftmo-strengthens-its-modern-prop-focus/ [oficial]

**Estadísticas de aprobación**
- **FTMO no publica su tasa de aprobación** (varias fuentes lo remarcan; otra afirma lo contrario — conflicto). Estimaciones de terceros: 8–12% pasa ambas fases; ~5–7,5% llega a cobrar. 70% falla por límites de pérdida (50% DD máximo, 20% DD diario). Más de $650M pagados; 4,5M clientes. — https://traderssecondbrain.com/guides/prop-firm-pass-rate; https://coinlaw.io/ftmo-statistics/; https://tradelikemaster.com/blog/how-to-pass-ftmo-challenge-2026-complete-guide

---

### 2.2 FundedNext (Dubái)

**Evaluación** [2026]
- Stellar 2-Step: 8% / 5%; DD diario 5%, DD máximo 10% estático sobre balance inicial; 5 días mín. por fase; sin límite de tiempo. — https://proptradingvibes.com/blog/fundednext-stellar-2-step; https://help.fundednext.com/en/articles/9438795-what-do-you-mean-by-no-time-limit [oficial]
- Stellar 1-Step: 10%; DD diario 3%, máx. 6% estático; apalancamiento 1:30. — https://proptradingvibes.com/blog/fundednext-stellar-1-step
- Modelo "Evaluation" antiguo discontinuado para nuevos clientes desde 18-mar-2025. — https://tradingfinder.com/props/fundednext/rules/ [2024-25]

**Reglas críticas** [2026]
- **Consistencia 40%:** ningún día puede aportar >40% del beneficio de la fase. Fuentes discrepan sobre a qué productos aplica (Stellar vs. Bolt/Legacy, abril 2026). — https://proptradingvibes.com/blog/fundednext-consistency-rule
- **Noticias:** permitido, pero la ganancia de trades abiertos ±5 min de noticias de alto impacto se limita al 40% (según fuente). — https://tradingfinder.com/props/fundednext/
- **Fin de semana:** sin restricción. — https://tradingfinder.com/props/fundednext/rules/
- **Prohibido:** gambling, hedging entre cuentas, arbitraje, tick scalping, grid, latency, HFT (>200 trades/día). Regla de riesgo 1% introducida para desalentar gambling. — https://help.fundednext.com/en/articles/8020351-what-are-the-restricted-prohibited-trading-strategies [oficial]; https://help.fundednext.com/en/articles/10256545-what-is-the-1-risk-limit-rule-who-and-when-will-it-be-implemented [oficial]
- **EAs:** permitidos en MT4/MT5, no en cTrader/Match-Trader. **Copy trading:** sólo entre cuentas propias de challenge (tope $300k), prohibido en fondeadas. — https://tradingfinder.com/props/fundednext/; https://tradingfinder.com/props/fundednext/rules/
- Apalancamiento 1:100 (1:30 en 1-Step). — https://tradingfinder.com/props/fundednext/rules/

**Precio** [2026, verificado en checkout 28-ago-2026 según fuente]
- Stellar 2-Step: 6k $59.99 (otra fuente $49.99), 15k $119.99, 25k $199.99, 50k $299.99, 100k $549.99, 200k $1,099.99. 1-Step mismo precio. Lite ~25-30% más barato. — https://proptradingvibes.com/blog/fundednext-pricing
- Reembolso: "120% fee refund" / reward 15% del beneficio del challenge. Código "FT" 7%. — https://fundedtrading.com/propfirm/fundednext/

**Plataformas:** MT4, MT5, cTrader, Match-Trader. — https://fundednext.com/blog/how-to-trade-on-mt4-mt5-ctrader-and-match-trader [oficial]

**Payouts** [2026]
- 1er payout: 5 días (1-Step) / 21 días (2-Step). Luego cada 14 días. Garantía 24 h con penalidad $1,000. Métodos: cripto USDT (mín. $20)/USDC ($50), Rise ($50), banco, Confirmo. — https://proptradingvibes.com/blog/fundednext-payout-rules; https://propvator.com/blog/fundednext-payout-methods/
- **Argentina: NO restringida.** — https://www.surgefunded.com/fundednext-supported-and-restricted-countries/; https://help.fundednext.com/en/articles/8020080-are-any-countries-restricted-on-fundednext-cfds [oficial]

**Reputación 2025-26**
- Quejas individuales en Forex Peace Army: reembolso cripto aprobado y luego rechazado (mayo 2026); acusación de violar "regla 3%" con emails contradictorios (marzo 2026); trader con 7 payouts al que no le pagaron reward de $975. — https://www.forexpeacearmy.com/community/threads/problem-with-fundednext-account-13829292-missing-payout-and-fake-rules.89184/; https://www.forexpeacearmy.com/forex-reviews/19902/funded-next-review
- Denegaciones <3% de reseñas agregadas, mayoría por incumplimiento de reglas. — https://propfirmscope.com/prop-firms/fundednext

**Estadísticas:** tasa de aprobación publicada: no encontrado.

---

### 2.3 The5ers (Israel/UK; broker Leverate)

**Evaluación** [2026]
- High Stakes (2 fases): 8% (una fuente dice 10%) / 5%; DD diario 5%, DD máx. 10% estático; días mínimos: sólo este programa los exige (número exacto: no encontrado). — https://tradingfinder.com/props/the-5ers/rules/; https://tradetanto.com/learn/the-5-ers-rules-explained-a-complete-guide
- Hyper Growth (1 fase): 10%; DD diario 3% (pausa), máx. 6%; apalancamiento 1:30; 3 días rentables. — https://tradetanto.com/learn/the-5-ers-rules-explained-a-complete-guide; https://www.fxempire.com/prop-firms/the5ers
- Bootcamp (3 fases): 6% por fase, 5% pérdida máx. — https://tradingfinder.com/props/the-5ers/rules/
- Sin límite de tiempo, con actividad dentro de cada ventana de 30 días. — https://www.fxempire.com/prop-firms/the5ers

**Reglas críticas** [2026]
- Permite noticias, weekend, EAs, copy entre cuentas propias. EA debe tener SL en cada posición; prohibido tick scalping, latency/reverse/hedge arbitrage, señales de terceros, "rollover scalping", HFT. — https://www.eafunded.com/firms/the5ers; https://www.jptradingcapital.com/blog/en/the5ers-ea
- Consistencia: no hay (excepto High Stakes según una fuente). — https://www.fxempire.com/prop-firms/the5ers

**Precio** [2026]: High Stakes 5k $45 ($42.75 con 5%); 100k: no encontrado. Códigos 5–15%. — https://propfirmmatch.com/prop-firms/the-5-ers/challenges; https://fundedtrading.com/propfirm/the5ers/

**Plataformas:** MT5 y cTrader. Apalancamiento hasta 1:100 (HS). — https://www.luxalgo.com/prop-firms/the-5-ers/

**Payouts** [2026]
- Split 80% → 100% (escalado a $350k). 1er payout 14 días tras activación; luego cada 14 días; mín. $150. Métodos: Rise (3,5% comisión), cripto (<$1,500 directo), banco (3,5%), Hub credits. Procesado ≤3 días hábiles. — https://help.the5ers.com/what-payout-methods-are-available/ [oficial]; https://thetrustedprop.com/blogs/the5ers-payout-rules-profit-split-withdrawal-process
- **Argentina: NO restringida** (lista incluye Venezuela, Rusia, Israel, Irán, etc.). — https://help.the5ers.com/who-can-join-the5ers/ [oficial]; https://www.surgefunded.com/the5ers-supported-and-restricted-countries/

**Reputación 2025-26**
- Varias quejas en Forex Peace Army: payout $3,099 denegado y cuenta cerrada tras 4 payouts ($10,422) por "verification failed"; cuenta cerrada dic-2025 por "bulk trading" sin detallar trades; cuenta deshabilitada por "pure speculative gambling" por un trade de $1,150. — https://www.forexpeacearmy.com/community/threads/problem-the5ers-payout-3-099-declined-account-closed-no-explanation-after-4-successful-payouts-totaling-10-422.89364/; https://www.forexpeacearmy.com/community/threads/the5ers-denying-the-payout-without-valid-reason-stealing-money-from-the-traders.89902/
- Videollamadas de verificación de identidad antes de pagar. — https://propvator.com/blog/the5ers-review/

**Estadísticas:** 5–15% de aprobación citado por terceros; publicación oficial: no encontrado. — https://www.quantvps.com/blog/prop-firm-statistics

---

### 2.4 FundingPips (Dubái; desde 2022)

**Evaluación** [2026]
- 2-Step Standard: 8% / 5%; DD diario 5%, máx. 10%; 3 días mín. por fase. 2-Step Pro: 6%/6%, 1 día. 2-Step Flex y 1-Step Flex: 0 días, DD máx. 12%. 1-Step: 10%, 3% diario, 6% máx., apalancamiento 1:50. Zero (instant): 7 días antes del 1er retiro. Sin límite de tiempo. — https://help.fundingpips.com/hc/en-us/articles/34501809112081-2-Step-Standard [oficial]; https://proptradingvibes.com/blog/fundingpips-rules
- Tipo de drawdown: una fuente dice trailing sobre balance cerrado (8%) — https://www.simtrade.io/prop-firms/fundingpips; confirmar por modelo.

**Reglas críticas** [2026, help center oficial]
- **Noticias:** mantener trades a través de noticias está permitido en evaluación, pero "operar noticias a propósito" (abrir/cerrar alrededor de noticias de alto impacto para explotar el spike) está **prohibido y cierra la cuenta**. — https://help.fundingpips.com/hc/en-us/articles/34504137479441-News-Trading-Weekend-Holding [oficial]
- **Fin de semana:** permitido en evaluación; "temporalmente no permitido" en Master (fondeada) de los 4 modelos; en Zero, cerrar antes del viernes o terminación. — misma fuente.
- **Prohibido:** gap trading, HFT, spam de servidor, latency arbitrage, hedging, long-short arbitrage, tick scalping, "opposite account trading", churning. — https://tradingfinder.com/props/funding-pips/rules/
- EAs permitidos en MT5 (con verificación de restricciones). — https://proptradingvibes.com/blog/fundingpips-mt5-setup
- Apalancamiento: 1:100 (2-Step Std), 1:50 (1-Step). — https://proptradingvibes.com/blog/fundingpips-rules

**Precio** [2026]
- 2-Step Std (30-jul-2026): 10k $59, 25k $159, 50k $269, 100k $499. 1-Step: 10k $99, 25k $199, 50k $319, 100k $500. 2-Step Pro desde $29. Códigos 20%. — https://proptradingvibes.com/prop-firms/fundingpips; https://thepropfirmguide.com/fundingpips/
- Reembolso de fee: no encontrado.

**Plataformas:** MT5 (gratis, volvió en 2026 tras 13 meses fuera), cTrader (+$20), Match-Trader (gratis). — http://www.proptradingvibes.com/blog/fundingpips-platforms; https://www.financemagnates.com/forex/funding-pips-becomes-latest-prop-firm-to-bring-metatrader-5-back-after-year-long-hiatus/

**Payouts** [2026]
- Split según ciclo: 60% weekly → 100% monthly (Pro 80%, Zero 95%). 1er payout <2 semanas. SLA 24 h Rise/cripto, 48 h Wise, 3–5 días SWIFT. Métodos: Rise, cripto USDT/USDC, banco, tarjeta. Política "Zero Reward Denial". — https://proptradingvibes.com/blog/fundingpips-payout-rules; https://lunefi.com/blog/fundingpips-payouts; https://newyorkcityservers.com/blog/fundingpips-review
- **Argentina: NO restringida** (lista oficial: Irán, Vietnam, EAU). — https://proptradingvibes.com/blog/fundingpips-restricted-countries; https://finantresfondeo.com/funding-pips-en-argentina-como-abrir-cuenta-revisar-antes-pagar/

**Reputación 2025-26**
- Perdió MT5 en feb-2024 (caso MetaQuotes/clientes US) y lo recuperó en 2026. — Finance Magnates arriba.
- Cifras publicadas: $98.9M pagados en 2025 (75,773 rewards); $106.7M en 2026 (parcial); >$340M acumulados. — https://coinlaw.io/fundingpips-statistics/; https://fundingpips.com/rewards [oficial]
- Tasa de aprobación publicada: no encontrado.

---

### 2.5 Alpha Capital Group (Londres; broker ACG Markets, FSA Seychelles)

**Evaluación** [2026]
- Alpha One: DD diario 4%, máx. 6% trailing. Alpha Pro: 10% (5% diario, 10% estático), 8% (4%/8%), 6% (3%/6%). Alpha Swing y Alpha Three también. Objetivos exactos por fase: no encontrado en resultados. Tamaños $5k–$200k, escalado a $400k. — https://alphacapitalgroup.uk/posts/alpha-capital-rules-explained-drawdown-profit-targets-daily-loss-and-evaluation-rules-2026 [oficial]; https://tradetanto.com/learn/alpha-capital-group-rules-what-traders-need-to-know
- Límite de tiempo: no encontrado.

**Reglas críticas** [2026]
- **Best Day Rule 40%** en cuentas fondeadas con payout on-demand (no existe en evaluación → sorprende al cobrar). — https://tradingfinder.com/props/alpha-capital-group/rules/; https://proptradingvibes.com/prop-firms/alpha-capital-group
- **Noticias:** libre en evaluación; en cuenta "Qualified" ventana ±5 min (Swing: trade abierto ±2 min debe durar >2 min). — https://alphacapitalgroup.uk/posts/alpha-capital-news-trading-and-overnight-rules-explained-2026 [oficial]
- **Fin de semana:** permitido en Swing/One/Three; no en Alpha Pro fondeada (soft breach). — misma fuente.
- **EAs:** requieren aprobación previa (enviar EX5/MQ5/set). Copy entre cuentas propias OK; señales de terceros prohibidas. Apalancamiento hasta 1:100. — https://thetrustedprop.com/blogs/alpha-capital-group-trading-rules-allowed-vs-not-allowed

**Precio** [2026]: desde $35–50; Pro 25k $197, One 50k $297, Swing 100k $577; Alpha Direct (instant) 10k $97, 25k $197, 50k $257, 100k $457. Códigos 15–40%. — https://propfirmmap.com/firms/alphacapitalgroup; https://propfirmmatch.com/prop-firms/alpha-capital-group

**Plataformas:** DXtrade, cTrader, MT5, TradeLocker. — https://propfirmmap.com/firms/alphacapitalgroup

**Payouts** [2026]: 80% (Alpha Prime 60% + salario opcional); bi-semanal u on-demand; 1er payout ~5 días de trading; pagado en 2 días hábiles. Métodos: Rise, Wise, banco; **cripto no directo** (vía Rise). — https://help.alphacapitalgroup.uk/en/articles/6933755-how-do-i-get-paid-performance-fees [oficial]; https://www.quantvps.com/blog/alpha-capital-payout-rules-explained-how-trader-payouts-work
- **Argentina:** no confirmado. 203 países seleccionables en checkout (30-jun-2026); lista de restringidos no apareció en los resultados. — https://alphacapitalgroup.uk/resources/alpha-capital-country-availability-2026 [oficial]

**Reputación 2025-26:** patrón de quejas "pasa, cobra y lo flaggean por regla que no conocía" (Best Day 40%); terminación por IP compartida/"group trading" (dic-2024). — https://proptradingvibes.com/prop-firms/alpha-capital-group; https://www.trustpilot.com/review/alphacapitalgroup.uk

**Estadísticas:** no encontrado.

---

### 2.6 E8 Markets (Praga / EE.UU.)

**Evaluación** [2026]
- E8 One (1 fase, configurable): eliges DD máximo 4/6/8/10/14% en el checkout; el objetivo = 1,5× el DD (6% a 21%); DD dinámico EOD. Sin límite de tiempo, sin días mínimos (se puede pasar en una tarde). — https://proptradingvibes.com/blog/e8-markets-rules-overview; https://tradingtoolshub.com/blog/e8-markets-rules-explained/
- E8 Pro / Signature también existen (Signature sin overnight). — https://tradetanto.com/learn/e8-markets-rules

**Reglas críticas** [2026]
- **Noticias:** libre en evaluación; en fondeada prohibido ±5 min de alto impacto. — https://www.eafunded.com/firms/e8-markets
- **Fin de semana:** permitido salvo Signature. — https://bestpropfirmguide.com/faqs/e8markets/strategies-allowed/
- **EAs:** permitidos, una estrategia por usuario (misma EA en varios usuarios → terminación). **Copy entre cuentas E8 de evaluación: prohibido.** HFT: no más del 50% de trades <1 min. Martingala: permitida según una fuente. — https://help.e8markets.com/en/articles/6929927-trading-policies-and-prohibited-trading-strategies [oficial]; https://tradingfinder.com/props/e8-markets/rules/
- Payout: mejor día ≤40% del total; beneficio neto > 50% del DD diario. — https://thetrustedprop.com/prop-firms/e8-markets

**Precio** [2026]: 50k $130, 100k $260, 150k $390 (varía con DD y split elegidos); 25k–250k $98–$1,310. Código 25%. — https://propscope.net/en/e8markets/; https://thetrustedprop.com/prop-firms/e8-markets

**Plataformas:** cTrader, Match-Trader, MT5, TradeLocker. — https://thetrustedprop.com/prop-firms/e8-markets

**Payouts** [2026]: 1er payout 14 días calendario desde el 1er trade fondeado; luego on-demand tras 5 días rentables ≥0,3%. Métodos: Rise (mín. $250) y Plane (mín. $50). — https://proptradingvibes.com/blog/e8-markets-payout-rules; https://pickmytrade.io/prop-firm-faq/e8-markets-faq
- **Argentina: permitida** (lista restringida incluye Venezuela, Nicaragua, Rusia, EAU, etc.). — https://www.surgefunded.com/e8-markets-supported-and-restricted-countries/; https://help.e8markets.com/en/articles/5514278-accepted-countries [oficial]

**Reputación:** sin incidentes concretos encontrados; una reseña habla de "hidden payout caps". — https://proptrusted.com/prop-firms/e8-markets/
**Estadísticas:** no encontrado.

---

### 2.7 Blue Guardian (UK)

**Evaluación** [2026]
- Mayoría de planes: objetivo 9%, DD diario 3%, máx. 6% trailing. 2-Step Standard: DD diario 4% (reset 17:00 EST), máx. 8%; 3 días mín. (compras desde 20-ago) / 5 antes. 18 tipos de challenge, $5k–$400k. Sin límite de tiempo. — https://help.blueguardian.com/en/articles/14062291-2-step-standard-rules [oficial]; https://lunefi.com/blog/blue-guardian-complete-guide-to-rules-and-payouts; https://completetradersedge.com/blue-guardian-review-2026/

**Reglas críticas** [2026]
- **Consistencia 50%** en periodo de payout. — https://blueguardian.com/blogs/blue-guardian-prop-firm-rules-explained-from-beginner-to-pro-traders-2026 [oficial]
- **Noticias:** cuentas compradas después del 13-nov-2025: prohibido abrir/cerrar ±5 min de noticias "red folder" en fondeadas; challenge, Instant Starter y Guardian X sin restricción. — https://tradingfinder.com/props/blue-guardian/
- **Fin de semana/overnight:** sin restricción en todos los tipos. — https://www.luxalgo.com/prop-firms/blue-guardian/
- **EAs:** permitidos (grid OK según EAFunded); prohibido explotar delays demo, HFT, arbitraje. Copy sólo entre cuentas propias. Apalancamiento 1:100 forex. — https://www.eafunded.com/firms/blue-guardian; https://thetrustedprop.com/prop-firms/blue-guardian

**Precio** [2026]: Instant 10k $75, 25k $156, 50k $243, 100k $467 (con descuento; regulares $100/$208/$324/$623). **Activación tras pasar: $69–$1,377 según tamaño.** Códigos 25–30%. — https://thetrustedprop.com/prop-firms/blue-guardian; https://propfirmmatch.com/prop-firms/blue-guardian

**Plataformas:** MT5, Match-Trader, TradeLocker (MT4 retirado). — https://thetrustedprop.com/prop-firms/blue-guardian

**Payouts** [2026]: 100% de los primeros $15k, luego 90/10; 24–48 h; métodos cripto y Rise. — https://lunefi.com/blog/blue-guardian-an-in-depth-guide-rules-review-and-discount
- **Argentina: NO en lista restringida** (Afganistán, Albania, Argelia, Cuba, Irán, Jordania, Libia, Myanmar, Corea del Norte, Filipinas, Senegal, Siria, Vietnam). — https://thetrustedprop.com/prop-firms/blue-guardian

**Reputación / estadísticas:** incidentes concretos 2025-26: no encontrado. Tasa de aprobación: no encontrado.

---

### 2.8 Maven Trading (UK)

**Evaluación** [2026]
- 1-step, 2-step, 3-step e Instant; objetivo 8%; DD diario 3–4%; DD máx. 5% trailing (1-step) u 8% estático (2-step). Fondeada: DD diario 4% EOD, máx. 8% trailing desde equity máximo flotante. Límite de tiempo / días mínimos: no encontrado. — https://lunefi.com/blog/maven-trading-complete-guide-to-rules-and-payouts; https://www.propfirmscompared.com/prop-firms/maven-trading

**Reglas críticas** [2026]
- **Noticias:** prohibido abrir/cerrar ±2 min de noticias "red folder" (ForexFactory); Instant y Mini exentas. — https://tradingfinder.com/props/maventrading/rules/
- **Fin de semana:** permitido. **EAs: prohibidos totalmente** (sin vía de aprobación). Copy de terceros prohibido; entre cuentas propias OK. Apalancamiento 1:75 forex. — https://thepropfirmguide.com/maven-trading/; https://blog.pickmytrade.io/maven-trading-copy-trading-rules-whats-allowed-in-2026/
- **Tope de payout $10,000 por 30 días rodantes** y entrevista de riesgo obligatoria a partir de $5,000 acumulados. — https://brokeranalysis.com/prop-trading-firms/maven-trading/; https://propvator.com/blog/maven-trading-payout-methods/

**Precio** [2026]: 2k desde $13–19; 10k 1-step $37 (MT5, abr-2026; cTrader ~doble); 100k desde $299. Código "MVN" 40%. — https://clearank.com/prop-trading-firms/maven-trading-review/; https://fundedtrading.com/propfirm/maven/

**Plataformas:** Match-Trader (primaria), MT5, cTrader. — https://newyorkcityservers.com/blog/maven-trading-review

**Payouts** [2026]: 80%; 1er payout 14 días; luego cada 10 días hábiles (7 con add-on); banco, cripto, Rise ($20 fee). — https://tradersunion.com/brokers/prop/view/maven-trading/payout-and-withdrawal-rules/
- **Argentina: permitida**; para algunos países el payout sólo vía Rise. — https://www.surgefunded.com/maven-prop-firm-supported-and-restricted-countries/; https://maventrading.com/faqs [oficial]

**Reputación:** reseñas señalan el tope de $10k y entrevistas como "red flags"; incidentes concretos: no encontrado. — https://myforexfirms.com/blogs/maven-trading-review-2026
**Estadísticas:** no encontrado.

---

### 2.9 Goat Funded Trader (GFT)

**Evaluación** [2026]
- 1-step 10%; 2-step GOAT 8% / 4%, DD diario 4%, máx. 10% trailing; 3-fases 6%; Instant sin objetivo (3% diario, 6% máx.). **Seis modelos de drawdown distintos según la cuenta** (dos pueden reventar una cuenta en beneficio). Sin límite de tiempo; 3 días mín. — https://tradingfinder.com/props/goat-funded-trader/rules/; https://proptradingvibes.com/prop-firms/goat-funded-trader; https://propjournal.net/prop-firms/goat-funded-trader/rules

**Reglas críticas** [2026]
- **Noticias:** trades abiertos/cerrados ±2 min de red folder sólo pueden generar 1% de beneficio; el exceso se elimina. — https://tradingfinder.com/props/goat-funded-trader/rules/
- **Fin de semana:** permitido; explotar gaps prohibido. Apalancamiento 1:100 eval → 1:50 fondeada. **Copy trading totalmente prohibido.** EAs: sólo si sos dueño del código; HFT, "Gold arbitrage EAs" y EAs comerciales para pasar challenges prohibidos. — https://www.eafunded.com/firms/goat-funded-trader; https://newyorkcityservers.com/blog/goat-funded-trader-review
- **Consistencia sólo en fondeada:** mejor día ≤20% del total del periodo (según help center; el % varía por modelo); no cierra la cuenta, bloquea el payout. Desde 25-jul-2026: 4 días con ≥0,5% para cobrar (antes 3); Instant 5 días. — https://help.goatfundedtrader.com/en/articles/15290379-what-is-the-consistency-rule [oficial]
- 2% fee de procesamiento en cada payout; mín. $100; procesado en 2 días hábiles. — https://cryptoslate.com/prop-firms/goat-funded-trader-review/

**Precio** [2026]: 5k desde $30–36; 100k eval ≈ $263–499 (fuentes discrepan); Instant 100k $489 (10-ago-2026, antes $815). Fee refundable con 1er payout. Códigos 50%. — https://proptradingvibes.com/prop-firms/goat-funded-trader; https://www.futureshive.com/blog/goat-funded-trader-review-2026

**Plataformas:** MT5, TradeLocker, Match-Trader, Volumetrica. — https://www.fxempire.com/prop-firms/goat-funded-trader

**Payouts:** Rise, cripto (BTC/ETH/USDT), Skrill, banco. — https://www.brokeranalysis.com/prop-trading-firms/goat-funded-trader/payouts/
- **Argentina: NO en lista de 26 restringidos** (incluye Chile, Venezuela, Rusia, Israel, Singapur, Hong Kong…). — https://tradeaquila.com/find/goat-funded-trader

**Reputación 2025-26 (⚠ la más frágil de la lista)**
- Abril 2026: absorbió TradeXMastery sin avisar ni dar opt-out; cuentas fondeadas reemplazadas. Payout pre-fusión "seguro" que no llegó semanas después (Forex Peace Army). Trustpilot cayendo hacia 2,6 con bandera de reseñas falsas. Quejas recurrentes de retiros denegados por "violación" vaga y tope al primer payout no informado. Aun así, >$11M pagados documentados ($7M en 2025). — https://curvedtrading.com/articles/en/reviews/goat-funded-trader-review/; https://newyorkcityservers.com/blog/goat-funded-trader-review

**Estadísticas:** no encontrado.

---

### 2.10 Topstep (futuros, Chicago)

**Evaluación (Trading Combine)** [2026]
- 50k/100k/150k: objetivo $3k/$6k/$9k; Daily Loss Limit $1k/$2k/$3k; Maximum Loss Limit trailing EOD $2k/$3k/$4.5k (se congela al llegar al balance inicial); contratos máx. 5/10/15 minis (micros 10:1); sin días mínimos; suscripción mensual sin fecha límite. — https://proptradingvibes.com/blog/topstep-trading-combine-rules; https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit [oficial]
- Nota: fuentes discrepan si el DLL "hard" se aplica o si sólo hay MLL en Combine; el MLL se monitorea en tiempo real. — https://proptradingvibes.com/blog/topstep-rules-overview

**Reglas críticas** [2026]
- **Consistencia:** Standard XFA: 5 días ganadores ≥$150 y mejor día ≤50% para cobrar; variante "Consistency" 40% con 3 días. — https://www.quantvps.com/blog/topstep-consistency-rule; https://tradecovex.com/guides/topstep-payout-rules-2026
- **Overnight / fin de semana: prohibido**, flat a las 3:10 PM CT. Noticias: permitido. — https://propvator.com/blog/topstep-overnight-holding/; https://fortraders.com/blog/topstep-funded-account-rules
- Conducta prohibida (hedging entre cuentas, copy de terceros, etc.). — https://help.topstep.com/en/articles/10296582-prohibited-conduct [oficial]

**Precio** [jul-2026]: $49/$99/$199 al mes (Standard) + $149 activación al pasar; ruta sin activación $95/$149/$229. — https://help.topstep.com/en/articles/14289835-topstep-pricing-and-payment-questions [oficial]; https://proptradingvibes.com/blog/topstep-pricing-breakdown

**Plataformas:** TopstepX, NinjaTrader, Tradovate (sin MT5). — https://proptradingvibes.com/blog/topstep-trading-platforms

**Payouts** [2026]: cuentas creadas desde 12-ene-2026: 90/10 desde el primer dólar (antes 100% de los primeros $10k). Caps en XFA $2k–$6k por payout; mín. $125; 1–3 días. Métodos: Prop-to-Brokerage y Aeropay/ACH (US), Wise (sólo China/Canadá/UK), Wire/SWIFT internacional ($30). **Para Argentina el método práctico sería SWIFT** (no hay cripto/Rise). — https://help.topstep.com/en/articles/8284233-topstep-payout-policy [oficial]; https://proptradingvibes.com/blog/topstep-payout-rules
- **Argentina:** no aparece ni en la lista de inelegibles ni en la de "sólo Express Funded" (Bolivia sí está en la segunda). Confirmar en la página de elegibilidad oficial. — https://help.topstep.com/en/articles/8284116-am-i-eligible-to-trade-with-topstep [oficial]; https://x.com/AskTopstep/status/2038962464419647809

**Reputación 2025-26**
- **Demanda judicial (abril 2026)** en corte federal de EE.UU.: un trader acusa reglas diseñadas para impedir payouts. — https://www.youtube.com/watch?v=vaEPXdvS578; https://tradersunion.com/brokers-blacklist/prop/
- Análisis de casos de bans con $40k retenidos vs. el claim "99% de aprobación". — https://www.propscorer.com/blog/topstep-payout-claims-vs-reality-2026

**Estadísticas publicadas (Topstep, año 2025)** — la disclosure más completa del sector:
- 16,8% de los Combines iniciados se completaron; 51,8% de las personas pasaron al menos un Combine; 33,3% de los fondeados recibieron algún payout; 0,71% llegaron a Live Funded. Éxito real (empezar → cobrar) ≈ 2,8%. 99,26% de aprobación de payouts (sólo entre quienes llegan a pedirlos). — https://tradecovex.com/guides/how-many-combines-passed-express-topstep-2025; https://www.topstep.com/instant-payouts [oficial]

---

### 2.11 Apex Trader Funding (futuros, Texas)

**Evaluación (Apex 4.0, desde 1-mar-2026)** [2026]
- Pago único (ya no suscripción). Dos variantes por tamaño: **EOD Trail** (con Daily Loss Limit) e **Intraday Trail** (sin DLL en eval). 50k/100k/150k: objetivo $3k/$6k/$9k; trailing DD $2.5k/$3k/$5k; contratos 10/14/17 minis; sin días mínimos; **30 días** para alcanzar el objetivo. — https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-evaluations/ [oficial]; https://phidiaspropfirm.com/education/apex-trader-funding-4-0-explained
- Static 100k: $137/mes, objetivo $2,000, DD fijo $625 (fuente posiblemente pre-4.0). — https://blog.traderspost.io/article/apex-trader-funding-pricing-evaluation-guide

**Reglas críticas** [2026]
- **Sin consistencia en evaluación.** Para payout: 50% (ningún día >50% del beneficio desde el último payout), 5 días rentables, mín. $500, balance por encima del Safety Net. — https://tradetanto.com/learn/apex-trader-funding-rules-what-you-need-to-know; https://www.forexfactory.com/thread/1392737-apex-trader-funding-payout-rules-in-2026
- **Overnight y fin de semana: prohibidos en 4.0** (flat 4:59 PM ET) — cambio respecto a legacy. Noticias: permitido, pero **prohibido poner órdenes a ambos lados para "apostar" al resultado**. — https://www.fundedmath.com/apex-overnight-trades; https://www.thetradingplaybook.com/strategies/news-trading/on/apex-trader-funding
- 4.0 eliminó la regla MAE, el 5:1 RR y el mínimo de 7 días. — https://spicyfutures.com/apex-trader-funding-4-0-review-2026/

**Precio** [2026]: 25k $167 / 50k $207 (Rithmic; fuente puede ser pre-4.0); activación desde 1-mar-2026: $59 (Intraday, todos los tamaños) o $119/$139/$149/$159 (EOD 25k/50k/100k/150k), o $0 en variante "No Activation Fee". Descuentos del 80–90% son habituales en Apex. — https://www.fundedfuturesfamily.com/apex-activation-fee/; https://www.eltraderfinanciado.com/en/news/apex-trader-funding/apex-trader-funding-price-cuts-zero-activation-fee-2026

**Plataformas:** Rithmic / Tradovate (NinjaTrader, etc.); sin MT5.

**Payouts** [2026]: 100% split (marketing); ACH (US) y **Plane** para internacionales; antes Deel (desde sep-2022). Automatizados en 4.0. — https://apextraderfunding.com/help-center/additional-helpful-items/payout-method-international-users/ [oficial]
- **Argentina:** fuente en español dice que acepta Argentina, México, Colombia, Chile, Perú, Uruguay. Lista de 84 restringidos (Rusia, China, Irán, Nigeria, Pakistán…) no menciona Argentina. Verificar además restricciones de Plane/Deel. — https://apextraderfunding.com/preguntas-frecuentes/ [oficial]; https://restrictedcountries.com/apex-trader-funding-restricted-countries

**Reputación 2025-26**
- 2025: "revuelta" de la comunidad por denegaciones de payout por "windfall violations" (métrica vaga) mientras operadores usaban copiadores para stackear cuentas; motivó el rediseño 4.0. — https://propfirmescape.com/blog/apex-evaluation-rules-2026/
- >$598–660M pagados desde 2022; ~$15M/mes fines 2025. — https://blog.pickmytrade.trade/apex-trader-funding-review-2025-worth-it-real-data/

**Estadísticas:** terceros citan 15–20% de aprobación al primer intento (40% con resets); disclosure oficial: no encontrado. — https://www.quantvps.com/blog/prop-firm-statistics

---

### 2.12 MyFundedFutures (MFFU, futuros)

**Evaluación** [jul/ago-2026]
- Planes actuales: Builder, Rapid, Pro (Core y Flex legacy; Starter/Expert/Milestone retirados). Objetivo ~6%: $1.5k/$3k/$6k/$9k (25/50/100/150k). DD: 4% en 50k, 3% en 100k/150k; EOD trailing (Pro, Builder, Core), intradía (Rapid), EOD estático (Flex). **Sin daily loss limit en ningún plan** (Builder: $1,000 soft pause). Días mínimos: 1 (Builder) / 2 (resto). Límite de tiempo: no encontrado. — https://proptradingvibes.com/blog/myfundedfutures-rules-overview; https://tradetanto.com/learn/my-funded-futures-rules-a-trader-s-guide

**Reglas críticas** [2026]
- Consistencia 50% en evaluación (Builder no); Core 40% en fondeada; Rapid/Pro sin consistencia fondeada. — https://proptradingvibes.com/blog/myfundedfutures-payout-rules
- **Overnight y fin de semana permitidos en todos los planes (desde mar-2026)**; noticias permitidas, pero posición overnight debe cerrarse antes de la ventana de 2 min pre-noticia Tier 1. — https://proptradingvibes.com/blog/myfundedfutures-overnight-holding

**Precio** [6-ago-2026]: $105 (Builder 25k) a $477 (Pro 150k). — https://proptradingvibes.com/prop-firms/myfundedfutures

**Payouts** [2026]: Pro 80/20, elegible 14 días desde el 1er trade, mín. $1,000, buffers $2.1k/$3.1k/$4.6k; Rapid 90/10, diario, mín. $500, sin cap; Core 80/20 cap $5k por ciclo. Métodos: Riseworks (banco + cripto), ACH, wire ($50 internacional). — https://proptradingvibes.com/blog/myfundedfutures-payout-rules
- **Argentina: no restringida** (sólo OFAC: Irán, Corea del Norte, Cuba, Siria, Rusia, territorios ocupados; posiblemente Bielorrusia, Myanmar, Venezuela). — https://proptradingvibes.com/blog/myfundedfutures-restricted-countries

**Reputación 2025-26**
- Payout de $63k rechazado "sin razón válida" y bloqueo en redes (nov-2025, @propfirmeye). Patrón de cuentas terminadas tras pedir retiro por "múltiples perfiles"/"trading coordinado" sin evidencia pública. Aun así, $123M pagados en 55,733 payouts (mejor registro publicado en futuros). — https://x.com/propfirmeye/status/1992444325901578359; https://theindustryspread.com/myfundedfutures-review-payouts-ban-complaints/

**Estadísticas:** tasa de aprobación: no encontrado.

---

## 3. Panorama de la industria 2025-2026 (quiebras y denegaciones)

- Entre feb-2024 y fin de 2025 cerraron 80–100 prop firms; ~$50M+ de fondos de traders bloqueados. — https://thepropfirmguide.com/prop-firms-that-shut-down/; https://edge-ledger.io/prop-firm-payout-tracker
- Cierres 2026 documentados: **Seacrest Funding (6-feb-2026)**, **MyFundedFX (feb-2026)**, **FundingTicks (mayo-2026, tras recortes retroactivos de beneficios)**. — https://propfirmmap.com/blog/prop-firm-industry-news-shutdowns-rebrands-new-firms-q2-2026; https://fundedprogram.com/%F0%9F%9A%A8-fundingticks-closes-its-doors/
- Blacklists: Crypto Fund Trader (reglas retroactivas), Fidelcrest (2025, reglas retroactivas y retención de payouts). — https://tradersunion.com/brokers-blacklist/prop/; https://vettedpropfirms.com/prop-firm-scams-and-blacklist/
- Patrón previo al colapso: payouts se demoran → reglas se endurecen → beneficios se recortan retroactivamente. — https://fxnx.com/en/blog/prop-firm-closures-dated-record-shutdowns-payout-halts
- Sobrevivientes dominantes y capitalizados: FTMO, Apex, FundingPips, Tradeify. — https://fundedtrading.com/are-prop-firms-legit/
- Regulación: CFTC/FCA/ASIC evaluando licencias, ventanas de noticias estandarizadas, posible clasificación CTA. — https://www.kenmoredesign.com/2026/01/06/global-regulatory-risks-for-prop-firms/

---

## 4. Tasas de aprobación: qué es dato real y qué es estimación

| Firma | Dato | Origen |
|---|---|---|
| Topstep (2025) | 16,8% de Combines completados; 51,8% de personas pasaron ≥1; 33,3% de fondeados cobraron; 0,71% a Live; ≈2,8% de inicio a cobro | Disclosure oficial de Topstep citada por https://tradecovex.com/guides/how-many-combines-passed-express-topstep-2025 [2026] |
| FTMO | No publica tasa. Estimaciones: 8–12% pasa; 5–7,5% cobra | https://coinlaw.io/ftmo-statistics/; https://traderssecondbrain.com/guides/prop-firm-pass-rate [2026] |
| Apex | 15–20% primer intento (estimación de terceros) | https://www.quantvps.com/blog/prop-firm-statistics [2026] |
| The5ers | 5–15% (estimación) | https://www.quantvps.com/blog/prop-firm-statistics |
| Industria | ~7% de compradores de challenge llegan a cobrar; pass rate 5–14% | https://track360.io/blog/prop-trading-industry-statistics-2026; https://thepropfirmguide.com/prop-firm-statistics/ |
| FundedNext, FundingPips, Alpha, E8, Blue Guardian, Maven, Goat, MFFU | Tasa de aprobación publicada: **no encontrado** (sólo montos pagados) | — |

Tiempo medio para pasar: no encontrado como dato oficial en ninguna firma; una fuente cita 15–25 días de trading en Blue Guardian fase 1 (anecdótico). — https://www.tradernotion.com/blog/how-to-pass-blue-guardians-challenge-2026

---

## 5. Estrategias "para pasar rápido" y por qué las firmas las prohíben

| Estrategia | Qué hacen | Quién la prohíbe / cómo la neutraliza | Fuente |
|---|---|---|---|
| **"One trade" / all-in en oro** | Una posición sobredimensionada en XAUUSD para tocar el objetivo en un día. Funciona donde no hay días mínimos ni consistencia (E8 One, FundingPips Flex, FTMO 1-Step, Apex, MFFU Builder). | Best Day / consistencia (FTMO 1-Step 50%, FundedNext 40%, Alpha 40%, Blue Guardian 50%, Goat 20%, E8 40%, Apex/Topstep/MFFU 50%) bloquean el payout aunque pases; el rango diario del oro provoca breach del DD diario 3–5% con facilidad. The5ers cerró una cuenta por "pure speculative gambling" por un solo trade. | https://fxnx.com/en/blog/gold-prop-firms-2026-master-xauusd-volatility; https://propnavi.io/en/blog/consistency-rule-explained/; https://www.forexpeacearmy.com/community/threads/thee5ers-denied-my-payout-without-breaking-any-rules.89478/ |
| **Pasar en una semana con gold scalping** | Método "bajo riesgo" en XAUUSD, 1–2 trades/día, 7 días. | Spreads/comisiones en oro erosionan; algunas firmas prohíben tick scalping (The5ers, FundingPips, FundedNext) y exigen >50% de trades >1 min (E8) o >10 s (Tradeify). | https://medium.com/@fxmbrand/how-to-pass-any-prop-firm-challenge-in-7-days-the-low-risk-gold-trading-method-b69f642fb9b0; https://fxnx.com/en/blog/best-prop-firms-gold-scalping-2026-spread-test |
| **News straddle (pendientes arriba y abajo en NFP/CPI/FOMC)** | Dos stops pendientes para atrapar el spike. | Slippage llena ambas órdenes; **FundingPips cierra la cuenta por "operar noticias a propósito"**; FTMO Standard fondeada prohíbe pendientes ±2 min; Alpha/E8/Blue Guardian ±5 min en fondeadas; Maven ±2 min; Goat limita el beneficio al 1%; **Apex prohíbe expresamente órdenes a ambos lados para apostar la noticia**. | https://propjournal.net/guides/news-trading-prop-firms; https://help.fundingpips.com/hc/en-us/articles/34504137479441-News-Trading-Weekend-Holding; https://www.thetradingplaybook.com/strategies/news-trading/on/apex-trader-funding |
| **Hedging entre dos cuentas / dos firmas** | Long en una cuenta, short en otra: una siempre pasa. | Prohibido universalmente ("opposite account trading" en FundingPips, "hedging across accounts" en FundedNext, "prohibited conduct" en Topstep). Detección: posiciones opuestas con timestamps coincidentes, IP/dispositivo/KYC compartidos y servicios de riesgo de terceros que agregan datos entre firmas y proveedores de liquidez comunes. Consecuencia: cierre de todas las cuentas, reversión de beneficios, ban permanente. | https://thortradecopier.com/blog/hedging-across-prop-accounts-banned; https://blog.pickmytrade.io/why-prop-firms-ban-cross-account-hedging/; https://propfirmsfinder.com/guides/prop-firm-hedging-rules/ |
| **Copy trading / EAs comerciales "pasa-challenges"** | Copiar señales o usar EA vendido para pasar. | FundedNext: copy sólo entre cuentas propias (≤$300k) y nunca fondeadas; E8: una estrategia por usuario; Goat: copy totalmente prohibido, EA sólo si sos dueño del código; Maven: EAs prohibidos; Alpha: EA con aprobación previa; The5ers: prohibidas señales de terceros. | ver secciones por firma |
| **Martingala / grid** | Promediar en contra hasta recuperar. | FundedNext prohíbe grid; E8 y Blue Guardian permiten (según EAFunded/TradingFinder); FTMO no lo prohíbe explícitamente pero sanciona "gambling". Con DD diario 3–5% la martingala revienta la cuenta antes de recuperarse. | https://tradingfinder.com/props/e8-markets/rules/; https://www.eafunded.com/firms/blue-guardian; https://help.fundednext.com/en/articles/8020351-what-are-the-restricted-prohibited-trading-strategies |

Consenso 2026 de las guías: el "camino rápido" que sobrevive al payout es el 2-step con objetivos por fase pequeños, riesgo 0,5–1% por trade y respetar el DD diario (que incluye flotante). — https://fxnx.com/en/blog/gold-prop-firms-2026-master-xauusd-volatility; https://seunforex.com/ftmo-1-percent-rule-2026-complete-guide-2026/

---

## 6. Notas específicas para un trader en Argentina

- Ninguna de las 12 firmas lista a Argentina como país restringido en las fuentes encontradas; Alpha Capital y Topstep quedan como "no confirmado" por falta de lista explícita. Argentina sí aparece en listas de "prop firms disponibles para Argentina". — https://propfirmmatch.com/prop-firm-lists/countries/argentina; https://bestpropfirmguide.com/guides/top-prop-firms-that-accept-clients-from-argentina/; https://propfirmxl.com/prop-firms-in-argentina/
- Cobro: los rails que funcionan sin banco internacional son cripto (USDT/USDC) y Rise; los usan FTMO, FundedNext, FundingPips, The5ers, E8 (Rise/Plane), Blue Guardian, Maven, Goat, MFFU. Apex paga a internacionales vía Plane (antes Deel). Topstep y Alpha no ofrecen cripto directo (Alpha vía Rise; Topstep SWIFT $30). — https://propfirmmap.com/blog/best-prop-firms-crypto-payouts-2026-bitcoin-usdt-usdc-withdrawals; https://tradefunded.org/payouts-guide
- Impuestos: existe discusión local sobre si facturar payouts con Factura E. — https://cripto-contador.com/trading-y-cuentas-de-fondeo/factura-e-y-cuentas-de-fondeo-hay-que-facturar-los-payouts/
- MT5: disponible en las 9 firmas de CFD; en FundingPips gratis y en Maven es la opción más barata. Las 3 de futuros no usan MT5.

---

## 7. Datos que NO se encontraron (lista honesta)

- Tasa de aprobación oficial de FTMO, FundedNext, FundingPips, The5ers, Alpha, E8, Blue Guardian, Maven, Goat, Apex, MFFU.
- Tiempo medio para pasar (ninguna firma).
- Precio exacto 100k High Stakes de The5ers; objetivos por fase de Alpha One/Pro/Swing/Three; límite de tiempo de Alpha, Maven y MFFU; días mínimos de Alpha, Maven y High Stakes.
- Lista de países restringidos de Alpha Capital y confirmación explícita de Argentina en Topstep y Apex (sólo indicios).
- Spreads/comisiones concretos de XAUUSD/BTCUSD por firma (sólo FTMO ≈$3/lote forex).
- Confirmación oficial de la "regla de 1% por trade tras primer payout" en FTMO (sólo una queja de usuario).
- Reembolso del fee en FundingPips.
