# Enfoque A — Apuesta direccional de alta volatilidad (1-2 operaciones al día)

Reproducir: `python3 trading/fondeo/enfoques/A_apuesta_direccional/run.py` (≈30 min en 4 núcleos compartidos; `--quick` para una
prueba de 4 min). Salidas: `grid.csv` (4.488 filas: todas las combinaciones, IS y OOS), `results.json` (configuración elegida por
firma, línea base, fase fondeada, valor esperado, matemática), `betlib.py` (estrategia `strat_bet` y utilidades), `extra.py`
(complemento: mejor candidato en oro y USDJPY). `challenge_sim.py` no se modificó.

## 1. La idea en 5 líneas
Lo que hace la gente que "pasa rápido": una (o dos) apuestas direccionales al día en un activo volátil (XAUUSD, BTCUSD), stop por
ATR, take profit con R:R alto, y tamaño grande (1,5-2,8 % por operación) para que tres o cuatro aciertos seguidos hagan el 10 %.
Probé 9 reglas de dirección (momentum 4/12/24/72 h, reversión 4/24 h, dirección del día anterior, dirección de la sesión asiática,
largo permanente), 3 horas de entrada (Londres 10:00, NY 16:00, apertura 01:00; en BTC 08/13/00 UTC), SL de 0,5-3 ATR, R:R 1-3,
cierre a hora fija vs. trailing, 1 vs. 2 operaciones/día, parada diaria y riesgo sobre balance. **Resultado: no hay edge.** La mejor
configuración OOS pasa el 14 % de las semanas (BTC largo) contra 10 % de la moneda al aire, y quema más de lo que pasa.

## 2. Configuración final y tabla IS/OOS por firma

Selección solo con IS (etapas 1-3a); OOS se reporta. Las seis firmas eligieron **la misma configuración**:
**BTCUSD, largo permanente, entrada 08:00 UTC, SL = 1,0 × ATR14(H1), TP = 3 × SL, cierre 23:00 UTC, 1 operación/día,
riesgo 1,5 % del balance actual (`risk_on_balance=True`), sin parada diaria.** IS = 391 semanas de inicio (2023-09 → 2025-02),
OOS = 395 (2025-03 → 2026-09). Media 6-7 operaciones por intento de 7 días (BTC opera también fin de semana).

Plazo 7 días (lo que pide el usuario):

| Firma | Fee | IS pass | IS quema | OOS pass | OOS inconsist. | OOS quema (diaria+máx) | OOS timeout | Días medianos hasta pasar (OOS) |
|---|---|---|---|---|---|---|---|---|
| FTMO 1-Step (10/3/10 trailing, Best Day) | 540 | 18,2 | 14,8 | **14,2** | 0,0 | 16,5 (0,0 + 16,5) | 69,4 | 3,8 |
| FundingPips 1-Step (10/3/6) | 500 | 18,9 | 26,1 | **14,2** | 0,0 | 35,7 (0,0 + 35,7) | 50,1 | 3,8 |
| E8 One DD 8 % (12 %/8 % trailing) | 260 | 12,5 | 35,5 | **10,6** | 0,0 | 42,3 | 47,1 | 3,9 |
| E8 One DD 14 % (21 %/14 %) | 260 | 0,5 | 0,0 | **0,8** | 0,0 | 0,0 | 99,2 | 5,5 |
| The5ers Hyper (10/3/6, 3 días) | 260 | 18,9 | 26,1 | **14,2** | 0,0 | 35,7 | 50,1 | 4,2 |
| FTMO fase 1 de 2 (10/5/10, 4 días) | 540 | 10,2 | 0,3 | **3,0** | 0,0 | 0,0 | 97,0 | 5,6 |

Plazos más largos (las firmas no tienen límite de tiempo; "una semana" es autoimpuesto):

| Firma | 14 d IS pass/quema | 14 d OOS pass/quema | 30 d IS pass/quema | 30 d OOS pass/quema | 30 d OOS timeout |
|---|---|---|---|---|---|
| FTMO 1-Step | 26,6 / 47,1 | 22,5 / 50,1 | 30,9 / 68,0 | 24,8 / 70,9 | 4,3 |
| FundingPips 1-Step | 26,6 / 46,8 | 21,5 / 54,9 | 35,5 / 60,4 | 26,8 / 65,3 | 7,8 |
| E8 One 8 % | 20,2 / 67,3 | 15,9 / 74,2 | 21,2 / 78,8 | 16,2 / 81,3 | 2,5 |
| E8 One 14 % | 7,7 / 16,4 | 4,8 / 20,8 | 16,4 / 54,2 | 10,4 / 64,1 | 25,6 |
| The5ers Hyper | 26,6 / 46,8 | 21,5 / 54,9 | 35,5 / 60,4 | 26,8 / 65,3 | 7,8 |
| FTMO fase 1 | 22,0 / 5,6 | 8,9 / 8,9 | 39,4 / 18,9 | 17,5 / 30,1 | 52,4 |

