# Estrategia "breakout" — Ruptura del rango asiático con filtro de compresión (BTCUSD, H1)

Agente: breakout · Datos: Bitstamp BTC/USD H1, 2023-09-01 → 2026-09-05 (26.402 velas) · IS hasta 2025-02-28, OOS desde 2025-03-01.

## 1. Lógica en 5 líneas

1. **Rango asiático**: máximo/mínimo de las 8 velas H1 de 00:00–07:59 UTC; queda fijado al cierre de la vela de las 07:00.
2. **Filtro de compresión**: ancho del rango < 0,35 × ATR(14) diario del día anterior (ATR = SMA del True Range, como el `iATR` de MT5). Filtro de volumen: volumen de la vela de ruptura > 1,2 × SMA(20) del volumen.
3. **Entrada**: entre las 08:00 y las 12:59 UTC, si una vela H1 cierra por encima del máximo del rango → largo; por debajo del mínimo → corto; se ejecuta en la apertura de la vela siguiente. Máximo 1 operación por día y por dirección.
4. **Salidas**: SL = máx(0,5 × ancho del rango, 0,25 × ATR diario) desde el cierre de la vela de señal; TP = 2 R; cierre forzoso de la posición en la apertura de la vela de las 23:00 UTC.
5. **Tamaño**: lotes = (1 % de 1.000 USD) / distancia del SL, redondeado a 0,01 (mínimo 0,01). Sin interés compuesto en el backtest; el EA usa el balance real.

Nota: con `compress_k = 0,35` y `sl_mult = 0,5`, 0,5 × ancho ≤ 0,175 × ATR < 0,25 × ATR, por lo que en la práctica **el SL es siempre 0,25 × ATR diario** (por eso `sl_mult` no cambia nada en la tabla de robustez).

## 2. Proceso de optimización (solo in-sample)

- Rejilla de 192 combinaciones (`optimize.py`, resultados completos en `opt_grid.csv`): `compress_k ∈ {0,35, 0,5, 0,7, sin filtro}`, `sl_mult ∈ {0,5, 1}`, `tp_r ∈ {1,5, 2, 3}`, `entry_end ∈ {13, 16}`, `exit_eod ∈ {sí, no}`, `vol_mult ∈ {0, 1,2}`.
- Criterio de selección declarado ANTES de mirar OOS: `score = PF × min(1, 300/DD) × min(1, trades/60)` con beneficio > 0 (prima PF y DD bajo, no el beneficio). Coste Pepperstone, leverage 2, `stop_on_dd=False`.
- Elegida: `compress_k=0,35, sl_mult=0,5, tp_r=2, entry_end=13, exit_eod=True, vol_mult=1,2` (IS: +124,78 USD, PF 1,50, DD 53 USD, 70 trades).
- Como referencia se guardó también la **variante B** (mayor beneficio IS con PF ≥ 1,3 y DD ≤ 300: `compress_k=0,7, sl_mult=1, tp_r=2, entry_end=16, exit_eod=False, vol_mult=0`). Sirve para mostrar lo que pasa al elegir por beneficio.

## 3. Resultados (`results.md` / `results.json`, generados por `run.py`)

### 3.1 Corrida oficial (max_dd_limit=300, stop_on_dd=True)

