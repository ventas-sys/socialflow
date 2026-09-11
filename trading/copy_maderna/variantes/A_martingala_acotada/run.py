"""Variante A — MARTINGALA ACOTADA (rejilla/martingala con multiplicador bajo, pocos niveles y stop-loss de cesta en USD).

Ejecutar desde /home/user/socialflow:   python3 trading/copy_maderna/variantes/A_martingala_acotada/run.py
Salida: results.md (tablas IS/OOS/FULL por par y combinado, robustez, por año) y grid_is.csv en esta misma carpeta.

Diseño de la rejilla (~236 combinaciones por par, dentro del límite 150-250):
  Fase 1 (216): lot_mult {1.0, 1.5} × step {20, 40, 60} × max_levels {3, 4, 6} × basket_sl {60, 100, 150, 200} × tp {6, 10, 15}
  Fase 2 (≤20): para las 5 mejores de la fase 1 se prueban los vecinos lot_mult {1.2, 1.3}, step 30 y max_levels 5.
Selección (solo IS = 2012-11 → 2017-12), en cascada y siempre etiquetada en la salida:
  A (criterio pedido): sin ruina, max_dd_usd ≤ 300, máximo usd/h
  B (relajado):        sin ruina, max_dd_usd ≤ 500, net IS > 0, máximo usd/h
  C (relajado):        sin ruina, net IS > 0, máximo usd/h
  D (relajado):        sin ruina (todas con net ≤ 0), máximo usd/h
  E (todo arruinado):  la que más tarda en arruinarse ("menos mala"; desempate: menor max DD)
Nota: con max_levels = 3 el multiplicador no actúa (0,01·mult se redondea a 0,01), así que las combinaciones con resultados
idénticos se desduplican en los top-5.
Después: OOS (2018-01 → 2022-03) y FULL para las 5 mejores por par, combinado (EURUSD+GBPUSD, cada uno simulado con 1.000 y
suma de curvas de equity − 1.000), robustez ±20 % en step y basket_sl sobre OOS, y una comprobación FUERA DE REJILLA (tp 20/30)
solo informativa (no se usa para seleccionar).
"""
import sys, os, itertools, time
sys.path.insert(0, '/home/user/socialflow')
import numpy as np, pandas as pd
from multiprocessing import Pool
from trading.copy_maderna.grid_sim import load_fx
from trading.copy_maderna.variantes.A_martingala_acotada.grid_sim_a import simulate

HERE = os.path.dirname(os.path.abspath(__file__))
CAPITAL, LEVERAGE = 1000.0, 200.0
IS_END, OOS_START = '2018-01-01', '2018-01-01'
PAIRS = ['EURUSD', 'GBPUSD']
PERIODS = {'IS': lambda d: d[d.index < IS_END], 'OOS': lambda d: d[d.index >= OOS_START], 'FULL': lambda d: d}
KEYS = ['mult', 'step', 'lv', 'sl', 'tp']
DATA = {}


def init():
    for s in PAIRS:
        DATA[s] = load_fx(s)


def run(job):
    """job = (sym, period, mult, step, lv, sl, tp) -> dict de métricas (+ equity si period != 'IS')."""
    s, per, mult, step, lv, sl, tp = job
    r = simulate(PERIODS[per](DATA[s]), capital=CAPITAL, leverage=LEVERAGE, tp_pips=tp, step_pips=step, lot_mult=mult,
                 max_levels=lv, basket_sl_usd=sl)
    eq = r.pop('equity')
    out = dict(sym=s, period=per, mult=mult, step=step, lv=lv, sl=sl, tp=tp, **r)
    out['ruin'] = r['ruined_at'] is not None
    if per != 'IS':
        out['equity'] = eq
    return out


def pmap(jobs):
    with Pool(4, initializer=init) as pool:
        return pool.map(run, jobs, chunksize=4)


def select(df):
    """Devuelve (df ordenado según el criterio aplicable, etiqueta del criterio)."""
    ok = df[~df.ruin].drop_duplicates(subset=['net', 'max_dd_usd', 'sl_hits', 'tp_hits'])
    for tag, sub in (('A: sin ruina, DD≤300, max usd/h', ok[ok.max_dd_usd <= 300]),
                     ('B (RELAJADO): sin ruina, DD≤500, net IS>0, max usd/h', ok[(ok.max_dd_usd <= 500) & (ok.net > 0)]),
                     ('C (RELAJADO): sin ruina, net IS>0, max usd/h', ok[ok.net > 0]),
                     ('D (RELAJADO): sin ruina pero todas con net≤0, max usd/h', ok)):
        if len(sub):
            return sub.sort_values('usd_per_hour', ascending=False), tag
    d = df.drop_duplicates(subset=['ruined_at', 'max_dd_usd', 'sl_hits', 'tp_hits'])
    return d.sort_values(['ruined_at', 'max_dd_usd'], ascending=[False, True]), 'E (FRACASO): todo se arruina; se elige la que más tarda en arruinarse'


