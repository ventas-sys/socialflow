# Enfoque B — Ruptura de rango intradía con órdenes stop OCO

Archivos: `run.py` (barrido reproducible, ~15 min con 4 núcleos), `strat_b.py` (variantes de la estrategia), `sim_b.py` (copia del
simulador con un cambio documentado), `sim_optimista.py` (copia para medir el sesgo de vela), `extras.py` → `extras.json`
(estadísticas por operación), `grid.csv` (2.178 evaluaciones, IS y OOS en cada fila), `results.json` (configuración final).
Ejecutar desde la raíz del repo: `python3 trading/fondeo/enfoques/B_ruptura_rango/run.py` y luego `python3 .../extras.py`.

## 1. La idea en cinco líneas
Se mide el rango de una sesión (asiático 01-09, pre-Londres 07-10, primera hora de Londres 10-11, Londres 10-15 o el día
anterior) y al terminar se colocan un buy stop en el máximo y un sell stop en el mínimo (OCO). La primera que se toca entra;
el SL va al lado opuesto del rango (o a la mitad, o a 1 ATR), el TP a 1-3 R o se sale por trailing ATR; la orden pendiente
expira a las 14-20 h y la posición se cierra a las 18-23 h. Filtros: rango relativo al ATR(H1), sin lunes/viernes, 1 o 2
operaciones al día. Sizing: 1-2,8 % por operación, sobre balance inicial o actual, con parada diaria autoimpuesta opcional.

## 2. Qué se probó y cómo se eligió (solo con IS)
- **Etapa 1 (960 evaluaciones)**: 4 activos × 5 rangos × 2 ventanas × 3 stops × 4 salidas, riesgo 2 %, ftmo_1step y
  fundingpips_1step, 500 inicios. Criterio: balance final medio IS (con 7 días y 2 % las tasas de pase son 0-3 %, demasiado
  escasas para ordenar).
- **Etapa 2 (384)**: para las 3 mejores estructuras por activo, 4 filtros ATR × con/sin lunes-viernes × 1 o 2 operaciones/día.
- **Etapa 3 (720)**: para las mejores configuraciones, 6 firmas × riesgo {1; 1,5; 2; 2,4; 2,8} × `risk_on_balance` × parada diaria 2 %.
  Criterio por firma: máximo de `pass − fail` IS.
- **Etapa 4 (114)**: configuración ganadora con **todos** los inicios (1.579 IS + 821 OOS), 7/14/30 días, fase fondeada,
  moneda al aire (5 semillas) y los tres simuladores (conservador, optimista, original).

**Un artefacto que hubo que corregir (importante para cualquiera que use `strat_breakout`)**. En la primera pasada EURUSD
"pasaba" el 36 % de las semanas IS y el 26 % OOS con un filtro `max_range_atr = 1,5`. Era falso: el filtro se evalúa vela a
vela con un ATR(H1) que cambia cada hora, así que un día con rango "demasiado grande" a las 09:00 se volvía válido a las
12:00 porque el ATR había subido *por el propio movimiento*; el ejecutor veía `high ≥ máximo del rango` y rellenaba la orden
stop **al nivel del rango**, un precio que ya no existía (el mercado estaba 30 pips más allá). Con el ratio medido una sola vez
por día, el mismo bucket 1,0-1,5 tiene 64 operaciones IS con R medio 0,26, no 477 con R 1,0; y con entrada al cierre de la vela
el R medio era −0,05. Dos correcciones: (1) `strat_b.py` fija el ATR de referencia en la primera vela de la ventana; (2) `sim_b.py`
(copia de `run_attempt`/`evaluate`, un solo cambio marcado) rellena los stops en `max(nivel, open)` / `min(nivel, open)` cuando la
vela abre más allá del nivel. Todo el grid final usa `sim_b`. `challenge_sim.py` no se modificó; el mecanismo también existe
en `strat_breakout` original (con 0,3-3,0 ATR pesa poco, pero pesa: ver §7).

