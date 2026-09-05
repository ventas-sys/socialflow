"""Variante B: rejilla PLANA (lot_mult=1.0, sin martingala) con filtro de tendencia (EMA H1).

Ejecutar desde /home/user/socialflow:   python trading/copy_maderna/variantes/B_rejilla_tendencia/run.py
Reproducible: no hay aleatoriedad. Usa grid_sim.simulate() sin modificar.

Etapas por par (EURUSD, GBPUSD):
  1) Barrido IS (2012-11 -> 2017-12), tp=10, base_lot=0.01: EMA{50,100,200,400} x step{15,25,40,60} x niveles{3,5,8} x SL{80,150,250} = 144 combos.
  2) Refinado sobre los 12 mejores de la etapa 1: tp{6,10,20} x base_lot{0.01,0.02} = 72 combos. Total 216/par.
     (both_sides=False con trend_filter es idéntico a both_sides=True: el filtro ya decide el lado; se verifica en el script.)
  Criterio IS: sin ruina, sin stop-outs, max_dd_usd <= 300, maximizar usd_per_hour.
  3) OOS (2018-01 -> 2022-03) y FULL para el mejor de cada par, y combinado (suma de curvas - 1000) sobre una sola cuenta.
  4) Robustez: +-20 % en step, basket_sl y EMA (27 variaciones) sobre OOS, por par y combinado.
"""
from __future__ import annotations
import sys, json, itertools, os
sys.path.insert(0, '/home/user/socialflow')
import numpy as np, pandas as pd
from multiprocessing import Pool
from trading.copy_maderna.grid_sim import load_fx, simulate

OUT = os.path.dirname(os.path.abspath(__file__))
CAPITAL = 1000.0
IS = ('2012-11-01', '2017-12-31 23:59')
OOS = ('2018-01-01', '2022-03-31 23:59')
FULL = ('2012-11-01', '2022-03-31 23:59')
DD_LIMIT = 300.0
DATA = {}


def get(sym, period):
    if sym not in DATA:
        DATA[sym] = load_fx(sym)
    return DATA[sym].loc[period[0]:period[1]]


def run(sym, period, p):
    r = simulate(get(sym, period), capital=CAPITAL, lot_mult=1.0, leverage=200.0, both_sides=True, **p)
    eq = r.pop('equity')
    return r, eq


def _job(args):
    sym, period, p = args
    r, _ = run(sym, period, p)
    r.update(p); r['sym'] = sym
    return r


def ok(r):
    return (r['ruined_at'] is None or pd.isna(r['ruined_at'])) and r['stopouts'] == 0 and r['max_dd_usd'] <= DD_LIMIT


def alive(r):
    return (r['ruined_at'] is None or pd.isna(r['ruined_at'])) and r['stopouts'] == 0


def rank(df):
    d = df.copy()
    d['ok'] = d.apply(ok, axis=1)
    return d.sort_values(['ok', 'usd_per_hour'], ascending=[False, False])


def combine(eq_a, eq_b):
    idx = eq_a.index.union(eq_b.index)
    a = eq_a.reindex(idx).ffill().bfill(); b = eq_b.reindex(idx).ffill().bfill()
    return a + b - CAPITAL


