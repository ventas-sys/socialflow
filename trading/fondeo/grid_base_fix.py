"""Recalcula solo las filas de ruptura (breakout) de grid_base.csv tras corregir el filtro ATR y el relleno de stops."""
import sys, itertools; sys.path.insert(0, '.')
import pandas as pd
from trading.fondeo.challenge_sim import *
g = pd.read_csv('trading/fondeo/grid_base.csv'); g = g[~g.strategy.str.startswith('breakout')]
rows = []
for sym in ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD']:
    bars = load(sym)
    for (name, sig), risk in itertools.product({'breakout_2R': strat_breakout(bars), 'breakout_1R': strat_breakout(bars, rr=1.0)}.items(), [1.0, 2.0, 3.0, 4.0]):
        r = evaluate(bars, sig, SPECS[sym], RULES['ftmo_p1'], risk_pct=risk, starts='weekdays'); r.pop('attempts'); r.update(symbol=sym, strategy=name, risk=risk); rows.append(r)
        print(sym, name, risk, 'pass', r['pass_pct'], 'fail', r['fail_daily_pct'] + r['fail_max_pct'], flush=True)
pd.concat([g, pd.DataFrame(rows)]).to_csv('trading/fondeo/grid_base.csv', index=False)
