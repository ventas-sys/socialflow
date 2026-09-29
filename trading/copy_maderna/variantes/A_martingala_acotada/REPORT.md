# Variante A — Martingala acotada (EURUSD / GBPUSD, H1, 2012-11 → 2022-03)

Reproducir: `python3 trading/copy_maderna/variantes/A_martingala_acotada/run.py` (≈45 s, 4 procesos).
Tablas completas: `results.md`. Rejilla IS completa: `grid_is.csv`. Simulador: `grid_sim_a.py`.

## 1. Lógica (5 líneas)

1. Cada hora, si no hay cesta abierta en una dirección, se abre 0,01 lotes en esa dirección (ambos lados, como el copy real).
2. TP de cesta a `tp_pips` del precio medio ponderado; sin SL individual.
3. Si el precio va `step_pips` en contra desde el último nivel, se añade otra posición; el lote del nivel k es 0,01·mult^(k−1) redondeado a 0,01.
4. La cesta está ACOTADA por dos lados: nunca más de `max_levels` posiciones y se cierra entera si su flotante cae por debajo de −`basket_sl_usd`.
5. Costes por defecto del simulador: spread 1 pip, comisión 7 USD/lote ida y vuelta, swap −3 USD/lote/noche; capital 1.000, apalancamiento 200.

## 2. Dos avisos previos (importantes para interpretar todo lo demás)

- **En el simulador original `lot_mult` no hace nada con base_lot 0,01**: 0,01·1,2 / 1,3 / 1,5 se redondea a 0,01 y la cadena `last_lot·mult` nunca crece. Comprobado: las 768 combinaciones de la rejilla completa dan resultados idénticos para mult 1,0/1,2/1,3/1,5. Por eso se copió `simulate()` a `grid_sim_a.py` con un único cambio: lote del nivel k = 0,01·mult^(k−1) y **después** se redondea a 0,01 (ej. mult 1,5, 6 niveles: 0,01/0,01/0,01/0,02/0,03/0,05). Con 3 niveles el multiplicador sigue sin actuar, sea cual sea su valor.
- **El criterio de optimización pedido (sin ruina y max DD ≤ 300 USD en IS) no lo cumple NINGUNA combinación**, ni en la rejilla de `run.py` (234 por par) ni en la rejilla completa exploratoria de 768 por par. Se aplicaron criterios relajados, etiquetados en `results.md`:
  - EURUSD → criterio C: sin ruina, net IS > 0, máximo usd/h (0 combinaciones con DD ≤ 300; 4 con DD ≤ 500, todas con net ≤ 0; 74/234 sobreviven; 21/234 acaban en positivo).
  - GBPUSD → criterio E (fracaso): **las 234 combinaciones se arruinan en el IS** (también las 768 de la exploración). Se elige la que más tarda en arruinarse (2016-10-07, el flash-crash de la libra), solo para poder rellenar OOS/FULL/combinado.

## 3. Rejilla explorada (234 combinaciones por par)

Fase 1 (216): mult {1,0; 1,5} × step {20, 40, 60} × niveles {3, 4, 6} × basket_sl {60, 100, 150, 200} × tp {6, 10, 15}. Fase 2 (18): vecinos de las 5 mejores con mult {1,2; 1,3}, step 30 y niveles 5. Optimización solo con 2012-11 → 2017-12.

Lo que dice la rejilla en EURUSD (fase 1, sin sesgo): tp 6 → ruina en el 100 % de los casos; tp 10 → 85 %; tp 15 → 30 %. Step 60 y 3 niveles sobreviven más. El SL de cesta apenas cambia la supervivencia (64-76 % de ruina para cualquier valor). Es decir: **el TP de 6 pips del copy original es matemáticamente inviable con estos costes** (0,6 USD brutos frente a 0,17 USD de spread+comisión por operación de 0,01 lotes, más swap), y lo que salva algunas combinaciones es alargar el TP y ensanchar el paso, no la martingala.

## 4. Mejores parámetros

| par | parámetros (mult / step / niveles / SL cesta / tp) | criterio | secuencia de lotes |
|---|---|---|---|
| EURUSD | **1,2 / 60 pips / 6 / 100 USD / 15 pips** | C (relajado) | 0,01 0,01 0,01 0,01 0,02 0,02 |
| GBPUSD | 1,0 / 40 pips / 3 / 200 USD / 15 pips | E (todo se arruina; "menos mala") | 0,01 0,01 0,01 |

## 5. Resultados (cada periodo simulado desde 1.000 USD; combinado = eq_EURUSD + eq_GBPUSD − 1.000, congelado en 0 si llega a 0)

| serie | periodo | net USD | usd/h | max DD USD | max DD % | ruina | stopouts | sl_hits | tp_hits | cestas | peor cesta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EURUSD | IS | +522,31 | 0,0116 | 550,21 | 52,2 | no | 0 | 57 | 4.000 | 4.057 | −146,20 |
| EURUSD | OOS | +327,36 | 0,0090 | 345,79 | 22,7 | no | 0 | 34 | 2.406 | 2.440 | −134,98 |
| EURUSD | FULL | +810,21 | 0,0099 | 550,21 | 52,2 | no | 0 | 92 | 6.407 | 6.499 | −146,20 |
| GBPUSD | IS | −1.000,00 | −0,0223 | 1.006,60 | 100,0 | **SÍ (2016-10-07)** | 1 | 23 | 2.177 | 2.201 | −370,12 |
| GBPUSD | OOS | −111,90 | −0,0031 | 728,31 | 57,1 | no | 0 | 19 | 2.323 | 2.342 | −273,05 |
| GBPUSD | FULL | −1.000,00 | −0,0123 | 1.006,60 | 100,0 | **SÍ (2016-10-07)** | 1 | 23 | 2.177 | 2.201 | −370,12 |
| Combinado | IS | −477,69 | −0,0106 | 963,38 | 94,9 | no (mín. equity 52 USD) | 1 | 80 | 6.177 | 6.258 | −370,12 |
| Combinado | **OOS** | **+215,46** | **0,0059** | 914,50 | 55,1 | no | 0 | 53 | 4.729 | 4.782 | −273,05 |
| Combinado | **FULL** | −189,79 | −0,0023 | **963,38** | **94,9** | no (técnicamente) | 1 | 115 | 8.584 | 8.700 | −370,12 |

