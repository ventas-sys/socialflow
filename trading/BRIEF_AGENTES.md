# Brief para agentes de estrategia (BTCUSD CFD en MT4/MT5)

## Objetivo del cliente (literal)
- Capital: 1.000 USD. Meta: +1 USD por hora (= 24 USD/día ≈ 720 USD/mes ≈ 72 % mensual).
- Pérdida flotante máxima permitida: 300 USD (drawdown de EQUITY, no de balance).
- Backtest: últimos 3 años (2023-09-01 → 2026-09-05), datos reales Bitstamp BTC/USD.
- Debe ser implementable en MT4/MT5 (entregar EA en MQL5).

## Reglas obligatorias (NO negociables)
1. NO modificar `trading/engine/backtest.py`. Si crees que tiene un bug, escríbelo en tu REPORT.md y sigue.
2. Optimiza parámetros SOLO con in-sample (antes de 2025-03-01, usa `split(df)`). Reporta out-of-sample por separado. Reporta también el periodo completo.
3. Reporta SIEMPRE con los 3 modelos de coste (`CostModel.pepperstone_razor()`, `CostModel.eightcap()`, `CostModel.conservative()`) y con leverage=2 (retail ASIC/FCA/CySEC) y leverage=10 (entidad offshore/pro).
4. Sin look-ahead: la señal de la vela t se ejecuta en la apertura de t+1 (el motor ya lo hace, no uses `shift(-1)` ni datos futuros en indicadores).
5. Nada de martingala ni grid sin stop: `max_dd_limit=300` y `stop_on_dd=True` en la corrida oficial. Puedes añadir una corrida con `stop_on_dd=False` para ver el DD real.
6. Test de robustez: varía cada parámetro clave ±20 % y ±40 % y reporta si el resultado se mantiene (tabla).
7. Honestidad total: si no llegas a 1 USD/hora, dilo con números. NUNCA inventes ni ajustes resultados. Un informe honesto con 0,05 USD/hora vale más que uno falso.

## Entregables (todo dentro de `trading/strategies/<tu_nombre>/`)
- `strategy.py` con `build_signals(df: pd.DataFrame, **params) -> pd.DataFrame` (columnas `pos`, `lots`, `sl`, `tp`, alineadas con df) y un dict `DEFAULT_PARAMS`.
- `run.py`: ejecuta IS/OOS/FULL × 3 costes × 2 leverages y guarda `results.json` y `results.md` (tabla).
- `<nombre>.mq5`: Expert Advisor MQL5 con la misma lógica exacta (mismos indicadores estándar de MT5: iMA, iATR, iRSI, iBands, etc.), inputs = parámetros, gestión de riesgo (lotes por riesgo, SL/TP), filtro de spread máximo, y que cierre por drawdown de equity > 300 USD. Debe compilar sin librerías externas. Comenta el código en español.
- `REPORT.md`: lógica en 5 líneas, tabla de resultados, robustez, puntuación honesta 0-10 según rúbrica, y qué haría falta para mejorar.

## Rúbrica de puntuación (la aplico yo como revisor)
- 3 pts: USD/hora OOS con coste Pepperstone y leverage 2 (3 = ≥1.0; 2 = ≥0.25; 1 = >0; 0 = ≤0).
- 2 pts: max DD equity ≤ 300 USD en FULL sin `stop_on_dd` (2 = sí con margen; 1 = roza; 0 = supera).
- 2 pts: robustez (resultado OOS positivo en ≥70 % de las variaciones ±20/40 %).
- 1 pt: profit factor OOS ≥ 1.3 y ≥ 60 trades OOS.
- 1 pt: EA MQL5 fiel a la lógica y con protección de DD.
- 1 pt: informe claro y honesto.

## Cómo correr
```
cd /home/user/socialflow
python3 trading/strategies/<nombre>/run.py
```
`sys.path.insert(0, '/home/user/socialflow')` y `from trading.engine.backtest import Backtester, CostModel, load_h1, load_m15, split`.
Datos: `load_h1()` (26.402 velas) o `load_m15()`. Índice UTC. 1 lote = 1 BTC, lote mínimo 0,01.
Referencia: buy & hold 3 años = +2.060 USD (0,078 USD/hora) pero con DD muy superior a 300 USD.
