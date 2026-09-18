"""Enfoque A — apuesta direccional de alta volatilidad, 1-2 operaciones al día (XAUUSD, BTCUSD; USDJPY control).
Ejecutar desde la raíz del repo:  python3 trading/fondeo/enfoques/A_apuesta_direccional/run.py [--quick]
Etapas (parámetros elegidos SOLO con IS; OOS se reporta):
  1) cribado de reglas de dirección × hora de entrada × SL(ATR) × R:R, riesgo 2 %, 1 op/día, cierre horario;
  2) para las 4 mejores señales IS por activo: riesgo {1.5, 2, 2.8} × 1-2 ops/día × cierre fijo vs trailing ×
     parada diaria {no, 2.5 %} × risk_on_balance;
  3a) 3 mejores por activo en las 6 firmas a 7 días (IS+OOS, todos los inicios) → elección por firma (IS);
  3b) configuraciones finales: 7/14/30 días, fase fondeada (+5 % en 30 d), moneda al aire (5 semillas), FTMO fase 2,
      estadística por operación y matemática de rachas.
Salidas en esta carpeta: grid.csv (todas las combinaciones, IS y OOS), results.json."""
from __future__ import annotations
import sys, os, json, time, itertools
sys.path.insert(0, '.'); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
from multiprocessing import Pool
from dataclasses import replace
from betlib import *

OUT = os.path.dirname(os.path.abspath(__file__))
QUICK = '--quick' in sys.argv
NPROC = int(os.environ.get('NPROC', 4))
SYMBOLS = ['XAUUSD', 'BTCUSD', 'USDJPY']
FIRMS = ['ftmo_1step', 'fundingpips_1step', 'e8_one_8', 'e8_one_14', 'the5ers_hyper', 'ftmo_p1']
SCREEN_FIRMS = ['ftmo_1step', 'fundingpips_1step']
HOURS = {'XAUUSD': [10, 16, 1], 'USDJPY': [10, 16, 1], 'BTCUSD': [8, 13, 0]}          # Londres, NY, apertura del día
SECOND_HOUR = {'XAUUSD': {10: 16, 16: 21, 1: 10}, 'USDJPY': {10: 16, 16: 21, 1: 10}, 'BTCUSD': {8: 13, 13: 18, 0: 8}}
EXIT_HOUR = {'XAUUSD': 22, 'USDJPY': 22, 'BTCUSD': 23}
SPLIT = {'ftmo_1step': 0.9, 'fundingpips_1step': 0.8, 'e8_one_8': 0.8, 'e8_one_14': 0.8, 'the5ers_hyper': 0.8, 'ftmo_p1': 0.8}
FUNDED = dict(target=0.05, min_trading_days=0, best_day=None)
BARS = {s: load(s) for s in SYMBOLS}
STARTS = {'full': {s: split_starts(BARS[s], s, max_starts=(120 if QUICK else None)) for s in SYMBOLS},
          'sub': {s: split_starts(BARS[s], s, max_starts=(80 if QUICK else 600)) for s in SYMBOLS}}
SC_KEYS = ['symbol', 'rule', 'lookback_h', 'entry_hours', 'sl_atr', 'rr', 'exit_hour', 'trail']
CFG_KEYS = SC_KEYS + ['risk', 'max_trades_day', 'day_stop', 'risk_on_balance']
METRICS = ['n', 'pass_pct', 'pass_inconsistent_pct', 'fail_daily_pct', 'fail_max_pct', 'fail_pct', 'timeout_pct', 'days_to_pass_median',
           'trades_mean', 'worst_day_mean', 'max_dd_mean', 'end_balance_mean']