def combine(res_e, res_g):
    """Una sola cuenta de 1.000: equity = eq_EURUSD + eq_GBPUSD − 1.000 (cada par simulado por separado con 1.000)."""
    e, g = res_e['equity'], res_g['equity']
    idx = e.index.union(g.index)
    e = e.reindex(idx).ffill().fillna(CAPITAL); g = g.reindex(idx).ffill().fillna(CAPITAL)
    eq = e + g - CAPITAL
    ruin_i = eq[eq <= 0].index
    if len(ruin_i):   # cuenta única: al llegar a 0 se congela (ruina)
        eq = eq.copy(); eq[eq.index >= ruin_i[0]] = 0.0
    hours = (idx[-1] - idx[0]).total_seconds() / 3600
    dd = eq.cummax() - eq
    yearly = eq.resample('YE').last().diff(); yearly.iloc[0] = eq.resample('YE').last().iloc[0] - CAPITAL
    return dict(net=round(float(eq.iloc[-1] - CAPITAL), 2), usd_per_hour=round(float((eq.iloc[-1] - CAPITAL) / hours), 4),
                max_dd_usd=round(float(dd.max()), 2), max_dd_pct=round(100 * float((dd / eq.cummax().replace(0, np.nan)).max()), 1),
                min_equity=round(float(eq.min()), 2), ruin=len(ruin_i) > 0, ruined_at=str(ruin_i[0]) if len(ruin_i) else None,
                stopouts=res_e['stopouts'] + res_g['stopouts'], sl_hits=res_e['sl_hits'] + res_g['sl_hits'], tp_hits=res_e['tp_hits'] + res_g['tp_hits'],
                baskets_closed=res_e['baskets_closed'] + res_g['baskets_closed'], worst_basket=min(res_e['worst_basket'], res_g['worst_basket']),
                yearly={str(k.year): round(float(v), 2) for k, v in yearly.items()}, equity=eq)


# ---------- formato markdown ----------
COLS = [('net', 'net USD'), ('usd_per_hour', 'usd/h'), ('max_dd_usd', 'maxDD USD'), ('max_dd_pct', 'maxDD %'), ('ruin', 'ruina'),
        ('ruined_at', 'fecha ruina'), ('stopouts', 'stopouts'), ('sl_hits', 'sl_hits'), ('tp_hits', 'tp_hits'), ('baskets_closed', 'cestas'),
        ('worst_basket', 'peor cesta')]


def fmt(v):
    if isinstance(v, bool): return 'SÍ' if v else 'no'
    if v is None or (isinstance(v, float) and np.isnan(v)): return '-'
    if isinstance(v, float): return f'{v:.4f}' if abs(v) < 1 and v != 0 else f'{v:.2f}'
    return str(v)


def params(r):
    return f"mult {r['mult']} / step {r['step']} / niv {r['lv']} / SL {r['sl']} / tp {r['tp']}"


def table(rows, first_cols):
    hdr = first_cols + [c[1] for c in COLS]
    out = ['| ' + ' | '.join(hdr) + ' |', '|' + '---|' * len(hdr)]
    for lab, r in rows:
        out.append('| ' + ' | '.join(list(lab) + [fmt(r.get(k)) for k, _ in COLS]) + ' |')
    return '\n'.join(out)


def yearly_table(rows):
    years = sorted({y for _, r in rows for y in r['yearly']})
    out = ['| serie | ' + ' | '.join(years) + ' |', '|---|' + '---|' * len(years)]
    for lab, r in rows:
        out.append(f'| {lab} | ' + ' | '.join(fmt(r['yearly'].get(y)) for y in years) + ' |')
    return '\n'.join(out)


