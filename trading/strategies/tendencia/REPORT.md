# REPORT — estrategia "tendencia" (seguimiento de tendencia BTCUSD H1)

**Veredicto en una frase: NO se alcanza 1 USD/hora. Fuera de muestra la estrategia PIERDE dinero (-0,0155 USD/hora, -205 USD en 18 meses) y rompe el límite de 300 USD de drawdown. Puntuación honesta: 2/10.**

## 1. Lógica (5 líneas)

1. **Filtro de tendencia:** solo largos cuando el cierre H1 está por encima de la EMA(200) (cortos opcionales por debajo; la optimización IS eligió long-only).
2. **Filtro de régimen:** ADX(14) > 25 para evitar operar en rango (réplica del iADX de MT5).
3. **Entrada:** ruptura del canal Donchian de 55 velas anteriores (cierre > máximo de las 55 velas previas), ejecutada en la apertura de la siguiente vela.
4. **Salida:** stop inicial a 3×ATR(14) y trailing tipo *chandelier* a 4×ATR que solo se acerca al precio; no hay take-profit.
5. **Tamaño:** riesgo fijo 1,5 % del capital (15 USD) / distancia del stop → en la práctica 0,01–0,02 lotes (el lote mínimo de 0,01 BTC ya equivale a ~1–2 % de riesgo con ATR de 500–900 USD).

Ficheros: `strategy.py` (señales), `optimize.py` (rejilla IS), `run.py` (corridas oficiales → `results.json`, `results.md`), `grid_is.csv` / `grid_oos.csv`, `best_params.json`, `tendencia.mq5` (EA).

## 2. Optimización (solo in-sample, 2023-09-01 → 2025-02-28)

Rejilla de 144 combinaciones: EMA {100,200} × Donchian {20,55} × SL {2,3}×ATR × trailing {2,3,4}×ATR × ADX mín {0,20,25} × {long-only, long+short}. Criterio: entre las combinaciones con DD intravela ≤ 250 USD y ≥ 40 trades, la de mayor **profit factor** (no la de mayor beneficio). Después se barrió `risk_pct` ∈ {1…3 %} y se tomó el mayor con DD IS ≤ 250 USD (1,5 %; con 2 % el DD ya era 251).

Elegido: `ema_len=200, dc_len=55, atr_len=14, sl_mult=3, trail_mult=4, adx_len=14, adx_min=25, allow_short=0, risk_pct=1.5`.
En IS: +541,68 USD, 0,041 USD/h, PF 1,92, 85 trades, DD 219 USD. Ya en IS, con BTC subiendo de 26k a 84k, el mejor resultado de la rejilla está **24 veces por debajo** del objetivo de 1 USD/h.

Observaciones de la rejilla IS: 85 % de los combos positivos; long+short peor que long-only en mediana (104 vs 266 USD) y con más DD; el trailing ancho (4×ATR) fue el mejor.

## 3. Resultados oficiales (capital 1.000 USD, `max_dd_limit=300`, `stop_on_dd=True`)

| Periodo | Coste | Lev | Neto USD | USD/hora | Max DD intravela | DD>300 | Trades | Win % | PF |
|---|---|---|---|---|---|---|---|---|---|
| IS | Pepperstone | 2 | 541,68 | 0,0413 | 218,71 | no | 85 | 38,8 | 1,919 |
| IS | Pepperstone | 10 | 605,73 | 0,0461 | 218,71 | no | 85 | 38,8 | 2,027 |
| IS | Eightcap | 2 | 553,58 | 0,0422 | 214,31 | no | 85 | 38,8 | 1,951 |
| IS | Eightcap | 10 | 617,73 | 0,0471 | 214,31 | no | 85 | 38,8 | 2,061 |
| IS | Conservador | 2 | 496,32 | 0,0378 | 234,57 | no | 85 | 38,8 | 1,810 |
| IS | Conservador | 10 | 559,71 | 0,0426 | 234,57 | no | 85 | 38,8 | 1,914 |
| **OOS** | **Pepperstone** | **2** | **-205,14** | **-0,0155** | **302,54** | **SÍ** | **72** | **26,4** | **0,709** |
| OOS | Pepperstone | 10 | -203,17 | -0,0153 | 300,83 | SÍ | 72 | 26,4 | 0,711 |
| OOS | Eightcap | 2 | -200,42 | -0,0151 | 301,31 | SÍ | 73 | 26,0 | 0,715 |
| OOS | Eightcap | 10 | -199,81 | -0,0151 | 300,00 | SÍ | 72 | 26,4 | 0,715 |
| OOS | Conservador | 2 | -215,58 | -0,0162 | 302,64 | SÍ | 71 | 25,4 | 0,693 |
| OOS | Conservador | 10 | -213,54 | -0,0161 | 300,09 | SÍ | 71 | 26,8 | 0,695 |
| FULL | Pepperstone | 2 | 316,57 | 0,0120 | 300,83 | SÍ | 158 | 32,9 | 1,241 |
| FULL | Pepperstone | 10 | 380,62 | 0,0144 | 300,83 | SÍ | 158 | 32,9 | 1,290 |
| FULL | Eightcap | 2 | 331,93 | 0,0126 | 300,00 | SÍ | 158 | 32,9 | 1,254 |
| FULL | Eightcap | 10 | 396,08 | 0,0150 | 300,00 | SÍ | 158 | 32,9 | 1,303 |
| FULL | Conservador | 2 | 278,81 | 0,0106 | 300,52 | SÍ | 155 | 32,9 | 1,212 |
| FULL | Conservador | 10 | 342,20 | 0,0130 | 300,52 | SÍ | 155 | 32,9 | 1,260 |