Dar más tiempo no arregla nada: a 30 días la cuenta termina decidida casi siempre, y **se quema 2,5-3 veces más de lo que pasa**.
La única firma donde quemar es raro es FTMO 2 fases (5 % diario, 10 % estático), pero entonces pasar en 7 días es 3 %.

**Mejor candidato en ORO** (el activo que pedía el brief; elegido en IS, `results.json → extra_mejor_oro_y_control`):
XAUUSD, momentum 4 h, entrada 01:00 servidor, SL 2 ATR, R:R 2, cierre 22:00, riesgo 2 % sobre balance. OOS a 7 días:
FTMO 1-Step 3,4 % pass / 4,9 % quema (moneda 3,2 / 4,1); FundingPips 3,6 / 21,4 (moneda 3,4 / 21,2); The5ers 3,6 / 21,4;
E8 8 % 1,0 / 18,5; FTMO fase 1 3,6 / 0,0. A 30 días FTMO 1-Step 29,3 % pass / 59,9 % quema. **Control USDJPY** (momentum 24 h,
10:00, SL 2 ATR, R:R 2, parada diaria 2,5 %): OOS 7 d FTMO 1-Step 4,1 / 6,9 (moneda 3,5 / 7,2). Es decir: oro y yen dan lo
mismo que tirar una moneda; BTC largo da 4 puntos más que la moneda y eso viene del sesgo de muestra (§8).

## 3. Línea base "moneda al aire" (misma configuración, dirección al azar, media de 5 semillas)

| Firma | 7 d IS coin pass / quema | 7 d OOS coin pass / quema | 7 d OOS estrategia pass / quema | 30 d OOS coin pass / quema |
|---|---|---|---|---|
| FTMO 1-Step | 9,4 / 19,4 | 9,7 / 22,8 | 14,2 / 16,5 | 21,1 / 76,2 |
| FundingPips 1-Step | 9,4 / 32,6 | 9,8 / 34,6 | 14,2 / 35,7 | 24,2 / 70,2 |
| E8 One 8 % | 5,5 / 45,3 | 6,2 / 47,9 | 10,6 / 42,3 | 12,6 / 85,4 |
| E8 One 14 % | 0,1 / 0,3 | 0,4 / 0,6 | 0,8 / 0,0 | 4,5 / 72,3 |
| The5ers Hyper | 9,4 / 32,6 | 9,8 / 34,6 | 14,2 / 35,7 | 24,2 / 70,2 |
| FTMO fase 1 | 5,0 / 0,3 | 4,0 / 0,0 | 3,0 / 0,0 | 19,1 / 26,1 |

La estrategia supera a la moneda por 4-5 puntos en 7 días (14 vs 10) en las firmas de 1 fase y **no la supera** en FTMO 2 fases
(3,0 vs 4,0). Por operación (OOS, 553 operaciones): tasa de acierto 28,4 %, ganancia media +2,48 R, pérdida media −1,02 R,
esperanza **−0,025 R** (IS: 33,0 %, +0,106 R). Las 5 semillas de moneda dan 25-29 % de acierto y −0,15 a 0,00 R. La ventaja
OOS es 2-3 puntos de acierto, dentro del ruido de las semillas. **No hay edge demostrable.**

## 4. P(primer payout): +5 % en 30 días sin quemar, misma estrategia, reglas de pérdida de la cuenta fondeada

| Firma | IS pass / quema | OOS pass / quema | Moneda OOS pass / quema |
|---|---|---|---|
| FTMO 1-Step | 50,6 / 49,1 | 43,3 / 54,2 | 41,9 / 56,3 |
| FundingPips 1-Step | 48,8 / 51,2 | 39,5 / 58,2 | 40,4 / 58,1 |
| E8 One 8 % | 44,0 / 56,0 | 37,5 / 60,5 | 34,6 / 64,0 |
| E8 One 14 % | 63,4 / 29,4 | 54,2 / 34,9 | 50,7 / 41,2 |
| The5ers Hyper | 48,8 / 51,2 | 39,5 / 58,2 | 40,4 / 58,1 |
| FTMO 2 fases (fondeada 5/10) | 61,4 / 17,6 | 43,0 / 28,9 | 44,6 / 24,9 |

