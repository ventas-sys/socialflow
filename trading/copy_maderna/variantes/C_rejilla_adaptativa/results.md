# Variante C - Rejilla adaptativa: resultados

Grid completo: 6912 combinaciones; muestreo aleatorio reproducible de 250 por par (seed 42), mismas combinaciones en ambos pares.
Capital 1000 USD, leverage 200, spread 1 pip, comisión 7 USD/lote, swap -3 USD/lote/noche. IS: 2012-11 -> 2017-12. OOS: 2018-01 -> 2022-03.
Criterio de selección IS: sin ruina, max_dd_usd <= 300 USD, máximo USD/h. Si ningún candidato cumple, se relaja (se indica).

## EURUSD

**Mejores parámetros (IS):** `{'step_atr_mult': 2.0, 'hours': 'all', 'lot_mult': 1.0, 'max_levels': 4, 'basket_sl_usd': 250, 'tp_pips': 10, 'risk_scale': False, 'max_basket_hours': 168, 'vol_filter': True}`  
Selección: B (relajado): sin ruina, max usd/h (NINGUNA combinación cumple DD<=300).  
Grid IS: 17/250 combinaciones sin ruina; 0 cumplen DD<=300 sin ruina; 0 con net>0.

| Periodo | Net USD | USD/h | Max DD USD | Max DD % | Ruina | Stopouts | SL hits | TP hits | Time hits | Cestas | Peor cesta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| IS 2012-11→2017-12 | -261.61 | -0.0058 | 790.01 | 63.0 | no | 0 | 0 | 6393 | 141 | 6534 | -179.82 |
| OOS 2018-01→2022-03 | -198.62 | -0.0054 | 453.06 | 44.5 | no | 0 | 0 | 4651 | 135 | 4786 | -155.57 |
| FULL 2012-11→2022-03 | -484.72 | -0.0059 | 975.72 | 77.8 | no | 0 | 0 | 11142 | 279 | 11421 | -179.82 |

**Por año (USD, variación de equity)**

| Año | IS | OOS | FULL |
|---|---|---|---|
| 2012 | 39.87 | - | 39.87 |
| 2013 | 47.37 | - | 47.37 |
| 2014 | 30.92 | - | 30.92 |
| 2015 | -503.83 | - | -503.83 |
| 2016 | 129.43 | - | 129.43 |
| 2017 | -5.37 | - | -5.37 |
| 2018 | - | -115.45 | -139.94 |
| 2019 | - | 2.80 | 2.80 |
| 2020 | - | -155.39 | -155.39 |
| 2021 | - | 135.72 | 135.72 |
| 2022 | - | -66.31 | -66.31 |

**Top-5 IS por USD/h y su OOS** (contexto: ¿el ranking IS predice algo?)

| # | step_atr | hours | lot_mult | niveles | SL USD | TP | risk_scale | N h | vol_filter | IS usd/h | IS DD | IS ruina | OOS net | OOS usd/h | OOS DD | OOS ruina |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2.0 | all | 1.0 | 4 | 250 | 10 | False | 168 | True | -0.0058 | 790 | no | -198.62 | -0.0054 | 453 | no |
| 2 | 2.0 | all | 1.2 | 4 | 150 | 10 | True | 72 | True | -0.0061 | 1054 | no | 220.93 | 0.0060 | 321 | no |
| 3 | 2.0 | all | 1.2 | 3 | 150 | 10 | True | 168 | True | -0.0068 | 719 | no | -101.53 | -0.0028 | 329 | no |
| 4 | 2.0 | 7-20 | 1.2 | 3 | 150 | 10 | True | 168 | True | -0.0106 | 848 | no | -72.09 | -0.0020 | 339 | no |
| 5 | 1.5 | 7-20 | 1.2 | 3 | 250 | 10 | True | 168 | True | -0.0113 | 796 | no | -133.62 | -0.0037 | 262 | no |

