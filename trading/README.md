# Estrategia de trading BTCUSD para MT4/MT5 — informe final del revisor

**Fecha:** 5 de septiembre de 2026 · **Datos:** Bitstamp BTC/USD, 1 minuto, 2023-09-01 → 2026-09-05 (26.402 velas H1, 0 huecos) · **Capital:** 1.000 USD · **Límite de pérdida flotante:** 300 USD · **Objetivo pedido:** +1 USD/hora.

---

## 1. Resumen simple (léelo aunque no leas nada más)

**No es posible ganar 1 USD por hora con 1.000 USD y una pérdida flotante máxima de 300 USD.** No lo digo por prudencia: lo dicen los números del backtest de 3 años con datos reales, y una cota matemática que no depende de ninguna estrategia.

| Hecho | Número |
|---|---|
| Lo que pides | 1 USD/h = 24 USD/día = 720 USD/mes = **72 % mensual** |
| Comprar y mantener BTC 3 años (26.035 → 79.661 USD) | +2.060 USD = **0,078 USD/h**, con pérdida flotante > 1.500 USD |
| Máximo que permiten 1.000 USD con apalancamiento 1:2 (regla ASIC/ESMA) | 0,02 lotes (0,02 BTC) |
| Con 0,02 lotes y **adivinando perfectamente la dirección de cada día** durante 3 años | 1,07 USD/h |
| Mejor estrategia real de las 3 (breakout), fuera de muestra | **0,0001 USD/h** |
| Mejor estrategia real en el periodo completo (tendencia) | 0,017 USD/h, pero con pérdida flotante de 402 USD (rompe el límite) |

Es decir: para llegar a 1 USD/h con el margen que permite tu cuenta tendrías que acertar el sentido del mercado **todos los días durante 3 años**. Con más apalancamiento (1:10 en entidad offshore) el techo teórico sube a 5 USD/h con previsión perfecta, pero cualquier racha normal de pérdidas supera los 300 USD flotantes en días.

**Lo que sí es realista con 1.000 USD y DD ≤ 300 USD:** entre 0 y 0,05 USD/h (0 a 35 USD/mes) con una estrategia sistemática honesta, y con años negativos por el camino. Eso es lo que muestran las 3 estrategias.

**Puntuación de las estrategias (rúbrica sobre 10, aplicada por mí como revisor):** tendencia **2/10**, reversión a la media **4/10**, breakout **4/10**. Ninguna llega a 9/10 y **ninguna iteración adicional puede llegar**: el problema no es la estrategia, es que el objetivo excede el máximo físico del mercado para ese tamaño de cuenta. Seguir "afinando" parámetros hasta que el backtest diga 9/10 sería fabricar sobreajuste, y te haría perder dinero real.

---

## 2. Qué se hizo (todo reproducible en este repo)

1. **Datos reales**: 1,58 millones de velas de 1 minuto de Bitstamp agregadas a H1 y M15 (`trading/data/`). Fuente: repositorio público `ff137/bitstamp-btcusd-minute-data`, actualizado a diario.
2. **Motor de backtest** (`trading/engine/backtest.py`): ejecuta la señal en la apertura de la vela siguiente (sin mirar el futuro), cobra spread, comisión, slippage y swap diario, respeta lote mínimo 0,01, margen por apalancamiento, SL/TP intravela (si tocan ambos, se asume SL) y mide el **drawdown de equity** intravela, que es tu pérdida flotante.
3. **Tres agentes independientes**, cada uno con una familia de estrategia distinta, optimizando **solo** con el primer 55 % de los datos (hasta feb-2025) y validando en el resto (mar-2025 → sep-2026). Cada uno entregó código Python, un Expert Advisor MQL5 y un informe.
4. **Revisión**: reejecuté los backtests, comprobé que no hay look-ahead, revisé los EA a mano (no hay MetaEditor en Linux, así que **no están compilados**: compílalos tú en MT5 antes de usarlos) y probé la cartera combinada.

### Las tres estrategias

