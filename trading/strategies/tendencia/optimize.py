"""
Optimización SOLO in-sample (antes de 2025-03-01) con rejilla pequeña.
Criterio de selección: entre las combinaciones con max DD intravela <= 250 USD y >= 40 trades en IS,
se ordena por profit factor (no por beneficio). Guarda grid_is.csv y best_params.json.
Coste usado en la optimización: Pepperstone Razor, leverage 2 (el caso de la rúbrica).
"""
import sys, json, itertools, time
sys.path.insert(0, '/home/user/socialflow')
import pandas as pd
from trading.engine.backtest import Backtester, CostModel, load_h1, split
from trading.strategies.tendencia.strategy import build_signals, DEFAULT_PARAMS

HERE = '/home/user/socialflow/trading/strategies/tendencia'

GRID = dict(
    ema_len=[100, 200],
    dc_len=[20, 55],
    sl_mult=[2.0, 3.0],
    trail_mult=[2.0, 3.0, 4.0],
    adx_min=[0.0, 20.0, 25.0],
    allow_short=[0, 1],
)


def run_is(df_is, params):
    sig = build_signals(df_is, **params)
    r = Backtester(df_is, CostModel.pepperstone_razor(), capital=1000, leverage=2,
                   max_dd_limit=300, stop_on_dd=True).run_vectorized(sig)
    m = r.metrics()
    return dict(net=m['net_profit'], usd_h=m['usd_per_hour'], dd=m['max_dd_usd_intrabar'], trades=m['trades'],
                pf=(999.0 if m['profit_factor'] == 'inf' else m['profit_factor']), wr=m['win_rate_pct'],
                breached=m['dd_limit_breached'])


def main():
    df = load_h1()
    df_is, _ = split(df)
    keys = list(GRID)
    rows = []
    t0 = time.time()
    combos = list(itertools.product(*[GRID[k] for k in keys]))
    print(f'{len(combos)} combinaciones IS ({df_is.index[0].date()} -> {df_is.index[-1].date()})')
    for i, vals in enumerate(combos):
        p = dict(zip(keys, vals))
        res = run_is(df_is, p)
        rows.append({**p, **res})
        if (i + 1) % 24 == 0:
            print(f'  {i+1}/{len(combos)}  {time.time()-t0:.0f}s')
    g = pd.DataFrame(rows)
    g.to_csv(f'{HERE}/grid_is.csv', index=False)

    ok = g[(g.dd <= 250) & (g.trades >= 40) & (g.net > 0)].sort_values(['pf', 'dd'], ascending=[False, True])
    print('\nTop 10 IS por profit factor (DD<=250, trades>=40):')
    print(ok.head(10).to_string(index=False))
    best = ok.iloc[0]
    params = {k: (int(best[k]) if k in ('ema_len', 'dc_len', 'allow_short') else float(best[k])) for k in keys}

    # riesgo por trade: se elige después, con la rejilla fija, el mayor riesgo que mantenga DD IS <= 250
    print('\nBarrido risk_pct con los mejores parámetros:')
    chosen_risk = None
    for rp in [1.0, 1.5, 2.0, 2.5, 3.0]:
        res = run_is(df_is, {**params, 'risk_pct': rp})
        print(f'  risk_pct={rp}: {res}')
        if res['dd'] <= 250 and not res['breached']:
            chosen_risk = rp
    params['risk_pct'] = chosen_risk or 1.0
    out = {**DEFAULT_PARAMS, **params}
    json.dump(out, open(f'{HERE}/best_params.json', 'w'), indent=2)
    print('\nParámetros elegidos:', out)


if __name__ == '__main__':
    main()
