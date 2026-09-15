"""Barrido base: activos × estrategias × riesgo, reglas FTMO fase 1, plazo 7 días. Salida: grid_base.csv"""
import sys, time, itertools; sys.path.insert(0, '.')
import pandas as pd
from trading.fondeo.challenge_sim import *
rows = []
for sym in ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD']:
    bars = load(sym); t = time.time()
    strats = {'breakout_2R': strat_breakout(bars), 'breakout_1R': strat_breakout(bars, rr=1.0), 'momentum_2R': strat_daily_bet(bars, 'momentum'),
              'meanrev_2R': strat_daily_bet(bars, 'meanrev'), 'coin_2R': strat_daily_bet(bars, 'coin', seed=1), 'coin_1R': strat_daily_bet(bars, 'coin', seed=2, rr=1.0),
              'ema_trend_h1': strat_ema_trend(bars), 'ema_trend_h4': strat_ema_trend(bars, tf='4h')}
    for (name, sig), risk in itertools.product(strats.items(), [1.0, 2.0, 3.0, 4.0]):
        r = evaluate(bars, sig, SPECS[sym], RULES['ftmo_p1'], risk_pct=risk, starts='weekdays')
        r.pop('attempts'); r.update(symbol=sym, strategy=name, risk=risk); rows.append(r)
        print(sym, name, risk, r['n'], 'pass', r['pass_pct'], 'fail', r['fail_daily_pct'] + r['fail_max_pct'], 'timeout', r['timeout_pct'], flush=True)
    print(sym, 'done in', round(time.time() - t), 's', flush=True)
pd.DataFrame(rows).to_csv('trading/fondeo/grid_base.csv', index=False)