| Periodo | Coste | Lev | Neto USD | USD/hora | DD máx (intravela) | Trades | Win % | PF | Costes USD |
|---|---|---|---|---|---|---|---|---|---|
| IS | Pepperstone | 2 | 124,78 | 0,0095 | 53,34 | 70 | 47,1 | 1,50 | 47,36 |
| IS | Pepperstone | 10 | 127,08 | 0,0097 | 53,34 | 70 | 47,1 | 1,51 | 47,68 |
| IS | Eightcap | 2 | 139,58 | 0,0106 | 52,37 | 70 | 48,6 | 1,58 | 32,56 |
| IS | Eightcap | 10 | 141,98 | 0,0108 | 52,37 | 70 | 48,6 | 1,59 | 32,78 |
| IS | Conservador | 2 | 87,78 | 0,0067 | 55,79 | 70 | 45,7 | 1,33 | 84,36 |
| IS | Conservador | 10 | 89,83 | 0,0068 | 55,79 | 70 | 45,7 | 1,34 | 84,93 |
| **OOS** | **Pepperstone** | **2** | **1,81** | **0,0001** | **129,09** | **62** | **40,3** | **1,007** | 23,04 |
| OOS | Pepperstone | 10 | -8,26 | -0,0006 | 139,16 | 62 | 40,3 | 0,971 | 24,00 |
| OOS | Eightcap | 2 | 9,01 | 0,0007 | 125,39 | 62 | 40,3 | 1,03 | 15,84 |
| OOS | Eightcap | 10 | -0,76 | -0,0001 | 135,16 | 62 | 40,3 | 0,997 | 16,50 |
| OOS | Conservador | 2 | -16,19 | -0,0012 | 138,34 | 62 | 38,7 | 0,944 | 41,04 |
| OOS | Conservador | 10 | -27,01 | -0,0020 | 149,16 | 62 | 38,7 | 0,910 | 42,75 |
| FULL | Pepperstone | 2 | 175,66 | 0,0067 | 139,16 | 135 | 45,2 | 1,33 | 72,32 |
| FULL | Pepperstone | 10 | 177,96 | 0,0067 | 139,16 | 135 | 45,2 | 1,33 | 72,64 |
| FULL | Eightcap | 2 | 198,26 | 0,0075 | 135,16 | 135 | 45,9 | 1,38 | 49,72 |
| FULL | Eightcap | 10 | 200,66 | 0,0076 | 135,16 | 135 | 45,9 | 1,38 | 49,94 |
| FULL | Conservador | 2 | 119,16 | 0,0045 | 149,16 | 135 | 43,7 | 1,21 | 128,82 |
| FULL | Conservador | 10 | 121,21 | 0,0046 | 149,16 | 135 | 43,7 | 1,21 | 129,39 |

Ningún caso tocó el límite de 300 USD, así que el stop por DD nunca actuó. Beneficio por año (Pepperstone, lev 2, FULL): 2023 +41, 2024 +95, 2025 +144, 2026 (hasta sept.) **-105**.

### 3.2 FULL sin stop_on_dd (drawdown real)

| Coste | Lev | Neto USD | DD máx intravela | DD máx a cierre |
|---|---|---|---|---|
| Pepperstone | 2 | 175,66 | **139,16** | 136,56 |
| Pepperstone | 10 | 177,96 | 139,16 | 136,56 |
| Eightcap | 2 | 198,26 | 135,16 | 132,56 |
| Eightcap | 10 | 200,66 | 135,16 | 132,56 |
| Conservador | 2 | 119,16 | 149,16 | 146,56 |
| Conservador | 10 | 121,21 | 149,16 | 146,56 |

Idéntico a la corrida oficial porque el DD nunca superó 300 USD. El leverage casi no influye: con riesgo del 1 % y SL ≈ 0,25 × ATR diario, la posición es de 0,01–0,03 lotes, muy por debajo del tope de margen incluso con leverage 2 (el único efecto de lev 10 es un coste de swap/margen ligeramente distinto en las pocas operaciones de 2023 con BTC a 26k).

### 3.3 Robustez ±20 % / ±40 % (OOS, Pepperstone, lev 2, stop_on_dd=False)

Resultado: **14 de 36 variaciones con beneficio > 0 (38,9 %)** → NO supera el umbral del 70 %.

