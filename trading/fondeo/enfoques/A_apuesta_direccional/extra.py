"""Complemento reproducible de run.py: el mejor candidato en ORO (y el control USDJPY) de la etapa 3a, en todas las firmas,
a 7/14/30 días, con su línea base moneda al aire (5 semillas, 7 días) y fase fondeada. Se ejecuta al final de run.py o solo:
python3 trading/fondeo/enfoques/A_apuesta_direccional/extra.py  → añade filas (stage 'extra*') a grid.csv y bloque 'extra' a results.json"""
import sys, os, json; sys.path.insert(0, '.'); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pandas as pd, numpy as np
import run as R


def main():
    grid = pd.read_csv(os.path.join(R.OUT, 'grid.csv')); res = json.load(open(os.path.join(R.OUT, 'results.json')))
    s3 = grid[(grid.stage == 's3') & (grid.max_days == 7) & (grid.firm == 'ftmo_1step') & (grid.segment == 'IS')].copy(); s3['score'] = R.score(s3)
    tasks = []; cfgs = {}
    for sym in ['XAUUSD', 'USDJPY']:
        t = s3[s3.symbol == sym].sort_values('score', ascending=False).iloc[0]; cfg = R.cfg_from_row(t); cfgs[sym] = cfg
        sc = {k: cfg[k] for k in R.SC_KEYS}; sc['seed'] = 0; risk = cfg['risk']
        kw = dict(mtd=cfg['max_trades_day'], day_stop=cfg['day_stop'], rob=cfg['risk_on_balance'])
        ev = [R.ev_cfg('extra', f, risk, max_days=md, **kw) for f in R.FIRMS for md in (14, 30)]
        ev += [R.ev_cfg('extra_funded', f, risk, max_days=30, rules_override=R.FUNDED, variant='funded_5pct_30d', **kw) for f in ['ftmo_1step', 'fundingpips_1step']]
        ev[-1]['trade_stats'] = True; tasks.append((sc, ev))
        for seed in range(1, 6):
            tasks.append((dict(sc, rule='coin', seed=seed), [R.ev_cfg('extra_coin', f, risk, max_days=7, **kw) for f in R.FIRMS]))
    rows = R.run_tasks(tasks, 'extra'); df = R.rows_df(rows); ts = [r for r in rows if r['stage'] == 'trade_stats']
    df.to_csv(os.path.join(R.OUT, 'grid.csv'), mode='a', header=False, index=False)
    out = {}
    for sym, cfg in cfgs.items():
        mine = pd.concat([grid[(grid.stage == 's3') & (grid.max_days == 7)], df[df.stage == 'extra']]); mine = R.match(mine, cfg)
        coin = R.match(df[df.stage == 'extra_coin'], cfg, [k for k in R.CFG_KEYS if k not in ('rule', 'lookback_h')])
        fund = R.match(df[df.stage == 'extra_funded'], cfg)
        o = dict(config=cfg, by_firm={})
        for f in R.FIRMS:
            o['by_firm'][f] = {int(md): {seg: mine[(mine.firm == f) & (mine.max_days == md) & (mine.segment == seg)].iloc[0][R.METRICS].to_dict() for seg in ('IS', 'OOS')} for md in (7, 14, 30)}
            o['by_firm'][f]['coin_7d'] = {seg: coin[(coin.firm == f) & (coin.segment == seg)][R.METRICS].mean(numeric_only=True).round(2).to_dict() for seg in ('IS', 'OOS')}
            if f in ('ftmo_1step', 'fundingpips_1step'):
                o['by_firm'][f]['funded_5pct_30d'] = {seg: fund[(fund.firm == f) & (fund.segment == seg)].iloc[0][R.METRICS].to_dict() for seg in ('IS', 'OOS')}
        o['trade_stats'] = [t for t in ts if t['symbol'] == sym]
        out[sym] = o
        print(sym, cfg, {f: (o['by_firm'][f][7]['OOS']['pass_pct'], o['by_firm'][f]['coin_7d']['OOS']['pass_pct']) for f in R.FIRMS}, flush=True)
    res['extra_mejor_oro_y_control'] = out
    json.dump(res, open(os.path.join(R.OUT, 'results.json'), 'w'), indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))


if __name__ == '__main__':
    main()
