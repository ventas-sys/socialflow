# Variante C — Rejilla adaptativa (EURUSD / GBPUSD, H1, 2012-11 → 2022-03)

**Veredicto en una frase: la rejilla adaptativa NO convierte la estrategia copiada en rentable; la mejor combinación
in-sample pierde dinero en OOS en EURUSD, se arruina en GBPUSD y la cuenta combinada de 1.000 USD se arruina en los tres
periodos. Puntuación 2/10.**

## 1. Lógica (5 líneas)

1. Cada hora se abre una cesta de 0,01 lotes en cada dirección (compra y venta) si no hay una abierta; TP de cesta a precio medio ± `tp_pips`; sin SL individual.
2. El paso entre niveles es adaptativo: `step_atr_mult × ATR14(H1)` de la vela anterior (sin lookahead); se añaden niveles con lote × `lot_mult` hasta `max_levels`.
3. Tres frenos de cola: SL de cesta en USD (`basket_sl_usd`), **stop temporal** (cesta abierta > N horas reales se cierra a mercado en la apertura siguiente) y stop-out de margen del bróker.
4. **Filtro de volatilidad**: no se abren cestas nuevas si ATR14 de la vela anterior > percentil 90 rolling de los últimos 500 valores; opcionalmente sesión horaria (`hours`) y `risk_scale` (lote proporcional al balance).
5. Costes: spread 1 pip, comisión 7 USD/lote ida y vuelta, swap −3 USD/lote/noche; capital 1.000 USD, apalancamiento 200. Implementado en `grid_sim_c.py` (copia de `simulate()`; `grid_sim.py` intacto).

## 2. Método

- Grid completo: 4 (step_atr_mult) × 3 (hours) × 2 (lot_mult) × 3 (max_levels) × 4 (basket_sl) × 2 (tp) × 2 (risk_scale) × 3 (N) × 2 (vol_filter) = **6.912 combinaciones**. Se muestrearon **250 por par** (aleatorio, seed 42, mismas 250 en ambos pares; 3,6 % del grid).
- Optimización SOLO in-sample (2012-11 → 2017-12) con criterio: sin ruina, max DD ≤ 300 USD, máximo USD/h. Después se reporta OOS (2018-01 → 2022-03) y FULL, y el combinado (suma de curvas de equity − 1.000, truncada a 0 en ruina).
- Robustez: ±20 % en `step_atr_mult`, `basket_sl_usd` y N (27 variaciones) sobre OOS, por par y combinado (misma variación en ambos pares).
- Reproducible: `cd /home/user/socialflow && python3 trading/copy_maderna/variantes/C_rejilla_adaptativa/run.py 250 42` (≈100 s con 4 núcleos).

## 3. Resultado de la búsqueda in-sample

| Par | Combos IS | Sin ruina | Sin ruina y DD ≤ 300 | Con net > 0 | Criterio finalmente aplicado |
|---|---|---|---|---|---|
| EURUSD | 250 | **17** | **0** | **0** | Relajado B: sin ruina, máx USD/h (la "mejor" pierde −261,61 USD en IS) |
| GBPUSD | 250 | **0** | 0 | 0 | Relajado C: todas arruinan; se elige la que sobrevive más tiempo (ruina 2016-01-26) |

**Ninguna de las 500 simulaciones IS cumple el criterio pedido. Ninguna tiene beneficio neto positivo en IS.** Lo que sigue es la mejor de las malas.

### Mejores parámetros (IS, criterio relajado)

| Par | step_atr_mult | hours | lot_mult | max_levels | basket_sl_usd | tp_pips | risk_scale | N (h) | vol_filter |
|---|---|---|---|---|---|---|---|---|---|
| EURUSD | 2.0 | todas | 1.0 | 4 | 250 | 10 | no | 168 | sí |
| GBPUSD | 2.0 | todas | 1.0 | 3 | 150 | 10 | sí | 24 | no |

## 4. Tabla de resultados

