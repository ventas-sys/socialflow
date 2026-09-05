"""
Corrida oficial de la estrategia breakout (rango asiático + compresión de volatilidad) en BTCUSD H1.
Produce results.json y results.md con:
  - IS / OOS / FULL x 3 modelos de coste x leverage 2 y 10 (max_dd_limit=300, stop_on_dd=True)
  - FULL con stop_on_dd=False (DD real) para los 3 costes x 2 leverages
  - Tabla de robustez ±20 % / ±40 % de cada parámetro clave sobre OOS (Pepperstone, leverage 2, stop_on_dd=False)
  - Variante B (segunda candidata IS: mayor beneficio IS con PF>=1.3 y DD<=300) como referencia.
Uso: python3 trading/strategies/breakout/run.py
"""
import sys, json, time
sys.path.insert(0, '/home/user/socialflow')
import numpy as np
import pandas as pd
from trading.engine.backtest import Backtester, CostModel, load_h1, split
from trading.strategies.breakout.strategy import build_signals, DEFAULT_PARAMS

HERE = '/home/user/socialflow/trading/strategies/breakout'
COSTS = {"pepperstone": CostModel.pepperstone_razor, "eightcap": CostModel.eightcap, "conservative": CostModel.conservative}
LEVS = [2, 10]
KEEP = ['net_profit', 'usd_per_hour', 'usd_per_day', 'max_dd_usd_intrabar', 'max_dd_usd_close', 'dd_limit_breached',
        'dd_breach_time', 'trades', 'win_rate_pct', 'profit_factor', 'avg_trade', 'sharpe_daily', 'total_costs',
        'cagr_pct', 'net_by_year', 'buy_and_hold_net']

# Variante B: elegida también SOLO con IS (fila de opt_grid.csv con mayor beneficio IS entre PF>=1.3 y DD<=300).
PARAMS_B = dict(DEFAULT_PARAMS, compress_k=0.7, sl_mult=1.0, tp_r=2.0, entry_end=16, exit_eod=False, vol_mult=0.0)

# Parámetros clave para el test de robustez y cómo se escalan (los enteros se redondean).
ROBUST_KEYS = ['compress_k', 'sl_mult', 'sl_floor_atr', 'tp_r', 'vol_mult', 'entry_end', 'risk_pct', 'atr_len', 'vol_len']
INT_KEYS = {'entry_end', 'atr_len', 'vol_len'}


def run_one(df, params, cost, lev, stop_on_dd=True):
    sig = build_signals(df, **params)
    r = Backtester(df, cost, capital=1000, leverage=lev, max_dd_limit=300, stop_on_dd=stop_on_dd).run_vectorized(sig)
    m = r.metrics()
    return {k: m[k] for k in KEEP}


def fmt(v):
    if isinstance(v, float):
        return f"{v:.4f}" if abs(v) < 1 else f"{v:.2f}"
    return str(v)


def table(rows, cols):
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        out.append("| " + " | ".join(fmt(r.get(c, '')) for c in cols) + " |")
    return "\n".join(out)


