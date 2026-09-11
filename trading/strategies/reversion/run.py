"""
Corrida oficial de la estrategia de reversión a la media (M15).
Produce results.json y results.md: IS / OOS / FULL x 3 costes x leverage 2 y 10 (stop_on_dd=True, límite 300),
FULL sin stop_on_dd, tabla de robustez ±20 %/±40 % sobre OOS (Pepperstone, lev 2) y análisis de coste por trade.
Uso: python3 trading/strategies/reversion/run.py
"""
import sys, json, time
sys.path.insert(0, '/home/user/socialflow')
import numpy as np, pandas as pd
from trading.engine.backtest import Backtester, CostModel, load_m15, split
from trading.strategies.reversion.strategy import build_signals, DEFAULT_PARAMS, bollinger, atr_sma
from trading.strategies.reversion.mdtable import md_table

HERE = '/home/user/socialflow/trading/strategies/reversion'
COSTS = {"pepperstone": CostModel.pepperstone_razor(), "eightcap": CostModel.eightcap(), "conservative": CostModel.conservative()}
LEVS = [2, 10]
KEYS = ['net_profit', 'usd_per_hour', 'max_dd_usd_intrabar', 'max_dd_usd_close', 'dd_limit_breached', 'dd_breach_time',
        'trades', 'win_rate_pct', 'profit_factor', 'avg_trade', 'sharpe_daily', 'total_costs', 'net_by_year', 'final_equity']


def run(df, cost, lev, params, stop_on_dd=True):
    sig = build_signals(df, **params)
    r = Backtester(df, cost, capital=1000.0, leverage=lev, max_dd_limit=300.0, stop_on_dd=stop_on_dd).run_vectorized(sig)
    m = r.metrics()
    out = {k: m[k] for k in KEYS}
    out['exit_reasons'] = {k: int(v) for k, v in pd.Series([t.reason for t in r.trades]).value_counts().items()} if r.trades else {}
    out['avg_lots'] = round(float(np.mean([t.lots for t in r.trades])), 4) if r.trades else 0.0
    return out


def main():
    t0 = time.time()
    df = load_m15()
    is_, oos = split(df)
    periods = {"IS": is_, "OOS": oos, "FULL": df}
    params = dict(DEFAULT_PARAMS)
    res = dict(strategy="reversion (Bollinger+RSI, SL ATR, TP banda media, filtro EMA200 H4)", timeframe="M15",
               params=params, data=dict(bars=len(df), start=str(df.index[0]), end=str(df.index[-1]),
                                        is_end="2025-03-01", is_bars=len(is_), oos_bars=len(oos)),
               official={}, full_no_dd_stop={}, robustness={}, cost_analysis={})

    # ---- corrida oficial: IS/OOS/FULL x 3 costes x 2 leverages, stop_on_dd=True
    for per, d in periods.items():
        for cn, cm in COSTS.items():
            for lev in LEVS:
                res['official'][f"{per}|{cn}|lev{lev}"] = run(d, cm, lev, params, stop_on_dd=True)
    # ---- FULL sin stop de DD (DD real)
    for cn, cm in COSTS.items():
        for lev in LEVS:
            res['full_no_dd_stop'][f"FULL|{cn}|lev{lev}"] = run(df, cm, lev, params, stop_on_dd=False)
    # ---- sin costes (¿hay ventaja bruta?)
    zero = CostModel("sin costes", 0, 0, 0, 0, slippage_usd=0)
    res['full_no_dd_stop']["FULL|zero_cost|lev2"] = run(df, zero, 2, params, stop_on_dd=False)
    for per, d in periods.items():
        res['official'][f"{per}|zero_cost|lev2"] = run(d, zero, 2, params, stop_on_dd=False)

    # ---- robustez ±20/40 % de cada parámetro clave, OOS, Pepperstone lev 2, stop_on_dd=False (para no truncar)
    key_params = ['bb_period', 'bb_dev', 'rsi_low', 'atr_mult', 'max_bars', 'ema_period', 'rsi_period', 'atr_period']
    rob_rows = []
    base = run(oos, COSTS['pepperstone'], 2, params, stop_on_dd=False)
    rob_rows.append(dict(param='(base)', factor=1.0, value=None, net=base['net_profit'], usd_h=base['usd_per_hour'],
                         dd=base['max_dd_usd_intrabar'], pf=base['profit_factor'], trades=base['trades'], positive=base['net_profit'] > 0))
    for kp in key_params:
        for f in [0.6, 0.8, 1.2, 1.4]:
            v = params[kp] * f
            if isinstance(params[kp], int): v = max(2, int(round(v)))
            else: v = round(v, 3)
            p2 = dict(params); p2[kp] = v
            m = run(oos, COSTS['pepperstone'], 2, p2, stop_on_dd=False)
            rob_rows.append(dict(param=kp, factor=f, value=v, net=m['net_profit'], usd_h=m['usd_per_hour'],
                                 dd=m['max_dd_usd_intrabar'], pf=m['profit_factor'], trades=m['trades'], positive=m['net_profit'] > 0))
    var_rows = [r for r in rob_rows if r['param'] != '(base)']
    n_pos = sum(r['positive'] for r in var_rows)
    res['robustness'] = dict(rows=rob_rows, n_variations=len(var_rows), n_positive=n_pos,
                             pct_positive=round(100 * n_pos / len(var_rows), 1))

    # ---- coste por trade vs movimiento esperado (FULL): distancia cierre->banda media en las velas de señal
    sig = build_signals(df, **params)
    mid, up, lo = bollinger(df.close, params['bb_period'], params['bb_dev'])
    atr = atr_sma(df, params['atr_period'])
    entries = sig.index[~sig.lots.isna()]
    dist_mid = (df.close.loc[entries] - mid.loc[entries]).abs()
    sl_dist = atr.loc[entries] * params['atr_mult']
    ca = {}
    for cn, cm in COSTS.items():
        rt = cm.spread_usd + 2 * cm.slippage_usd + cm.commission_per_lot_rt   # USD por BTC ida y vuelta (sin swap)
        ca[cn] = dict(cost_rt_usd_per_btc=rt, avg_target_move_usd=round(float(dist_mid.mean()), 1),
                      median_target_move_usd=round(float(dist_mid.median()), 1),
                      cost_pct_of_target=round(100 * rt / float(dist_mid.mean()), 2),
                      avg_sl_dist_usd=round(float(sl_dist.mean()), 1), cost_pct_of_sl=round(100 * rt / float(sl_dist.mean()), 2))
    res['cost_analysis'] = dict(n_signals_full=int(len(entries)), per_cost=ca,
                                avg_price=round(float(df.close.loc[entries].mean()), 0))
    res['runtime_sec'] = round(time.time() - t0, 1)

    with open(f'{HERE}/results.json', 'w') as f:
        json.dump(res, f, indent=2, ensure_ascii=False, default=str)
    write_md(res)
    print(f"OK results.json + results.md en {res['runtime_sec']}s")
    o = res['official']['OOS|pepperstone|lev2']; fnd = res['full_no_dd_stop']['FULL|pepperstone|lev2']
    print(f"OOS pepperstone lev2: {o['usd_per_hour']} USD/h, PF {o['profit_factor']}, trades {o['trades']} | "
          f"FULL sin stop DD max: {fnd['max_dd_usd_intrabar']} | robustez positiva {res['robustness']['pct_positive']}%")


