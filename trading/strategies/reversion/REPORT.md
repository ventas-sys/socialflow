# Estrategia `reversion` – Reversión a la media en BTCUSD (M15)

Agente: reversion · Fecha: 2026-09-05 · Datos: Bitstamp BTC/USD M15, 105.606 velas (2023-09-01 → 2026-09-05).
IS = hasta 2025-03-01 (52.512 velas) · OOS = desde 2025-03-01 (53.094 velas, ~18 meses).

## Lógica en 5 líneas

1. Bollinger(20, 3.0) sobre el cierre + RSI(14) Wilder + ATR(14) (media simple del TR), todos calculados como los `iBands/iRSI/iATR` de MT5.
2. **LONG** si el cierre < banda inferior y RSI < 25; **SHORT** si cierre > banda superior y RSI > 75. Sólo a favor de la tendencia mayor: long si cierre > EMA200 de la H4 cerrada, short si cierre < EMA200 H4 (`iMA` H4, sin look-ahead).
3. Salida: **TP dinámico en la banda media** (se reajusta cada vela), **SL duro = cierre ∓ 2,5×ATR**, o **cierre por tiempo a las 8 velas** (2 h) si no ha llegado a la media.
4. Tamaño: riesgo fijo 1,5 % del capital inicial (15 USD) / distancia al SL → ~0,01-0,02 lotes; una posición a la vez, sin martingala ni grid.
5. La señal de la vela t se ejecuta en la apertura de t+1 (lo hace el motor). Variantes probadas y descartadas: filtro horario 07-21 UTC y entrada "al volver dentro de la banda" (`confirm`).

## Resultado en una frase

**No funciona.** OOS con Pepperstone y leverage 2: **−151,7 USD en 18 meses = −0,0114 USD/hora**, PF 0,49, 74 trades. Ni siquiera sin costes es rentable en OOS (−132 USD, PF 0,55). El objetivo de 1 USD/hora queda a dos órdenes de magnitud y con signo contrario.

## Optimización (sólo IS)

- Rejilla de 144 combinaciones en M15 (`optimize.py`, guardada en `grid_is.csv` / `grid_is_top.md`): bb_dev {2, 2.5, 3} × rsi_low {20, 25, 30} × atr_mult {1.5, 2.5} × max_bars {8, 32} × confirm {0, 1} × sesión {0, 1}; filtro de tendencia H4 fijo (sin él todo es peor: PF 0,7-0,8). Más 32 corridas previas de exploración H1 vs M15 (H1 daba <40 trades con filtro de tendencia, por eso M15). Total 176 backtests.
- Criterio: trades ≥ 60, DD ≤ 300 USD, ordenado por **profit factor** (no por beneficio). Sólo **3 de 61** combos válidas tienen PF > 1 en IS, y la mejor es PF 1,10 con +24,6 USD en 18 meses. Ya en IS la "ventaja" es marginal; que salga positiva es compatible con puro azar.
- Elegida: bb_dev 3.0, rsi_low 25, atr_mult 2.5, max_bars 8, sin confirm, sin filtro horario.

## Tabla de resultados (corrida oficial, `stop_on_dd=True`, límite 300 USD)

| periodo | coste | lev | net USD | USD/h | DD intrabar | DD>300 | trades | win % | PF | avg/trade |
|---|---|---|---|---|---|---|---|---|---|---|
| IS | Pepperstone | 2 | +24,6 | +0,0019 | 57,7 | no | 64 | 48,4 | 1,10 | +0,38 |
| IS | Pepperstone | 10 | +9,6 | +0,0007 | 78,5 | no | 64 | 48,4 | 1,03 | +0,15 |
| IS | Eightcap | 2 | +32,6 | +0,0025 | 53,3 | no | 64 | 50,0 | 1,13 | +0,51 |
| IS | Eightcap | 10 | +27,5 | +0,0021 | 72,4 | no | 64 | 50,0 | 1,09 | +0,43 |
| IS | Conservador | 2 | −20,7 | −0,0016 | 69,8 | no | 64 | 48,4 | 0,92 | −0,32 |
| IS | Conservador | 10 | −40,8 | −0,0031 | 95,0 | no | 64 | 48,4 | 0,88 | −0,64 |
| **OOS** | **Pepperstone** | **2** | **−151,7** | **−0,0114** | **160,4** | no | **74** | 43,2 | **0,49** | −2,05 |
| OOS | Pepperstone | 10 | −149,3 | −0,0113 | 210,9 | no | 74 | 43,2 | 0,66 | −2,02 |
| OOS | Eightcap | 2 | −147,4 | −0,0111 | 157,0 | no | 74 | 43,2 | 0,51 | −1,99 |
| OOS | Eightcap | 10 | −132,2 | −0,0100 | 198,7 | no | 74 | 43,2 | 0,69 | −1,79 |
| OOS | Conservador | 2 | −179,8 | −0,0135 | 186,1 | no | 74 | 37,8 | 0,42 | −2,43 |
| OOS | Conservador | 10 | −202,4 | −0,0153 | 245,2 | no | 74 | 37,8 | 0,56 | −2,74 |
| FULL | Pepperstone | 2 | −162,6 | −0,0062 | 205,3 | no | 144 | 45,1 | 0,72 | −1,13 |
| FULL | Pepperstone | 10 | −200,6 | −0,0076 | 276,8 | no | 144 | 45,1 | 0,76 | −1,39 |
| FULL | Eightcap | 2 | −152,0 | −0,0058 | 202,6 | no | 144 | 45,8 | 0,74 | −1,06 |
| FULL | Eightcap | 10 | −160,2 | −0,0061 | 251,3 | no | 144 | 45,8 | 0,80 | −1,11 |
| FULL | Conservador | 2 | −232,6 | −0,0088 | 251,6 | no | 144 | 41,7 | 0,62 | −1,62 |
| FULL | Conservador | 10 | −274,1 | −0,0104 | 300,9 | **SÍ** | 137 | 42,3 | 0,67 | −2,00 |
| OOS | *sin costes* | 2 | −132,1 | −0,0099 | 144,3 | no | 74 | 44,6 | 0,55 | −1,78 |
| FULL | *sin costes* | 2 | −98,9 | −0,0037 | 176,5 | no | 144 | 47,2 | 0,83 | −0,69 |