def metrics_from_curve(eq, ra, rb):
    hours = (eq.index[-1] - eq.index[0]).total_seconds() / 3600
    dd = eq.cummax() - eq
    ruined = (eq <= 0).any() or ra['ruined_at'] or rb['ruined_at']
    yearly = eq.resample('YE').last().diff(); yearly.iloc[0] = eq.resample('YE').last().iloc[0] - CAPITAL
    return dict(net=round(float(eq.iloc[-1] - CAPITAL), 2), usd_per_hour=round(float((eq.iloc[-1] - CAPITAL) / hours), 4),
                max_dd_usd=round(float(dd.max()), 2), max_dd_pct=round(100 * float((dd / eq.cummax()).max()), 1),
                ruined_at=str(min(x for x in [ra['ruined_at'], rb['ruined_at']] if x)) if (ra['ruined_at'] or rb['ruined_at']) else ('combined<=0' if (eq <= 0).any() else None),
                stopouts=ra['stopouts'] + rb['stopouts'], baskets_closed=ra['baskets_closed'] + rb['baskets_closed'],
                sl_hits=ra['sl_hits'] + rb['sl_hits'], tp_hits=ra['tp_hits'] + rb['tp_hits'],
                worst_basket=min(ra['worst_basket'], rb['worst_basket']), max_lots=ra['max_lots'] + rb['max_lots'],
                yearly={str(k.year): round(float(v), 2) for k, v in yearly.items()})


COLS = ['net', 'usd_per_hour', 'max_dd_usd', 'max_dd_pct', 'ruined_at', 'stopouts', 'baskets_closed', 'sl_hits', 'tp_hits', 'worst_basket', 'max_lots']


def md_table(rows, cols, names=None):
    names = names or cols
    out = ['| ' + ' | '.join(names) + ' |', '|' + '---|' * len(cols)]
    for r in rows:
        out.append('| ' + ' | '.join(str(r.get(c, '')) if not isinstance(r.get(c), float) else f"{r[c]:.4g}" for c in cols) + ' |')
    return '\n'.join(out)