| Estrategia | Lógica (estilo) | Fuera de muestra (18 meses), Pepperstone, 1:2 | Periodo completo sin freno de DD | Robustez (±20/40 % params) | Nota |
|---|---|---|---|---|---|
| **Tendencia** (`strategies/tendencia/`) | Precio > EMA200 + ADX > 25 + ruptura Donchian 55, trailing 4×ATR (estilo LuxAlgo / Alex Ruiz) | **−205 USD**, −0,016 USD/h, 72 trades, PF 0,71 | +438 USD, 0,017 USD/h, **DD 402 USD** | 1/28 variaciones positivas | 2/10 |
| **Reversión a la media** (`strategies/reversion/`) | M15: Bollinger(20, 3) + RSI < 25 / > 75 a favor de EMA200 H4, SL 2,5×ATR, TP en la media (estilo scalping Maderna/kmanuss, sin martingala) | **−152 USD**, −0,011 USD/h, 74 trades, PF 0,49 | −163 USD, DD 205 USD | 1/32 positivas | 4/10 |
| **Breakout** (`strategies/breakout/`) | Ruptura del rango asiático (00-08 UTC) con compresión < 0,35×ATR diario y volumen, SL 0,25×ATR, TP 2R, cierre a las 23:00 (estilo hobeecode/kmanuss) | **+1,81 USD**, 0,0001 USD/h, 62 trades, PF 1,01 | +176 USD, 0,0067 USD/h, DD 139 USD | 14/36 positivas | 4/10 |
| **Cartera de las 3** (`reports/cartera_combinada.json`) | Misma cuenta, 1:10 | −184 USD, −0,014 USD/h, DD 590 USD | +170 USD, DD 750 USD | — | La diversificación no ayuda: correlación ~0 pero cada pata pierde por su lado |

Lectura: lo que funcionó en 2023-24 (mercado alcista) dejó de funcionar en 2025-26 (BTC cayó de 126.000 a 80.000 USD). Eso es sobreajuste al régimen, no ventaja real.

---

## 3. Plan real con costes (si aun así quieres operar)

Lo describo porque lo pediste, pero con la expectativa correcta: es un plan para **aprender y no perder más de 300 USD**, no para ganar 720 USD/mes.

### Broker
- **Pepperstone, cuenta Razor en MT5** (detalle en `trading/BROKERS.md`). Grupo con regulación tier-1 (ASIC, FCA, CySEC); como residente argentino te darán de alta en la entidad SCB (Bahamas), con menos protección pero más apalancamiento. Alternativa: **Eightcap** (ASIC/FCA/CySEC/SCB, sin comisión en cripto).
- Evita brokers sin regulación tier-1 en el grupo (Bybit MT5 = Mauricio, BlackBull = Nueva Zelanda/Seychelles) aunque ofrezcan 1:100-1:500: ese apalancamiento con 1.000 USD es la forma más rápida de perderlos.

### Costes mensuales estimados (confianza 0,7)
| Concepto | USD/mes | Nota |
|---|---|---|
| Spread + comisión + slippage (≈ 5 trades/semana, 0,01-0,02 lotes) | 6 – 15 | Calculado con el motor: ~0,3-0,7 USD por trade |
| Swap por mantener largos (20 %/año sobre 0,02 lotes) | 0 – 27 | Solo si mantienes posiciones de noche; en corto Pepperstone acredita 7,5 %/año |
| VPS para que el EA corra 24/7 (MetaQuotes VPS u otro) | 10 – 20 | Estimado; puedes empezar con tu PC encendida |
| Depósito/retiro | 0 – 10 | Depende del método (tarjeta/transfer/cripto) |
| **Total** | **16 – 72 USD/mes** | **Entre el 50 % y el 200 % del beneficio realista (0-35 USD/mes)** |

Conclusión del plan de costes: con 1.000 USD, los costes fijos (VPS) ya se comen el beneficio esperado. El plan solo tiene sentido como aprendizaje o con un capital 10-20 veces mayor.

### Pasos
1. Abre cuenta **demo** en Pepperstone MT5. Compila los tres EA (`*.mq5`) en MetaEditor; corrige cualquier error de compilación (no pude compilar aquí).
2. Ejecuta el **Probador de estrategias** de MT5 con datos del propio broker (modelo "Cada tick basado en ticks reales", 2023-2026) y compara con las tablas de este informe. Si el resultado del broker es peor, manda el nuestro (el broker tiene spreads reales).
3. Si decides ir a real: usa **breakout** (única con DD < 150 USD y PF > 1 en el periodo completo), 0,01 lotes, `MaxEquityDD = 300`. Espera 0-10 USD/mes y acepta meses negativos.
4. **Regla dura**: si la equity cae 300 USD desde el máximo, el EA cierra todo y se para. No lo desactives, no subas el lote para "recuperar".
5. Reevalúa cada 3 meses con este mismo motor (`python3 trading/strategies/breakout/run.py` desde la raíz del repo, tras actualizar `trading/data/` con el script de la sección 5).

---

## 4. Sobre los canales de YouTube que citas

No pude verificar ningún track record auditado de Alex Ruiz, Matías Maderna, hobeecode, kmanuss ni LuxAlgo (no tengo acceso a sus cuentas ni a auditorías Myfxbook/FXBlue publicadas). Lo que sí hice fue implementar las **familias de estrategia** que enseñan (tendencia con trailing, scalping de reversión, breakout de rango) y someterlas a 3 años de datos con costes reales. El resultado está arriba. Si alguno de ellos publica un EA concreto con reglas exactas, puedo backtestearlo con este mismo motor.

