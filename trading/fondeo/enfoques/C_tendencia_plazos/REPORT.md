# Enfoque C — Seguimiento de tendencia con trailing, riesgo escalonado y la pregunta del plazo

Reproducir: `python3 trading/fondeo/enfoques/C_tendencia_plazos/run.py` (≈25 min con 4 procesos; `--stage 1|2|3|report`).
Ficheros: `run.py`, `sim_c.py` (copia del simulador con cambios documentados en su docstring), `grid.csv` (1.844 evaluaciones,
IS y OOS), `results.json` (configuraciones finales y tablas), `stage1.csv` / `stage2.csv` / `final.csv` / `funded.csv` / `coin.csv`.

## 1. La idea en 5 líneas
Entrar a favor de la tendencia en H1/H4 (cruce de EMAs 10/30, 20/50, 50/200 o ruptura de canal Donchian 20/55), stop y
trailing por ATR(H1) ×1/×2/×4, sin take profit, salida por trailing, señal contraria o viernes 22h. Riesgo 0,5-2,8 % por
operación, fijo, sobre balance (`risk_on_balance`) o **escalonado anti-martingala** (sube un escalón tras ganar, vuelve al
mínimo tras perder; implementado como `risk_ladder` en `sim_c.py`). Lo que se mide es cómo cambia P(pasar)/P(quemar)/
P(sin decidir) si al challenge se le dan 7, 14, 30 o 60 días, y en qué firma encajan sus reglas. Resultado corto: la
entrada no tiene edge (la moneda al aire con el mismo riesgo pasa igual o más en OOS); lo que mueve los números es el
tamaño de riesgo, el plazo y las reglas de la firma.

## 2. Disciplina y método
- IS: FX/oro hasta 2018-12-31, BTC hasta 2025-02-28. OOS: FX/oro 2019-01-01 → 2022-03-04 (816 inicios), BTC 2025-03-01 → 2026-09
  (395 inicios). Parámetros elegidos solo en IS. Un intento por cada día hábil de inicio (01:00 servidor); costes del simulador sin tocar.
- Etapa 1 (IS, 150 combinaciones, riesgo fijo 2 %, reglas 10/3/6 = FundingPips 1-step, plazos 7 y 30 d): 5 activos × 5 entradas × H1/H4 × ATR 1/2/4.
- Etapa 2 (IS, 792 evaluaciones): las 11 mejores entradas × riesgo 0,5/1/1,5/2/2,8 % × modo (fijo, balance, escalonado, escalonado
  sobre balance) × cierre de viernes sí/no, plazos 7 y 14 d. Score = P(pasar 7) + P(pasar 14) − 0,5·P(quemar 14).
- Etapa 3 (IS y OOS, todos los inicios): 4 finales (mejor global, su versión escalonada, mejor de otro activo, su escalonada)
  × 7 firmas (las 6 pedidas + `ftmo_p2`) × plazos 7/14/30/60; fase fondeada P(+5 % en 30 d); moneda al aire (5 semillas, mismo riesgo/modo).

### Qué salió del barrido (IS)
| Hallazgo | Números (IS, 10/3/6, 2 % fijo) |
|---|---|
| Donchian 20 H1 es lo único que opera lo bastante para pasar en 7 d | media entradas: don20 P(pasar 7 d) 2,6 % / quema 11,8 %; ema50_200 0,2 % / 0,3 % (no opera: 95 % sin decidir a 30 d) |
| H4 casi no quema pero tampoco pasa | H1-ATR1: 3,0 % pasa / 10,0 % quema; H4-ATR2: 0,5 % / 0,9 % |
| Subir riesgo sube P(pasar) pero quemar sube más rápido | riesgo 1 %: 0,4/0,1; 1,5 %: 1,4/2,4; 2 %: 2,5/7,6; 2,8 %: 4,3/16,6 (medias etapa 2, 7 d) |
| Escalonado elimina quemar y casi elimina pasar | 2,8 % escalonado: 0,4 % pasa / 0,2 % quema (fijo: 8,4 / 31,0). Con tasa de acierto < 50 % la escalera casi nunca sube: opera de hecho a 0,5-1 % |
| Riesgo sobre balance ≈ fijo | diferencias de ±0,3 puntos en todo el barrido |
| Cierre de viernes indiferente | 1,9 %/6,0 % (sin cierre) vs 1,9 %/5,9 % (con cierre); BTC es 24/7 y en FX el efecto es < 0,2 puntos |

