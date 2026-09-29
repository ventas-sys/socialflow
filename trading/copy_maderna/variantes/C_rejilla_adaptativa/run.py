"""Variante C - Rejilla adaptativa. Búsqueda in-sample (2012-11 -> 2017-12), validación out-of-sample (2018-01 -> 2022-03),
periodo completo, combinado EURUSD+GBPUSD sobre una sola cuenta de 1.000 USD y robustez +-20 %.

Uso (desde /home/user/socialflow):  python3 trading/copy_maderna/variantes/C_rejilla_adaptativa/run.py [n_combos] [seed]
Genera en esta carpeta: grid_is_<PAR>.csv, robustness_<PAR>.csv, summary.json, results.md
"""
from __future__ import annotations
import sys, os, json, random, itertools, time
sys.path.insert(0, '/home/user/socialflow')
import numpy as np, pandas as pd
from multiprocessing import Pool
from trading.copy_maderna.grid_sim import load_fx
from trading.copy_maderna.variantes.C_rejilla_adaptativa.grid_sim_c import simulate_c

HERE = os.path.dirname(os.path.abspath(__file__))
CAPITAL, LEVERAGE = 1000.0, 200.0
IS_END, OOS_START = '2017-12-31 23:59', '2018-01-01'
PAIRS = ['EURUSD', 'GBPUSD']
GRID = dict(step_atr_mult=[0.5, 1.0, 1.5, 2.0], hours=['all', '7-20', '12-21'], lot_mult=[1.0, 1.2], max_levels=[3, 4, 6],
            basket_sl_usd=[60, 100, 150, 250], tp_pips=[6, 10], risk_scale=[False, True], max_basket_hours=[24, 72, 168],
            vol_filter=[False, True])
HOURS = {'all': None, '7-20': range(7, 20), '12-21': range(12, 21)}
KEYS = ['net', 'usd_per_hour', 'max_dd_usd', 'max_dd_pct', 'ruined_at', 'stopouts', 'baskets_closed', 'sl_hits', 'tp_hits', 'time_hits', 'worst_basket', 'max_lots']

DATA = {}   # rellenado antes de crear el Pool (fork)


def run_one(args):
    pair, period, params = args[:3]; keep_eq = args[3] if len(args) > 3 else period != 'IS'
    df = DATA[pair][period]
    kw = dict(params); kw['hours'] = HOURS[kw['hours']]
    r = simulate_c(df, capital=CAPITAL, leverage=LEVERAGE, **kw)
    out = {k: r[k] for k in KEYS}; out['yearly'] = r['yearly']
    out['equity'] = r['equity'] if keep_eq else None   # la curva IS del grid no se guarda (memoria)
    return out


def slices(df):
    return {'IS': df[:IS_END], 'OOS': df[OOS_START:], 'FULL': df}


def combine(rE, rG):
    """Suma de curvas de equity de dos simulaciones de 1.000 USD -> una sola cuenta de 1.000 USD."""
    eq = pd.concat([rE['equity'], rG['equity']], axis=1, sort=True).ffill().bfill().sum(axis=1) - CAPITAL
    ruined = None
    if (eq <= 0).any():   # ruina de la cuenta combinada (suma de equities <= 0): ocurre ANTES que la ruina del par individual
        ruined = str(eq[eq <= 0].index[0]); eq[eq.index >= eq[eq <= 0].index[0]] = 0.0
    elif rE['ruined_at'] or rG['ruined_at']:
        ruined = 'parcial (' + ('EURUSD ' + rE['ruined_at'] if rE['ruined_at'] else 'GBPUSD ' + rG['ruined_at']) + ')'
    hours = (eq.index[-1] - eq.index[0]).total_seconds() / 3600
    dd = eq.cummax() - eq
    yearly = eq.resample('YE').last().diff(); yearly.iloc[0] = eq.resample('YE').last().iloc[0] - CAPITAL
    return dict(net=round(float(eq.iloc[-1] - CAPITAL), 2), usd_per_hour=round(float((eq.iloc[-1] - CAPITAL) / hours), 4),
                max_dd_usd=round(float(dd.max()), 2), max_dd_pct=round(100 * float((dd / eq.cummax().replace(0, np.nan)).max()), 1),
                ruined_at=ruined if ruined else None, stopouts=rE['stopouts'] + rG['stopouts'], baskets_closed=rE['baskets_closed'] + rG['baskets_closed'],
                sl_hits=rE['sl_hits'] + rG['sl_hits'], tp_hits=rE['tp_hits'] + rG['tp_hits'], time_hits=rE['time_hits'] + rG['time_hits'],
                worst_basket=min(rE['worst_basket'], rG['worst_basket']), max_lots=round(rE['max_lots'] + rG['max_lots'], 2),
                yearly={str(k.year): round(float(v), 2) for k, v in yearly.items()}, equity=eq)