En la cuenta fondeada la estrategia es indistinguible de la moneda: ≈40 % cobra una vez, ≈55 % pierde la cuenta en el primer mes.

## 5. Valor esperado por intento (fee real, split de FIRMAS.md, primer payout = 5 % de 100k)

EV = P(pasar) × P(primer payout) × 5.000 × split − fee. Con P(pasar) a 7 días (y, entre paréntesis, a 30 días):

| Firma | P(pasar) 7 d OOS | P(payout) OOS | Split | Fee | **EV 7 d** | EV 30 d |
|---|---|---|---|---|---|---|
| FTMO 1-Step | 0,142 | 0,433 | 0,90 | 540 | **−263** | −57 |
| FundingPips 1-Step | 0,142 | 0,395 | 0,80 | 500 | **−276** | −77 |
| E8 One 8 % | 0,106 | 0,375 | 0,80 | 260 | **−101** | −17 |
| E8 One 14 % | 0,008 | 0,542 | 0,80 | 260 | **−243** | −35 |
| The5ers Hyper | 0,142 | 0,395 | 0,80 | 260 | **−36** | +163 |
| FTMO fase 1 (× P(fase 2 en 30 d) = 0,43) | 0,013 | 0,430 | 0,80 | 540 | **+22** (*) | +129 (*) |

(*) El EV de FTMO 2 fases sale positivo solo porque casi nunca se quema (0 % OOS) y el fee se paga una sola vez aunque el intento
dure meses: con P(pasar en 7 días) = 3 % no es un plan de "una semana". No se incluye el reembolso del fee con el primer payout
(FTMO) ni el coste de oportunidad de las semanas en `timeout`. Todos los EV a 7 días son negativos salvo ese artefacto.

## 6. Qué firma y qué riesgo recomendaría, y por qué

**No recomiendo comprar un challenge con este enfoque.** Si igualmente se quiere apostar:
- **Riesgo 1,5 % por operación, una sola operación al día, cierre a hora fija, sin trailing.** Es lo que salió del barrido IS y OOS
  lo confirma: con límite diario del 3 %, dos operaciones/día a ≥1,5 % quemaron el 47-75 % de los intentos (una doble pérdida =
  fail_daily), y 2,8 % por operación duplica la quema sin subir la probabilidad de pasar (BTC: 2,8 % → 4,6 % pass / 68,6 % quema
  IS vs 1,5 % → 7,4 % / 38,2 %). El trailing recorta a la mitad los pases (las apuestas ganadoras se cierran antes del 3R).
  La parada diaria de 2,5 % y `risk_on_balance` no mueven la aguja (±0,5 puntos).
- **Firma:** FTMO 1-Step es la que menos quema (16,5 % OOS, porque el DD máximo es 10 % y no 6 %) y la que más paga (90 %), pero
  el fee de 540 hace el EV más negativo. The5ers Hyper (fee 260, mismas reglas 10/3/6) es la menos mala en EV (−36 a 7 d) y la única
  con EV positivo si se aceptan 30 días, aunque quema el 65 %. E8 One 14 % (objetivo 21 %) es inalcanzable en una semana.

## 7. Puntuación honesta (0-10)

Criterios del brief sobre la firma principal (FTMO 1-Step, OOS 7 días): P(pasar) = 14,2 % < 30 % → **0**; P(quemar) 16,5 % >
P(pasar) 14,2 % → **0**; IS 18,2 vs OOS 14,2 (diferencia 4) → **2**; EV −263 → **0**. **Total: 2/10.** Igual para FundingPips,
E8 8 % y The5ers (2/10). E8 14 % suma 4 y FTMO 2 fases suma 6 por artefactos de la fórmula (0 % de quema con 0,8 % y 3 % de pase,
y un EV de +22 que depende de esperar meses); en la práctica valen lo mismo o menos. **Puntuación del enfoque: 2/10.**

## 8. Sesgo de muestra (obligatorio reportarlo)

- **BTC largo permanente** ganó el cribado IS porque el tramo IS (2023-09 → 2025-02) es una subida de +225 % (26k → 84k). El tramo
  OOS (2025-03 → 2026-09) es −6 % (84k → 80k, máximo 126k, mínimo 58k). Que "largo" siga dando 14 % OOS (vs 10 % moneda) se explica
  por la asimetría: con R:R 3 los pocos días de subida fuerte pagan, pero la esperanza por operación pasó de +0,11 R a −0,03 R.
  Sobre un tramo bajista sostenido este plan quemaría igual que la moneda y no pasaría.
