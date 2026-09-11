"""
Corrida oficial de la estrategia "tendencia".
  - IS / OOS / FULL x 3 modelos de coste x leverage 2 y 10 (max_dd_limit=300, stop_on_dd=True)
  - FULL con stop_on_dd=False (DD real) para los 3 costes y ambos leverages
  - Robustez: +-20 % / +-40 % de cada parámetro clave, evaluado en OOS (Pepperstone, lev 2)
  - Resumen OOS de toda la rejilla IS (para saber si la familia entera funciona fuera de muestra)
Guarda results.json y results.md en esta carpeta.
Uso:  cd /home/user/socialflow && python3 trading/strategies/tendencia/run.py
"""
import sys, json, os
sys.path.insert(0, '/home/user/socialflow')
import pandas as pd
from trading.engine.backtest import Backtester, CostModel, load_h1, split
from trading.strategies.tendencia.strategy import build_signals, DEFAULT_PARAMS

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = ['net_profit', 'usd_per_hour', 'usd_per_day', 'max_dd_usd_intrabar', 'max_dd_usd_close', 'dd_limit_breached',
        'dd_breach_time', 'trades', 'win_rate_pct', 'profit_factor', 'avg_trade', 'sharpe_daily', 'total_costs',
        'costs', 'cagr_pct', 'buy_and_hold_net', 'net_by_year', 'hours']
COSTS = [('pepperstone', CostModel.pepperstone_razor), ('eightcap', CostModel.eightcap), ('conservative', CostModel.conservative)]
LEVS = [2, 10]


def load_params():
    fp = os.path.join(HERE, 'best_params.json')
    if os.path.exists(fp):
        return json.load(open(fp))
    return dict(DEFAULT_PARAMS)


def bt(d, params, cost, lev, stop_on_dd=True):
    sig = build_signals(d, **params)
    r = Backtester(d, cost, capital=1000, leverage=lev, max_dd_limit=300, stop_on_dd=stop_on_dd).run_vectorized(sig)
    m = r.metrics()
    return {k: m[k] for k in KEYS}


def fmt(x):
    return f'{x:.3f}' if isinstance(x, float) else str(x)


