# Brief para los agentes: pasar un challenge de fondeo en una semana

## Objetivo
Encontrar, con datos reales, la combinación **activo + estrategia + tamaño de riesgo + firma** que maximice la
probabilidad de pasar un challenge de fondeo de 100.000 USD **en 7 días naturales**, sin quemar la cuenta, y con valor
esperado positivo frente al precio del challenge. Nada de curvas bonitas: lo que se entrega es una probabilidad
medida sobre cientos de semanas históricas, separando muestra de optimización y muestra de validación.

## Herramienta: `trading/fondeo/challenge_sim.py` (ejecutar siempre desde la raíz del repo)
```python
import sys; sys.path.insert(0, '.')
from trading.fondeo.challenge_sim import *
bars = load('XAUUSD')                      # M15: XAUUSD, EURUSD, GBPUSD, USDJPY (2012-2022, hora servidor GMT+2/3: el día va de 01:00 a 23:45,
                                           # Londres abre ~10:00, NY ~15:30) o BTCUSD (2023-09 → 2026-09, UTC, 24/7)
sig = strat_breakout(bars, range_start=1, range_end=9, expire_hour=17, exit_hour=22, sl_frac=1.0, rr=2.0)
res = evaluate(bars, sig, SPECS['XAUUSD'], RULES['ftmo_1step'], risk_pct=2.0, starts='weekdays', max_starts=600,
               max_trades_day=1, day_stop_pct=None, risk_on_balance=False)
print({k: v for k, v in res.items() if k != 'attempts'})   # pass_pct, pass_inconsistent_pct, fail_daily_pct, fail_max_pct, timeout_pct, ...
res['attempts']                                            # DataFrame con cada intento (fecha de inicio, resultado, días, balance final, DD...)
```
- `evaluate(..., starts='weekdays')` lanza un intento por cada día hábil de inicio (≈2.500 en FX/oro, ≈780 en BTC); tarda ~2,5 s.
  Para explorar usá `max_starts=500`; para el resultado final usá todos.
- Estrategias disponibles: `strat_daily_bet` (una operación al día: momentum / meanrev / coin / long / short, SL por ATR, TP por R:R),
  `strat_breakout` (ruptura del rango de sesión con OCO), `strat_ema_trend` (cruce de EMAs con trailing ATR). Podés escribir
  estrategias nuevas: devolvé un DataFrame con las columnas `dir, stop_px, sl, tp, exit_hour, trail, atr` (ver `_empty` y los ejemplos).
  `dir=2` significa OCO (buy stop en `stop_px`, sell stop en `stop_px - width`).
- Reglas de firmas en `RULES` (ver FIRMAS.md para fuentes): `ftmo_1step` (10 % objetivo, 3 % diario, 10 % trailing, 0 días mín.,
  regla Best Day 50 %), `fundingpips_1step` (10/3/6, 0 días), `fundednext_1step` (10/3/6, 5 días, consistencia 40 %, 1:30),
  `the5ers_hyper` (10/3/6, 3 días), `e8_one_8` (12 % objetivo, DD 8 % trailing, sin límite diario, 0 días), `e8_one_14` (21 %/14 %),
  `blueguardian_1step` (9/3/6 trailing, 3 días), `ftmo_p1` + `ftmo_p2` (2 fases 10 % y 5 %, 5 % diario, 10 % estático, 4 días por fase),
  `twostep_8_5_10_p1/p2` (FundedNext Stellar). `max_days=7` por defecto; podés copiar una regla con `replace(RULES['x'], max_days=30)`.
- Resultados: `pass` = objetivo alcanzado dentro del plazo cumpliendo días mínimos y consistencia; `pass_inconsistent` = objetivo
  alcanzado pero la regla de consistencia bloquea (cuenta como NO pasado); `fail_daily`/`fail_max` = cuenta quemada; `timeout` = ni
  una cosa ni otra en el plazo (se puede seguir intentando en firmas sin límite de tiempo, pero ya no es "una semana").
- Costes ya incluidos: spread, comisión, deslizamiento (valores estimados en `SPECS`, no los cambies a mejor). El sizing respeta
  el apalancamiento de cada programa. Si SL y TP caen en la misma vela se asume SL (conservador).

## Disciplina obligatoria
1. **Muestra de optimización (IS)**: FX/oro hasta 2018-12-31; BTC hasta 2025-03-01. **Validación (OOS)**: FX/oro 2019-01-01 → 2022-03-04;
   BTC 2025-03-01 → 2026-09. Elegí parámetros SOLO con IS. Reportá IS y OOS por separado. Si OOS es mucho peor que IS, decilo.
   Para recortar: `bars_is = bars[:'2018-12-31']`, `bars_oos = bars['2019-01-01':]` (recalculá las señales sobre cada tramo o sobre todo y filtrá los intentos por fecha de inicio con `res['attempts']`).
2. **Línea base obligatoria**: la misma configuración de riesgo con dirección al azar (`strat_daily_bet(bars, 'coin', seed=s)`, promediando ≥5 semillas).
   Si tu estrategia no supera claramente a la moneda al aire en OOS, no tiene edge: decilo.
3. **Riesgo vs. límite diario**: con límite diario del 3 %, una operación con riesgo 3 % + costes ya quema la cuenta. Explorá riesgo por operación,
   operaciones por día (`max_trades_day`), parada diaria autoimpuesta (`day_stop_pct`) y `risk_on_balance`.
4. **Fase fondeada**: para estimar el valor de pasar, medí también con la misma estrategia `P(+5 % en 30 días sin quemar)` con
   `replace(RULES['x'], target=0.05, max_days=30, min_trading_days=0)`. Valor esperado por intento ≈ P(pasar) × P(primer payout) × 5.000 × split − fee.
5. Nada de mirar el futuro: las señales se calculan con información hasta la vela anterior; no toques `run_attempt`. Si necesitás cambiar el
   simulador, copialo a tu carpeta y documentá el cambio.
6. Runtime: cada `evaluate` completo tarda ~2,5 s. Un barrido de 200 combinaciones × 2 tramos = ~15 min. No hagas barridos de miles.

## Entregables (en tu carpeta `trading/fondeo/enfoques/<letra>_<nombre>/`)
- `run.py` reproducible (desde la raíz del repo: `python3 trading/fondeo/enfoques/<carpeta>/run.py`).
- `grid.csv` con todas las combinaciones probadas (IS y OOS) y `results.json` con la configuración elegida.
- `REPORT.md` en español con: (1) la idea en 5 líneas; (2) tabla IS/OOS de la configuración final por firma (`pass_pct`, `pass_inconsistent_pct`,
  `fail_daily+fail_max`, `timeout`, días medianos hasta pasar); (3) la línea base "moneda al aire" con el mismo riesgo; (4) P(primer payout);
  (5) valor esperado por intento con el `fee_usd` de cada firma; (6) qué firma y qué tamaño de riesgo recomendarías y por qué;
  (7) **puntuación honesta 0-10**: 4 puntos si P(pasar en 7 días) OOS ≥ 50 % (2 si ≥ 30 %, 0 si menos), 2 si P(quemar) OOS ≤ P(pasar),
  2 si IS y OOS son coherentes (diferencia < 10 puntos), 2 si el valor esperado por intento es positivo con el fee real.
- Al terminar, respondé con un resumen de 10-15 líneas: configuración final, números OOS, puntuación y la mayor debilidad.
