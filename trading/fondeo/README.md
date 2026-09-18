# Pasar una cuenta de fondeo "en una semana": qué dicen los datos y qué plan real hay

**Fecha:** 7 de septiembre de 2026. **Para:** operar desde Argentina en MT5 con una cuenta de 100.000 USD.
**Método:** 12 firmas investigadas con fuentes (`FIRMAS.md`), un simulador que aplica las reglas reales de cada firma sobre
velas M15 de 10 años de oro, EURUSD, GBPUSD, USDJPY y 3 años de BTCUSD (`challenge_sim.py`), la matemática pura del challenge
(`matematica.md`) y tres agentes con enfoques distintos, optimizados en 2012-2018 y validados en 2019-2022 (BTC: validado 2025-2026).

## 1. Respuesta corta

**No hay forma fiable de pasar en una semana.** Con reglas de 1 fase (objetivo 10 %, pérdida diaria 3 %, pérdida máxima 6-10 %),
las mejores configuraciones encontradas pasan en 7 días entre el 1 % y el 14 % de las semanas históricas, y queman la cuenta
en la misma proporción o más. La moneda al aire con el mismo riesgo da los mismos números. Es un billete de lotería cuyo precio es el fee.

**Lo que sí existe** es una ruta con probabilidad de pasar mayor que la de quemar: FTMO 2 fases (o FundedNext Stellar 2 fases),
riesgo 1,5 % por operación, ruptura de rango en GBPUSD, **1 a 3 meses por fase** y sin límite de tiempo. Está cuantificada en la sección 5.

## 2. Los números de "una semana" (fuera de muestra, 100.000 USD, 7 días naturales)

| Enfoque (agente) | Activo y regla | Firma | Riesgo/op. | P(pasar) | P(quemar) | Moneda al aire | Nota honesta |
|---|---|---|---|---|---|---|---|
| A. Apuesta direccional | BTCUSD largo, 08:00 UTC, SL 1 ATR, TP 3R, 1 op/día | FTMO 1-Step | 1,5 % | **14,2 %** | 16,5 % | 9,7 % / 22,8 % | Solo funciona por el sesgo alcista de BTC; esperanza por op. −0,025 R OOS |
| A. Apuesta direccional | ídem | FundingPips / The5ers 1-Step | 1,5 % | 14,2 % | 35,7 % | — | Pérdida máx. 6 % quema el doble |
| A. Apuesta direccional | XAUUSD momentum 4 h, SL 2 ATR, TP 2R | 1-Step 10/3/6 | 2 % | 3,4 % | — | 3,2 % | Oro = moneda |
| B. Ruptura de rango | GBPUSD, rango 07-10, OCO, SL lado opuesto, TP 3R, sin lunes/viernes | FTMO 1-Step / FundingPips / The5ers | 1,5 % | 1,1 % | 0 % | 3,4 % / 1,0 % | Edge real (+0,06 R) pero diminuto: no quema, tampoco pasa |
| B. Ruptura de rango | ídem | FundingPips 1-Step | 2,8 % | 12,7 % | 37 % | — | Subir el riesgo solo compra varianza |
| C. Tendencia con trailing | BTCUSD Donchian-20 H1, trailing 1 ATR, 1 op/día | The5ers / FundingPips | 2,8 % | 16,2 % | 52 % | 22,5 % / 51 % | La moneda pasa más que la estrategia |
| Barrido base (sin optimizar) | Cualquier activo, cualquier regla, TP 2R | FTMO fase 1 (5 % diario, 10 % máx.) | 4 % | 25-30 % | 28-40 % | 26-30 % / 37-40 % | Con 5 % diario se pasa más, y se quema igual |

Puntuaciones honestas de los agentes (escala del brief, 9/10 era el objetivo): **A 2/10, B 4/10, C 2/10**. Ninguno recomienda comprar
un challenge para pasarlo en 7 días. Detalle en `enfoques/*/REPORT.md`, con IS y OOS, línea base de moneda al aire y valor esperado por intento.

## 3. Por qué no se puede (la matemática, independiente del activo)

`matematica.md` simula operaciones independientes bajo las reglas reales. Tres conclusiones:

1. **El límite diario del 3 % manda.** Obliga a arriesgar como máximo 2,5 % en una sola operación al día (o 1,3 % en dos). Con 2,5 % y
   TP 3R, el 10 % exige 2 ganadoras (+7 % cada una) antes de 3 perdedoras. Con 1,5 %, 3 ganadoras seguidas de 4-5 posibles.
2. **Sin edge, el resultado es simétrico**: con RR 3, riesgo 2,5 %, 5 días → 24 % pasa, 33 % quema, 43 % sin decidir. Subir el RR o el riesgo
   sube las dos columnas a la vez. Es varianza, no ventaja.
3. **Para pasar en una semana la mitad de las veces con menos del 15 % de ruina hace falta una esperanza de +0,5 R por operación**
   (45 % de acierto con TP 3R, o 62 % con TP 1R). Los mejores sistemas que medimos con datos reales rondan 0 a +0,06 R. No es un
   problema de afinar parámetros: es un orden de magnitud.

Además, las firmas ya lo saben: las que permiten pasar en una tarde (E8 One, FundingPips Flex, FTMO 1-Step, Apex) añaden reglas de
consistencia (mejor día ≤ 40-50 % del beneficio) que bloquean el cobro aunque pases con dos operaciones. En la simulación de FTMO 1-Step,
la regla Best Day anuló 3 de cada 4 pases del enfoque C y el 12 % de los del B con riesgo ≥ 2 %.

## 4. Errores de simulación detectados y corregidos (para que confíes en los números)

- La primera versión de la ruptura de rango daba 36 % de pases en EURUSD. Era un artefacto: el filtro de rango usaba un ATR que cambiaba
  cada hora y el ejecutor rellenaba la orden stop a un precio que ya no existía. Corregido (ATR fijo por día, relleno al peor entre el nivel
  y la apertura), el 36 % pasó a 1,3 %. Lo detectó el agente B; el simulador y el barrido base están recalculados.
- Si el stop y el take profit caen en la misma vela M15 se asume stop. Si una vela toca ambos lados del rango, se asume entrada y stop.
  El agente B midió el efecto: 0,7 % de las rupturas, sin cambio en los resultados a un decimal.
- Costes: spread, comisión y deslizamiento estimados (oro 25 centavos + 6 USD/lote, GBPUSD 0,4 pip + 6 USD/lote, BTC 30 USD). El sizing respeta
  el apalancamiento de cada programa (1:30 a 1:100).

## 5. La ruta que sí tiene sentido: 2 fases, 1,5 % de riesgo, 1-3 meses

Las reglas de 2 fases (5 % diario, 10 % máximo estático, sin límite de tiempo) son las únicas en las que P(pasar) supera a P(quemar).
Ruptura de rango B en GBPUSD, fuera de muestra 2019-2022 (820 fechas de inicio):

| Riesgo/op. | Plazo | Fase 1 (10 %): pasa / quema / sigue viva | Fase 2 (5 %): pasa / quema / sigue viva |
|---|---|---|---|
| 1,0 % | 60 días | 18 % / 12 % / 70 % | 44 % / 12 % / 44 % |
| **1,5 %** | 30 días | 22 % / 16 % / 62 % | 48 % / 16 % / 37 % |
| **1,5 %** | 60 días | **33 % / 29 % / 38 %** | **60 % / 25 % / 16 %** |
| 2,0 % | 60 días | 41 % / 41 % / 17 % | 61 % / 33 % / 5 % |
| 2,8 % | 30 días | 41 % / 43 % / 16 % | 60 % / 37 % / 4 % |

Lectura: con 1,5 % y sin límite de tiempo, la fase 1 termina en pase ~53 % de las veces (33 de cada 62 decididas) y la fase 2 ~70 %.
FTMO regala un reintento de la fase 2; con eso, **P(cuenta fondeada) ≈ 45-50 %**, en un plazo típico de 2 a 4 meses. En la cuenta fondeada,
P(+5 % en 30 días sin quemar) ≈ 45-60 % según el riesgo (fondeada Standard: sin fin de semana, sin noticias ±2 min).