Por año (FULL, variación de equity en USD):

| serie | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 (ene-mar) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EURUSD | −72,6 | −182,9 | +239,5 | −136,1 | +338,7 | +335,7 | +142,1 | +302,8 | −44,0 | +41,5 | −154,5 |
| GBPUSD | −6,4 | −203,9 | −50,4 | −101,2 | −638,1 (ruina) | 0 | 0 | 0 | 0 | 0 | 0 |
| Combinado | −79,0 | −386,8 | +189,1 | −237,3 | −299,5 | +335,7 | +142,1 | +302,8 | −44,0 | +41,5 | −154,5 |

Lectura honesta: EURUSD gana ~0,01 USD/hora (≈ 86 USD/año sobre 1.000, un 8,6 % anual) a cambio de un drawdown del 52 % y años enteros en negativo (2013, 2015). GBPUSD destruye la cuenta en el IS y en OOS sigue perdiendo (−112 USD con 57 % de DD). El combinado en OOS es positivo solo porque EURUSD tapa a GBPUSD; en FULL la cuenta única llega a quedarse con 52 USD de 1.000 (2016-11-28) (no es "ruina" solo por el criterio formal del simulador). Contraste con el copy real: +0,36 USD/h con 53 % de DD flotante en 5 meses; aquí el DD es parecido y el rendimiento es 40-60 veces menor.

## 6. Robustez (OOS, step × {0,8; 1; 1,2} y basket_sl × {0,8; 1; 1,2}, 9 variantes)

| serie | OOS > 0 | rango net OOS | rango max DD OOS |
|---|---|---|---|
| EURUSD | 9/9 (100 %) | +243 … +1.047 | 233 … 516 |
| GBPUSD | 2/9 (22 %) | −310 … +70 | 457 … 731 |
| Combinado | 9/9 (100 %) | +190 … +960 | 503 … 943 |

Pero la dispersión es enorme y no monótona: en EURUSD, SL 80 da +1.022 y SL 120 da +415 con el mismo paso; step 72/SL 120 da +1.047 y step 60/SL 120 da +310. Son 20-35 cierres por SL de ~100-150 USD en 4 años los que deciden el resultado, no las 2.400 cestas ganadoras: el resultado depende de qué tendencias concretas "pillan" a la cesta, es decir, de suerte. El 100 % de positivos en OOS es real, pero el intervalo va de "mediocre" a "bueno" según dos parámetros que no se pueden fijar a priori.

Comprobación fuera de rejilla (informativa, no usada para seleccionar): con TP 30 pips en vez de 15, EURUSD FULL pasa a +1.136 USD con DD 478 y GBPUSD deja de arruinarse (+94 USD, DD 851, 71 %). Confirma que la palanca real es el TP/paso (menos operaciones, menos costes), no el multiplicador.

## 7. Puntuación (rúbrica)

| criterio | resultado | puntos |
|---|---|---|
| usd/h OOS combinado (3: ≥1,0; 2: ≥0,25; 1: >0; 0: ≤0) | 0,0059 USD/h (positivo, pero 170 veces por debajo del umbral de 3 puntos) | **1/3** |
| DD (3: max DD FULL ≤ 300 sin ruina; 1: ≤ 500; 0: mayor o ruina) | combinado FULL 963 USD (94,9 %); GBPUSD solo: ruina; EURUSD solo: 550 | **0/3** |
| Robustez (OOS > 0 en ≥ 70 % de variaciones) | combinado 9/9 (gracias a EURUSD 9/9; GBPUSD 2/9) | **2/2** |
| ≥ 200 cestas OOS | 4.782 cestas combinadas | **1/1** |
| Informe claro | tablas reproducibles, criterios etiquetados, fallos explicados | **1/1** |
| **Total** | | **5/10** |

Nota brutal: el 5 lo dan puntos "fáciles" de la rúbrica (robustez, número de cestas, informe). En lo que importa —ganar dinero con un drawdown tolerable— la variante saca 1/6. Sin la rúbrica, como estrategia operable la puntuaría 2/10: no cumple el criterio de optimización en ningún par, GBPUSD se arruina, y en EURUSD gana ~8 %/año con DD del 52 %.

## 8. Conclusión

- La "martingala acotada" no arregla el copy: acotar niveles y poner SL de cesta convierte la ruina segura en una sangría lenta (cada SL de 100-200 USD se come 100-400 TPs de 0,4-1,4 USD).
- El multiplicador de lotes es irrelevante o perjudicial (mult 1,5 → 77 % de ruina frente a 64 % con 1,0 en la fase 1); con 0,01 lotes y ≤ 3 niveles directamente no existe.
- Lo único que mueve la aguja es reducir la frecuencia y el coste (TP 15-30 pips, paso 60) y **no operar GBPUSD** con esta lógica.
- Recomendación: no operar en real. Si se quiere seguir explorando, la familia con más recorrido no es la martingala sino TP/paso anchos con filtro de tendencia y un solo lado (fuera del alcance de esta variante).
