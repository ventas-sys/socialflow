"""Enfoque B: ruptura de rango intradía con OCO (London / Asian range breakout).
Ejecutar desde la raíz del repo:  python3 trading/fondeo/enfoques/B_ruptura_rango/run.py [--quick]
Etapas (selección SOLO con la muestra IS; OOS se calcula a la vez pero no se mira para elegir):
  1. estructura: tipo de rango × SL × salida (R:R o trailing) × ventana, riesgo 2 %, firmas ftmo_1step+fundingpips_1step
  2. filtros: rango relativo al ATR, filtro de día (sin lunes/viernes), 1 o 2 operaciones/día
  3. sizing por firma: riesgo 1-2,8 %, risk_on_balance, parada diaria autoimpuesta
  4. final: todos los inicios, 7/14/30 días, fase fondeada (+5 % en 30 días), línea base moneda al aire (5 semillas),
     sensibilidad al sesgo de vela (simulador optimista) → grid.csv, results.json
"""
import sys, os, time, json, itertools, functools
sys.path.insert(0, '.')
import numpy as np, pandas as pd
from multiprocessing import Pool
from dataclasses import replace
from trading.fondeo.challenge_sim import load, evaluate, SPECS, RULES, strat_daily_bet, prep, run_attempt, summarize
from trading.fondeo.enfoques.B_ruptura_rango.strat_b import strat_breakout_b, both_sides_stats
from trading.fondeo.enfoques.B_ruptura_rango import sim_optimista, sim_b

HERE = os.path.dirname(os.path.abspath(__file__))
QUICK = '--quick' in sys.argv
SYMS = ['XAUUSD', 'GBPUSD', 'EURUSD', 'BTCUSD']
IS_END = {'XAUUSD': '2018-12-31', 'GBPUSD': '2018-12-31', 'EURUSD': '2018-12-31', 'BTCUSD': '2025-02-28'}
FIRMS = ['ftmo_1step', 'fundingpips_1step', 'e8_one_8', 'e8_one_14', 'the5ers_hyper', 'ftmo_p1']
SEL_FIRMS = ['ftmo_1step', 'fundingpips_1step']       # firmas usadas para puntuar en las etapas 1-2
SPLIT = {'ftmo_1step': 0.9, 'fundingpips_1step': 0.8, 'e8_one_8': 0.8, 'e8_one_14': 0.8, 'the5ers_hyper': 0.8, 'ftmo_p1': 0.8}
MAX_STARTS_EXPLORE = 500
BARS = {}


def bars_of(sym):
    if sym not in BARS: BARS[sym] = load(sym)
    return BARS[sym]


@functools.lru_cache(maxsize=64)
def sig_of(sym, strat_key):
    return strat_breakout_b(bars_of(sym), **dict(strat_key))


def summ(att):
    """Resumen de un subconjunto de intentos (IS u OOS)."""
    n = len(att)
    if n == 0: return dict(n=0, pass_pct=np.nan, pass_inc_pct=np.nan, fail_pct=np.nan, timeout_pct=np.nan, days_med=np.nan, trades=np.nan, endbal=np.nan)
    p = lambda r: round(100 * (att.result == r).mean(), 1)
    passed = att[att.result == 'pass']
    return dict(n=n, pass_pct=p('pass'), pass_inc_pct=p('pass_inconsistent'), fail_pct=round(p('fail_daily') + p('fail_max'), 1),
                timeout_pct=p('timeout'), days_med=round(float(passed.days.median()), 1) if len(passed) else np.nan,
                trades=round(float(att.trades.mean()), 1), endbal=round(float(att.end_balance.mean()), 0))