## 3. Configuración final
**GBPUSD, rango pre-Londres 07:00-10:00, OCO desde las 10:00, expira 17:00, cierre 23:00, SL en el lado opuesto del rango
(mediana 26-30 pips), TP = 3 R, filtro 0,3-5 ATR(H1), sin lunes ni viernes, 1 operación/día, riesgo sobre balance inicial, sin
parada diaria** (no aporta con 1 operación/día). Sizing elegido por firma (IS): 1,5 % en ftmo_1step, fundingpips_1step,
the5ers_hyper y e8_one_8; 2,4 % en e8_one_14; 2,8 % en ftmo_p1.

Por operación (rastreador independiente, `extras.json`): IS 935 operaciones, acierto 38,7 %, TP 14 %, **R medio +0,081**,
3,0 op./semana; OOS 493 operaciones, acierto 36,3 %, **R medio +0,056**, 3,0 op./semana. Cortos mejores que largos (OOS
+0,12 vs 0,00). Por año: 2013 +0,38, 2014 +0,06, 2015 +0,02, 2016 −0,05, 2017 0,00, 2018 +0,11 | 2019 +0,21, 2020 −0,08,
2021 +0,06, 2022 −0,06. Es decir: un edge pequeño, positivo y coherente IS/OOS, pero de **+0,06 R por operación**, ~+0,5 %
de cuenta por semana con 2,8 % de riesgo. El objetivo son 10 % en 7 días.

### Tabla IS / OOS de la configuración final, plazo 7 días (todos los inicios; n = 1.579 IS, 821 OOS)
| Firma | riesgo | pass IS | pass OOS | pass_inc IS/OOS | quema IS | quema OOS | timeout OOS | días med. (OOS) |
|---|---|---|---|---|---|---|---|---|
| ftmo_1step | 1,5 % | 1,0 | **1,1** | 0 / 0 | 0,0 | 0,0 | 98,9 | 6,6 |
| fundingpips_1step | 1,5 % | 1,0 | **1,1** | 0 / 0 | 0,0 | 0,0 | 98,9 | 6,6 |
| e8_one_8 | 1,5 % | 0,4 | **0,4** | 0 / 0 | 0,7 | 1,6 | 98,1 | 6,9 |
| e8_one_14 | 2,4 % | 0,4 | **0,1** | 0 / 0 | 0,1 | 0,4 | 99,5 | 6,6 |
| the5ers_hyper | 1,5 % | 1,0 | **1,1** | 0 / 0 | 0,0 | 0,0 | 98,9 | 6,6 |
| ftmo_p1 (ref.) | 2,8 % | 6,3 | **6,6** | 0 / 0 | 0,0 | 0,0 | 93,4 | 5,6 |

La quema es 0 % por construcción: sin lunes/viernes caben como mucho 3-4 operaciones en 7 días naturales, y 3 × 1,5 % + costes
no llega al 6 %. Pero pasar exige 3 TP de 3 R en ≤ 4 intentos: ~1 %. ftmo_p1 llega al 6,6 % porque con 5 %/10 % de límites
tolera 2,8 % por operación (2 TP de 8,4 % pasan) y 3 pérdidas (8,4 %) no queman; sigue faltando la fase 2.

### 14 y 30 días (misma configuración y sizing)
| Firma | 14 d pass IS/OOS | 14 d quema IS/OOS | 30 d pass IS/OOS | 30 d quema IS/OOS | días med. 30 d OOS |
|---|---|---|---|---|---|
| ftmo_1step | 7,5 / 6,9 | 2,8 / 5,8 | 21,3 / 21,1 | 24,3 / 35,0 | 16,9 |
| fundingpips_1step | 7,5 / 6,9 | 14,6 / 22,2 | 20,7 / 21,9 | 33,7 / 38,5 | 18,4 |
| e8_one_8 | 2,9 / 2,7 | 13,5 / 25,1 | 13,4 / 11,0 | 45,3 / 60,8 | 20,6 |
| e8_one_14 | 2,0 / 1,5 | 8,9 / 13,4 | 12,0 / 10,4 | 37,3 / 50,4 | 22,4 |
| the5ers_hyper | 7,5 / 6,9 | 14,6 / 22,2 | 20,7 / 21,9 | 33,7 / 38,5 | 18,4 |
| ftmo_p1 | 24,4 / 27,9 | 19,6 / 28,0 | 41,4 / 40,6 | 37,7 / 43,1 | 8,9 |

