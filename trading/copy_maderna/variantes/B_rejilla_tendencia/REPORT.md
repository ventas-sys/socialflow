# Variante B — Rejilla plana (sin martingala) con filtro de tendencia EMA

Ficheros: `run.py` (reproducible, `python trading/copy_maderna/variantes/B_rejilla_tendencia/run.py` desde `/home/user/socialflow`, ~90 s con 4 núcleos), `results.md` (todas las tablas), `is_scan_*.csv` (barrido IS completo), `robustness_oos.csv`, `equity_*.csv` (curvas diarias), `summary.json`. Se usa `grid_sim.simulate()` sin modificar.

## Lógica en 5 líneas
1. Cada hora, si no hay cesta abierta, abre 1 posición de `base_lot` **solo a favor de la EMA(H1)**: largo si cierre anterior > EMA, corto si < EMA (`trend_filter`).
2. Si el precio va en contra `step_pips` desde el último nivel, añade otra posición **del mismo lote** (`lot_mult=1.0`, sin martingala), hasta `max_levels`.
3. La cesta cierra en TP cuando el precio medio ± `tp_pips` se toca, o en SL cuando el flotante de la cesta < `-basket_sl_usd`.
4. Sin SL individual ni salida por tiempo: una cesta abierta contra tendencia se mantiene hasta TP o SL de cesta (puede ser semanas o meses).
5. Costes por defecto del simulador (spread 1 pip, 7 USD/lote, swap -3 USD/lote/noche), capital 1.000, apalancamiento 200. `both_sides=False` es idéntico con `trend_filter` (se verifica con un `assert` en `run.py`), así que no añade combinaciones.

## Búsqueda (204 combinaciones por par, solo IS 2012-11 → 2017-12)
- Etapa 1 (144): EMA {50,100,200,400} × step {15,25,40,60} × niveles {3,5,8} × SL {80,150,250} con tp=10, lote 0,01.
- Etapa 2 (60): sobre los 12 mejores de la etapa 1, tp {6,10,20} × lote {0,01, 0,02}.
- Criterio: sin ruina, sin stop-out, max DD ≤ 300 USD, máximo usd/h.

Resultado del barrido (detalle en `results.md`):
- **EURUSD**: 154/204 acaban en ruina o stop-out; 18/204 con neto > 0; **solo 3 cumplen el criterio** (todas con niveles=3, SL=250, tp=20, lote 0,01).
- **GBPUSD**: 197/204 en ruina o stop-out; **0/204 con neto > 0**; ninguna cumple. Como fallback se toma la de menor DD sin ruina (EMA50, step 25, 3 niveles, SL 80, tp 20, lote 0,01), que pierde igualmente.
- Tendencias claras: tp=6 y tp=10 pierden en todas las combinaciones (la ganancia por cesta, ~0,4-0,8 USD, no compensa ni una sola cesta perdedora); más niveles ⇒ más ruina (56 % con 3 niveles, 94 % con 8); SL 80/150 "salta" demasiado y suma pérdidas sistemáticas; lote 0,02 dobla el DD sin doblar el neto.

## Mejores parámetros

| Par | EMA | step (pips) | niveles | SL cesta (USD) | TP (pips) | lote | Cumple criterio IS |
|---|---|---|---|---|---|---|---|
| EURUSD | 400 | 60 | 3 | 250 | 20 | 0,01 | sí (DD IS 229 USD) |
| GBPUSD | 50 | 25 | 3 | 80 | 20 | 0,01 | **no** (fallback: mínimo DD sin ruina) |

Nota: en EURUSD un SL de 250 USD con 0,03 lotes máximos equivale a ~830 pips adversos de media; en la práctica es "casi sin SL": las 4 cestas que lo tocan en OOS son las que explican casi toda la pérdida (peor cesta -260 USD, 15 cestas en SL en todo el periodo). Las 3 combinaciones válidas en EURUSD son vecinas en espacio de parámetros (EMA 200/400, step 60, niveles 3, SL 250, tp 20) pero es un rincón muy pequeño de un espacio en el que el 75 % de las combinaciones se arruina.

## Resultados (una sola cuenta de 1.000 USD; COMBINADO = suma de curvas − 1.000)