def main():
    t0 = time.time()
    md = ['# Variante A — Martingala acotada: resultados', '',
          f'Generado por `run.py` el {pd.Timestamp.now():%Y-%m-%d %H:%M}. Capital 1.000 USD, apalancamiento 200, base_lot 0,01, costes por defecto '
          '(spread 1 pip, comisión 7 USD/lote ida y vuelta, swap −3 USD/lote/noche). IS = 2012-11 → 2017-12; OOS = 2018-01 → 2022-03; FULL = todo.',
          '', 'Simulador: `grid_sim_a.py` (copia de `grid_sim.simulate` con el lote de nivel k = base·mult^(k−1) redondeado a 0,01; '
          'en el original el redondeo hacía que mult 1,2/1,3/1,5 fuesen idénticos a 1,0).', '']
    # ---------- Fase 1 ----------
    g1 = list(itertools.product([1.0, 1.5], [20, 40, 60], [3, 4, 6], [60, 100, 150, 200], [6, 10, 15]))
    jobs = [(s, 'IS') + c for s in PAIRS for c in g1]
    res = pmap(jobs)
    df = pd.DataFrame(res)
    # ---------- Fase 2: vecinos de las 5 mejores por par ----------
    jobs2 = []
    for s in PAIRS:
        top, _ = select(df[df.sym == s])
        seen = set(map(tuple, df[df.sym == s][KEYS].values.tolist()))
        for _, r in top.head(5).iterrows():
            for c in [(1.2, r.step, r.lv, r.sl, r.tp), (1.3, r.step, r.lv, r.sl, r.tp), (r.mult, 30, r.lv, r.sl, r.tp), (r.mult, r.step, 5, r.sl, r.tp)]:
                c = (float(c[0]), int(c[1]), int(c[2]), int(c[3]), int(c[4]))
                if c not in seen:
                    seen.add(c); jobs2.append((s, 'IS') + c)
    if jobs2:
        df = pd.concat([df, pd.DataFrame(pmap(jobs2))], ignore_index=True)
    df.drop(columns=['period']).to_csv(os.path.join(HERE, 'grid_is.csv'), index=False)
    md += ['## 1. Rejilla in-sample (2012-11 → 2017-12)', '']
    best = {}
    for s in PAIRS:
        d = df[df.sym == s]
        n_ok = int((~d.ruin).sum()); n_a = int(((~d.ruin) & (d.max_dd_usd <= 300)).sum()); n_b = int(((~d.ruin) & (d.max_dd_usd <= 500)).sum())
        ranked, tag = select(d)
        best[s] = ranked.head(5)
        md += [f'### {s}: {len(d)} combinaciones — sin ruina: {n_ok} — sin ruina y DD≤300: **{n_a}** — sin ruina y DD≤500: {n_b} — net>0: {int((d.net > 0).sum())}',
               '', f'Criterio aplicado: **{tag}**', '', 'Top 5 IS:', '',
               table([((params(r),), r) for _, r in ranked.head(5).iterrows()], ['parámetros']), '']
        # resumen por factor
        md += ['Media de net IS y % de ruina por valor de cada parámetro (OJO: mult 1,2/1,3, step 30 y niv 5 solo se prueban en la fase 2 '
               'como vecinos de las 5 mejores, así que sus medias están sesgadas al alza y no son comparables con el resto):', '', '| parámetro | valores (net medio / % ruina) |', '|---|---|']
        for f in KEYS:
            gg = d.groupby(f).agg(net=('net', 'mean'), ruin=('ruin', 'mean'))
            md.append(f'| {f} | ' + ', '.join(f'{k}: {v.net:.0f} / {100 * v.ruin:.0f}%' for k, v in gg.iterrows()) + ' |')
        md.append('')
    # ---------- OOS y FULL para el top 5 de cada par ----------
    jobs = [(s, per) + tuple(r[KEYS]) for s in PAIRS for _, r in best[s].iterrows() for per in ('OOS', 'FULL')]
    jobs = [(s, per, float(m), int(st), int(lv), int(sl), int(tp)) for s, per, m, st, lv, sl, tp in jobs]
    full = {(r['sym'], r['period'], r['mult'], r['step'], r['lv'], r['sl'], r['tp']): r for r in pmap(jobs)}
    for r in df.to_dict('records'):
        full[(r['sym'], 'IS', r['mult'], r['step'], r['lv'], r['sl'], r['tp'])] = r
    md += ['## 2. IS / OOS / FULL por par (top 5 IS de cada par; cada periodo se simula desde 1.000 USD)', '']
    chosen = {}
    for s in PAIRS:
        rows = []
        for rank, (_, r) in enumerate(best[s].iterrows(), 1):
            key = (float(r.mult), int(r.step), int(r.lv), int(r.sl), int(r.tp))
            for per in ('IS', 'OOS', 'FULL'):
                rows.append(((f'#{rank}' if per == 'IS' else '', params(r) if per == 'IS' else '', per), full[(s, per) + key]))
            if rank == 1:
                chosen[s] = key
        md += [f'### {s}', '', table(rows, ['#', 'parámetros', 'periodo']), '', 'Por año (variación de equity, USD; FULL):', '',
               yearly_table([(f'#{i + 1}', full[(s, 'FULL') + (float(r.mult), int(r.step), int(r.lv), int(r.sl), int(r.tp))]) for i, (_, r) in enumerate(best[s].iterrows())]), '']
    # ---------- Combinado ----------
    md += ['## 3. Combinado EURUSD + GBPUSD en una sola cuenta de 1.000 USD (mejor #1 de cada par; equity = eq_EUR + eq_GBP − 1.000)', '']
    comb = {}
    for per in ('IS', 'OOS', 'FULL'):
        if per == 'IS':   # necesitamos la equity IS del elegido: se recalcula
            re_, rg_ = [run((s, 'IS') + chosen[s]) | {'equity': simulate(PERIODS['IS'](DATA[s]), capital=CAPITAL, leverage=LEVERAGE, tp_pips=chosen[s][4], step_pips=chosen[s][1], lot_mult=chosen[s][0], max_levels=chosen[s][2], basket_sl_usd=chosen[s][3])['equity']} for s in PAIRS]
        else:
            re_, rg_ = full[('EURUSD', per) + chosen['EURUSD']], full[('GBPUSD', per) + chosen['GBPUSD']]
        comb[per] = combine(re_, rg_)
    md += [f"EURUSD: {params(dict(zip(KEYS, chosen['EURUSD'])))} · GBPUSD: {params(dict(zip(KEYS, chosen['GBPUSD'])))}", '',
           table([((per,), comb[per]) for per in ('IS', 'OOS', 'FULL')], ['periodo']), '', 'Por año (FULL, combinado):', '',
           yearly_table([('combinado', comb['FULL'])]), '']
    # combinado alternativo: parámetros de EURUSD aplicados a ambos pares
    md += ['Combinado alternativo con los parámetros #1 de EURUSD aplicados a AMBOS pares:', '']
    alt = {}
    for per in ('OOS', 'FULL'):
        rg = run(('GBPUSD', per) + chosen['EURUSD'])
        alt[per] = combine(full[('EURUSD', per) + chosen['EURUSD']], rg)
    md += [table([((per,), alt[per]) for per in ('OOS', 'FULL')], ['periodo']), '']
    # ---------- Robustez ±20 % step y SL sobre OOS ----------
    md += ['## 4. Robustez OOS (2018-01 → 2022-03): step × {0,8; 1,0; 1,2} y basket_sl × {0,8; 1,0; 1,2} (9 variantes por par)', '']
    rob = {}
    for s in PAIRS:
        m, st, lv, sl, tp = chosen[s]
        vjobs = [(s, 'OOS', m, int(round(st * fs)), lv, int(round(sl * fl)), tp) for fs in (0.8, 1.0, 1.2) for fl in (0.8, 1.0, 1.2)]
        rob[s] = pmap(vjobs)
        pos = sum(r['net'] > 0 for r in rob[s])
        md += [f'### {s} — OOS positivo en {pos}/9 variantes ({100 * pos / 9:.0f} %)', '',
               table([((f"step {r['step']} / SL {r['sl']}",), r) for r in rob[s]], ['variación']), '']
    combs = [combine(re_, rg_) for re_, rg_ in zip(rob['EURUSD'], rob['GBPUSD'])]
    pos = sum(c['net'] > 0 for c in combs)
    md += [f'### Combinado — OOS positivo en {pos}/9 variantes ({100 * pos / 9:.0f} %)', '',
           table([((f"EUR step {re_['step']}/SL {re_['sl']} + GBP step {rg_['step']}/SL {rg_['sl']}",), c) for re_, rg_, c in zip(rob['EURUSD'], rob['GBPUSD'], combs)], ['variación']), '']
    # ---------- Fuera de rejilla (informativo) ----------
    md += ['## 5. Comprobación FUERA DE REJILLA (solo informativa, no usada para seleccionar): tp 20 y 30 pips con los parámetros #1 de cada par, FULL', '']
    xjobs = [(s, 'FULL', chosen[s][0], chosen[s][1], chosen[s][2], chosen[s][3], tp) for s in PAIRS for tp in (20, 30)]
    xres = pmap(xjobs)
    md += [table([((r['sym'], params(r)), r) for r in xres], ['par', 'parámetros']), '']
    md += [f'Tiempo total: {time.time() - t0:.0f} s.']
    with open(os.path.join(HERE, 'results.md'), 'w') as f:
        f.write('\n'.join(md) + '\n')
    print('\n'.join(md))


if __name__ == '__main__':
    init()
    main()