**Robustez OOS (±20 % en step_atr_mult, basket_sl_usd, N; 27 variaciones):** 3/27 con net OOS > 0; net mín -371.79, mediana -149.71, máx 40.39; ruinas: 0.

| f_step | f_SL | f_N | net OOS | usd/h | DD USD | ruina |
|---|---|---|---|---|---|---|
| 0.8 | 0.8 | 0.8 | -5.22 | -0.0001 | 373 | no |
| 0.8 | 0.8 | 1.0 | -371.79 | -0.0102 | 471 | no |
| 0.8 | 0.8 | 1.2 | -230.50 | -0.0063 | 553 | no |
| 0.8 | 1.0 | 0.8 | -5.22 | -0.0001 | 373 | no |
| 0.8 | 1.0 | 1.0 | -371.79 | -0.0102 | 471 | no |
| 0.8 | 1.0 | 1.2 | -241.91 | -0.0066 | 565 | no |
| 0.8 | 1.2 | 0.8 | -5.22 | -0.0001 | 373 | no |
| 0.8 | 1.2 | 1.0 | -371.79 | -0.0102 | 471 | no |
| 0.8 | 1.2 | 1.2 | -241.91 | -0.0066 | 565 | no |
| 1.0 | 0.8 | 0.8 | -149.71 | -0.0041 | 426 | no |
| 1.0 | 0.8 | 1.0 | -198.62 | -0.0054 | 453 | no |
| 1.0 | 0.8 | 1.2 | -12.57 | -0.0003 | 372 | no |
| 1.0 | 1.0 | 0.8 | -149.71 | -0.0041 | 426 | no |
| 1.0 | 1.0 | 1.0 | -198.62 | -0.0054 | 453 | no |
| 1.0 | 1.0 | 1.2 | -12.57 | -0.0003 | 372 | no |
| 1.0 | 1.2 | 0.8 | -149.71 | -0.0041 | 426 | no |
| 1.0 | 1.2 | 1.0 | -198.62 | -0.0054 | 453 | no |
| 1.0 | 1.2 | 1.2 | -12.57 | -0.0003 | 372 | no |
| 1.2 | 0.8 | 0.8 | -5.19 | -0.0001 | 392 | no |
| 1.2 | 0.8 | 1.0 | -153.68 | -0.0042 | 407 | no |
| 1.2 | 0.8 | 1.2 | 40.39 | 0.0011 | 370 | no |
| 1.2 | 1.0 | 0.8 | -5.19 | -0.0001 | 392 | no |
| 1.2 | 1.0 | 1.0 | -153.68 | -0.0042 | 407 | no |
| 1.2 | 1.0 | 1.2 | 40.39 | 0.0011 | 370 | no |
| 1.2 | 1.2 | 0.8 | -5.19 | -0.0001 | 392 | no |
| 1.2 | 1.2 | 1.0 | -153.68 | -0.0042 | 407 | no |
| 1.2 | 1.2 | 1.2 | 40.39 | 0.0011 | 370 | no |

**Efecto marginal de cada parámetro en el grid IS (media de net USD y % sin ruina por valor):**