def main():
    t0 = time.time()
    df = load_h1()
    is_df, oos_df = split(df)
    periods = {"IS": is_df, "OOS": oos_df, "FULL": df}
    results = {"params": DEFAULT_PARAMS, "params_B": PARAMS_B, "timeframe": "H1",
               "data": dict(start=str(df.index[0]), end=str(df.index[-1]), bars=len(df),
                            is_end=str(is_df.index[-1]), oos_start=str(oos_df.index[0]))}

    # 1) corrida oficial IS/OOS/FULL x costes x leverage, stop_on_dd=True
    official = []
    for per, d in periods.items():
        for cname, cfn in COSTS.items():
            for lev in LEVS:
                m = run_one(d, DEFAULT_PARAMS, cfn(), lev, stop_on_dd=True)
                official.append(dict(period=per, cost=cname, leverage=lev, **m))
                print(f"{per:4s} {cname:12s} lev{lev:2d}: net {m['net_profit']:8.2f}  usd/h {m['usd_per_hour']:.4f}  "
                      f"DD {m['max_dd_usd_intrabar']:6.2f}  PF {m['profit_factor']}  trades {m['trades']}")
    results["official"] = official

    # 2) FULL sin stop_on_dd (DD real)
    nostop = []
    for cname, cfn in COSTS.items():
        for lev in LEVS:
            m = run_one(df, DEFAULT_PARAMS, cfn(), lev, stop_on_dd=False)
            nostop.append(dict(period="FULL", cost=cname, leverage=lev, **m))
            print(f"FULL nostop {cname:12s} lev{lev:2d}: net {m['net_profit']:8.2f}  DD {m['max_dd_usd_intrabar']:6.2f}")
    results["full_no_stop"] = nostop

    # 3) robustez ±20/±40 % sobre OOS, Pepperstone lev 2, stop_on_dd=False
    base = run_one(oos_df, DEFAULT_PARAMS, CostModel.pepperstone_razor(), 2, stop_on_dd=False)
    robust = [dict(param="(base)", factor=1.0, value=None, **base)]
    n_pos = 0; n_tot = 0
    for k in ROBUST_KEYS:
        for f in [0.6, 0.8, 1.2, 1.4]:
            v = DEFAULT_PARAMS[k] * f
            v = int(round(v)) if k in INT_KEYS else round(v, 4)
            if v == DEFAULT_PARAMS[k]:
                continue
            p = dict(DEFAULT_PARAMS); p[k] = v
            m = run_one(oos_df, p, CostModel.pepperstone_razor(), 2, stop_on_dd=False)
            robust.append(dict(param=k, factor=f, value=v, **m))
            n_tot += 1; n_pos += int(m['net_profit'] > 0)
            print(f"robust {k:13s} x{f:.1f} = {v}: net {m['net_profit']:8.2f} PF {m['profit_factor']} trades {m['trades']}")
    results["robustness"] = robust
    results["robustness_summary"] = dict(variations=n_tot, positive=n_pos, pct_positive=round(100 * n_pos / max(n_tot, 1), 1))

    # 4) variante B (referencia, elegida solo con IS)
    varB = []
    for per, d in periods.items():
        for lev in LEVS:
            m = run_one(d, PARAMS_B, CostModel.pepperstone_razor(), lev, stop_on_dd=True)
            varB.append(dict(period=per, cost="pepperstone", leverage=lev, stop_on_dd=True, **m))
        m = run_one(d, PARAMS_B, CostModel.pepperstone_razor(), 2, stop_on_dd=False)
        varB.append(dict(period=per, cost="pepperstone", leverage=2, stop_on_dd=False, **m))
    results["variant_B"] = varB

    # 5) puntos de la rúbrica (cálculo automático, el revisor la aplica)
    oos_pep2 = next(r for r in official if r['period'] == 'OOS' and r['cost'] == 'pepperstone' and r['leverage'] == 2)
    full_ns = next(r for r in nostop if r['cost'] == 'pepperstone' and r['leverage'] == 2)
    uh = oos_pep2['usd_per_hour']
    pts_uh = 3 if uh >= 1 else 2 if uh >= 0.25 else 1 if uh > 0 else 0
    dd = full_ns['max_dd_usd_intrabar']
    pts_dd = 2 if dd <= 250 else 1 if dd <= 300 else 0
    pts_rob = 2 if results["robustness_summary"]["pct_positive"] >= 70 else 0
    pf = oos_pep2['profit_factor']; pf = 99 if pf == 'inf' else float(pf)
    pts_pf = 1 if (pf >= 1.3 and oos_pep2['trades'] >= 60) else 0
    results["rubric_auto"] = dict(usd_per_hour_oos_pep_lev2=uh, pts_usd_hour=pts_uh, max_dd_full_nostop=dd, pts_dd=pts_dd,
                                  pts_robustness=pts_rob, pf_oos=pf, trades_oos=oos_pep2['trades'], pts_pf_trades=pts_pf,
                                  subtotal_sin_EA_ni_informe=pts_uh + pts_dd + pts_rob + pts_pf)
    results["runtime_sec"] = round(time.time() - t0, 1)

    json.dump(results, open(f'{HERE}/results.json', 'w'), indent=2, default=str, ensure_ascii=False)

    # results.md
    cols = ['period', 'cost', 'leverage', 'net_profit', 'usd_per_hour', 'max_dd_usd_intrabar', 'dd_limit_breached',
            'trades', 'win_rate_pct', 'profit_factor', 'avg_trade', 'total_costs', 'sharpe_daily']
    md = ["# Resultados breakout (rango asiático + compresión) BTCUSD H1", "",
          f"Datos: {results['data']['start']} → {results['data']['end']} ({results['data']['bars']} velas H1). "
          f"IS hasta {results['data']['is_end']}, OOS desde {results['data']['oos_start']}.", "",
          "Parámetros: `" + json.dumps(DEFAULT_PARAMS) + "`", "",
          "## Corrida oficial (max_dd_limit=300, stop_on_dd=True)", "", table(official, cols), "",
          "## FULL sin stop_on_dd (drawdown real)", "", table(nostop, cols), "",
          f"## Robustez ±20 % / ±40 % (OOS, Pepperstone, leverage 2, stop_on_dd=False) — "
          f"{n_pos}/{n_tot} variaciones con beneficio > 0 ({results['robustness_summary']['pct_positive']} %)", "",
          table(robust, ['param', 'factor', 'value', 'net_profit', 'usd_per_hour', 'max_dd_usd_intrabar', 'trades', 'profit_factor', 'win_rate_pct']), "",
          "## Variante B (referencia; elegida solo con IS: mayor beneficio IS con PF≥1.3 y DD≤300)", "",
          "Parámetros B: `" + json.dumps(PARAMS_B) + "`", "",
          table(varB, ['period', 'cost', 'leverage', 'stop_on_dd', 'net_profit', 'usd_per_hour', 'max_dd_usd_intrabar', 'dd_limit_breached', 'trades', 'profit_factor', 'win_rate_pct']), "",
          "## Rúbrica (cálculo automático)", "", "```", json.dumps(results["rubric_auto"], indent=2), "```", ""]
    open(f'{HERE}/results.md', 'w').write("\n".join(md))
    print(json.dumps(results["rubric_auto"], indent=2))
    print(f"OK en {results['runtime_sec']} s -> results.json / results.md")


if __name__ == '__main__':
    main()