def run_cfg(job):
    """job = dict(stage, sym, strat (tuple de pares), firm, risk, exec (tuple de pares), max_days, max_starts, target, baseline_seed)"""
    sym = job['sym']; bars = bars_of(sym)
    if job.get('baseline_seed') is not None:
        sig = strat_daily_bet(bars, 'coin', seed=job['baseline_seed'], entry_hour=job.get('entry_hour', 10), exit_hour=22)
    else:
        sig = sig_of(sym, job['strat'])
    rules = RULES[job['firm']]
    if job.get('max_days', 7) != 7 or job.get('target'):
        rules = replace(rules, max_days=job.get('max_days', 7), **({'target': job['target'], 'min_trading_days': 0} if job.get('target') else {}))
    ex = dict(job.get('exec', ()))
    ev = {None: sim_b.evaluate, 'optimista': sim_optimista.evaluate, 'original': evaluate}[job.get('sim')]   # sim_b = conservador (por defecto)
    res = ev(bars, sig, SPECS[sym], rules, risk_pct=job['risk'], max_starts=job.get('max_starts'), **ex)
    att = res['attempts']
    a_is = att[att.start <= IS_END[sym]]; a_oos = att[att.start > IS_END[sym]]
    row = {k: job.get(k) for k in ['stage', 'sym', 'firm', 'risk', 'max_days', 'target', 'baseline_seed', 'sim']}
    row.update({k: v for k, v in job['strat']} if job.get('strat') else {})
    row.update({k: v for k, v in job.get('exec', ())})
    row.update({f'is_{k}': v for k, v in summ(a_is).items()})
    row.update({f'oos_{k}': v for k, v in summ(a_oos).items()})
    return row


def run_jobs(jobs, label):
    t = time.time()
    with Pool(min(4, os.cpu_count() or 1)) as pool:
        rows = pool.map(run_cfg, jobs, chunksize=4)
    print(f'[{label}] {len(jobs)} evaluaciones en {time.time() - t:.0f} s', flush=True)
    return pd.DataFrame(rows)


def score(df, firms=SEL_FIRMS):
    """Puntuación IS de una configuración para las etapas de estructura/filtros: rentabilidad media por intento
    (balance final medio − 100k, en % del capital) promediada entre firmas, con riesgo fijo 2 %. Con 7 días y 2 % de
    riesgo las tasas de pase son ~0-3 % (demasiado escasas para ordenar); la rentabilidad media captura edge y quemas.
    Solo usa columnas IS."""
    g = df[df.firm.isin(firms)].groupby(['sym', 'strat_key', 'exec_key'])
    return ((g.is_endbal.mean() - 100_000) / 1000).rename('score_is')


def key_cols(df):
    scols = ['rng_type', 'expire_hour', 'exit_hour', 'sl_frac', 'sl_atr', 'rr', 'trail', 'min_range_atr', 'max_range_atr', 'skip_dow']
    ecols = ['max_trades_day', 'day_stop_pct', 'risk_on_balance']
    df['strat_key'] = df.apply(lambda r: tuple((c, r[c]) for c in scols if c in df and pd.notna(r[c]) and r[c] is not None), axis=1).astype(str)
    df['exec_key'] = df.apply(lambda r: tuple((c, r[c]) for c in ecols if c in df and pd.notna(r[c]) and r[c] is not None), axis=1).astype(str)
    return df


def strat_tuple(**kw):
    """Normaliza los parámetros de la estrategia a una tupla hashable (skip_dow como tupla)."""
    kw = {k: v for k, v in kw.items() if v is not None}
    if 'skip_dow' in kw: kw['skip_dow'] = tuple(kw['skip_dow'])
    return tuple(sorted(kw.items()))