Con más plazo pasan más semanas, pero la quema crece más deprisa: a 30 días en las firmas de 6 % la probabilidad de quemar
(35-60 %) supera a la de pasar. Con acierto del 37 % una racha de 4 pérdidas (6 %) es cuestión de tiempo.

### Trade-off del riesgo (etapa 3, fundingpips_1step, 500 inicios, 7 días)
| riesgo | pass IS | quema IS | pass OOS | quema OOS |
|---|---|---|---|---|
| 1,0 % | 0,0 | 0,0 | 0,0 | 0,0 |
| 1,5 % | 1,8 | 0,0 | 1,0 | 0,0 |
| 2,0 % | 5,3 | 13,4 | 4,4 | 20,5 |
| 2,4 % | 8,9 | 20,5 | 11,2 | 28,8 |
| 2,8 % | 10,4 | 26,6 | 12,7 | 37,1 |

Subir el riesgo multiplica los pases por 10 y la quema por infinito: con 2,8 % dos pérdidas son 5,6 % + costes y la tercera
quema. `risk_on_balance=True` empeora (más quemas, 36,9 vs 26,6 IS) y la parada diaria del 2 % no cambia nada con 1 operación/día.
La segunda operación del día (re-armar el OCO tras el stop) es contraproducente en todo el grid: en GBPUSD pasa de 13 % a
68 % de quemas IS con el mismo 2 % de riesgo. En **ftmo_1step**, además, con ≥ 2 % de riesgo la regla Best Day bloquea la
mayoría de los objetivos alcanzados (`pass_inconsistent` 9,4 % IS / 11,7 % OOS con 2,8 %, frente a 0,3 % de pases limpios):
una estrategia de pocas operaciones a 3 R gana el 10 % en un día grande y ese día supera el 50 % del beneficio.

## 4. Línea base: moneda al aire con el mismo riesgo
`strat_daily_bet(bars, 'coin', seed=0..4)` (1 operación/día a las 10 h, SL 1,5 ATR, TP 2 R), mismo riesgo y mismas reglas de ejecución, 7 días:

| Firma (riesgo) | estrategia pass/quema OOS | moneda pass/quema OOS | balance medio 7 d OOS: estrategia vs moneda |
|---|---|---|---|
| ftmo_1step (1,5 %) | 1,1 / 0,0 | 3,4 / 1,0 | +249 vs −434 USD |
| fundingpips_1step (1,5 %) | 1,1 / 0,0 | 3,4 / 19,8 | +249 vs −439 USD |
| e8_one_8 (1,5 %) | 0,4 / 1,6 | 0,3 / 10,2 | +248 vs −455 USD |
| e8_one_14 (2,4 %) | 0,1 / 0,4 | 0,2 / 5,1 | +399 vs −707 USD |
| the5ers_hyper (1,5 %) | 1,1 / 0,0 | 3,4 / 19,8 | +249 vs −439 USD |
| ftmo_p1 (2,8 %) | 6,6 / 0,0 | 21,3 / 24,5 | +549 vs −897 USD |

La moneda "pasa" más semanas (3,4 % vs 1,1 %) simplemente porque opera 5 días en vez de 3 y quema 20 veces más; en balance
medio la estrategia gana ~+250 USD por semana y la moneda pierde ~−440 (los costes). Una moneda con el **mismo 3 R y stop
1 ATR** (`extras.json`) da R medio −0,02 a −0,13 IS y −0,02 a −0,14 OOS, frente a +0,08 / +0,06 de la estrategia: hay edge
sobre el azar, pequeño pero fuera de muestra. En ftmo_p1 la moneda al 2,8 % pasa el 21 % de las semanas: con 5 %/10 % de
límites y 2 R, pasar la fase 1 en 7 días es en buena parte varianza, no habilidad.