def worker(task):
    """task = (sig_cfg, [eval_cfg,...]); calcula la señal una vez y corre todas las evaluaciones."""
    sc, evals = task; sym = sc['symbol']; bars = BARS[sym]
    sig = strat_bet(bars, sc['rule'], tuple(sc['entry_hours']), sc['sl_atr'], sc['rr'], sc['exit_hour'], sc['trail'],
                    lookback_h=sc['lookback_h'], seed=sc.get('seed', 0), asia=ASIA[sym])
    P = prep(bars, sig); spec = SPECS[sym]; out = []
    scrow = {k: (str(v) if isinstance(v, (tuple, list)) else v) for k, v in sc.items()}
    for ec in evals:
        rules = replace(RULES[ec['firm']], max_days=ec['max_days'], **(ec.get('rules_override') or {}))
        for seg, starts in zip(('IS', 'OOS'), STARTS[ec.get('starts', 'full')][sym]):
            r = run_many(P, spec, rules, starts, ec['risk'], max_trades_day=ec['max_trades_day'], day_stop_pct=ec['day_stop'],
                         risk_on_balance=ec['risk_on_balance'])
            row = dict(stage=ec['stage'], **scrow, firm=ec['firm'], firm_variant=ec.get('variant', ''), max_days=ec['max_days'], risk=ec['risk'],
                       max_trades_day=ec['max_trades_day'], day_stop=ec['day_stop'], risk_on_balance=ec['risk_on_balance'], segment=seg)
            row.update({k: (float(v) if isinstance(v, (np.floating, float)) else v) for k, v in r.items()}); out.append(row)
    if any(ec.get('trade_stats') for ec in evals):
        t = trade_stats(P, spec); cut = pd.Timestamp(IS_END[sym]) + pd.Timedelta(hours=23)
        out.append(dict(stage='trade_stats', **scrow, IS=summarize_trades(t[t.dt <= cut]), OOS=summarize_trades(t[t.dt > cut])))
    return out


def run_tasks(tasks, label):
    t0 = time.time(); rows = []
    with Pool(NPROC) as pool:
        for i, out in enumerate(pool.imap_unordered(worker, tasks, chunksize=1)):
            rows += out
            if (i + 1) % 25 == 0 or i + 1 == len(tasks): print(f'  [{label}] {i + 1}/{len(tasks)} tareas, {time.time() - t0:.0f} s', flush=True)
    return rows


def ev_cfg(stage, firm, risk, mtd=1, day_stop=None, rob=False, max_days=7, starts='full', **kw):
    return dict(stage=stage, firm=firm, risk=risk, max_trades_day=mtd, day_stop=day_stop, risk_on_balance=rob, max_days=max_days, starts=starts, **kw)


def sig_cfg(sym, rule, hours, sl, rr, lookback=24, exit_hour=None, trail=0.0, seed=0):
    return dict(symbol=sym, rule=rule, lookback_h=int(lookback), entry_hours=[int(h) for h in hours], sl_atr=float(sl), rr=float(rr),
                exit_hour=int(EXIT_HOUR[sym] if exit_hour is None else exit_hour), trail=float(trail), seed=int(seed))


def group_tasks(tasks):
    g = {}
    for sc, ev in tasks: g.setdefault(json.dumps(sc, sort_keys=True), (sc, []))[1].extend(ev)
    return list(g.values())


def score(d): return d.pass_pct - 0.25 * d.fail_pct     # pasar es lo que cuenta; quemar penaliza un poco


def cfg_from_row(t):
    return dict(symbol=t.symbol, rule=t.rule, lookback_h=int(t.lookback_h), entry_hours=list(eval(t.entry_hours)), sl_atr=float(t.sl_atr), rr=float(t.rr),
                exit_hour=int(t.exit_hour), trail=float(t.trail), risk=float(t.risk), max_trades_day=int(t.max_trades_day),
                day_stop=(None if pd.isna(t.day_stop) else float(t.day_stop)), risk_on_balance=bool(t.risk_on_balance))


def match(df, cfg, keys=CFG_KEYS):
    m = np.ones(len(df), bool)
    for c in keys:
        v = cfg[c]; v = str(v) if isinstance(v, list) else v
        m &= (df[c].isna().values if v is None else (df[c] == v).values)
    return df[m]