def main():
    t_all = time.time()
    for s in SYMS: bars_of(s)
    all_rows = []
    # ------------------------------------------------------------------ etapa 1: estructura
    WINDOWS = {'asian': [(14, 18), (17, 23)], 'prelondon': [(14, 18), (17, 23)], 'london1h': [(14, 18), (17, 23)],
               'nypre': [(18, 22), (20, 23)], 'prevday': [(14, 18), (17, 23)]}
    SLS = [dict(sl_frac=1.0), dict(sl_frac=0.5), dict(sl_atr=1.0, sl_frac=1.0)]
    EXITS = [dict(rr=1.0), dict(rr=2.0), dict(rr=3.0), dict(rr=0, trail=1.5)]
    jobs = []
    for sym in SYMS:
        for rt, wins in WINDOWS.items():
            filt = dict(min_range_atr=1.0, max_range_atr=12.0) if rt == 'prevday' else dict(min_range_atr=0.3, max_range_atr=3.0)
            for (exp, exh), sl, ex in itertools.product(wins, SLS, EXITS):
                st = strat_tuple(rng_type=rt, expire_hour=exp, exit_hour=exh, **filt, **sl, **ex)
                for firm in SEL_FIRMS:
                    jobs.append(dict(stage=1, sym=sym, strat=st, firm=firm, risk=2.0, exec=(('max_trades_day', 1),), max_starts=MAX_STARTS_EXPLORE))
    if QUICK: jobs = jobs[::8]
    g1 = key_cols(run_jobs(jobs, 'etapa 1'))
    s1 = score(g1).reset_index().sort_values('score_is', ascending=False)
    print(s1.head(12).to_string(), flush=True)
    all_rows.append(g1)
    # ------------------------------------------------------------------ etapa 2: filtros y 2ª operación
    top2 = s1.groupby('sym').head(3 if not QUICK else 1)
    jobs = []
    for _, r in top2.iterrows():
        base = dict(eval(r.strat_key))
        rt = base['rng_type']
        f_opts = [(1.0, 12.0), (2.0, 12.0), (1.0, 6.0), (3.0, 12.0)] if rt == 'prevday' else [(0.3, 3.0), (0.3, 2.0), (1.0, 3.0), (0.3, 5.0)]
        for (mn, mx), skip, mtd in itertools.product(f_opts, [(), (0, 4)], [1, 2]):
            st = strat_tuple(**{**base, 'min_range_atr': mn, 'max_range_atr': mx, 'skip_dow': skip})
            for firm in SEL_FIRMS:
                jobs.append(dict(stage=2, sym=r.sym, strat=st, firm=firm, risk=2.0, exec=(('max_trades_day', mtd),), max_starts=MAX_STARTS_EXPLORE))
    g2 = key_cols(run_jobs(jobs, 'etapa 2'))
    s2 = score(g2).reset_index().sort_values('score_is', ascending=False)
    print(s2.head(12).to_string(), flush=True)
    all_rows.append(g2)
    # ------------------------------------------------------------------ etapa 3: sizing por firma
    s12 = pd.concat([s1, s2]).sort_values('score_is', ascending=False)
    cands = s12.groupby('sym').head(1)                     # mejor configuración por activo (IS)
    cands = pd.concat([cands, s12.head(3)]).drop_duplicates(['sym', 'strat_key', 'exec_key'])
    print('candidatas etapa 3:\n', cands.to_string(), flush=True)
    jobs = []
    for _, r in cands.iterrows():
        st = tuple(eval(r.strat_key)); mtd = dict(eval(r.exec_key)).get('max_trades_day', 1)
        for firm, risk, rob, ds in itertools.product(FIRMS, [1.0, 1.5, 2.0, 2.4, 2.8], [False, True], [None, 2.0]):
            ex = (('max_trades_day', mtd), ('risk_on_balance', rob)) + ((('day_stop_pct', ds),) if ds else ())
            jobs.append(dict(stage=3, sym=r.sym, strat=st, firm=firm, risk=risk, exec=ex, max_starts=MAX_STARTS_EXPLORE))
    if QUICK: jobs = jobs[::6]
    g3 = key_cols(run_jobs(jobs, 'etapa 3'))
    all_rows.append(g3)
    # configuración global: la (sym, strat) con mejor media IS de (pass − fail) sobre las firmas de selección, tomando para cada firma su mejor sizing
    best_per = g3.sort_values('is_pass_pct', ascending=False).copy()
    best_per['sc'] = best_per.is_pass_pct - best_per.is_fail_pct
    idx = best_per.groupby(['sym', 'strat_key', 'exec_key', 'firm']).sc.idxmax()
    bp = best_per.loc[idx]
    glob = bp[bp.firm.isin(SEL_FIRMS)].groupby(['sym', 'strat_key']).sc.mean().sort_values(ascending=False)
    print('ranking global etapa 3 (IS):\n', glob.to_string(), flush=True)
    top_sym, top_strat = glob.index[0]
    chosen = {}
    for firm in FIRMS:
        sub = g3[(g3.sym == top_sym) & (g3.strat_key == top_strat) & (g3.firm == firm)].copy()
        sub['sc'] = sub.is_pass_pct - sub.is_fail_pct
        best = sub.sort_values(['sc', 'is_pass_pct'], ascending=False).iloc[0]
        chosen[firm] = dict(risk=float(best.risk), exec=tuple(eval(best.exec_key)))
        print(f'  {firm}: riesgo {best.risk} exec {best.exec_key} IS pass {best.is_pass_pct} fail {best.is_fail_pct}', flush=True)
    # ------------------------------------------------------------------ etapa 4: final con todos los inicios
    st = tuple(eval(top_strat))
    jobs = []
    for firm in FIRMS:
        ch = chosen[firm]
        for md in [7, 14, 30]:
            jobs.append(dict(stage=4, sym=top_sym, strat=st, firm=firm, risk=ch['risk'], exec=ch['exec'], max_days=md))
        jobs.append(dict(stage=4, sym=top_sym, strat=st, firm=firm, risk=ch['risk'], exec=ch['exec'], max_days=30, target=0.05))   # fase fondeada
        for seed in range(5):                                                                                                  # moneda al aire
            for md in [7]:
                jobs.append(dict(stage=4, sym=top_sym, firm=firm, risk=ch['risk'], exec=ch['exec'], max_days=md, baseline_seed=seed))
            jobs.append(dict(stage=4, sym=top_sym, firm=firm, risk=ch['risk'], exec=ch['exec'], max_days=30, target=0.05, baseline_seed=seed))
        jobs.append(dict(stage=4, sym=top_sym, strat=st, firm=firm, risk=ch['risk'], exec=ch['exec'], max_days=7, sim='optimista'))  # sesgo de vela
        jobs.append(dict(stage=4, sym=top_sym, strat=st, firm=firm, risk=ch['risk'], exec=ch['exec'], max_days=7, sim='original'))   # relleno al nivel (challenge_sim original)
    # segunda mejor configuración (otro activo) a 7 días para referencia
    runner = [k for k in glob.index if k[0] != top_sym][:1]
    for sym2, strat2 in runner:
        for firm in FIRMS:
            sub = g3[(g3.sym == sym2) & (g3.strat_key == strat2) & (g3.firm == firm)].copy(); sub['sc'] = sub.is_pass_pct - sub.is_fail_pct
            b2 = sub.sort_values(['sc', 'is_pass_pct'], ascending=False).iloc[0]
            for md in [7, 14, 30]:
                jobs.append(dict(stage=5, sym=sym2, strat=tuple(eval(strat2)), firm=firm, risk=float(b2.risk), exec=tuple(eval(b2.exec_key)), max_days=md))
    g4 = key_cols(run_jobs(jobs, 'etapa 4-5'))
    all_rows.append(g4)
    grid = pd.concat(all_rows, ignore_index=True)
    grid.to_csv(os.path.join(HERE, 'grid.csv'), index=False)
    # ------------------------------------------------------------------ resultados
    bars = bars_of(top_sym); sig = sig_of(top_sym, st)
    n_first, n_both, frac_both = both_sides_stats(bars, sig)
    out = dict(symbol=top_sym, strategy=dict(st), chosen_sizing={f: dict(risk=c['risk'], **dict(c['exec'])) for f, c in chosen.items()},
               both_sides=dict(first_breakouts=n_first, both_sides=n_both, frac=round(frac_both, 4)), firms={}, runner_up={})
    f4 = g4[(g4.stage == 4)]
    for firm in FIRMS:
        d = {}
        for md in [7, 14, 30]:
            r = f4[(f4.firm == firm) & (f4.max_days == md) & f4.target.isna() & f4.baseline_seed.isna() & f4.sim.isna()].iloc[0]
            d[f'{md}d'] = {k: (None if pd.isna(r[k]) else float(r[k])) for k in ['is_pass_pct', 'is_pass_inc_pct', 'is_fail_pct', 'is_timeout_pct', 'is_days_med', 'oos_pass_pct', 'oos_pass_inc_pct', 'oos_fail_pct', 'oos_timeout_pct', 'oos_days_med', 'oos_trades', 'is_n', 'oos_n']}
        r = f4[(f4.firm == firm) & (f4.target == 0.05) & f4.baseline_seed.isna()].iloc[0]
        d['funded_5pct_30d'] = dict(is_pass_pct=float(r.is_pass_pct), is_fail_pct=float(r.is_fail_pct), oos_pass_pct=float(r.oos_pass_pct), oos_fail_pct=float(r.oos_fail_pct))
        c = f4[(f4.firm == firm) & (f4.max_days == 7) & f4.target.isna() & f4.baseline_seed.notna()]
        d['coin_7d'] = dict(is_pass_pct=round(float(c.is_pass_pct.mean()), 1), is_fail_pct=round(float(c.is_fail_pct.mean()), 1), oos_pass_pct=round(float(c.oos_pass_pct.mean()), 1), oos_fail_pct=round(float(c.oos_fail_pct.mean()), 1))
        c = f4[(f4.firm == firm) & (f4.target == 0.05) & f4.baseline_seed.notna()]
        d['coin_funded'] = dict(is_pass_pct=round(float(c.is_pass_pct.mean()), 1), oos_pass_pct=round(float(c.oos_pass_pct.mean()), 1))
        for simname in ['optimista', 'original']:
            o = f4[(f4.firm == firm) & (f4.sim == simname)].iloc[0]
            d[f'{simname}_7d'] = dict(is_pass_pct=float(o.is_pass_pct), is_fail_pct=float(o.is_fail_pct), oos_pass_pct=float(o.oos_pass_pct), oos_fail_pct=float(o.oos_fail_pct))
        fee = RULES[firm].fee_usd; p_pass = d['7d']['oos_pass_pct'] / 100; p_pay = d['funded_5pct_30d']['oos_pass_pct'] / 100
        d['ev_oos_usd'] = round(p_pass * p_pay * 5000 * SPLIT[firm] - fee, 0)
        d['fee_usd'] = fee; d['split'] = SPLIT[firm]
        pts = (4 if d['7d']['oos_pass_pct'] >= 50 else 2 if d['7d']['oos_pass_pct'] >= 30 else 0)
        pts += 2 if d['7d']['oos_fail_pct'] <= d['7d']['oos_pass_pct'] else 0
        pts += 2 if abs(d['7d']['oos_pass_pct'] - d['7d']['is_pass_pct']) < 10 else 0
        pts += 2 if d['ev_oos_usd'] > 0 else 0
        d['score_0_10'] = pts
        out['firms'][firm] = d
    for sym2, strat2 in runner:
        out['runner_up'] = dict(symbol=sym2, strategy=dict(eval(strat2)), firms={})
        for firm in FIRMS:
            f5 = g4[(g4.stage == 5) & (g4.firm == firm)]
            out['runner_up']['firms'][firm] = {f'{int(r.max_days)}d': dict(risk=float(r.risk), is_pass=float(r.is_pass_pct), is_fail=float(r.is_fail_pct), oos_pass=float(r.oos_pass_pct), oos_fail=float(r.oos_fail_pct)) for _, r in f5.iterrows()}
    with open(os.path.join(HERE, 'results.json'), 'w') as f:
        json.dump(out, f, indent=1, ensure_ascii=False, default=lambda x: None if (isinstance(x, float) and np.isnan(x)) else str(x))
    print(json.dumps(out, indent=1, ensure_ascii=False, default=str))
    print(f'total {time.time() - t_all:.0f} s')


if __name__ == '__main__':
    main()