| Parámetro | Valor | n | net medio | % sin ruina | % net>0 |
|---|---|---|---|---|---|
| step_atr_mult | 0.5 | 59 | -1000.0 | 0 | 0 |
| step_atr_mult | 1.0 | 65 | -991.5 | 3 | 0 |
| step_atr_mult | 1.5 | 59 | -977.9 | 7 | 0 |
| step_atr_mult | 2.0 | 67 | -937.4 | 16 | 0 |
| hours | 12-21 | 70 | -997.5 | 1 | 0 |
| hours | 7-20 | 89 | -977.8 | 7 | 0 |
| hours | all | 91 | -957.1 | 11 | 0 |
| lot_mult | 1.0 | 127 | -981.5 | 6 | 0 |
| lot_mult | 1.2 | 123 | -969.9 | 8 | 0 |
| max_levels | 3 | 83 | -963.9 | 10 | 0 |
| max_levels | 4 | 84 | -971.1 | 7 | 0 |
| max_levels | 6 | 83 | -992.4 | 4 | 0 |
| basket_sl_usd | 60 | 59 | -990.6 | 3 | 0 |
| basket_sl_usd | 100 | 54 | -983.7 | 6 | 0 |
| basket_sl_usd | 150 | 68 | -963.3 | 7 | 0 |
| basket_sl_usd | 250 | 69 | -969.2 | 10 | 0 |
| tp_pips | 6 | 131 | -1000.0 | 0 | 0 |
| tp_pips | 10 | 119 | -949.2 | 14 | 0 |
| risk_scale | False | 124 | -981.3 | 6 | 0 |
| risk_scale | True | 126 | -970.4 | 8 | 0 |
| max_basket_hours | 24 | 85 | -996.9 | 2 | 0 |
| max_basket_hours | 72 | 87 | -972.9 | 8 | 0 |
| max_basket_hours | 168 | 78 | -956.1 | 10 | 0 |
| vol_filter | False | 127 | -996.3 | 2 | 0 |
| vol_filter | True | 123 | -954.6 | 11 | 0 |

## GBPUSD

**Mejores parámetros (IS):** `{'step_atr_mult': 2.0, 'hours': 'all', 'lot_mult': 1.0, 'max_levels': 3, 'basket_sl_usd': 150, 'tp_pips': 10, 'risk_scale': True, 'max_basket_hours': 24, 'vol_filter': False}`  
Selección: C (relajado): TODAS arruinan; se elige la que sobrevive más tiempo (ruina más tardía).  
Grid IS: 0/250 combinaciones sin ruina; 0 cumplen DD<=300 sin ruina; 0 con net>0.

| Periodo | Net USD | USD/h | Max DD USD | Max DD % | Ruina | Stopouts | SL hits | TP hits | Time hits | Cestas | Peor cesta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| IS 2012-11→2017-12 | -1000.00 | -0.0223 | 1029.21 | 100.0 | SÍ (2016-01-26) | 1 | 0 | 7102 | 849 | 7952 | -60.69 |
| OOS 2018-01→2022-03 | -865.02 | -0.0237 | 990.92 | 95.5 | no | 0 | 1 | 10006 | 1085 | 11092 | -172.21 |
| FULL 2012-11→2022-03 | -1000.00 | -0.0123 | 1029.21 | 100.0 | SÍ (2016-01-26) | 1 | 0 | 7102 | 849 | 7952 | -60.69 |

**Por año (USD, variación de equity)**

| Año | IS | OOS | FULL |
|---|---|---|---|
| 2012 | -5.65 | - | -5.65 |
| 2013 | -508.54 | - | -508.54 |
| 2014 | 39.01 | - | 39.01 |
| 2015 | -426.77 | - | -426.77 |
| 2016 | -98.06 | - | -98.06 |
| 2017 | 0.00 | - | 0.00 |
| 2018 | - | -45.71 | 0.00 |
| 2019 | - | -306.38 | 0.00 |
| 2020 | - | -431.31 | 0.00 |
| 2021 | - | -107.38 | 0.00 |
| 2022 | - | 25.74 | 0.00 |

**Top-5 IS por USD/h y su OOS** (contexto: ¿el ranking IS predice algo?)