**FULL sin `stop_on_dd` (DD real):** Pepperstone lev 2 → max DD intrabar **205,4 USD** (net −162,6); lev 10 → 276,8; Eightcap 202,6 / 251,3; Conservador 251,6 / **339,9 (supera 300)**. Beneficio por año (Pepperstone lev 2): 2023 −8,8 · 2024 +30,5 · 2025 −64,8 · 2026 −119,4. Motivos de salida FULL: 63 por tiempo, 57 SL, 24 TP.

Por lado: en IS el beneficio venía sólo de los cortos (+46,8 USD, 26 trades) y los largos perdían (−22,2); en OOS los cortos pierden −123,2 (50 trades) y los largos −28,5. Es decir, el único "edge" del IS se invirtió en OOS: ruido.

## Robustez (OOS, Pepperstone, lev 2, sin stop DD) — tabla completa en `results.md`

| parámetro | −40 % | −20 % | base | +20 % | +40 % |
|---|---|---|---|---|---|
| bb_period (20) | −42,3 (18 tr) | −132,5 | −151,7 | −174,1 | −189,9 |
| bb_dev (3.0) | −258,1 | −201,5 | −151,7 | −72,8 (18 tr) | 0 (0 trades) |
| rsi_low (25) | **+23,3 (7 tr)** | −69,1 | −151,7 | −233,5 | −231,2 |
| atr_mult (2.5) | −146,0 | −146,0 | −151,7 | −132,3 | −154,3 |
| max_bars (8) | −115,1 | −118,0 | −151,7 | −143,8 | −114,4 |
| ema_period (200) | −107,9 | −133,2 | −151,7 | −130,1 | −120,7 |
| rsi_period (14) | −258,7 | −227,5 | −151,7 | −104,4 | −80,9 |
| atr_period (14) | −168,3 | −138,2 | −151,7 | −150,7 | −150,1 |

**1 de 32 variaciones positiva (3,1 %)**, y esa única (rsi_low 15) tiene 7 trades: no cuenta. El resultado negativo es uniformemente robusto, lo cual es lo peor que puede pasar: no es un problema de parámetros, es que la idea no tiene ventaja en BTC 2025-26.

## Costes: ¿matan la estrategia?

Coste ida y vuelta (spread + 2×slippage + comisión), sin swap: Pepperstone 32 USD/BTC, Eightcap 22, Conservador 57. Movimiento objetivo medio (cierre → banda media en la señal) = 1.230 USD (mediana 1.001); distancia media al SL = 658 USD.

| coste | USD/BTC RT | % del objetivo | % del SL |
|---|---|---|---|
| Pepperstone | 32 | 2,6 % | 4,9 % |
| Eightcap | 22 | 1,8 % | 3,3 % |
| Conservador | 57 | 4,6 % | 8,7 % |

Con dev 3,0 los objetivos son grandes (≈1,5 % del precio), así que los costes **no** son la causa principal: sólo explican ~20 USD de los −152 OOS (el resto, −132, es pérdida bruta). Con bandas más estrechas (dev 2,0: objetivo ~600-800 USD) el coste sube al 4-5 % y el resultado es aún peor (−258 con dev 1,8). El scalping intradía "estilo canal" con objetivos de 100-300 USD tendría un coste del 10-30 % del objetivo: inviable con estos spreads.

## Límite estructural (independiente de la estrategia)