---

## 5. Cómo reproducir todo

```bash
# desde la raíz del repo
pip install pandas numpy
python3 trading/strategies/tendencia/run.py
python3 trading/strategies/breakout/run.py
python3 trading/strategies/reversion/run.py
```
Cada uno escribe `results.json` y `results.md` en su carpeta. Los informes de cada agente están en `REPORT.md`.

Actualizar datos (requiere acceso a raw.githubusercontent.com):
```bash
curl -L -o hist.csv.gz https://raw.githubusercontent.com/ff137/bitstamp-btcusd-minute-data/main/data/historical/btcusd_bitstamp_1min_2012-2025.csv.gz
curl -L -o latest.csv https://raw.githubusercontent.com/ff137/bitstamp-btcusd-minute-data/main/data/updates/btcusd_bitstamp_1min_latest.csv
# luego agregar a H1/M15 con pandas resample como en el commit inicial
```

Instalar un EA en MT5: copiar el `.mq5` a `MQL5/Experts/`, abrir MetaEditor, compilar (F7), arrastrar el EA al gráfico BTCUSD H1 (tendencia/breakout) o M15 (reversión), activar "Algo Trading".

---

## 6. Limitaciones y honestidad
- Datos de **spot Bitstamp**, no del CFD del broker: los precios difieren ligeramente y el spread real del broker varía (10-40 USD, hasta 100-200 en volatilidad). El modelo "Conservador" (spread 30, slippage 10) cubre parte de eso.
- Costes de broker **no verificados en la web oficial** (bloqueada en esta sesión); tomados de comparativas de 2026. Verifica en la especificación del símbolo en tu MT5.
- EA **no compilados** (sin MetaEditor en Linux). Revisados a mano; espera pequeñas correcciones de sintaxis.
- El swap se aplica sobre el precio de entrada y 7 días/semana; los brokers lo aplican sobre el precio de cierre y algunos con triple swap un día. Diferencia < 5 % del coste de swap.
- Los backtests son honestos pero **no son garantía**: incluso 0,05 USD/h en backtest puede ser 0 o negativo en real.

**[Confianza: 0.85 | Revisado: Sí | Partes estimadas: costes exactos de cada broker y apalancamiento en entidades offshore (0,7); coste de VPS; todo lo demás (datos, backtests, cota teórica) está calculado y es reproducible]**

---

## 7. Anexo: ¿cambiar de activo (acción, ETF, otra cripto) resuelve el problema? No.

Simulación Monte Carlo con los movimientos diarios reales de BTC (`reports/limite_matematico.py`), sin costes, para un trader que acierta la dirección de cada día con probabilidad *p*:

| Acierto diario | Lotes | USD/h | Prob. de DD ≤ 300 | DD mediana |
|---|---|---|---|---|
| 55 % (trader bueno real) | 0,02 | 0,11 | 0 % | 769 USD |
| 55 % | 0,20 | 1,08 | 0 % | 7.432 USD |
| 70 % (excepcional) | 0,05 | 1,08 | 0 % | 818 USD |
| 90 % (no existe) | 0,02 | 0,86 | 96 % | 165 USD |

Lectura: para 1 USD/h con DD ≤ 300 USD hace falta acertar más del 90 % de los días. Los mejores traders sistemáticos documentados rondan el 52-58 %. El resultado **no depende del activo**: una acción menos volátil (una tecnológica se mueve 2-4 % al día, BTC 3,5 %) obliga a usar más lotes para el mismo objetivo y el drawdown crece en la misma proporción. Un ETF 3x o una memecoin solo aceleran ambas cosas.

### Lo que sí es factible (elige una de las tres variables)
| Mantengo | Cambio | Resultado realista |
|---|---|---|
| 1.000 USD y DD ≤ 300 | Objetivo → 5-35 USD/mes | Estrategia breakout de este repo en demo, luego 0,01 lotes en real |
| Objetivo 720 USD/mes y DD ≤ 30 % | Capital → 25.000-30.000 USD | Trader con 55 % de acierto, 0,2 lotes, DD esperado ~7.500 USD; años negativos posibles |
| 1.000 USD y objetivo 720 USD/mes | Salir del mercado: capital de trabajo en tu propio negocio | 1.000 USD en mercadería con 20-30 % de margen y 2-3 rotaciones al mes ≈ 400-900 USD/mes brutos (**estimado**, depende de tu margen real) |

La única vía de mercado para 720 USD/mes con 1.000 USD es una apuesta tipo lotería (opciones fuera del dinero, perpetuos a 50-100x): probabilidad de perder todo el capital superior al 90 % en el primer mes. No la recomiendo ni la voy a construir.