def main():
    params = load_params()
    df = load_h1()
    df_is, df_oos = split(df)
    periods = [('IS', df_is), ('OOS', df_oos), ('FULL', df)]
    out = dict(strategy='tendencia', params=params,
               periods={n: dict(start=str(d.index[0]), end=str(d.index[-1]), bars=len(d)) for n, d in periods},
               official={}, full_no_stop={}, robustness={}, grid_oos_summary={})

    # ---------------- corridas oficiales
    md = ['# Resultados estrategia "tendencia" (BTCUSD H1)\n',
          f'Parámetros (optimizados solo en IS): `{json.dumps(params)}`\n',
          'Periodos: ' + ', '.join(f"{n} {d.index[0].date()}..{d.index[-1].date()} ({len(d)} velas)" for n, d in periods) + '\n',
          '## Corridas oficiales (capital 1000, max_dd_limit=300, stop_on_dd=True)\n',
          '| Periodo | Coste | Lev | Neto USD | USD/hora | Max DD intravela | DD>300? | Trades | Win % | PF | Costes totales |',
          '|---|---|---|---|---|---|---|---|---|---|---|']
    for pname, d in periods:
        for cname, cf in COSTS:
            for lev in LEVS:
                m = bt(d, params, cf(), lev)
                out['official'][f'{pname}|{cname}|lev{lev}'] = m
                md.append(f"| {pname} | {cname} | {lev} | {m['net_profit']} | {m['usd_per_hour']} | {m['max_dd_usd_intrabar']} | "
                          f"{'SI' if m['dd_limit_breached'] else 'no'} | {m['trades']} | {m['win_rate_pct']} | {m['profit_factor']} | {m['total_costs']} |")
                print(pname, cname, lev, m['net_profit'], m['usd_per_hour'], m['max_dd_usd_intrabar'], m['trades'], m['profit_factor'])

    # ---------------- FULL sin stop por DD
    md += ['\n## FULL sin stop_on_dd (drawdown real de equity)\n',
           '| Coste | Lev | Neto USD | USD/hora | Max DD intravela | Max DD cierre | Momento 1ª rotura 300 | Trades | PF |',
           '|---|---|---|---|---|---|---|---|---|']
    for cname, cf in COSTS:
        for lev in LEVS:
            m = bt(df, params, cf(), lev, stop_on_dd=False)
            out['full_no_stop'][f'{cname}|lev{lev}'] = m
            md.append(f"| {cname} | {lev} | {m['net_profit']} | {m['usd_per_hour']} | {m['max_dd_usd_intrabar']} | {m['max_dd_usd_close']} | "
                      f"{m['dd_breach_time'] or '-'} | {m['trades']} | {m['profit_factor']} |")
    m = out['full_no_stop']['pepperstone|lev2']
    md.append('\nNeto por año (FULL sin stop, Pepperstone lev 2): ' + ', '.join(f'{y}: {v}' for y, v in m['net_by_year'].items()))

    # ---------------- robustez +-20 / +-40 % sobre OOS (Pepperstone lev 2)
    base = bt(df_oos, params, CostModel.pepperstone_razor(), 2)
    md += ['\n## Robustez OOS (Pepperstone, lev 2): variación de cada parámetro clave\n',
           f"Base OOS: neto {base['net_profit']} USD, USD/h {base['usd_per_hour']}, DD {base['max_dd_usd_intrabar']}, trades {base['trades']}, PF {base['profit_factor']}\n",
           '| Parámetro | Variación | Valor | Neto USD | USD/hora | Max DD | Trades | PF | Positivo? |',
           '|---|---|---|---|---|---|---|---|---|']
    rob_keys = ['ema_len', 'dc_len', 'atr_len', 'sl_mult', 'trail_mult', 'adx_min', 'risk_pct']
    n_pos = n_tot = 0
    for k in rob_keys:
        for pct in (-40, -20, 20, 40):
            v = params[k] * (1 + pct / 100)
            if k in ('ema_len', 'dc_len', 'atr_len'):
                v = max(2, int(round(v)))
            else:
                v = round(v, 3)
            m = bt(df_oos, {**params, k: v}, CostModel.pepperstone_razor(), 2)
            pos = m['net_profit'] > 0
            n_pos += pos; n_tot += 1
            out['robustness'][f'{k}|{pct:+d}%'] = dict(value=v, **m)
            md.append(f"| {k} | {pct:+d} % | {v} | {m['net_profit']} | {m['usd_per_hour']} | {m['max_dd_usd_intrabar']} | {m['trades']} | {m['profit_factor']} | {'si' if pos else 'NO'} |")
    out['robustness_positive_share'] = round(n_pos / n_tot, 3)
    md.append(f'\nVariaciones con OOS positivo: {n_pos}/{n_tot} = {100*n_pos/n_tot:.0f} % (rúbrica pide >= 70 %)')

    # ---------------- OOS de toda la rejilla IS (diagnóstico, NO se usa para elegir parámetros)
    gp = os.path.join(HERE, 'grid_is.csv')
    if os.path.exists(gp):
        g = pd.read_csv(gp)
        gkeys = ['ema_len', 'dc_len', 'sl_mult', 'trail_mult', 'adx_min', 'allow_short']
        oos_rows = []
        for _, row in g.iterrows():
            p = {**params, **{k: (int(row[k]) if k in ('ema_len', 'dc_len', 'allow_short') else float(row[k])) for k in gkeys}}
            m = bt(df_oos, p, CostModel.pepperstone_razor(), 2)
            oos_rows.append({**{k: row[k] for k in gkeys}, 'is_net': row['net'], 'is_pf': row['pf'],
                             'oos_net': m['net_profit'], 'oos_pf': m['profit_factor'] if m['profit_factor'] != 'inf' else 99,
                             'oos_dd': m['max_dd_usd_intrabar'], 'oos_trades': m['trades']})
        go = pd.DataFrame(oos_rows)
        go.to_csv(os.path.join(HERE, 'grid_oos.csv'), index=False)
        summ = dict(n=len(go), oos_positive_share=round(float((go.oos_net > 0).mean()), 3),
                    oos_net_median=round(float(go.oos_net.median()), 2), oos_net_max=round(float(go.oos_net.max()), 2),
                    oos_pf_median=round(float(go.oos_pf.median()), 3),
                    corr_is_oos_net=round(float(go.is_net.corr(go.oos_net)), 3),
                    by_allow_short={int(k): round(float(v), 2) for k, v in go.groupby('allow_short').oos_net.median().items()},
                    by_trail_mult={float(k): round(float(v), 2) for k, v in go.groupby('trail_mult').oos_net.median().items()},
                    top10_is_oos_net=[round(float(x), 2) for x in go.sort_values('is_pf', ascending=False).head(10).oos_net])
        out['grid_oos_summary'] = summ
        md += ['\n## Diagnóstico: comportamiento OOS de TODA la rejilla IS (144 combos, Pepperstone lev 2)\n',
               'No se usa para elegir parámetros; sirve para saber si la familia de estrategias funciona fuera de muestra.\n',
               f"- Combos con OOS positivo: {100*summ['oos_positive_share']:.0f} %; mediana neto OOS {summ['oos_net_median']} USD; máximo {summ['oos_net_max']} USD",
               f"- Mediana PF OOS: {summ['oos_pf_median']}; correlación neto IS vs OOS: {summ['corr_is_oos_net']}",
               f"- Neto OOS de los 10 mejores IS por PF: {summ['top10_is_oos_net']}",
               f"- Mediana neto OOS long-only vs long+short: {summ['by_allow_short']}; por trail_mult: {summ['by_trail_mult']}"]

    json.dump(out, open(os.path.join(HERE, 'results.json'), 'w'), indent=2, ensure_ascii=False, default=str)
    open(os.path.join(HERE, 'results.md'), 'w').write('\n'.join(md) + '\n')
    print('\nGuardado results.json y results.md en', HERE)
    print('Robustez positiva:', out['robustness_positive_share'], ' Grid OOS:', out['grid_oos_summary'])


if __name__ == '__main__':
    main()