- **Oro largo**: el tramo IS (2012-2018) es bajista (1554 → 1280, −18 %) y el OOS alcista (1283 → 1970, +54 %). El sesgo largo
  fue el peor de las reglas en IS (1,7 % pass medio) y sube a 2,9 % en OOS (máximo 7,4 % en alguna combinación). Si alguien
  optimizara sobre 2019-2022 "descubriría" que hay que comprar oro; con 2012-2018 descubriría lo contrario. Por eso no se eligió.
- Ninguna regla de dirección en oro o yen se separa de las demás ni IS ni OOS (todas entre 2,1 y 2,7 % de pase medio a riesgo 2 %).
  Lo que sí mueve el resultado es el tamaño del stop y el R:R (§9): es un problema de geometría de la apuesta, no de predicción.

## 9. Qué aprendí del barrido (grid.csv, riesgo 2 %, media FTMO 1-Step + FundingPips, IS → OOS)

- **R:R**: con R:R 1 no se pasa nunca (0 %) porque hacen falta 5-7 aciertos seguidos; R:R 3 es lo mejor (oro 4,5 → 4,2; BTC 9,3 →
  8,4) a costa de quemar más (29 % / 37 %).
- **SL**: 1 ATR es el óptimo (oro 4,0 → 3,7; BTC 7,7 → 7,1); 0,5 ATR quema el 39-53 %; 3 ATR casi no pasa (0,6-3 %) porque el
  apalancamiento y el tamaño del stop limitan cuánto se puede ganar por día.
- **Hora**: Londres 10:00 (oro 3,0, yen 3,7) > apertura 01:00 (2,4) > NY 16:00 (1,9); en BTC 08 UTC > 13 > 00.
- **Regla de dirección**: irrelevante en oro y yen; en BTC "largo" y momentum 72 h destacan en IS solo por el mercado alcista.
- **Consistencia (Best Day 50 %, FTMO 1-Step)**: 0 % de `pass_inconsistent`; con una operación de ≤4,5 % al día no se viola.
- **Días mínimos**: no afectan (The5ers 3 días, FTMO 4 días: se cumplen dentro de la semana).

## 10. Matemática sencilla: cuántas ganadoras seguidas hacen falta

Con los números OOS de la configuración final (tasa de acierto p = 28,4 %, ganancia media +2,48 R, riesgo 1,5 %):
- Cada acierto suma 1,5 % × 2,48 = **3,7 %**. Para el 10 % hacen falta **3 aciertos seguidos** (11,1 %); P = 0,284³ = **2,3 %**.
  Para E8 8 % (12 %) hacen falta 4 (0,65 %); para E8 14 % (21 %) 6 (0,05 %).
- No hace falta que sean estrictamente seguidos: con 6-7 operaciones por semana caben secuencias como G-P-G-G. Un Monte Carlo con
  operaciones independientes (Bernoulli 28,4 %, 5 operaciones en la semana) da P(pasar) = 3,6 % y P(quemar) = 0-26 % según la
  firma. El simulador da 14 % porque BTC opera 7 días (6,5 operaciones), porque los aciertos se agrupan en rachas (autocorrelación
  de la volatilidad) y porque el TP a 3R se cobra entero mientras que el cierre horario recorta pérdidas (pérdida media −1,02 R).
- Con riesgo 2,8 % bastarían 2 aciertos (2 × 2,8 × 2,48 = 13,9 %) y P = 8 %, pero 2 fallos seguidos (−5,7 %) están a un paso
  del 6 % de DD máximo y por eso quema el 70 % (grid, etapa 2).
- Con moneda al aire (p ≈ 27 %) los números son los mismos: la "estrategia" no cambia la matemática, solo el tamaño y el R:R.

## 11. Debilidades y advertencias
- El edge OOS sobre la moneda (4 puntos) es del tamaño del ruido entre semillas y depende de que BTC no entre en bajista.
- Costes: spread 30 USD + slip 10 USD en BTC (0,05 % por lado) son ≈8 % del stop de 1 ATR; están incluidos, pero en un broker
  de prop firm con spreads peores el resultado empeora.
- Las 395 semanas OOS de BTC se solapan (inicios diarios): la muestra efectiva es ≈80 semanas independientes; el error estándar
  real es mayor que el ±2 % nominal.
- El apalancamiento 1:2 de BTC no capó el tamaño con riesgo 1,5 % y SL de 1 ATR (sí lo haría con SL de 0,5 ATR).