Finales elegidas (IS): **(A) BTCUSD Donchian-20 H1, stop y trailing 1 ATR, 2,8 % fijo, cierre viernes** (score 21,4:
P(pasar 7 d) 22,6 %, quema 54,3 %); (B) la misma entrada con escalera 0,5→1,0→1,5 % sobre balance; (C) XAUUSD Donchian-55
H4, ATR 1, 2,8 % fijo (mejor no-BTC, score 6,6); (D) XAUUSD escalera 0,5→2,0 %.

## 3. Configuración final (A) por firma, plazo 7 días — IS / OOS
BTCUSD, Donchian 20 en H1, stop 1 ATR(H1), trailing 1 ATR, sin TP, 2,8 % del balance inicial por operación, 1 op./día máx.
"Quema" = fail_daily + fail_max. "Incons." = objetivo alcanzado pero bloqueado por la Best Day Rule (cuenta como no pasado).

| Firma | P(pasar) IS | **OOS** | Incons. IS / OOS | Quema IS / **OOS** | Sin decidir IS / OOS | Días medianos hasta pasar IS / OOS |
|---|---|---|---|---|---|---|
| FTMO 1-Step (10/3/10 trailing, Best Day 50 %) | 3,3 | **3,8** | 16,2 / 11,6 | 57,4 / **52,6** | 23,1 / 31,9 | 5,8 / 5,4 |
| FundingPips 1-Step (10/3/6) | 22,6 | **16,2** | 0 / 0 | 54,3 / **52,2** | 23,1 / 31,6 | 3,8 / 3,4 |
| E8 One DD 8 % (12 % obj., 8 % trailing, sin diario) | 12,3 | **9,9** | 0 / 0 | 77,4 / **74,9** | 10,3 / 15,2 | 3,4 / 3,6 |
| E8 One DD 14 % (21 % obj., 14 % trailing) | 4,9 | **1,3** | 0 / 0 | 17,4 / **15,7** | 77,7 / 83,0 | 4,8 / 5,4 |
| The5ers Hyper Growth (10/3/6, 3 días) | 22,6 | **16,2** | 0 / 0 | 54,3 / **51,9** | 23,1 / 31,9 | 4,2 / 4,2 |
| FTMO fase 1 (10/5/10 estático, 4 días) | 3,1 | **2,3** | 0 / 0 | 0,3 / **0,0** | 96,7 / 97,7 | 5,6 / 5,6 |
| FTMO fase 2 (5/5/10, 4 días) | 19,0 | **14,2** | 0 / 0 | 0,3 / **0,0** | 80,8 / 85,8 | 5,6 / 5,6 |

IS y OOS son coherentes (diferencias < 10 puntos en todas las filas). El OOS de BTC son 395 inicios solapados en 18 meses
(≈ 80 semanas independientes a 7 d; ≈ 9 ventanas independientes a 60 d): los números a 30-60 d son ruidosos.