| Par / periodo | Net USD | USD/h | Max DD USD | Max DD % | Ruina | Stopouts | SL hits | TP hits | Time hits | Cestas | Peor cesta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EURUSD IS | −261,61 | −0,0058 | 790,01 | 63,0 | no | 0 | 0 | 6.393 | 141 | 6.534 | −179,82 |
| EURUSD OOS | −198,62 | −0,0054 | 453,06 | 44,5 | no | 0 | 0 | 4.651 | 135 | 4.786 | −155,57 |
| EURUSD FULL | −484,72 | −0,0059 | 975,72 | 77,8 | no | 0 | 0 | 11.142 | 279 | 11.421 | −179,82 |
| GBPUSD IS | −1.000,00 | −0,0223 | 1.029,21 | 100,0 | **SÍ 2016-01-26** | 1 | 0 | 7.102 | 849 | 7.952 | −60,69 |
| GBPUSD OOS | −865,02 | −0,0237 | 990,92 | 95,5 | no (equity mín. 45 USD) | 0 | 1 | 10.006 | 1.085 | 11.092 | −172,21 |
| GBPUSD FULL | −1.000,00 | −0,0123 | 1.029,21 | 100,0 | **SÍ 2016-01-26** | 1 | 0 | 7.102 | 849 | 7.952 | −60,69 |
| **COMBINADO IS** | −1.000,00 | −0,0223 | 1.081,62 | 100,0 | **SÍ 2015-05-14** | 1 | 0 | 13.495 | 990 | 14.486 | −179,82 |
| **COMBINADO OOS** | −1.000,00 | −0,0274 | 1.002,81 | 100,0 | **SÍ 2020-03-27** | 0 | 1 | 14.657 | 1.220 | 15.878 | −172,21 |
| **COMBINADO FULL** | −1.000,00 | −0,0123 | 1.081,62 | 100,0 | **SÍ 2015-05-14** | 1 | 0 | 18.244 | 1.128 | 19.373 | −179,82 |

Por año (variación de equity, USD; de `summary.json`). Para cada par se muestran las corridas FULL (2012→2022) y OOS (arranca plana en 2018 con 1.000 USD, por eso difiere de FULL en 2018):

| Año | EURUSD FULL | EURUSD OOS | GBPUSD FULL | GBPUSD OOS | Combinado FULL | Combinado OOS |
|---|---|---|---|---|---|---|
| 2012 (nov-dic) | +39,87 | – | −5,65 | – | +34,22 | – |
| 2013 | +47,37 | – | −508,54 | – | −461,17 | – |
| 2014 | +30,92 | – | +39,01 | – | +69,93 | – |
| 2015 | −503,83 | – | −426,77 | – | −642,99 → **ruina 14-may-2015** | – |
| 2016 | +129,43 | – | −98,06 → **ruina 26-ene-2016** | – | 0 | – |
| 2017 | −5,37 | – | 0 | – | 0 | – |
| 2018 | −139,94 | −115,45 | 0 | −45,71 | 0 | −161,15 |
| 2019 | +2,80 | +2,80 | 0 | −306,38 | 0 | −303,58 |
| 2020 | −155,39 | −155,39 | 0 | −431,31 | 0 | −535,27 → **ruina 27-mar-2020** |
| 2021 | +135,72 | +135,72 | 0 | −107,38 | 0 | 0 |
| 2022 (ene-mar) | −66,31 | −66,31 | 0 | +25,74 | 0 | 0 |

La cuenta combinada se arruina (14-may-2015) **antes** que GBPUSD en solitario (26-ene-2016): los dos pares consumen el mismo colchón de 1.000 USD (equity EUR + equity GBP − 1.000 ≤ 0). EURUSD en solitario nunca se arruina, pero pierde en 6 de 11 años y su único año "bueno" (2016, +129) no compensa 2015 (−504).

### Por qué pierde (descomposición de la mejor EURUSD, FULL)

- 11.142 cestas cerradas en TP: **+13.468 USD** (media +1,21 USD).
- 279 cestas cerradas por stop temporal (168 h): **−13.074 USD** (media −46,86 USD; peor −179,82). Las cestas de 4 niveles (550) suman −11.970 USD.
- Comisiones de apertura y swaps: **≈ −879 USD**. Resultado: −484,72 USD.

Es decir: el bruto de TP y el bruto de las cestas "atascadas" se cancelan casi exactamente (edge ≈ 0) y los costes de transacción deciden el signo. Esto es lo esperable de una apuesta de reversión a la media a 6-10 pips en H1 con 1 pip de spread + 0,07 USD de comisión por micro-lote: el TP recoge céntimos en el 97 % de las cestas y el 3 % restante devuelve todo. En GBPUSD (ATR mayor) las cestas atascadas cuestan más y la cuenta muere en 2016 (y en 2013-2014 con casi cualquier otra combinación: mediana de fecha de ruina en el grid IS = 2013-11-07).

### Qué parámetros "ayudan" (grid IS EURUSD, % de combinaciones sin ruina)