Con 1.000 USD y leverage 2 el motor (y el bróker) limitan la exposición a ~1.800 USD de nocional (0,02 BTC a 90 k). Ganar 720 USD/mes exige **+40 % mensual sobre el nocional máximo** manteniendo el DD de equity bajo 300 USD (17 % del nocional). Con leverage 10 (9.000 USD de nocional) sigue exigiendo +8 %/mes con DD < 3,3 % del nocional, es decir, un ratio retorno/DD mensual > 2,4 sostenido 36 meses. Ningún sistema de reversión a la media con SL en BTC (volatilidad 50-70 % anual) se acerca a eso; lo que enseñan los canales de "scalping intradía" alcanza esas cifras sólo con martingala/grid, que es lo que el brief prohíbe y lo que revienta la cuenta.

## Puntuación honesta (rúbrica)

| criterio | puntos | justificación |
|---|---|---|
| USD/h OOS Pepperstone lev 2 | **0 / 3** | −0,0114 USD/h (≤ 0) |
| Max DD FULL sin stop ≤ 300 | **2 / 2** | 205 USD Pepperstone lev 2 (todos los lev 2 ≤ 252). Ojo: es "mérito" del tamaño mínimo, no de la estrategia; con Conservador lev 10 supera (340). |
| Robustez (≥70 % positivas) | **0 / 2** | 3,1 % positivas |
| PF OOS ≥ 1,3 y ≥ 60 trades | **0 / 1** | PF 0,49 (74 trades) |
| EA MQL5 fiel + protección DD | **1 / 1** | `reversion.mq5`: mismos indicadores (iBands/iRSI/iATR/iMA H4 con índice exacto de la H4 cerrada), TP dinámico, cierre por tiempo idéntico (shift ≥ MaxBars+1), lotes por riesgo con tope de margen 90 %, filtro de spread, cierre total y parada si equity < máximo histórico − 300 (persistido en variable global), magic, sólo en vela nueva. **No se ha podido compilar aquí (no hay MetaEditor en Linux)**: revisado a mano, puede necesitar ajustes menores al compilar. |
| Informe claro y honesto | **1 / 1** | |
| **Total** | **4 / 10** | Y 2 de esos 4 puntos (DD) son triviales para un sistema que pierde poco por operar con 0,01-0,02 lotes. |

## Conclusión sobre el objetivo

**No se alcanza 1 USD/hora, ni de lejos.** Números: OOS −0,011 USD/h (objetivo +1,0), FULL −0,006 USD/h; buy & hold del mismo periodo daría +0,078 USD/h pero con DD muy superior a 300. La restricción de DD ≤ 300 sí se cumple (205 USD FULL con Pepperstone lev 2) sólo porque la estrategia opera tamaños diminutos y pierde despacio. Recomendación al cliente: **no operar esta estrategia**. La expectativa de +72 % mensual con DD del 30 % no es alcanzable con reversión a la media sin martingala en BTC; cualquier oferta que prometa eso lleva martingala/grid escondido.

## Qué haría falta para mejorar (sin garantías)

1. Cambiar de idea, no de parámetros: la reversión en M15 no muestra ventaja bruta en 2025-26 (mercado más direccional, menos "agotamientos" con rebote). Probar reversión sólo en régimen de baja volatilidad (ATR/precio bajo percentil 30) o sólo en fines de semana (menor participación institucional) — sin optimizar en OOS.
2. Objetivo parcial (TP al 50 % del camino a la media) como variante a probar en IS; no se incluyó para no inflar la rejilla.
3. Aceptar la aritmética: con 1.000 USD y lev 2 el techo realista de un sistema bueno (Sharpe ~1, 30 %/año sobre nocional) es ≈ 500 USD/año ≈ **0,06 USD/hora**. El objetivo debería reescribirse a 0,05-0,10 USD/h o el capital multiplicarse por 15-20.

## Observaciones del motor (no modificado)

- Ninguna incidencia que afecte a estos resultados. `dd_limit_breached` usa el DD intrabar (low/high, medio spread): correcto y conservador.
- Caso límite: si tras una salida por tiempo hay una señal del mismo sentido en la misma vela, el motor no cerraría la posición (sólo actualiza SL/TP). `strategy.py` evita ese caso (no reentra en la vela de la salida por tiempo) y el EA hace lo mismo. Verificado: 144 entradas de la señal = 144 trades del motor, mismos timestamps.

## Archivos

- `trading/strategies/reversion/strategy.py` – `build_signals(df, **params)`, `DEFAULT_PARAMS`, indicadores estilo MT5.
- `trading/strategies/reversion/optimize.py` – rejilla IS (144 combos) → `grid_is.csv`, `grid_is_top.md`.
- `trading/strategies/reversion/run.py` – corrida oficial → `results.json`, `results.md` (≈25 s).
- `trading/strategies/reversion/reversion.mq5` – Expert Advisor MQL5.
- `trading/strategies/reversion/mdtable.py` – utilidad de tablas markdown (sin dependencias).
