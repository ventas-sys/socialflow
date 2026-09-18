# Activar el bot mañana: checklist paso a paso

Bot: `ChallengeEA.mq5` con el preset `ChallengeEA_GBPUSD_FTMO2step.set`. Estrategia: ruptura del rango 07:00-10:00 (hora del
servidor) en GBPUSD con órdenes stop a ambos lados, stop en el lado opuesto del rango, take profit 3R, una operación al día, sin lunes
ni viernes, cierre forzoso a las 23:00, riesgo 1,5 % del balance inicial por operación, guardias de pérdida diaria (5 %) y máxima (10 %).

## 0. Qué está probado y qué no
- Probado: el algoritmo completo en backtest sobre GBPUSD 2012-2022 (optimizado hasta 2018, validado 2019-2022, 820 fechas de inicio),
  con spread, comisión y deslizamiento. Resultados en `enfoques/B_ruptura_rango/REPORT.md` y `README.md` sección 5.
- No probado: la compilación del EA (no hay MetaEditor en este entorno) ni su comportamiento con datos en tiempo real. Por eso el
  primer paso es demo, no challenge pagado.

## 1. Mañana (día 1): demo, no dinero
1. Crear una cuenta **FTMO Free Trial** (demo de 14 días, mismas reglas que el challenge) en MT5, tamaño 100.000 USD.
2. Abrir MetaEditor, crear un Expert Advisor nuevo llamado `ChallengeEA`, pegar el contenido de `ChallengeEA.mq5`, compilar (F7).
   Si hay errores de compilación, copiarlos y pasármelos; los corrijo.
3. En MT5: gráfico GBPUSD M15, arrastrar el EA, en "Inputs" pulsar "Load" y cargar `ChallengeEA_GBPUSD_FTMO2step.set`.
   Poner `InpInitialBalance` igual al balance real de la cuenta. Activar "Algo Trading" (botón verde).
4. Comprobar la hora del servidor (esquina inferior derecha de MT5 o `TimeCurrent()` en el diario): el rango 07:00-10:00 y la hora de
   cierre 23:00 están en hora del servidor. FTMO usa GMT+2 (GMT+3 en horario de verano), igual que los datos del backtest. Si el servidor
   usa otra zona, ajustar `InpRangeStartHour`, `InpRangeEndHour`, `InpExpireHour` y `InpExitHour` para que sigan siendo 07-10, 17 y 23 en GMT+2/+3.
5. Dejarlo correr en un VPS o en una PC encendida sin interrupciones (MT5 debe estar abierto desde antes de las 10:00 del servidor).

## 2. Qué debe verse cada día (validación durante 2 semanas)
- Martes a jueves, a las 10:00 del servidor: dos órdenes pendientes (buy stop en el máximo del rango 07-10, sell stop en el mínimo),
  con SL en el lado opuesto y TP a 3 veces la distancia del stop. Lotes ≈ 1.500 USD / (rango en pips × 10 USD). Ejemplo: rango 25 pips → 6,0 lotes.
- Si el rango es menor que 0,3 ATR(H1) o mayor que 5 ATR, no se colocan órdenes ese día (es normal).
- Cuando se ejecuta una orden, la contraria se cancela en el acto. A las 17:00 se cancelan las pendientes no ejecutadas. A las 23:00 se
  cierra cualquier posición abierta.
- Lunes y viernes: nada. Objetivo alcanzado: el EA cierra todo y no vuelve a operar (`g_done`).
- Al final de las 2 semanas comparar el diario de MT5 con lo que hace el simulador para las mismas fechas. Si coinciden en entradas,
  stops y tamaños, el bot está validado.

## 3. Cuándo pasar a dinero real
- Solo después de las 2 semanas de demo sin discrepancias y con la compilación limpia.
- Comprar FTMO 2-Step de 100k (≈ 540-590 USD). Aceptar de antemano que se pierde el fee ~50 % de las veces.
- Nunca subir el riesgo por encima de 2 % ni operar a mano en la misma cuenta. Nunca abrir otra cuenta con posiciones opuestas.

## 4. Qué hacer si algo falla
- Error de compilación: pasarme el texto del error.
- Órdenes rechazadas por "invalid stops": el broker exige distancia mínima; subir `InpMinRangeATR` a 0,5.
- Lotes en 0: ver `InpInitialBalance` y el margen libre; el EA no usa más del 80 % del margen.
- Diferencias de horario: revisar el punto 1.4.

## 5. Datos honestos para decidir
| Riesgo por operación | Fase 1 (10 %) en 30 días: pasa / quema / sigue viva | Fase 1 en 60 días | Fase 2 (5 %) en 30 días |
|---|---|---|---|
| 1,5 % | 22 % / 16 % / 62 % | 33 % / 29 % / 38 % | 48 % / 16 % / 37 % |
| 2,0 % | 32 % / 27 % / 42 % | 41 % / 41 % / 17 % | 56 % / 25 % / 19 % |
| 2,8 % | 41 % / 43 % / 16 % | 45 % / 51 % / 5 % | 60 % / 37 % / 4 % |

Con FundedNext Stellar 2-Step (objetivo 8 % en fase 1, 5 días mínimos por fase, consistencia 40 %): con 2 % de riesgo, 41 % / 27 % / 33 % a 30 días
y mediana de 12,6 días para pasar; con 1,5 %, 29 % / 16 % / 56 % a 30 días. Es la opción "más rápida con la misma tasa"; a cambio, el fee
(≈ 550 USD) no se devuelve según las fuentes encontradas, y la regla de consistencia del 40 % exige que ningún día aporte más del 40 % del beneficio.