## 5. P(primer payout): +5 % en 30 días sin quemar, misma estrategia y sizing
| Firma | estrategia IS / OOS | quema IS / OOS | moneda OOS |
|---|---|---|---|
| ftmo_1step (1,5 %) | 25,2 / **22,4** | 22,2 / 28,7 | 35,7 |
| fundingpips_1step (1,5 %) | 44,0 / **44,3** | 33,1 / 37,5 | 42,2 |
| e8_one_8 (1,5 %) | 42,7 / **41,7** | 38,3 / 45,3 | 40,5 |
| e8_one_14 (2,4 %) | 57,3 / **60,2** | 27,9 / 31,2 | 52,7 |
| the5ers_hyper (1,5 %) | 44,0 / **44,3** | 33,1 / 37,5 | 42,2 |
| ftmo_p1 (2,8 %) | 58,7 / **59,7** | 33,7 / 36,7 | 57,1 |

En la fase fondeada la estrategia apenas supera a la moneda (la moneda pasa +5 % a fuerza de varianza y quema más).
ftmo_1step queda peor porque el DD 10 % es trailing sobre el máximo de equity.

## 6. Valor esperado por intento (OOS, fee real, split de FIRMAS.md: FTMO 1-step 90 %, resto 80 %)
EV ≈ P(pasar 7 d) × P(payout) × 5.000 × split − fee.

| Firma | P(pasar) | P(payout) | fee | EV |
|---|---|---|---|---|
| ftmo_1step | 1,1 % | 22,4 % | 540 | **−529 USD** |
| fundingpips_1step | 1,1 % | 44,3 % | 500 | **−481 USD** |
| e8_one_8 | 0,4 % | 41,7 % | 260 | **−253 USD** |
| e8_one_14 | 0,1 % | 60,2 % | 260 | **−258 USD** |
| the5ers_hyper | 1,1 % | 44,3 % | 260 | **−241 USD** |
| ftmo_p1 | 6,6 % | 59,7 % | 0 en RULES (real ≈ 540) | +158 con fee 0; **−382** con el fee real, y falta la fase 2 |

Ni siquiera la variante agresiva salva el EV: fundingpips al 2,8 % (12,7 % pase, 37 % quema OOS) da 0,127 × 0,44 × 4.000 − 500 ≈ −276 USD.
Sin límite de una semana (30 días, fundingpips 1,5 %): 0,219 × 0,443 × 4.000 − 500 ≈ −112 USD, todavía negativo.

## 7. Sesgo de la vela M15 (entrada y stop en la misma vela)
- Con OCO y SL en el lado opuesto, "tocar ambos lados" equivale a "entrar y ser parado en la misma vela". En la configuración
  final ocurre en **10 de 1.428 primeras rupturas (0,7 %)**; en el rango asiático 0,05 %, primera hora de Londres 0,4 %, sesión
  de Londres 1,3 %. El simulador optimista (`sim_optimista.py`: esa vela nunca ejecuta el SL) da exactamente los mismos
  pass/quema a un decimal en las 6 firmas: **el sesgo es despreciable para rangos de 3 horas o más en M15**.
- En la segunda opción (XAUUSD, rango del día anterior, SL a mitad del rango, trailing) tampoco hay velas de doble toque
  (0 de 575), y optimista = conservador. Lo que sí cambia es el **supuesto de relleno**: el simulador original (rellena al nivel
  aunque la vela abra más allá) da 3,0 / 1,2 % de pases IS/OOS frente a 2,4 / 0,6 % con relleno a la apertura. Es decir, en
  esta familia de estrategias importa más cómo se rellena un stop con gap que la vela de doble toque, y en la primera versión
  del filtro ATR ese detalle fabricó un 36 % de pases. Para la configuración final GBPUSD original = sim_b (1,0 / 1,1 %).
- Con `max_trades_day=2` el ejecutor puede re-entrar en la misma vela en la que fue parado; es conservador (el doble toque
  vuelve a contar como stop), y de todos modos esa variante se descartó por las quemas.