## 4. Línea base: moneda al aire con el mismo riesgo (2,8 % fijo, 1 op./día, SL 1,5 ATR, TP 2R; media de 5 semillas)
| Firma | Plazo | Estrategia OOS pasa / quema | **Moneda OOS pasa / quema** (± desv. entre semillas) | Estrategia IS pasa / quema | Moneda IS pasa / quema |
|---|---|---|---|---|---|
| FundingPips / The5ers | 7 d | 16,2 / 52,2 | **22,5 ± 1,8 / 51,1** | 22,6 / 54,3 | 16,7 / 59,3 |
| FundingPips / The5ers | 30 d | 26,6 / 72,2 | **32,7 ± 4,1 / 65,7** | 33,8 / 66,2 | 25,1 / 74,4 |
| FTMO 1-Step | 7 d | 3,8 / 52,6 (+11,6 incons.) | **15,6 / 53,7** | 3,3 / 57,4 | 11,8 / 59,8 |
| E8 One 8 % | 7 d | 9,9 / 74,9 | **12,7 / 76,9** | 12,3 / 77,4 | 10,5 / 79,6 |
| FTMO fase 1 | 30 d | 17,5 / 7,8 | **30,9 ± 5,1 / 25,2** | 19,7 / 18,2 | 27,1 / 52,3 |
| XAUUSD (C), FundingPips | 7 d | 2,8 / 4,0 | 15,6 / 52,1 | 4,9 / 5,8 | 16,4 / 53,2 |

Veredicto: en IS la estrategia superaba a la moneda (22,6 vs 16,7); en OOS la moneda pasa **más** (22,5 vs 16,2) con la misma
quema. **No hay edge en la entrada.** La moneda con TP 2R resuelve más rápido que una tendencia con trailing de 1 ATR, y por
eso incluso "pasa" más dentro del plazo. Lo que produce el 16-22 % de pases es el riesgo 2,8 % con 3 % de límite diario
(una operación y media de margen), no la dirección.

## 5. La pregunta del plazo: 7 / 14 / 30 / 60 días (configuración A, OOS; IS entre paréntesis)
| Firma | 7 d pasa / quema / sin decidir | 14 d | 30 d | 60 d |
|---|---|---|---|---|
| FundingPips 1-Step | 16,2 / 52,2 / 31,6 (22,6/54,3/23,1) | 23,5 / 68,1 / 8,4 (30,3/63,1/6,7) | 26,6 / 72,2 / 1,3 (33,8/66,2/0) | 26,6 / 72,2 / 1,3 |
| The5ers Hyper | 16,2 / 51,9 / 31,9 | 23,8 / 67,8 / 8,4 | 26,8 / 71,9 / 1,3 | 26,8 / 71,9 / 1,3 |
| FTMO 1-Step (pasa limpio) | 3,8 / 52,6 / 31,9 (+11,6 incons.) | 7,6 / 75,4 / 2,5 (+14,4) | 8,4 / 75,7 / 1,3 (+14,7) | 8,4 / 75,7 / 1,3 |
| E8 One 8 % | 9,9 / 74,9 / 15,2 | 11,1 / 87,8 / 1,0 | 11,1 / 88,1 / 0,8 | 11,1 / 88,1 / 0,8 |
| E8 One 14 % | 1,3 / 15,7 / 83,0 | 4,8 / 58,2 / 37,0 | 12,2 / 85,1 / 2,8 | 13,4 / 85,3 / 1,3 |
| **FTMO fase 1 (2-step)** | 2,3 / 0,0 / 97,7 (3,1/0,3/96,7) | 7,3 / 2,3 / 90,4 (8,7/3,6/87,7) | 17,5 / 7,8 / 74,7 (19,7/18,2/62,1) | **30,9 / 24,3 / 44,8** (32,6/36,7/30,8) |
| FTMO fase 2 | 14,2 / 0,0 / 85,8 | 29,1 / 2,3 / 68,6 | 44,6 / 7,8 / 47,6 | 59,5 / 23,3 / 17,2 |

Lectura:
- En las firmas 1-step con 3 % diario / 6 % máximo (FundingPips, The5ers) el challenge **se decide solo en ≤ 14 días**: dar
  un mes convierte el 32 % "sin decidir" de la semana en +10 puntos de pasar y +20 de quemar. La mediana de días hasta pasar
  es 3-5. Más plazo no ayuda; ayuda solo a quemar.
- E8 (sin límite diario pero DD 8 % trailing sobre el máximo de equity) es la peor casa para una tendencia con trailing de 1 ATR:
  el 75-88 % de los intentos muere por el trailing. El modelo 14 % (objetivo 21 %) no se pasa en una semana (1,3 %).
