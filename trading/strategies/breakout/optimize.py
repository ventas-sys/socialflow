"""
Optimización SOLO in-sample (2023-09-01 .. 2025-02-28) con rejilla pequeña (192 combinaciones).
Criterio de selección: NO el beneficio neto, sino una puntuación que combina profit factor y drawdown:
    score = PF * min(1, 300 / max_dd_intrabar) * min(1, trades / 60)
con la condición de beneficio neto > 0. Coste Pepperstone, leverage 2, stop_on_dd=False (para ver el DD real).
Guarda opt_grid.csv y opt_best.json. Los parámetros elegidos se copian a mano a DEFAULT_PARAMS en strategy.py.
"""
import sys, itertools, json, time
sys.path.insert(0, '/home/user/socialflow')
import pandas as pd
from trading.engine.backtest import Backtester, CostModel, load_h1, split
from trading.strategies.breakout.strategy import build_signals, DEFAULT_PARAMS

HERE = '/home/user/socialflow/trading/strategies/breakout'

GRID = dict(
    compress_k=[0.35, 0.5, 0.7, 9.0],   # 9.0 = sin filtro de compresión
    sl_mult=[0.5, 1.0],
    tp_r=[1.5, 2.0, 3.0],
    entry_end=[13, 16],
    exit_eod=[True, False],
    vol_mult=[0.0, 1.2],
)


def evaluate(df, params, cost=None, leverage=2, stop_on_dd=False):
    cost = cost or CostModel.pepperstone_razor()
    sig = build_signals(df, **params)
    r = Backtester(df, cost, capital=1000, leverage=leverage, stop_on_dd=stop_on_dd).run_vectorized(sig)
    return r.metrics()


def score(m):
    pf = m['profit_factor']
    pf = 5.0 if pf == 'inf' else float(pf)
    if m['net_profit'] <= 0 or m['trades'] < 30:
        return 0.0
    return pf * min(1.0, 300.0 / max(m['max_dd_usd_intrabar'], 1e-9)) * min(1.0, m['trades'] / 60.0)


def main():
    df = load_h1()
    is_df, _ = split(df)
    keys = list(GRID)
    rows = []
    t0 = time.time()
    combos = list(itertools.product(*[GRID[k] for k in keys]))
    print(f"{len(combos)} combinaciones IS ...")
    for vals in combos:
        params = dict(zip(keys, vals))
        m = evaluate(is_df, params)
        rows.append(dict(**params, net=m['net_profit'], usd_h=m['usd_per_hour'], pf=m['profit_factor'],
                         dd=m['max_dd_usd_intrabar'], trades=m['trades'], wr=m['win_rate_pct'], score=round(score(m), 4)))
    res = pd.DataFrame(rows).sort_values('score', ascending=False)
    res.to_csv(f'{HERE}/opt_grid.csv', index=False)
    print(res.head(20).to_string())
    print(f"tiempo {time.time()-t0:.0f}s")
    best = res.iloc[0]
    best_params = {k: (bool(best[k]) if k == 'exit_eod' else (int(best[k]) if k == 'entry_end' else float(best[k]))) for k in keys}
    json.dump(dict(best_params=best_params, best_row=best.to_dict(), grid=GRID, n_combos=len(combos)),
              open(f'{HERE}/opt_best.json', 'w'), indent=2, default=str)
    print("mejor:", best_params)


if __name__ == '__main__':
    main()