# ============================================================ ETAPA 1: cribado de direcciones
def stage1():
    tasks = []
    rules_full = [('momentum', 4), ('momentum', 12), ('momentum', 24), ('momentum', 72), ('meanrev', 4), ('meanrev', 24),
                  ('prevday', 24), ('asian', 24), ('long', 24)]
    for sym in SYMBOLS:
        if sym == 'USDJPY':   # control: grid reducido
            grid = itertools.product([('momentum', 24), ('momentum', 72), ('meanrev', 24), ('prevday', 24), ('asian', 24)], HOURS[sym][:2], [1.0, 2.0], [1.0, 2.0, 3.0])
        else:
            grid = itertools.product(rules_full, HOURS[sym], [0.5, 1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
        for (rule, lb), h, sl, rr in grid:
            if QUICK and sl not in (1.0, 3.0): continue
            tasks.append((sig_cfg(sym, rule, [h], sl, rr, lb), [ev_cfg('s1', f, 2.0, starts='sub') for f in SCREEN_FIRMS]))
    print(f'Etapa 1: {len(tasks)} señales × {len(SCREEN_FIRMS)} firmas × IS/OOS', flush=True)
    return run_tasks(tasks, 'etapa 1')


# ============================================================ ETAPA 2: riesgo, nº operaciones, salida, parada diaria
def stage2(df1):
    tasks = []
    for sym in SYMBOLS:
        d = df1[(df1.symbol == sym) & (df1.segment == 'IS') & (df1.stage == 's1')]
        agg = d.groupby(['rule', 'lookback_h', 'entry_hours', 'sl_atr', 'rr']).agg(pass_pct=('pass_pct', 'mean'), fail_pct=('fail_pct', 'mean')).reset_index()
        agg['score'] = score(agg); top = agg.sort_values('score', ascending=False).head(2 if QUICK else 4)
        print(f'  top IS {sym} (media de {SCREEN_FIRMS}):\n{top.to_string(index=False)}', flush=True)
        for _, t in top.iterrows():
            h0 = int(eval(t.entry_hours)[0]); hours2 = [h0, SECOND_HOUR[sym][h0]]
            for mtd, exit_mode, risk, ds, rob in itertools.product([1, 2], ['fixed', 'trail'], [1.5, 2.0, 2.8], [None, 2.5], [False, True]):
                if QUICK and (risk == 1.5 or rob): continue
                hours = [h0] if mtd == 1 else hours2
                sc = sig_cfg(sym, t.rule, hours, t.sl_atr, t.rr, t.lookback_h) if exit_mode == 'fixed' else \
                    sig_cfg(sym, t.rule, hours, t.sl_atr, t.rr, t.lookback_h, exit_hour=-1, trail=1.5)
                tasks.append((sc, [ev_cfg('s2', 'ftmo_1step', risk, mtd, ds, rob, starts='sub')]))
    tasks = group_tasks(tasks)
    print(f'Etapa 2: {len(tasks)} señales, {sum(len(e) for _, e in tasks)} evaluaciones × IS/OOS', flush=True)
    return run_tasks(tasks, 'etapa 2')


# ============================================================ ETAPA 3a: candidatos en todas las firmas, 7 días, todos los inicios
def stage3a(df2):
    tasks = []
    for sym in SYMBOLS:
        d = df2[(df2.symbol == sym) & (df2.segment == 'IS') & (df2.stage == 's2')].copy(); d['score'] = score(d)
        for _, t in d.sort_values('score', ascending=False).head(2 if QUICK else 3).iterrows():
            cfg = cfg_from_row(t); sc = {k: cfg[k] for k in SC_KEYS}; sc['seed'] = 0
            kw = dict(mtd=cfg['max_trades_day'], day_stop=cfg['day_stop'], rob=cfg['risk_on_balance'])
            tasks.append((sc, [ev_cfg('s3', f, cfg['risk'], **kw) for f in FIRMS]))
    print(f'Etapa 3a: {len(tasks)} candidatos × {len(FIRMS)} firmas', flush=True)
    return run_tasks(tasks, 'etapa 3a')


# ============================================================ ETAPA 3b: finales: 14/30 días, fondeada, moneda, fase 2
def stage3b(final_cfgs):
    tasks = []
    for cfg in final_cfgs:
        sc = {k: cfg[k] for k in SC_KEYS}; sc['seed'] = 0; risk = cfg['risk']
        kw = dict(mtd=cfg['max_trades_day'], day_stop=cfg['day_stop'], rob=cfg['risk_on_balance'])
        ev = [ev_cfg('s3', f, risk, max_days=md, **kw) for f in FIRMS for md in ([30] if QUICK else [14, 30])]
        ev += [ev_cfg('funded', f, risk, max_days=30, rules_override=FUNDED, variant='funded_5pct_30d', **kw) for f in FIRMS]
        ev += [ev_cfg('s3', 'ftmo_p2', risk, max_days=md, **kw) for md in (7, 30)]
        ev[-1]['trade_stats'] = True
        tasks.append((sc, ev))
        for seed in range(1, 6):     # línea base: misma config (SL/TP/horas/riesgo/salidas), dirección al azar
            scc = dict(sc, rule='coin', seed=seed)
            evc = [ev_cfg('coin', f, risk, max_days=7, **kw) for f in FIRMS]
            evc += [ev_cfg('coin', f, risk, max_days=30, starts='sub', **kw) for f in FIRMS]
            evc += [ev_cfg('coin_funded', f, risk, max_days=30, starts='sub', rules_override=FUNDED, variant='funded_5pct_30d', **kw) for f in FIRMS]
            evc[-1]['trade_stats'] = True
            tasks.append((scc, evc))
    print(f'Etapa 3b: {len(final_cfgs)} configuraciones finales, {len(tasks)} tareas', flush=True)
    return run_tasks(tasks, 'etapa 3b')


def rows_df(rows): return pd.DataFrame([r for r in rows if r['stage'] != 'trade_stats'])


def main():
    t0 = time.time()
    df1 = rows_df(stage1()); df2 = rows_df(stage2(df1)); df3a = rows_df(stage3a(df2))
    # elección por firma: SOLO IS a 7 días
    chosen = {}
    for f in FIRMS:
        d = df3a[(df3a.firm == f) & (df3a.segment == 'IS')].copy(); d['score'] = score(d)
        chosen[f] = cfg_from_row(d.sort_values('score', ascending=False).iloc[0])
    final_cfgs = list({json.dumps(c, sort_keys=True): c for c in chosen.values()}.values())
    rows3b = stage3b(final_cfgs); df3b = rows_df(rows3b); tstats = [r for r in rows3b if r['stage'] == 'trade_stats']
    grid = pd.concat([df1, df2, df3a, df3b], ignore_index=True)
    grid.to_csv(os.path.join(OUT, 'grid.csv' if not QUICK else 'grid_quick.csv'), index=False)

    df3 = pd.concat([df3a, df3b], ignore_index=True); s3 = df3[df3.stage == 's3']; coin = df3[df3.stage == 'coin']
    coin_keys = [k for k in CFG_KEYS if k not in ('rule', 'lookback_h')]
    results = dict(enfoque='A_apuesta_direccional', quick=QUICK, firms={}, candidatos=[cfg_from_row(t) for _, t in df3a[df3a.segment == 'IS'].drop_duplicates(CFG_KEYS).iterrows()],
                   trade_stats=tstats)
    for f in FIRMS:
        cfg = chosen[f]; mine = match(s3[s3.firm == f], cfg); mcoin = match(coin[coin.firm == f], cfg, coin_keys)
        fr = dict(config=cfg, fee_usd=RULES[f].fee_usd, split=SPLIT[f], by_days={}, coin_by_days={})
        for md in sorted(mine.max_days.unique()):
            fr['by_days'][int(md)] = {seg: mine[(mine.max_days == md) & (mine.segment == seg)].iloc[0][METRICS].to_dict() for seg in ('IS', 'OOS')}
            mc = mcoin[mcoin.max_days == md]
            if len(mc): fr['coin_by_days'][int(md)] = {seg: mc[mc.segment == seg][METRICS].mean(numeric_only=True).round(2).to_dict() for seg in ('IS', 'OOS')}
        fund = match(df3[(df3.stage == 'funded') & (df3.firm == f)], cfg); cfund = match(df3[(df3.stage == 'coin_funded') & (df3.firm == f)], cfg, coin_keys)
        fr['funded_5pct_30d'] = {seg: fund[fund.segment == seg].iloc[0][METRICS].to_dict() for seg in ('IS', 'OOS')}
        fr['coin_funded_5pct_30d'] = {seg: cfund[cfund.segment == seg][METRICS].mean(numeric_only=True).round(2).to_dict() for seg in ('IS', 'OOS')}
        p_pass = fr['by_days'][7]['OOS']['pass_pct'] / 100; p_pay = fr['funded_5pct_30d']['OOS']['pass_pct'] / 100; p2 = 1.0
        if f == 'ftmo_p1':   # 2 fases: hay que pasar también la fase 2 (5 %, medido a 30 días con la misma estrategia)
            r2 = match(s3[(s3.firm == 'ftmo_p2') & (s3.max_days == 30) & (s3.segment == 'OOS')], cfg)
            fr['p2_pass_30d_OOS'] = float(r2.iloc[0].pass_pct) if len(r2) else 0.0; p2 = fr['p2_pass_30d_OOS'] / 100
        ev = lambda p: round(p * p2 * p_pay * 5000 * SPLIT[f] - RULES[f].fee_usd, 0)
        fr['ev_usd'] = dict(p_pass_7d=round(p_pass * p2, 4), p_first_payout=round(p_pay, 4), ev_7d=ev(p_pass),
                            ev_30d=ev(fr['by_days'][30]['OOS']['pass_pct'] / 100) if 30 in fr['by_days'] else None)
        is7, oos7 = fr['by_days'][7]['IS'], fr['by_days'][7]['OOS']
        fr['score_0_10'] = (4 if oos7['pass_pct'] >= 50 else 2 if oos7['pass_pct'] >= 30 else 0) + (2 if oos7['fail_pct'] <= oos7['pass_pct'] else 0) \
            + (2 if abs(is7['pass_pct'] - oos7['pass_pct']) < 10 else 0) + (2 if fr['ev_usd']['ev_7d'] > 0 else 0)
        ts = [t for t in tstats if t['rule'] != 'coin' and all(str(t[k]) == str(cfg[k]) for k in SC_KEYS)]
        if ts:   # matemática de rachas con la tasa de acierto y el R medio OOS
            st = ts[0]['OOS']; n_w, p_streak = wins_needed(st['win_rate'], st['avg_win_r'], cfg['risk'], RULES[f].target * 100)
            mc = mc_pass(st['win_rate'], st['avg_win_r'], st['avg_loss_r'], cfg['risk'], RULES[f].target * 100, RULES[f].max_loss * 100,
                         RULES[f].daily_loss * 100, cfg['max_trades_day'], 7, RULES[f].trailing)
            fr['math'] = dict(**st, wins_needed=n_w, p_streak=p_streak, mc_pass_7d=mc[0], mc_burn_7d=mc[1])
        results['firms'][f] = fr
        print(f'{f}: {cfg} | IS pass {is7["pass_pct"]} fail {is7["fail_pct"]} | OOS pass {oos7["pass_pct"]} fail {oos7["fail_pct"]} | '
              f'coin OOS {fr["coin_by_days"][7]["OOS"]["pass_pct"]} | payout {fr["ev_usd"]["p_first_payout"]} | EV {fr["ev_usd"]["ev_7d"]} | score {fr["score_0_10"]}', flush=True)
    lg = df1[(df1.symbol == 'XAUUSD') & (df1.rule == 'long') & (df1.firm == 'ftmo_1step')]
    results['sesgo_largo_oro_ftmo_1step'] = lg.groupby('segment').pass_pct.agg(['mean', 'max']).round(1).to_dict()
    lb = df1[(df1.symbol == 'BTCUSD') & (df1.rule == 'long') & (df1.firm == 'ftmo_1step')]
    results['sesgo_largo_btc_ftmo_1step'] = lb.groupby('segment').pass_pct.agg(['mean', 'max']).round(1).to_dict()
    results['runtime_s'] = round(time.time() - t0)
    with open(os.path.join(OUT, 'results.json' if not QUICK else 'results_quick.json'), 'w') as fh:
        json.dump(results, fh, indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
    print('listo en', results['runtime_s'], 's', flush=True)
    if not QUICK:
        import extra; extra.main()   # complemento: mejor candidato en oro y USDJPY, 7/14/30 días, moneda al aire


if __name__ == '__main__':
    main()