| # | step_atr | hours | lot_mult | niveles | SL USD | TP | risk_scale | N h | vol_filter | IS usd/h | IS DD | IS ruina | OOS net | OOS usd/h | OOS DD | OOS ruina |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2.0 | all | 1.0 | 3 | 150 | 10 | True | 24 | False | -0.0223 | 1029 | sí | -865.02 | -0.0237 | 991 | no |
| 2 | 2.0 | all | 1.2 | 6 | 250 | 10 | False | 24 | True | -0.0223 | 1007 | sí | -625.10 | -0.0171 | 873 | no |
| 3 | 2.0 | all | 1.2 | 3 | 60 | 10 | True | 24 | False | -0.0223 | 1029 | sí | -1000.00 | -0.0274 | 1038 | sí |
| 4 | 2.0 | 12-21 | 1.2 | 3 | 150 | 10 | False | 24 | False | -0.0223 | 1013 | sí | -1000.00 | -0.0274 | 1013 | sí |
| 5 | 2.0 | 12-21 | 1.0 | 6 | 150 | 10 | True | 24 | False | -0.0223 | 1013 | sí | -1000.00 | -0.0274 | 1013 | sí |

**Robustez OOS (±20 % en step_atr_mult, basket_sl_usd, N; 27 variaciones):** 0/27 con net OOS > 0; net mín -1000.00, mediana -902.76, máx -659.45; ruinas: 13.

| f_step | f_SL | f_N | net OOS | usd/h | DD USD | ruina |
|---|---|---|---|---|---|---|
| 0.8 | 0.8 | 0.8 | -1000.00 | -0.0274 | 1005 | sí |
| 0.8 | 0.8 | 1.0 | -1000.00 | -0.0274 | 1003 | sí |
| 0.8 | 0.8 | 1.2 | -1000.00 | -0.0274 | 1015 | sí |
| 0.8 | 1.0 | 0.8 | -1000.00 | -0.0274 | 1005 | sí |
| 0.8 | 1.0 | 1.0 | -1000.00 | -0.0274 | 1003 | sí |
| 0.8 | 1.0 | 1.2 | -1000.00 | -0.0274 | 1015 | sí |
| 0.8 | 1.2 | 0.8 | -1000.00 | -0.0274 | 1005 | sí |
| 0.8 | 1.2 | 1.0 | -1000.00 | -0.0274 | 1003 | sí |
| 0.8 | 1.2 | 1.2 | -1000.00 | -0.0274 | 1015 | sí |
| 1.0 | 0.8 | 0.8 | -902.76 | -0.0247 | 976 | no |
| 1.0 | 0.8 | 1.0 | -869.55 | -0.0238 | 995 | no |
| 1.0 | 0.8 | 1.2 | -1000.00 | -0.0274 | 1017 | sí |
| 1.0 | 1.0 | 0.8 | -902.76 | -0.0247 | 976 | no |
| 1.0 | 1.0 | 1.0 | -865.02 | -0.0237 | 991 | no |
| 1.0 | 1.0 | 1.2 | -1000.00 | -0.0274 | 1017 | sí |
| 1.0 | 1.2 | 0.8 | -837.21 | -0.0229 | 910 | no |
| 1.0 | 1.2 | 1.0 | -852.09 | -0.0233 | 978 | no |
| 1.0 | 1.2 | 1.2 | -1000.00 | -0.0274 | 1017 | sí |
| 1.2 | 0.8 | 0.8 | -834.55 | -0.0228 | 921 | no |
| 1.2 | 0.8 | 1.0 | -718.61 | -0.0197 | 862 | no |
| 1.2 | 0.8 | 1.2 | -1000.00 | -0.0274 | 1019 | sí |
| 1.2 | 1.0 | 0.8 | -834.55 | -0.0228 | 921 | no |
| 1.2 | 1.0 | 1.0 | -718.61 | -0.0197 | 862 | no |
| 1.2 | 1.0 | 1.2 | -659.45 | -0.0180 | 949 | no |
| 1.2 | 1.2 | 0.8 | -771.79 | -0.0211 | 858 | no |
| 1.2 | 1.2 | 1.0 | -705.68 | -0.0193 | 849 | no |
| 1.2 | 1.2 | 1.2 | -659.45 | -0.0180 | 949 | no |

**Efecto marginal de cada parámetro en el grid IS (media de net USD y % sin ruina por valor):**