## 8. Robustez de la elección (R medio por operación IS | OOS, GBPUSD)
| variante | n IS | R IS | n OOS | R OOS |
|---|---|---|---|---|
| final (07-10, 3 R, sin lun/vie, 0,3-5 ATR) | 935 | +0,081 | 493 | +0,056 |
| operando todos los días | 1.558 | +0,036 | 821 | +0,023 |
| sin filtro ATR (0,1-20) | 944 | +0,079 | 493 | +0,056 |
| max_range 3 ATR | 762 | +0,088 | 427 | +0,060 |
| TP 2 R | 935 | +0,041 | 493 | +0,042 |
| TP 1 R | 935 | +0,043 | 493 | +0,003 |
| expira 14 / cierre 18 | 917 | +0,073 | 485 | +0,040 |
| rango asiático 01-09 | 930 | −0,027 | 488 | +0,042 |
| rango 10-11 | 919 | +0,002 | 494 | +0,049 |

El filtro ATR no hace nada (0,3-5 deja pasar casi todo); el filtro de día sí: lunes y viernes son negativos en IS y en OOS
(−0,01/−0,05 IS, −0,01/−0,04 OOS), martes y jueves positivos en ambos tramos, miércoles cambia de signo. Es la parte del
edge más expuesta a sobreajuste, pero la mitad del efecto sobrevive OOS. Los otros activos: XAUUSD (día anterior + trailing)
2,4 / 0,6 % IS/OOS a 7 días con 2,8 %; EURUSD y BTCUSD peores. BTCUSD tenía el mejor balance medio IS (+0,9-1,2 k por semana,
mercado alcista 2023-25) pero ordenado por pass − fail queda tercero y su OOS (2025-26) es más flojo; no lo recomiendo.

## 9. Recomendación
**No comprar un challenge de 7 días con este enfoque.** Si aun así se quiere usar la ruptura pre-Londres en GBPUSD:
- Firma: **The5ers Hyper Growth** (fee 260, 3 días mínimos que la estrategia cumple) o FundingPips 1-step; evitar FTMO 1-step
  (Best Day bloquea los pases de una estrategia de pocas operaciones a 3 R) y E8 (más quemas y menos pases por el trailing).
- Riesgo: **1,5 % sobre balance inicial, 1 operación/día, sin re-entrada, sin lunes/viernes**; con eso la cuenta no se quema en
  7 días y se llega a 30 días con 22 % de pases y 38 % de quemas, que sigue siendo malo. 2,8 % solo si se acepta 37 % de quema
  por 13 % de pase en la semana.
- Lo honesto: el edge (+0,06 R, 3 op./semana) es real pero es 10-20 veces menor de lo que hace falta para un 10 % en 7 días.

## 10. Puntuación honesta (0-10), según el brief
| Criterio | ftmo_1step | fundingpips | e8_one_8 | e8_one_14 | the5ers | ftmo_p1 |
|---|---|---|---|---|---|---|
| P(pasar 7 d) OOS ≥ 50 % (4) / ≥ 30 % (2) | 0 | 0 | 0 | 0 | 0 | 0 |
| P(quemar) OOS ≤ P(pasar) (2) | 2 | 2 | 0 | 0 | 2 | 2 |
| IS y OOS coherentes, < 10 puntos (2) | 2 | 2 | 2 | 2 | 2 | 2 |
| EV positivo con el fee real (2) | 0 | 0 | 0 | 0 | 0 | 0 (2 con fee 0) |
| **Total** | **4** | **4** | **2** | **2** | **4** | **4** (6 nominal) |

Los 4 puntos vienen de "no quemar" y de la coherencia IS/OOS, no de pasar. **Mayor debilidad**: la magnitud del edge; una
ruptura de rango bien ejecutada rinde +0,5 % por semana con 2,8 % de riesgo, y las únicas maneras de convertir eso en 10 % en
7 días son apalancar la varianza (quemas del 20-40 %) o mentirse con el simulador (el artefacto del filtro ATR).