- FTMO 1-Step: la **Best Day Rule** bloquea 3 de cada 4 pases (11,6 % inconsistentes vs 3,8 % limpios en OOS) porque la
  tendencia hace el 10 % en 1-2 días buenos. Es la firma equivocada para este estilo.
- **FTMO 2 fases (5 % diario, 10 % estático, sin límite de tiempo)** es la única regla donde P(pasar) > P(quemar) en OOS a
  todos los plazos, pero necesita tiempo: 2 % en una semana, 17 % en un mes, 31 % en dos meses (24 % quemados, 45 % siguen
  vivos). La fase 2 (5 %) va al 60 % en dos meses. Producto de ambas ≈ 18 % en ~4 meses; la moneda al aire hace 30,9/25,2 a
  30 días en la misma fase 1, así que tampoco aquí hay edge, solo reglas más tolerantes con el drawdown.
- Escalera anti-martingala (B, 0,5→1,5 % sobre balance), OOS FundingPips: 7 d 0 / 0 / 100; 14 d 1,8 / 0 / 98; 30 d 2,0 / 13,9 / 84;
  60 d 5,3 / 31,6 / 63. Protege la cuenta a corto plazo (quema 0 % en dos semanas en todas las firmas) pero no pasa: sin una
  tasa de acierto > 50 % nunca acumula escalones. Sirve para una cuenta fondeada que quiere sobrevivir, no para un challenge
  con plazo. En XAUUSD (D) el resultado OOS es 0 % pasa / 0 % quema a todos los plazos: no opera lo suficiente.

## 6. Fase fondeada: P(primer payout) = P(+5 % en 30 días sin quemar), misma estrategia y riesgo (A)
| Firma (reglas de la fondeada = las del challenge) | P(+5 % en 30 d) IS / OOS | Quema de la fondeada en 30 d IS / OOS |
|---|---|---|
| FTMO 1-Step | 2,6 / 4,1 (Best Day) | 58,7 / 60,5 |
| FundingPips 1-Step | 44,4 / 39,2 | 55,7 / 59,5 |
| The5ers Hyper | 44,4 / 39,5 | 55,7 / 59,2 |
| E8 One 8 % | 33,3 / 29,9 | 66,7 / 69,4 |
| E8 One 14 % | 58,7 / 51,9 | 41,0 / 46,8 |
| FTMO fondeada (5/10 estático) | 52,3 / 44,6 | 17,7 / 7,8 |

A 2,8 % por operación la cuenta fondeada 10/3/6 muere el 60 % de las veces antes del primer payout. Con la escalera (B):
P(payout) 30,9 % y quema 13,9 % en OOS (FTMO fondeada: 27,1 % / 0 %).

## 7. Valor esperado por intento (OOS) = P(pasar) × P(primer payout) × 5.000 × split − fee
Splits usados: FTMO 1-Step 90 %, resto 80 %. Fees: FTMO 540 (1-Step y 2-Step), FundingPips 500, E8 260, The5ers 260 (precio de 100k
no confirmado en FIRMAS.md; 260 es una aproximación). Para FTMO 2-step se multiplica por P(pasar fase 2) al mismo plazo.

| Firma | 7 d | 14 d | 30 d | 60 d | Comentario |
|---|---|---|---|---|---|
| FTMO 1-Step | −533 | −526 | −525 | −525 | Best Day Rule también en la fondeada: P(payout) 4 % |
| FundingPips 1-Step | −246 | −132 | −83 | −83 | fee 500 demasiado caro para 16-27 % de pase |
| E8 One 8 % | −142 | −127 | −127 | −127 | trailing 8 % mata |
| E8 One 14 % | −233 | −160 | −7 | +18 | necesita ≥ 30 d; ruido a 60 d |
| **The5ers Hyper** | **−4** | **+116** | **+163** | +163 | único EV ≥ 0: fee barato + 80 % split, con 52-72 % de quema |
| FTMO 2-step (P1×P2) | −534 | −502 | −401 | −212 | P(ambas) 18 % a 60+60 d; fee 540 |