def write_md(res):
    L = [f"# Resultados – estrategia `reversion` (M15)\n", f"Parámetros: `{json.dumps(res['params'])}`\n",
         f"Datos: {res['data']['bars']} velas M15, {res['data']['start']} → {res['data']['end']}; IS hasta {res['data']['is_end']} "
         f"({res['data']['is_bars']} velas), OOS {res['data']['oos_bars']} velas.\n"]

    def rows_of(d):
        rr = []
        for k, m in d.items():
            per, cn, lev = k.split('|')
            rr.append(dict(periodo=per, coste=cn, lev=lev, net=m['net_profit'], usd_h=m['usd_per_hour'],
                           dd_intrabar=m['max_dd_usd_intrabar'], dd_cierre=m['max_dd_usd_close'],
                           dd300=('SÍ' if m['dd_limit_breached'] else 'no'), trades=m['trades'], wr=m['win_rate_pct'],
                           pf=m['profit_factor'], avg=m['avg_trade'], costes=m['total_costs']))
        return rr
    L.append("## Corrida oficial (stop_on_dd=True, límite 300 USD equity)\n")
    L.append(md_table(rows_of(res['official']), floatfmt=".4g") + "\n")
    L.append("## FULL sin stop_on_dd (drawdown real)\n")
    L.append(md_table(rows_of(res['full_no_dd_stop']), floatfmt=".4g") + "\n")
    L.append("## Beneficio por año (FULL sin stop, Pepperstone lev 2)\n")
    L.append("`" + json.dumps(res['full_no_dd_stop']['FULL|pepperstone|lev2']['net_by_year']) + "`\n")
    L.append("## Motivos de salida (FULL sin stop, Pepperstone lev 2)\n")
    L.append("`" + json.dumps(res['full_no_dd_stop']['FULL|pepperstone|lev2']['exit_reasons']) + "`\n")
    rb = res['robustness']
    L.append(f"## Robustez OOS (Pepperstone, lev 2, sin stop DD): {rb['n_positive']}/{rb['n_variations']} variaciones positivas ({rb['pct_positive']} %)\n")
    L.append(md_table(rb['rows'], ['param', 'factor', 'value', 'net', 'usd_h', 'dd', 'pf', 'trades', 'positive'], floatfmt=".4g") + "\n")
    ca = res['cost_analysis']
    L.append(f"## Coste por trade vs movimiento objetivo ({ca['n_signals_full']} señales FULL, precio medio {ca['avg_price']} USD)\n")
    rr = [dict(coste=k, **v) for k, v in ca['per_cost'].items()]
    L.append(md_table(rr) + "\n")
    with open(f'{HERE}/results.md', 'w') as f:
        f.write("\n".join(L))


if __name__ == '__main__':
    main()