| Parámetro (base) | ×0,6 | ×0,8 | base | ×1,2 | ×1,4 |
|---|---|---|---|---|---|
| compress_k (0,35) | +16,3 (24 tr) | -10,1 | +1,8 | -52,8 | -85,9 |
| sl_mult (0,5) | +1,8 | +1,8 | +1,8 | +1,8 | +1,8 (irrelevante, manda sl_floor_atr) |
| sl_floor_atr (0,25) | -13,9 | -70,4 | +1,8 | +52,8 | +105,9 |
| tp_r (2) | -48,3 | -41,3 | +1,8 | +12,3 | +24,9 |
| vol_mult (1,2) | -107,0 | -38,4 | +1,8 | -33,3 | -42,7 |
| entry_end (13) | 0 (sin trades) | +22,2 (27 tr) | +1,8 | -128,8 | -112,0 |
| risk_pct (1) | +13,8 | +6,9 | +1,8 | -26,3 | -18,9 |
| atr_len (14) | +31,8 | -29,9 | +1,8 | -34,5 | -53,1 |
| vol_len (20) | -77,7 | -43,6 | +1,8 | +13,8 | -22,6 |

(Valores = beneficio neto OOS en USD; tabla completa con DD, PF y trades en `results.md`.)

Lectura: el resultado OOS es esencialmente cero y cualquier variación lo mueve unas decenas de USD en un sentido u otro. No hay una zona "estable" de parámetros; sólo `sl_floor_atr` más alto (SL más ancho) mejora de forma monótona, lo que sugiere que la ventaja —si existe— está en no ser barrido por el ruido, no en la ruptura en sí.

### 3.4 Variante B (elegida por beneficio IS): el ejemplo de sobreajuste

| Periodo | Neto USD (Pepperstone, lev 2) | USD/hora | DD máx | Trades | PF |
|---|---|---|---|---|---|
| IS | +564,25 | 0,0430 | 199,73 | 260 | 1,31 |
| OOS (stop_on_dd) | -180,08 | -0,0136 | 300,36 (límite tocado) | 226 | 0,90 |
| OOS (sin stop) | -208,02 | -0,0157 | 330,55 | 235 | 0,89 |

La combinación con más beneficio en IS pierde 180–208 USD en OOS y rompe el límite de 300 USD. Confirma que la elección por PF/DD era la correcta y que el "borde" que mostraba la rejilla en IS es mayoritariamente ajuste a la muestra.

## 4. ¿Se alcanza 1 USD/hora con DD ≤ 300 USD?

**No, ni de lejos.** Con los números en la mano:

- OOS (Pepperstone, lev 2): **+1,81 USD en 13.273 horas = 0,0001 USD/hora**. El objetivo es 1 USD/hora → estamos a ~1/7.000 del objetivo. En FULL, 0,0067 USD/hora (175 USD en 3 años), menos que el buy & hold (0,078 USD/hora), aunque con DD 139 USD frente a más de 300 del buy & hold.
- El DD sí se respeta (139 USD máximo intravela en 3 años), pero porque la estrategia arriesga 1 % por operación y opera ~45 veces al año; a ese ritmo, aunque tuviera PF 1,5 en OOS, el techo realista sería ~0,01–0,02 USD/hora.
- Restricción estructural: para ganar 24 USD/día con 0,01 lotes (lo que permite un SL de ~600 USD y riesgo de 10 USD) haría falta capturar 2.400 USD de movimiento neto **cada día**, es decir, aproximadamente todo el ATR diario de BTC todos los días. Con leverage 10 y 0,09 lotes seguirían siendo ~270 USD/día de movimiento neto capturado a diario. El objetivo de +72 % mensual con 30 % de DD máximo no es alcanzable con una estrategia direccional de ruptura de rango en H1.

## 5. Puntuación honesta (rúbrica del brief)

| Criterio | Valor | Puntos |
|---|---|---|
| USD/hora OOS (Pepperstone, lev 2) | 0,0001 (+1,81 USD) | **1** por la letra de la rúbrica (">0"); en la práctica es ruido estadístico, sería justo 0 |
| Max DD FULL sin stop ≤ 300 | 139,16 USD | **2** |
| Robustez (≥70 % variaciones OOS positivas) | 38,9 % | **0** |
| PF OOS ≥ 1,3 y ≥ 60 trades | PF 1,007, 62 trades | **0** |
| EA MQL5 fiel con protección de DD | entregado; no he podido compilarlo aquí (sin MetaEditor) | **1** (0,5 si se penaliza la falta de compilación) |
| Informe claro y honesto | — | **1** |
| **Total** | | **5/10 por la letra; 4/10 por el espíritu** |