La moneda al aire en The5ers a 30 d (32,7 % pasa) daría EV ≈ +250: el EV positivo es propiedad de "riesgo 2,8 % en un
challenge de 260 USD con split 80 %", no de la estrategia. Y es una apuesta de varianza: se compran ~4 challenges por pase.

## 8. Recomendación
1. **No comprar un 1-step 10/3/6 ni un E8 ni un FTMO 1-Step para operar tendencia con trailing.** Los tres castigan
   exactamente lo que hace la estrategia (drawdowns intradía con el 3 % diario, devolver beneficio con el trailing, hacer el
   objetivo en 1-2 días con la Best Day Rule).
2. Si el usuario insiste en "una semana" con este estilo, la única firma donde el número no es ridículo es **The5ers Hyper Growth**
   (o FundingPips 1-Step, mismas reglas pero fee 500) con **BTCUSD Donchian-20 H1, 1 ATR, 2,8 % fijo**: 16 % de pasar en 7 días,
   52 % de quemar, EV ≈ 0 a 7 días y ≈ +120-160 USD si se le dan 14-30 días. Es una apuesta, no un edge: la moneda al aire hace lo mismo.
3. Si el usuario acepta 1-2 meses por fase, **FTMO 2 fases** con 2-2,8 % fijo es la regla que mejor tolera la estrategia
   (31 % fase 1 / 24 % quema en 60 d; 60 % fase 2); pero la Best Day Rule reaparece en la cuenta fondeada FTMO y la fondeada
   Standard no permite mantener el fin de semana (cierre de viernes obligatorio, que aquí no cambia los números).
4. Riesgo escalonado: usarlo solo en fase fondeada para no quemar (0-14 % de quema en 30 d); en challenge con plazo no pasa.
5. Riesgo por debajo de 2 % en 7 días: P(pasar) < 3 % en todas las firmas (1,5 % fijo: 1,4 % pasa / 2,4 % quema en IS). No tiene sentido
   con objetivo del 10 % y 3-5 operaciones por semana.

## 9. Puntuación honesta (configuración A, The5ers/FundingPips, 7 días, OOS): **2 / 10**
- P(pasar en 7 d) OOS = 16,2 % (< 30 %): **0** de 4.
- P(quemar) OOS = 52 % > P(pasar): **0** de 2.
- IS 22,6 % vs OOS 16,2 % (diferencia 6,4 puntos; todas las firmas < 10 puntos): **2** de 2.
- EV con fee real a 7 días: The5ers −4 USD, FundingPips −246 USD: **0** de 2 (a 14-30 días en The5ers sería +116/+163 y sumaría
  2 puntos, pero la moneda al aire lo iguala, así que no lo reclamo como mérito de la estrategia).

**Mayor debilidad:** la entrada no tiene edge medible: en OOS la moneda al aire con idéntico riesgo pasa más (22,5 % vs 16,2 %)
y quema igual. Todo lo que este enfoque puede decir con datos es sobre el tamaño de riesgo, el plazo y las reglas de cada firma;
además el OOS de BTC (18 meses) es corto y los números a 30-60 días descansan en ~9-18 ventanas independientes.

## 10. Cambios en el simulador (`sim_c.py`, copia; `challenge_sim.py` intacto)
- `run_attempt(..., risk_ladder=None)`: tupla de porcentajes; escalón 0 en la primera operación; tras una ganadora (balance al
  abrir la siguiente > balance al abrir la anterior) sube un escalón hasta el tope; tras una perdedora o neutra vuelve al escalón 0.
  Compatible con `risk_on_balance`. Con `risk_ladder=None` el comportamiento es idéntico al original.
- `strat_donchian(bars, n, atr_stop, trail, tf, exit_friday)`: ruptura de canal Donchian en H1/H4 (cierre por encima del máximo
  / debajo del mínimo de las n velas anteriores; solo la vela del cruce; ejecuta en la M15 siguiente), stop y trailing por ATR(H1).
- `evaluate_range(..., start, end, P=None)`: como `evaluate` pero limitando las fechas de inicio para separar IS y OOS y
  reutilizando `prep()` entre llamadas.