Notas: el leverage apenas cambia nada porque el tamaño lo fija el riesgo (0,01–0,02 lotes), no el margen. En OOS la corrida se detiene por rotura de DD el 2026-05-15. El coste dominante es el **swap largo** (-20 %/año): 62 USD en IS y 60 USD en OOS, más que spread+comisión+slippage juntos (37 / 24 USD).

### FULL sin `stop_on_dd` (drawdown real)

| Coste | Lev | Neto USD | USD/hora | Max DD intravela | Max DD cierre | 1ª rotura de 300 | Trades | PF |
|---|---|---|---|---|---|---|---|---|
| Pepperstone | 2 | 438,32 | 0,0166 | **402,40** | 402,07 | 2026-05-14 23:00 | 173 | 1,304 |
| Pepperstone | 10 | 502,37 | 0,0190 | 402,40 | 402,07 | 2026-05-14 23:00 | 173 | 1,349 |
| Eightcap | 2 | 459,73 | 0,0174 | 395,73 | 395,40 | 2026-05-15 04:00 | 173 | 1,323 |
| Eightcap | 10 | 523,88 | 0,0198 | 395,73 | 395,40 | 2026-05-15 04:00 | 173 | 1,368 |
| Conservador | 2 | 351,36 | 0,0133 | 445,86 | 445,53 | 2026-05-05 14:00 | 173 | 1,236 |
| Conservador | 10 | 414,75 | 0,0157 | 445,86 | 445,53 | 2026-05-05 14:00 | 173 | 1,279 |

Neto por año (Pepperstone lev 2, sin stop): 2023 (4 meses) +392 · 2024 +166 · 2025 -94 · 2026 (8 meses) -26. Todo el beneficio viene del arranque alcista de finales de 2023; desde 2025 la estrategia no gana.

Contexto OOS: BTC pasó de 83.830 a 79.661 USD (buy & hold OOS = -50 USD) con un máximo en 126.111 (oct-2025) y un mínimo en 58.214. Un sistema long-only de ruptura en H1 compra cada intento de escape del rango y es parado 3 de cada 4 veces (win rate 26 %).

## 4. Robustez (OOS, Pepperstone, lev 2; ±20 % / ±40 % de cada parámetro)

Base OOS: -205,14 USD, PF 0,709, 72 trades. Celdas = neto OOS en USD.

| Parámetro | -40 % | -20 % | +20 % | +40 % |
|---|---|---|---|---|
| ema_len (200) | -225,9 | -208,9 | -196,4 | -191,8 |
| dc_len (55) | -177,9 | -156,6 | -204,6 | -202,6 |
| atr_len (14) | -237,1 | -233,1 | -207,1 | -216,4 |
| sl_mult (3) | -240,9 | -194,6 | -197,3 | -219,9 |
| trail_mult (4) | -240,0 | -249,4 | -227,8 | -258,7 |
| adx_min (25) | -210,8 | -229,5 | -231,2 | **+13,2** |
| risk_pct (1,5) | -213,9 | -202,2 | -202,4 | -202,8 |

**Variaciones con OOS positivo: 1 de 28 (4 %).** La rúbrica pide ≥ 70 %. El resultado negativo es estable: no depende de un parámetro concreto, es la familia de estrategias la que no funciona en el periodo OOS. (Tabla completa con DD, trades y PF en `results.md`.)

Diagnóstico adicional (no usado para elegir parámetros): de las 144 combinaciones de la rejilla, solo el **19 %** es positivo en OOS, la mediana OOS es -214 USD, PF mediano OOS 0,70 y la correlación entre neto IS y neto OOS es **-0,38** (lo que gana en IS tiende a perder en OOS: sobreajuste al mercado alcista de 2023-24). El mejor combo OOS de la rejilla (+322 USD) habría sido imposible de elegir con datos IS.