def main():
    pool = Pool(4)
    md = ['# Variante B — rejilla plana + filtro de tendencia: resultados', '',
          f'IS = {IS[0]} → 2017-12 · OOS = {OOS[0]} → 2022-03 · FULL = todo. Capital 1.000 USD, leverage 200, costes por defecto (spread 1 pip, 7 USD/lote, swap -3 USD/lote/noche). lot_mult=1.0, both_sides=True (con trend_filter el lado lo decide la EMA).',
          f'Criterio IS: sin ruina, sin stop-outs, max DD ≤ {DD_LIMIT:.0f} USD, máximo usd/h.', '']
    best = {}; all_is = {}
    for sym in ['EURUSD', 'GBPUSD']:
        # sanity: both_sides False == True con filtro
        p0 = dict(trend_filter=200, step_pips=25, max_levels=5, basket_sl_usd=150, tp_pips=10, base_lot=0.01)
        r1 = simulate(get(sym, IS), capital=CAPITAL, lot_mult=1.0, both_sides=True, **p0)['equity']
        r2 = simulate(get(sym, IS), capital=CAPITAL, lot_mult=1.0, both_sides=False, **p0)['equity']
        assert np.allclose(r1.values, r2.values), 'both_sides debería ser irrelevante con trend_filter'
        # etapa 1
        grid1 = [dict(trend_filter=e, step_pips=s, max_levels=m, basket_sl_usd=sl, tp_pips=10, base_lot=0.01)
                 for e, s, m, sl in itertools.product([50, 100, 200, 400], [15, 25, 40, 60], [3, 5, 8], [80, 150, 250])]
        res1 = pool.map(_job, [(sym, IS, p) for p in grid1])
        df1 = rank(pd.DataFrame(res1))
        top = df1.head(12)
        grid2 = []
        for _, t in top.iterrows():
            for tp, bl in itertools.product([6, 10, 20], [0.01, 0.02]):
                if tp == 10 and bl == 0.01: continue
                grid2.append(dict(trend_filter=int(t.trend_filter), step_pips=int(t.step_pips), max_levels=int(t.max_levels), basket_sl_usd=int(t.basket_sl_usd), tp_pips=tp, base_lot=bl))
        res2 = pool.map(_job, [(sym, IS, p) for p in grid2])
        df = rank(pd.concat([df1.drop(columns='ok'), pd.DataFrame(res2)], ignore_index=True))
        df.drop(columns=['yearly']).to_csv(f'{OUT}/is_scan_{sym}.csv', index=False)
        all_is[sym] = df
        n_ok = int(df.ok.sum()); n_ruin = int((~df.apply(alive, axis=1)).sum())
        md += [f'## {sym} — barrido IS ({len(df)} combinaciones, {n_ok} cumplen el criterio, {n_ruin} acaban en ruina o stop-out, {int((df.net > 0).sum())} con neto > 0)', '',
               'Top 15 (ordenado por cumple-criterio y usd/h):', '',
               md_table(df.head(15).to_dict('records'), ['ok', 'trend_filter', 'step_pips', 'max_levels', 'basket_sl_usd', 'tp_pips', 'base_lot'] + COLS), '',
               'Resumen por EMA (media usd/h y % combos que cumplen):', '',
               md_table([dict(ema=int(e), mean_usd_h=round(g.usd_per_hour.mean(), 4), pct_ok=round(100 * g.ok.mean(), 1), best_usd_h=round(g.usd_per_hour.max(), 4)) for e, g in df.groupby('trend_filter')], ['ema', 'mean_usd_h', 'pct_ok', 'best_usd_h']), '',
               'Resumen por max_levels:', '',
               md_table([dict(levels=int(e), mean_usd_h=round(g.usd_per_hour.mean(), 4), pct_ok=round(100 * g.ok.mean(), 1), pct_ruina=round(100 * (~g.apply(alive, axis=1)).mean(), 1)) for e, g in df.groupby('max_levels')], ['levels', 'mean_usd_h', 'pct_ok', 'pct_ruina']), '',
               'Resumen por tp_pips (etapa 2 solo cubre tp 6/20 sobre los 12 mejores de tp=10):', '',
               md_table([dict(tp=int(e), n=len(g), mean_usd_h=round(g.usd_per_hour.mean(), 4), pct_ok=round(100 * g.ok.mean(), 1), best_usd_h=round(g.usd_per_hour.max(), 4)) for e, g in df.groupby('tp_pips')], ['tp', 'n', 'mean_usd_h', 'pct_ok', 'best_usd_h']), '',
               'Resumen por basket_sl_usd:', '',
               md_table([dict(sl=int(e), mean_usd_h=round(g.usd_per_hour.mean(), 4), pct_ok=round(100 * g.ok.mean(), 1), mean_dd=round(g.max_dd_usd.mean(), 1)) for e, g in df.groupby('basket_sl_usd')], ['sl', 'mean_usd_h', 'pct_ok', 'mean_dd']), '']
        b = df.iloc[0]
        if not b.ok:   # fallback: sin ruina ni stop-out, mínimo drawdown (lo más defensivo posible)
            al = df[df.apply(alive, axis=1)].sort_values('max_dd_usd')
            b = al.iloc[0] if len(al) else b
        best[sym] = dict(trend_filter=int(b.trend_filter), step_pips=int(b.step_pips), max_levels=int(b.max_levels), basket_sl_usd=int(b.basket_sl_usd), tp_pips=int(b.tp_pips), base_lot=float(b.base_lot))
        if not b.ok:
            md += [f'**AVISO {sym}: ninguna combinación cumple el criterio IS (ninguna con DD ≤ {DD_LIMIT:.0f} USD sin ruina); fallback = sin ruina/stop-out y mínimo DD: {best[sym]}.**', '']
    pool.close()

    # etapa 3: IS/OOS/FULL por par y combinado
    md += ['## Mejores parámetros por par (IS)', '', md_table([dict(sym=s, **best[s]) for s in best], ['sym', 'trend_filter', 'step_pips', 'max_levels', 'basket_sl_usd', 'tp_pips', 'base_lot']), '']
    curves = {}; summary = {}
    for name, per in [('IS', IS), ('OOS', OOS), ('FULL', FULL)]:
        rows = []
        for sym in best:
            r, eq = run(sym, per, best[sym]); curves[(sym, name)] = eq; r['sym'] = sym; rows.append(r); summary[(sym, name)] = r
        ceq = combine(curves[('EURUSD', name)], curves[('GBPUSD', name)])
        rc = metrics_from_curve(ceq, rows[0], rows[1]); rc['sym'] = 'COMBINADO'; rows.append(rc); summary[('COMBINADO', name)] = rc
        md += [f'## {name} ({per[0][:7]} → {per[1][:7]})', '', md_table(rows, ['sym'] + COLS), '',
               'Por año (variación de equity, USD):', '', md_table([dict(sym=r['sym'], **r['yearly']) for r in rows], ['sym'] + list(rows[0]['yearly'].keys())), '']
        pd.DataFrame({f'{s}': curves[(s, name)] for s in best} | {'COMBINADO': ceq}).resample('D').last().to_csv(f'{OUT}/equity_{name}.csv')

    # etapa 4: robustez OOS
    md += ['## Robustez OOS (±20 % en step, basket_sl y EMA; 27 variaciones)', '']
    rob_rows = []; pos = {'EURUSD': 0, 'GBPUSD': 0, 'COMBINADO': 0}
    var = list(itertools.product([0.8, 1.0, 1.2], repeat=3))
    pool = Pool(4)
    jobs = []
    for fs, fsl, fe in var:
        for sym in best:
            p = dict(best[sym]); p['step_pips'] = round(p['step_pips'] * fs, 1); p['basket_sl_usd'] = round(p['basket_sl_usd'] * fsl, 1); p['trend_filter'] = max(2, int(round(p['trend_filter'] * fe)))
            jobs.append((sym, OOS, p))
    rob_all = pool.map(_job, jobs); pool.close()
    for k, (fs, fsl, fe) in enumerate(var):
        ra, rb = rob_all[2 * k], rob_all[2 * k + 1]
        _, ea = run('EURUSD', OOS, {kk: ra[kk] for kk in best['EURUSD']}); _, eb = run('GBPUSD', OOS, {kk: rb[kk] for kk in best['GBPUSD']})
        rc = metrics_from_curve(combine(ea, eb), ra, rb)
        row = dict(step=f'x{fs}', sl=f'x{fsl}', ema=f'x{fe}', EUR_net=ra['net'], EUR_dd=ra['max_dd_usd'], EUR_ruina=bool(ra['ruined_at']), GBP_net=rb['net'], GBP_dd=rb['max_dd_usd'], GBP_ruina=bool(rb['ruined_at']),
                   COMB_net=rc['net'], COMB_usd_h=rc['usd_per_hour'], COMB_dd=rc['max_dd_usd'])
        rob_rows.append(row)
        pos['EURUSD'] += ra['net'] > 0; pos['GBPUSD'] += rb['net'] > 0; pos['COMBINADO'] += rc['net'] > 0
    md += [md_table(rob_rows, list(rob_rows[0].keys())), '',
           f"Variaciones con OOS neto > 0: EURUSD {pos['EURUSD']}/27 ({100*pos['EURUSD']/27:.0f} %), GBPUSD {pos['GBPUSD']}/27 ({100*pos['GBPUSD']/27:.0f} %), COMBINADO {pos['COMBINADO']}/27 ({100*pos['COMBINADO']/27:.0f} %).", '']
    pd.DataFrame(rob_rows).to_csv(f'{OUT}/robustness_oos.csv', index=False)

    open(f'{OUT}/results.md', 'w').write('\n'.join(md))
    json.dump(dict(best=best, summary={f'{k[0]}_{k[1]}': v for k, v in summary.items()}, robust_positive=pos), open(f'{OUT}/summary.json', 'w'), indent=1, default=str)
    print(json.dumps(dict(best=best, robust_positive=pos), indent=1))
    for k, v in summary.items():
        print(k, {c: v[c] for c in COLS})


if __name__ == '__main__':
    main()