step_atr_mult 2.0 → 16 % (0.5 → 0 %); tp_pips 10 → 14 % (6 → 0 %); vol_filter sí → 11 % (no → 2 %); N=168 h → 10 % (24 h → 2 %); max_levels 3 → 10 % (6 → 4 %); sesión "todas" → 11 % (12-21 → 1 %). En GBPUSD todo es 0 %. La sesión 12-21 (la que concentra el copy real) es la **peor** opción. Ninguno de estos efectos lleva a beneficio neto positivo: solo alarga la agonía.

## 5. Robustez (±20 % en step_atr_mult, basket_sl_usd, N sobre OOS; 27 variaciones)

| Ámbito | Variaciones con net OOS > 0 | Net mín | Mediana | Net máx | Ruinas |
|---|---|---|---|---|---|
| EURUSD | **3 / 27 (11 %)** | −371,79 | −149,71 | +40,39 | 0 |
| GBPUSD | **0 / 27 (0 %)** | −1.000,00 | −902,76 | −659,45 | 13 |
| Combinado | **0 / 27 (0 %)** | −1.371,79 | −1.012,57 | −619,06 | — |

Umbral de la rúbrica (≥ 70 % positivas): no se cumple en ningún ámbito. Adicionalmente, el ranking IS no predice OOS: el nº 2 del top-5 IS de EURUSD (lot_mult 1.2, SL 150, N 72, risk_scale) gana +220,93 USD en OOS con DD 321, mientras el nº 1 pierde −198,62. Es ruido de selección, no señal: ambos pierden en IS.

## 6. Puntuación honesta (rúbrica)

| Criterio | Valor obtenido | Puntos |
|---|---|---|
| USD/h OOS combinado (3: ≥1,0; 2: ≥0,25; 1: >0; 0: ≤0) | **−0,0274 USD/h** (ruina en OOS) | **0 / 3** |
| Max DD FULL (3: ≤300 sin ruina; 1: ≤500; 0: mayor o ruina) | **1.081,62 USD, ruina de la cuenta combinada el 2015-05-14** | **0 / 3** |
| Robustez (≥70 % variaciones OOS positivas) | **0 / 27 combinado** (EURUSD sola 3/27) | **0 / 2** |
| ≥ 200 cestas OOS | 15.878 cestas OOS (criterio formalmente cumplido, pero sin valor: la cuenta se arruina) | **1 / 1** |
| Informe claro | Autoevaluación; tablas IS/OOS/FULL, por año, descomposición y robustez con datos reproducibles | **1 / 1** |
| **Total** | | **2 / 10** |

## 7. Limitaciones y advertencias

- Se muestreó el 3,6 % del grid (250/6.912). No se puede excluir matemáticamente que exista una combinación con net > 0, pero: (a) los efectos marginales son monótonos y ninguna de las 17 supervivientes EURUSD gana en IS; (b) el mecanismo de pérdida (edge bruto ≈ 0 menos costes) no depende de los parámetros afinados.
- Sin datos de tick: TP/SL se evalúan con high/low de la vela H1 (favorable al TP: se asume que se ejecuta si el precio lo toca). Spread fijo 1 pip (optimista para GBPUSD y para 22-01h). Es decir, la realidad sería **peor**, no mejor.
- Las marcas de tiempo de los CSV son las del bróker; se han tratado como UTC para las sesiones `hours`. Un desfase de 2-3 h no cambia la conclusión (la sesión estrecha 12-21 es la peor de las tres).
- El copy real (+0,36 USD/h en 5 meses) equivale a ≈ +315 %/año sobre 1.000 USD con un flotante máximo del 53 %: es la fase de "cobrar céntimos" de una martingala ×1,5-2 sin SL, que el simulador arruina en 2013-2015 en todas sus réplicas. Limitar la martingala (esta variante) elimina la ruina rápida en EURUSD pero deja al descubierto que el edge subyacente es negativo tras costes.

## 8. Archivos

- `run.py` — script reproducible (grid, selección, OOS/FULL, combinado, robustez, escribe `results.md` y `summary.json`).
- `grid_sim_c.py` — copia de `simulate()` con stop temporal, filtro de volatilidad y ATR sin lookahead.
- `results.md` — tablas completas por par y combinado (incluye top-5 IS→OOS y efectos marginales).
- `grid_is_EURUSD.csv`, `grid_is_GBPUSD.csv` — las 250 combinaciones IS con métricas.
- `robustness_EURUSD.csv`, `robustness_GBPUSD.csv` — 27 variaciones OOS por par.
- `summary.json` — resumen numérico usado en este informe.