| Parámetro | Valor | n | net medio | % sin ruina | % net>0 |
|---|---|---|---|---|---|
| step_atr_mult | 0.5 | 59 | -1000.0 | 0 | 0 |
| step_atr_mult | 1.0 | 65 | -1000.0 | 0 | 0 |
| step_atr_mult | 1.5 | 59 | -1000.0 | 0 | 0 |
| step_atr_mult | 2.0 | 67 | -1000.0 | 0 | 0 |
| hours | 12-21 | 70 | -1000.0 | 0 | 0 |
| hours | 7-20 | 89 | -1000.0 | 0 | 0 |
| hours | all | 91 | -1000.0 | 0 | 0 |
| lot_mult | 1.0 | 127 | -1000.0 | 0 | 0 |
| lot_mult | 1.2 | 123 | -1000.0 | 0 | 0 |
| max_levels | 3 | 83 | -1000.0 | 0 | 0 |
| max_levels | 4 | 84 | -1000.0 | 0 | 0 |
| max_levels | 6 | 83 | -1000.0 | 0 | 0 |
| basket_sl_usd | 60 | 59 | -1000.0 | 0 | 0 |
| basket_sl_usd | 100 | 54 | -1000.0 | 0 | 0 |
| basket_sl_usd | 150 | 68 | -1000.0 | 0 | 0 |
| basket_sl_usd | 250 | 69 | -1000.0 | 0 | 0 |
| tp_pips | 6 | 131 | -1000.0 | 0 | 0 |
| tp_pips | 10 | 119 | -1000.0 | 0 | 0 |
| risk_scale | False | 124 | -1000.0 | 0 | 0 |
| risk_scale | True | 126 | -1000.0 | 0 | 0 |
| max_basket_hours | 24 | 85 | -1000.0 | 0 | 0 |
| max_basket_hours | 72 | 87 | -1000.0 | 0 | 0 |
| max_basket_hours | 168 | 78 | -1000.0 | 0 | 0 |
| vol_filter | False | 127 | -1000.0 | 0 | 0 |
| vol_filter | True | 123 | -1000.0 | 0 | 0 |

## Combinado EURUSD + GBPUSD (una sola cuenta de 1.000 USD: suma de curvas de equity - 1.000)

| Periodo | Net USD | USD/h | Max DD USD | Max DD % | Ruina | Stopouts | SL hits | TP hits | Time hits | Cestas | Peor cesta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| IS | -1000.00 | -0.0223 | 1081.62 | 100.0 | SÍ (2015-05-14) | 1 | 0 | 13495 | 990 | 14486 | -179.82 |
| OOS | -1000.00 | -0.0274 | 1002.81 | 100.0 | SÍ (2020-03-27) | 0 | 1 | 14657 | 1220 | 15878 | -172.21 |
| FULL | -1000.00 | -0.0123 | 1081.62 | 100.0 | SÍ (2015-05-14) | 1 | 0 | 18244 | 1128 | 19373 | -179.82 |

**Por año combinado (USD)**

| Año | IS | OOS | FULL |
|---|---|---|---|
| 2012 | 34.22 | - | 34.22 |
| 2013 | -461.17 | - | -461.17 |
| 2014 | 69.93 | - | 69.93 |
| 2015 | -642.99 | - | -642.99 |
| 2016 | 0.00 | - | 0.00 |
| 2017 | 0.00 | - | 0.00 |
| 2018 | - | -161.15 | 0.00 |
| 2019 | - | -303.58 | 0.00 |
| 2020 | - | -535.27 | 0.00 |
| 2021 | - | 0.00 | 0.00 |
| 2022 | - | 0.00 | 0.00 |

**Robustez OOS combinada** (misma variación ±20 % aplicada a ambos pares, net OOS EUR + net OOS GBP): 0/27 positivas; mín -1371.79, mediana -1012.57, máx -619.06.