| Periodo | Par | Neto USD | USD/h | Max DD USD | Max DD % | Ruina | Stop-outs | Cestas | SL hits | TP hits | Peor cesta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| IS 2012-11→2017-12 | EURUSD | 355,8 | 0,0079 | 228,8 | 19,5 | no | 0 | 1.380 | 10 | 1.370 | -267,2 |
| IS | GBPUSD | -196,0 | -0,0044 | 593,9 | 58,8 | no | 0 | 3.960 | 118 | 3.842 | -150,4 |
| IS | **COMBINADO** | 159,8 | 0,0036 | 530,1 | 51,4 | no | 0 | 5.340 | 128 | 5.212 | -267,2 |
| OOS 2018-01→2022-03 | EURUSD | 432,4 | 0,0118 | 119,5 | 9,1 | no | 0 | 746 | 4 | 742 | -260,4 |
| OOS | GBPUSD | -193,1 | -0,0053 | 688,3 | 57,6 | no | 0 | 3.156 | 94 | 3.062 | -115,5 |
| OOS | **COMBINADO** | **239,3** | **0,0065** | 507,7 | 40,5 | no | 0 | 3.902 | 98 | 3.804 | -260,4 |
| FULL 2012-11→2022-03 | EURUSD | 729,1 | 0,0089 | 228,8 | 19,5 | no | 0 | 2.166 | 15 | 2.151 | -267,2 |
| FULL | GBPUSD | -425,5 | -0,0052 | 737,1 | 73,0 | no | 0 | 7.116 | 213 | 6.903 | -150,4 |
| FULL | **COMBINADO** | 303,6 | 0,0037 | **530,1** | 51,4 | **no** | 0 | 9.282 | 228 | 9.054 | -267,2 |

Por año (variación de equity, USD, periodo FULL):

| Par | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EURUSD | -22,6 | 6,9 | 35,3 | -2,8 | 124,9 | 214,1 | 140,8 | 85,0 | 81,5 | 58,3 | 7,8 |
| GBPUSD | 1,4 | -275,5 | 5,0 | 143,1 | -237,5 | 167,6 | -15,6 | -324,7 | -103,4 | 230,0 | -15,8 |
| COMBINADO | -21,3 | -268,6 | 40,3 | 140,3 | -112,6 | 381,7 | 125,2 | -239,7 | -21,9 | 288,3 | -8,1 |

(El año 2018 de EURUSD difiere entre OOS y FULL, 199,8 vs 140,8, porque OOS arranca con cuenta y EMA "en frío" el 2018-01-01; el resto de años coincide.)

Comparación con el copy original: +0,36 USD/h real (con 53 % de DD flotante) frente a **0,0065 USD/h** OOS combinado aquí (~57 USD/año sobre 1.000, 5,7 % anual) con 40 % de DD. Quitar la martingala elimina la ruina, pero también elimina casi todo el rendimiento: la rejilla plana con TP de 20 pips gana ~1,8 USD por cesta y cada SL cuesta 100-260 USD.

## Robustez (±20 % en step, SL y EMA, 27 variaciones, OOS)
- EURUSD: **27/27 positivas** (neto entre +41 y +464 USD, DD máximo 214 USD, sin ruina). El parámetro sensible es el SL: bajarlo un 20 % (200 USD) reduce el neto a 40-260 USD.
- GBPUSD: **0/27 positivas** (neto entre -137 y -1.000 USD; una variación acaba en ruina).
- COMBINADO: **10/27 positivas (37 %)**, neto entre -936 y +315 USD. La combinación central (x1,x1,x1) está entre las mejores, señal de sobreajuste en la elección de SL/step.

## Puntuación honesta (rúbrica)

| Criterio | Valor | Puntos |
|---|---|---|
| USD/h OOS combinado | 0,0065 (>0 pero muy lejos de 0,25) | **1/3** |
| Drawdown FULL combinado | 530 USD sin ruina (>500) | **0/3** |
| Robustez (OOS >0 en ≥70 % de variaciones) | 37 % | **0/2** |
| ≥200 cestas OOS | 3.902 | **1/1** |
| Informe claro | tablas IS/OOS/FULL por par y combinado, por año, robustez, script reproducible | **1/1** |
| **Total** | | **3/10** |

Matices, sin maquillar:
- Si se evaluase **solo EURUSD** (decisión post-hoc, tras ver que GBPUSD pierde en todo): DD FULL 229 USD sin ruina, 100 % de variaciones positivas, 746 cestas OOS → saldría 1+3+2+1+1 = 8/10, pero con 0,0118 USD/h (~100 USD/año, 10 % anual con 12 % de DD). Es una estrategia que "no se arruina" más que una que "gana": el beneficio depende de 1 combinación de 204 y de que en 10 años el EURUSD no dé más de 15 cestas de -250 USD.
- La rejilla plana con filtro de tendencia **no es transportable entre pares**: los mismos parámetros que funcionan en EURUSD pierden en GBPUSD, y ninguna de las 204 combinaciones gana en GBPUSD en IS.
- Con un DD FULL combinado de 530 USD (51 %) sobre 1.000 USD, la mejora frente al copy original (835 USD, 53 %) es marginal en riesgo y de dos órdenes de magnitud peor en rendimiento.
- Limitaciones del análisis: EMA sin calentamiento al cortar IS/OOS; el SL se ejecuta al peor precio de la vela (conservador, por eso la peor cesta supera el SL nominal); no se ha tocado el simulador, así que hereda su modelo de costes y de apertura solo en la hora.

**Conclusión**: la variante B elimina la ruina en EURUSD pero no consigue un sistema rentable y robusto sobre la cuenta combinada exigida. Puntuación 3/10.