def select(grid: pd.DataFrame):
    ok = grid[grid.ruined_at.isna()]
    a = ok[ok.max_dd_usd <= 300]
    if len(a): return a.usd_per_hour.idxmax(), 'A: sin ruina y max_dd_usd<=300, max usd/h'
    if len(ok): return ok.usd_per_hour.idxmax(), 'B (relajado): sin ruina, max usd/h (NINGUNA combinación cumple DD<=300)'
    # todas arruinan: usd/h empata (-1000/h); se elige la que sobrevive más tiempo (ruina más tardía) y, a igualdad, menor DD
    g = grid.assign(_r=pd.to_datetime(grid.ruined_at)).sort_values(['_r', 'max_dd_usd'], ascending=[False, True])
    return g.index[0], 'C (relajado): TODAS arruinan; se elige la que sobrevive más tiempo (ruina más tardía)'


def fmt_row(name, r):
    ru = 'SÍ (' + str(r['ruined_at'])[:10] + ')' if r['ruined_at'] else 'no'
    return f"| {name} | {r['net']:.2f} | {r['usd_per_hour']:.4f} | {r['max_dd_usd']:.2f} | {r['max_dd_pct']:.1f} | {ru} | {r['stopouts']} | {r['sl_hits']} | {r['tp_hits']} | {r['time_hits']} | {r['baskets_closed']} | {r['worst_basket']:.2f} |"


HDR = '| Periodo | Net USD | USD/h | Max DD USD | Max DD % | Ruina | Stopouts | SL hits | TP hits | Time hits | Cestas | Peor cesta |\n|---|---|---|---|---|---|---|---|---|---|---|---|'


def yearly_table(rows: dict):
    years = sorted({y for r in rows.values() for y in r['yearly']})
    out = '| Año | ' + ' | '.join(rows) + ' |\n|---|' + '---|' * len(rows) + '\n'
    for y in years:
        out += f'| {y} | ' + ' | '.join((f"{r['yearly'][y]:.2f}" if y in r['yearly'] else '-') for r in rows.values()) + ' |\n'
    return out