## 5. Puntuación honesta según la rúbrica

| Criterio | Resultado | Puntos |
|---|---|---|
| USD/hora OOS Pepperstone lev 2 (3 = ≥1,0; 2 = ≥0,25; 1 = >0; 0 = ≤0) | **-0,0155** | **0 / 3** |
| Max DD equity ≤ 300 en FULL sin stop | 402 USD (supera) | **0 / 2** |
| Robustez ≥ 70 % positivo | 4 % | **0 / 2** |
| PF OOS ≥ 1,3 y ≥ 60 trades | PF 0,71, 72 trades | **0 / 1** |
| EA MQL5 fiel con protección de DD | Sí: iMA/iATR/iADX/iHighest, trailing, lotes por riesgo, spread máx., cierre por equity < máx-300, magic, solo vela nueva. No he podido compilarlo aquí (sin MetaEditor); revisado a mano. | **1 / 1** |
| Informe claro y honesto | — | **1 / 1** |
| **Total** | | **2 / 10** |

## 6. Conclusión: ¿se alcanza 1 USD/hora con DD ≤ 300 USD?

**No, ni de lejos.** Con los números:
- Objetivo: 1 USD/h = 720 USD/mes sobre 1.000 USD (72 % mensual). Ni siquiera en el mejor periodo (IS, mercado alcista 26k→84k) la mejor combinación de la rejilla pasa de **0,05 USD/h** (5 % del objetivo). Fuera de muestra el signo es negativo.
- Con lote mínimo 0,01 BTC y ATR H1 de 500–900 USD, cada trade arriesga ~15–25 USD; para ganar 24 USD/día haría falta una operación ganadora neta al día con ratio 1:1, cuando el sistema gana el 26–39 % de las veces y hace 4–5 trades al mes.
- El límite de 300 USD de DD (30 % del capital) obliga a operar con 0,01–0,02 lotes; a ese tamaño BTC tendría que moverse ~2.400 USD/día siempre a favor para dar 24 USD/día. Es incompatible con cualquier estrategia direccional realista.
- Buy & hold en los 3 años dio 0,078 USD/h con DD >> 300 USD; esta estrategia da 0,017 USD/h (FULL sin stop) con DD 402 USD. Es "mejor que comprar y mantener en riesgo" pero sigue siendo insignificante frente al objetivo.

## 7. Qué haría falta para mejorar (sin promesas)

- **Timeframe mayor (H4/D1) o Donchian más largo:** el H1 genera demasiados falsos escapes en rango; el trailing 4×ATR ya apunta a que la señal útil es de más largo plazo. Habría que re-optimizar en IS con una rejilla nueva y volver a validar; no lo he hecho para no contaminar el OOS.
- **Cortos con swap positivo (Pepperstone +7,5 %/año):** en IS los cortos empeoraron el DD, pero en OOS (mercado bajista desde oct-2025) la mediana long+short fue menos mala (-169 vs -240). Un filtro de régimen de tendencia diario podría permitir cortos solo en tendencia bajista.
- **Reducir el swap:** es el mayor coste (>50 % del total). Salidas por tiempo (cerrar posiciones que no avanzan en N días) o operar futuros en vez de CFD.
- **Objetivo realista:** para 1.000 USD, un sistema de tendencia bueno rinde 1–3 %/mes (0,015–0,04 USD/h) con DD del 15–30 %. El objetivo de 72 %/mes con 30 % de DD máximo no lo cumple ninguna de las variantes probadas y no conozco evidencia de que sea alcanzable de forma sistemática.

## 8. Notas técnicas

- Sin look-ahead: Donchian sobre `rolling().shift(1)`, indicadores solo con datos ≤ t; el motor ejecuta en la apertura de t+1. La simulación interna del trailing replica el orden del motor (en la vela i aplica `sl[i-1]` y luego comprueba low/high); en las corridas todas las salidas son "sl" (ninguna discrepancia señal/motor).
- Lotes calculados sobre un capital de referencia fijo (1.000 USD) en el backtest; el EA usa el balance real (input `RiskOnBalance`).
- Indicadores idénticos a MT5: ATR = media simple del TR (iATR), ADX con suavizado exponencial (ADX.mq5), EMA estándar. Pequeñas diferencias de arranque de la EMA/ADX no cambian las conclusiones.
- Motor de backtest: no he encontrado bugs que afecten al resultado. Observación menor: el swap se calcula sobre el precio de entrada en lugar del precio actual, y las corridas con `stop_on_dd=True` truncan el periodo tras la rotura (por eso OOS con stop tiene 72 trades y FULL sin stop 173).