**Valor esperado por intento** (supuestos: fee 100k ≈ 590 USD, primer payout 5 % × 80 % = 4.000 USD + devolución del fee; P(fondeada) 45 %;
P(primer payout) 55 %): 0,45 × 0,55 × 4.590 − 590 ≈ **+550 USD**, con enorme varianza (lo normal es perder el fee) y con 3 años de validación
en un solo par. La estimación pública de FTMO (8-12 % pasa, 5-7 % cobra) dice que los humanos lo hacen mucho peor que esta simulación,
sobre todo por saltarse el límite diario. La ventaja de esta ruta no es la estrategia: es que **el riesgo fijo y bajo respeta las reglas**.

## 6. Activo, plataforma y firma recomendados

- **Activo:** GBPUSD (ruptura del rango 07:00-10:00 hora del servidor, órdenes stop a ambos lados, SL en el lado opuesto, TP 3R, sin lunes ni viernes).
  Oro y BTC solo sirven para apostar varianza; en oro ningún enfoque superó a la moneda.
- **Plataforma:** MT5. El EA `ChallengeEA.mq5` replica la lógica del simulador con guardias de reglas (cierra todo al acercarse al límite diario
  o máximo, deja de operar al alcanzar el objetivo, una operación por día). No está compilado (sin MetaEditor en Linux): revisalo en MetaEditor
  y probalo en demo antes de usarlo.
- **Firma:** **FTMO 2-Step** (regulación de OANDA desde dic-2025, payout en cripto, Argentina no restringida, sin consistencia en el challenge,
  fee reembolsable). Alternativa más barata en fee con reglas equivalentes: **FundedNext Stellar 2-Step** (8 %/5 %, 550 USD, 5 días mínimos por fase,
  consistencia 40 %). Si aun así querés jugar la apuesta de 7 días, la menos mala es **The5ers Hyper Growth** (fee 260 USD, 10/3/6, 3 días):
  EV −4 a −36 USD por intento con 14-16 % de pases y 35-52 % de quemas.
- **Evitá**: E8 One con trailing (75-88 % de quemas en 7 días), Goat Funded Trader (reputación 2026), y cualquier hedge entre cuentas o firmas
  (prohibido en todas, detectado y sancionado con cierre y ban).

## 7. Plan operativo

1. Cuenta demo MT5 en FTMO (Free Trial) con el EA en GBPUSD, 1,5 % de riesgo, 2 semanas: comprobar que las órdenes, el sizing y las guardias
   funcionan como en el simulador (spread real, hora del servidor, expiración de pendientes).
2. Comprar FTMO 2-Step de 100k (≈ 540-590 USD) solo si aceptás perder el fee con probabilidad ~50 %.
3. Fase 1: 1,5 % por operación, una operación al día, cierre 23:00, sin operar lunes ni viernes, sin operar noticias. Nada de subir el riesgo
   tras una racha: la simulación muestra que 2,8 % iguala pases y quemas.
4. Al alcanzar el 10 %, parar y completar los 4 días mínimos con 0,01 lotes. Fase 2 igual con objetivo 5 %.
5. En fondeada: mismo riesgo o menor (1 %), retiro en cuanto se pueda (14 días), sin fin de semana ni noticias (cuenta Standard).
6. Costes totales del intento: fee 540-590 USD + VPS opcional 10-20 USD/mes. Sin fee de activación. Comisión 6 USD por lote ida y vuelta ya incluida.

## 8. Lo que este estudio no puede garantizar

- La validación fuera de muestra son 3 años (2019-2022) de un par; el edge medido (+0,06 R) está dentro del ruido estadístico. Lo que sostiene
  la ruta es la estructura de reglas, no la predicción.
- Las reglas y precios de las firmas cambian sin aviso; los datos de `FIRMAS.md` son de búsquedas web de septiembre de 2026 (no se pudo abrir
  las webs oficiales).
- Ninguna combinación llega a 9/10 con el criterio pactado (pasar en 7 días ≥ 50 % de las veces con EV positivo). La mejor puntuación es 4/10.

## 9. Reproducir

```bash
python3 trading/fondeo/matematica.py                                   # Monte Carlo de reglas (matematica.md)
python3 trading/fondeo/grid_base.py                                    # barrido base (grid_base.csv, ~7 min)
python3 trading/fondeo/enfoques/A_apuesta_direccional/run.py           # ~30 min
python3 trading/fondeo/enfoques/B_ruptura_rango/run.py                 # ~15 min
python3 trading/fondeo/enfoques/C_tendencia_plazos/run.py              # ~25 min
```