## 6. EA `breakout.mq5`

- Misma lógica: `iATR(PERIOD_D1, 14)` con shift 1, `iMA(PERIOD_CURRENT, 20, MODE_SMA, VOLUME_TICK)` para el filtro de volumen, rango calculado recorriendo las velas H1 del día UTC actual con `iTime/iHigh/iLow`, hora UTC = hora servidor − `InpServerUtcOffset`.
- Inputs = parámetros; lotes por riesgo (`InpRiskPct` del balance, `SYMBOL_TRADE_TICK_VALUE`, reducción si falta margen), filtro de spread máximo (`InpMaxSpreadUsd`), magic number, trabajo solo al abrir vela nueva (`iTime(...,0)` cambia).
- Protección: máximo histórico de equity persistido en una variable global del terminal; si equity < máximo − `InpMaxEquityDD` (300 USD) cierra todo y deja de operar. Se vigila en cada tick.
- Diferencias conocidas con el backtest: (a) la vela D1 del bróker empieza a medianoche del servidor, no a 00:00 UTC → el ATR diario puede diferir ligeramente; (b) el volumen del bróker es volumen de ticks del CFD, no el volumen real de Bitstamp, así que el filtro de volumen se comportará de forma distinta; (c) el EA entra a mercado al abrir la vela siguiente (igual que el motor) en lugar de con orden stop en el nivel del rango. No he podido compilar el EA (no hay MetaEditor en este entorno); está escrito con la API estándar (`CTrade`, `iATR`, `iMA`, `CopyBuffer`) sin librerías externas.

## 7. Qué haría falta para mejorar (y qué no va a arreglar el objetivo)

- Más operaciones: el filtro de compresión + volumen deja ~45 trades/año; con 60–70 trades por periodo, los resultados son muy sensibles a 3–4 operaciones. Probar en M15 con orden stop real en el nivel del rango (entrada más cercana, SL más ajustado).
- SL más ancho (0,35 × ATR) y TP más lejano (≥2,5 R) mejoran OOS de forma monótona; sería el primer candidato de un segundo ciclo, pero ya sería ajuste al OOS y habría que validarlo con datos nuevos (2026-09 en adelante).
- Filtro de régimen (tendencia diaria: solo rupturas a favor de la EMA 50 D1) o filtro por día de la semana; ambos añaden parámetros y, con este número de trades, más riesgo de sobreajuste.
- Ninguna de estas mejoras acerca la estrategia a 1 USD/hora: el margen realista de una ruptura de rango bien filtrada en BTC es de 0,01–0,05 USD/hora con 1.000 USD y DD ≤ 300. El objetivo del cliente (+72 %/mes) requiere asumir drawdowns muy superiores a 300 USD.

## 8. Notas sobre el motor

- No he encontrado bugs. Observación: el swap se cobra en la primera vela del nuevo día ANTES de ejecutar la señal de cierre, por lo que una posición cerrada "en la apertura de las 00:00" paga swap; por eso la salida horaria se hace a las 23:00 UTC.
- `build_signals` replica internamente la regla del motor (SL antes que TP en la misma vela) para poner `pos=0` en la vela en que se cierra la operación; se ha verificado que el motor no reabre operaciones tras un stop (0 reaperturas en 620 trades de una corrida de prueba) y que todas las entradas coinciden con las señales.

## Archivos

- `trading/strategies/breakout/strategy.py` — lógica y `DEFAULT_PARAMS`
- `trading/strategies/breakout/optimize.py` — rejilla IS (192 combos) → `opt_grid.csv`, `opt_best.json`
- `trading/strategies/breakout/run.py` — corrida oficial → `results.json`, `results.md`
- `trading/strategies/breakout/breakout.mq5` — Expert Advisor MQL5
- `trading/strategies/breakout/REPORT.md` — este informe