def main(n_combos=200, seed=42):
    t0 = time.time()
    for p in PAIRS:
        DATA[p] = slices(load_fx(p))
    keys = list(GRID)
    full = [dict(zip(keys, v)) for v in itertools.product(*GRID.values())]
    rng = random.Random(seed)
    combos = rng.sample(full, n_combos)
    print(f'grid completo {len(full)} combos; muestreadas {n_combos} (seed {seed})')
    md = ['# Variante C - Rejilla adaptativa: resultados', '',
          f'Grid completo: {len(full)} combinaciones; muestreo aleatorio reproducible de {n_combos} por par (seed {seed}), mismas combinaciones en ambos pares.',
          f'Capital {CAPITAL:.0f} USD, leverage {LEVERAGE:.0f}, spread 1 pip, comisión 7 USD/lote, swap -3 USD/lote/noche. IS: 2012-11 -> 2017-12. OOS: 2018-01 -> 2022-03.',
          'Criterio de selección IS: sin ruina, max_dd_usd <= 300 USD, máximo USD/h. Si ningún candidato cumple, se relaja (se indica).', '']
    summary = {'n_combos': n_combos, 'seed': seed, 'grid_size': len(full), 'pairs': {}}
    best_res = {}
    with Pool(4) as pool:
        for pair in PAIRS:
            print(f'== {pair}: IS grid ...', flush=True)
            res = pool.map(run_one, [(pair, 'IS', c) for c in combos], chunksize=4)
            grid = pd.DataFrame([{**c, **{k: r[k] for k in KEYS}} for c, r in zip(combos, res)])
            grid.to_csv(os.path.join(HERE, f'grid_is_{pair}.csv'), index=False)
            n_ok = int(grid.ruined_at.isna().sum()); n_a = int(((grid.ruined_at.isna()) & (grid.max_dd_usd <= 300)).sum()); n_pos = int((grid.net > 0).sum())
            ib, tier = select(grid); best = {k: grid.loc[ib, k] for k in keys}
            best = {k: (v.item() if hasattr(v, 'item') else v) for k, v in best.items()}
            print(f'   IS: {n_ok}/{n_combos} sin ruina, {n_a} cumplen DD<=300, {n_pos} con net>0. Mejor ({tier}): {best}', flush=True)
            # OOS y FULL de la mejor + top-5 IS en OOS (contexto)
            # top-5 con el mismo orden que la selección: sin ruina primero, luego usd/h, luego ruina más tardía
            top5 = grid.assign(_ok=grid.ruined_at.isna(), _r=pd.to_datetime(grid.ruined_at)).sort_values(['_ok', 'usd_per_hour', '_r'], ascending=[False, False, False]).head(5)
            jobs = [(pair, 'IS', best, True), (pair, 'OOS', best), (pair, 'FULL', best)] + [(pair, 'OOS', {k: (row[k].item() if hasattr(row[k], 'item') else row[k]) for k in keys}) for _, row in top5.iterrows()]
            out = pool.map(run_one, jobs)
            rIS, rOOS, rFULL = out[0], out[1], out[2]; top5_oos = out[3:]
            best_res[pair] = dict(params=best, IS=rIS, OOS=rOOS, FULL=rFULL)
            # robustez +-20 % en step_atr_mult, basket_sl_usd, max_basket_hours sobre OOS
            vars_ = []
            for fs, fb, fn in itertools.product([0.8, 1.0, 1.2], repeat=3):
                v = dict(best); v['step_atr_mult'] = round(best['step_atr_mult'] * fs, 3); v['basket_sl_usd'] = round(best['basket_sl_usd'] * fb, 1)
                v['max_basket_hours'] = round(best['max_basket_hours'] * fn, 1); vars_.append((fs, fb, fn, v))
            rob = pool.map(run_one, [(pair, 'OOS', v) for *_, v in vars_])
            robdf = pd.DataFrame([dict(f_step=fs, f_sl=fb, f_N=fn, step_atr_mult=v['step_atr_mult'], basket_sl_usd=v['basket_sl_usd'], max_basket_hours=v['max_basket_hours'],
                                       **{k: r[k] for k in KEYS}) for (fs, fb, fn, v), r in zip(vars_, rob)])
            robdf.to_csv(os.path.join(HERE, f'robustness_{pair}.csv'), index=False)
            best_res[pair]['rob'] = rob; best_res[pair]['robdf'] = robdf
            pos = int((robdf.net > 0).sum())
            summary['pairs'][pair] = dict(params=best, tier=tier, is_stats=dict(n_ok=n_ok, n_dd300=n_a, n_pos=n_pos),
                                          **{per: {k: (best_res[pair][per][k]) for k in KEYS + ['yearly']} for per in ('IS', 'OOS', 'FULL')},
                                          robust_pos=pos, robust_n=len(robdf), robust_min_net=float(robdf.net.min()), robust_med_net=float(robdf.net.median()))
            # markdown
            md += [f'## {pair}', '', f'**Mejores parámetros (IS):** `{best}`  ', f'Selección: {tier}.  ',
                   f'Grid IS: {n_ok}/{n_combos} combinaciones sin ruina; {n_a} cumplen DD<=300 sin ruina; {n_pos} con net>0.', '',
                   HDR, fmt_row('IS 2012-11→2017-12', rIS), fmt_row('OOS 2018-01→2022-03', rOOS), fmt_row('FULL 2012-11→2022-03', rFULL), '',
                   '**Por año (USD, variación de equity)**', '', yearly_table({'IS': rIS, 'OOS': rOOS, 'FULL': rFULL}),
                   '**Top-5 IS por USD/h y su OOS** (contexto: ¿el ranking IS predice algo?)', '',
                   '| # | step_atr | hours | lot_mult | niveles | SL USD | TP | risk_scale | N h | vol_filter | IS usd/h | IS DD | IS ruina | OOS net | OOS usd/h | OOS DD | OOS ruina |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
            for j, (_, row) in enumerate(top5.iterrows()):
                ro = top5_oos[j]
                md.append(f"| {j+1} | {row.step_atr_mult} | {row.hours} | {row.lot_mult} | {row.max_levels} | {row.basket_sl_usd} | {row.tp_pips} | {row.risk_scale} | {row.max_basket_hours} | {row.vol_filter} | {row.usd_per_hour:.4f} | {row.max_dd_usd:.0f} | {'sí' if isinstance(row.ruined_at, str) else 'no'} | {ro['net']:.2f} | {ro['usd_per_hour']:.4f} | {ro['max_dd_usd']:.0f} | {'sí' if ro['ruined_at'] else 'no'} |")
            md += ['', f'**Robustez OOS (±20 % en step_atr_mult, basket_sl_usd, N; 27 variaciones):** {pos}/{len(robdf)} con net OOS > 0; '
                   f'net mín {robdf.net.min():.2f}, mediana {robdf.net.median():.2f}, máx {robdf.net.max():.2f}; ruinas: {int(robdf.ruined_at.notna().sum())}.', '',
                   '| f_step | f_SL | f_N | net OOS | usd/h | DD USD | ruina |', '|---|---|---|---|---|---|---|']
            md += [f"| {r.f_step} | {r.f_sl} | {r.f_N} | {r.net:.2f} | {r.usd_per_hour:.4f} | {r.max_dd_usd:.0f} | {'sí' if isinstance(r.ruined_at, str) else 'no'} |" for r in robdf.itertuples()]
            md.append('')
            # agregado del grid IS: qué parámetros ayudan (media de net por valor)
            md += ['**Efecto marginal de cada parámetro en el grid IS (media de net USD y % sin ruina por valor):**', '', '| Parámetro | Valor | n | net medio | % sin ruina | % net>0 |', '|---|---|---|---|---|---|']
            for k in keys:
                g = grid.groupby(k)
                for val, sub in g:
                    md.append(f"| {k} | {val} | {len(sub)} | {sub.net.mean():.1f} | {100*sub.ruined_at.isna().mean():.0f} | {100*(sub.net>0).mean():.0f} |")
            md.append('')
    # combinado
    md += ['## Combinado EURUSD + GBPUSD (una sola cuenta de 1.000 USD: suma de curvas de equity - 1.000)', '', HDR]
    comb = {}
    for per in ('IS', 'OOS', 'FULL'):
        comb[per] = combine(best_res['EURUSD'][per], best_res['GBPUSD'][per])
        md.append(fmt_row(f'{per}', comb[per]))
    md += ['', '**Por año combinado (USD)**', '', yearly_table({p: comb[p] for p in comb})]
    # robustez combinada: misma variación aplicada a ambos pares
    robE, robG = best_res['EURUSD']['robdf'], best_res['GBPUSD']['robdf']
    comb_net = robE.net.values + robG.net.values
    comb_pos = int((comb_net > 0).sum())
    md += [f'**Robustez OOS combinada** (misma variación ±20 % aplicada a ambos pares, net OOS EUR + net OOS GBP): {comb_pos}/27 positivas; '
           f'mín {comb_net.min():.2f}, mediana {np.median(comb_net):.2f}, máx {comb_net.max():.2f}.', '']
    summary['combined'] = {per: {k: comb[per][k] for k in KEYS + ['yearly']} for per in comb}
    summary['combined']['robust_pos'] = comb_pos; summary['combined']['robust_nets'] = [round(float(x), 2) for x in comb_net]
    summary['elapsed_s'] = round(time.time() - t0, 1)
    with open(os.path.join(HERE, 'results.md'), 'w') as f: f.write('\n'.join(md))
    with open(os.path.join(HERE, 'summary.json'), 'w') as f: json.dump(summary, f, indent=1, default=str)
    print(json.dumps({p: {per: {k: summary['pairs'][p][per][k] for k in ('net', 'usd_per_hour', 'max_dd_usd', 'ruined_at', 'baskets_closed')} for per in ('IS', 'OOS', 'FULL')} for p in PAIRS}, indent=1))
    print('COMBINED', {per: {k: comb[per][k] for k in ('net', 'usd_per_hour', 'max_dd_usd', 'max_dd_pct', 'ruined_at', 'baskets_closed')} for per in comb})
    print('robust EUR', summary['pairs']['EURUSD']['robust_pos'], 'GBP', summary['pairs']['GBPUSD']['robust_pos'], 'comb', comb_pos, 'elapsed', summary['elapsed_s'])


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 200, int(sys.argv[2]) if len(sys.argv) > 2 else 42)
