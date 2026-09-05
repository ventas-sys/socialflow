"""
Optimización SOLO in-sample (antes de 2025-03-01) de la estrategia de reversión, M15.
Rejilla pequeña (144 combos). Criterio: trades >= 60, DD intrabar <= 300, ordenado por profit factor (no por beneficio).
Coste Pepperstone, leverage 2, stop_on_dd=False (para ver el DD real). Guarda grid_is.csv y grid_is_top.md.
"""
import sys, itertools, json, time
sys.path.insert(0, '/home/user/socialflow')
from multiprocessing import Pool
import pandas as pd
from trading.engine.backtest import Backtester, CostModel, load_m15, split
from trading.strategies.reversion.strategy import build_signals
from trading.strategies.reversion.mdtable import md_table

HERE = '/home/user/socialflow/trading/strategies/reversion'
GRID = dict(bb_dev=[2.0, 2.5, 3.0], rsi_low=[20, 25, 30], atr_mult=[1.5, 2.5], max_bars=[8, 32],
            confirm=[0, 1], session_filter=[0, 1])
FIXED = dict(trend_filter=1, bb_period=20, rsi_period=14, atr_period=14, hour_start=7, hour_end=21, risk_pct=1.5)

_IS = None
def _init():
    global _IS
    _IS, _ = split(load_m15())

def _one(combo):
    params = dict(FIXED); params.update(combo)
    sig = build_signals(_IS, **params)
    m = Backtester(_IS, CostModel.pepperstone_razor(), leverage=2, stop_on_dd=False).run_vectorized(sig).metrics()
    row = dict(combo)
    row.update(net=m['net_profit'], usd_h=m['usd_per_hour'], dd=m['max_dd_usd_intrabar'], pf=m['profit_factor'],
               trades=m['trades'], wr=m['win_rate_pct'], avg=m['avg_trade'], sharpe=m['sharpe_daily'])
    return row

if __name__ == '__main__':
    keys = list(GRID)
    combos = [dict(zip(keys, v)) for v in itertools.product(*GRID.values())]
    print(f"{len(combos)} combinaciones IS (M15)")
    t = time.time()
    with Pool(4, initializer=_init) as pool:
        rows = pool.map(_one, combos)
    print(f"hecho en {time.time()-t:.0f}s")
    g = pd.DataFrame(rows)
    g['pf_num'] = pd.to_numeric(g['pf'], errors='coerce').fillna(99)
    g.to_csv(f'{HERE}/grid_is.csv', index=False)
    ok = g[(g.trades >= 60) & (g.dd <= 300)].sort_values(['pf_num', 'net'], ascending=False)
    print("Cumplen trades>=60 y DD<=300:", len(ok), "/", len(g), "| con PF>1:", int((ok.pf_num > 1).sum()))
    cols = keys + ['net', 'usd_h', 'dd', 'pf', 'trades', 'wr', 'avg']
    print(ok[cols].head(15).to_string(index=False))
    print("\nTop por beneficio (referencia, no criterio):")
    print(g.sort_values('net', ascending=False)[cols].head(5).to_string(index=False))
    with open(f'{HERE}/grid_is_top.md', 'w') as f:
        f.write("# Rejilla IS (M15, Pepperstone, lev 2, sin stop DD)\n\n")
        f.write(f"{len(combos)} combos. Filtro trades>=60 y DD<=300: {len(ok)} combos; con PF>1: {int((ok.pf_num>1).sum())}.\n\n")
        f.write("## Top 15 por profit factor (cumpliendo filtro)\n\n" + md_table(ok[cols].head(15)) + "\n\n")
        f.write("## Top 5 por beneficio neto (sólo referencia)\n\n" + md_table(g.sort_values("net", ascending=False)[cols].head(5)) + "\n")
