"""Enfoque C: seguimiento de tendencia (EMA / Donchian) con trailing ATR, riesgo escalonado anti-martingala y la
pregunta del plazo (7 / 14 / 30 / 60 días). Ejecutar desde la raíz del repo:
    python3 trading/fondeo/enfoques/C_tendencia_plazos/run.py [--stage 1|2|3|all] [--quick]
Etapas (todas reproducibles, cada una guarda su CSV en esta carpeta):
  1. Barrido IS de entradas (EMA 10/30, 20/50, 50/200; Donchian 20, 55) × H1/H4 × ATR stop/trail 1/2/4 × 5 activos,
     riesgo fijo 2 %, reglas 10/3/6 (fundingpips_1step), plazos 7 y 30 días.       -> stage1.csv
  2. Para las mejores entradas IS: riesgo 0,5-2,8 % × modo (fijo / sobre balance / escalonado / escalonado sobre
     balance) × cierre de viernes sí/no, plazos 7 y 14 días, IS.                   -> stage2.csv
  3. Configuraciones finales: 7 firmas × plazos 7/14/30/60 × IS y OOS con todos los inicios; línea base moneda al
     aire (5 semillas) con el mismo riesgo; fase fondeada P(+5 % en 30 d).          -> final.csv, coin.csv, funded.csv
  grid.csv = concatenación de todo lo probado; results.json = configuración elegida y tablas del informe.
"""
import sys, os, time, json, argparse, itertools
sys.path.insert(0, '.')
from collections import OrderedDict
from multiprocessing import get_context
import numpy as np, pandas as pd
from trading.fondeo.enfoques.C_tendencia_plazos.sim_c import *

HERE = os.path.dirname(os.path.abspath(__file__))
SYMS = ['XAUUSD', 'BTCUSD', 'GBPUSD', 'EURUSD', 'USDJPY']
FIRMS = ['ftmo_1step', 'fundingpips_1step', 'e8_one_8', 'e8_one_14', 'the5ers_hyper', 'ftmo_p1']
FEE = {'ftmo_p1': 540.0}  # RULES['ftmo_p1'] trae fee 0; el FTMO 2-step de 100k cuesta ≈540 USD (FIRMAS.md)
SPLIT = {'ftmo_1step': 0.9, 'fundingpips_1step': 0.8, 'e8_one_8': 0.8, 'e8_one_14': 0.8, 'the5ers_hyper': 0.8, 'ftmo_p1': 0.8, 'ftmo_p2': 0.8}
HORIZONS = [7, 14, 30, 60]
ENTRIES = {'ema10_30': ('ema', 10, 30), 'ema20_50': ('ema', 20, 50), 'ema50_200': ('ema', 50, 200), 'don20': ('don', 20, 0), 'don55': ('don', 55, 0)}


def sample_dates(sym, sample):
    """IS/OOS según el brief: FX/oro IS hasta 2018-12-31; BTC IS hasta 2025-03-01."""
    if sym == 'BTCUSD':
        return (None, '2025-02-28') if sample == 'IS' else ('2025-03-01', None)
    return (None, '2018-12-31') if sample == 'IS' else ('2019-01-01', None)


def ladder(risk):
    """Escalones de riesgo: 0,5 % → risk en pasos de 0,5 (2,8 como tope)."""
    lv = [x for x in (0.5, 1.0, 1.5, 2.0, 2.5, 2.8) if x <= risk + 1e-9]
    if lv[-1] < risk - 1e-9: lv.append(risk)
    return tuple(lv)


# ---------------------------------------------------------------- worker (cache por proceso)
_BARS = {}; _SIG = OrderedDict()


def get_bars(sym):
    if sym not in _BARS: _BARS[sym] = load(sym)
    return _BARS[sym]


def get_sig(sym, cfg):
    """cfg: dict(entry, tf, atr_stop, trail, friday) o dict(entry='coin', seed=...)."""
    key = (sym, tuple(sorted(cfg.items())))
    if key in _SIG: return _SIG[key]
    bars = get_bars(sym)
    if cfg['entry'] == 'coin':
        sig = strat_daily_bet(bars, 'coin', seed=cfg['seed'], sl_atr=1.5, rr=2.0)
    else:
        kind, a, b = ENTRIES[cfg['entry']]
        if kind == 'ema':
            sig = strat_ema_trend(bars, a, b, cfg['atr_stop'], cfg['trail'], cfg['tf'], exit_friday=cfg['friday'])
        else:
            sig = strat_donchian(bars, a, cfg['atr_stop'], cfg['trail'], cfg['tf'], exit_friday=cfg['friday'])
    P = prep(bars, sig)
    _SIG[key] = (sig, P)
    while len(_SIG) > 3: _SIG.popitem(last=False)
    return sig, P


def run_task(task):
    """task = dict(sym, cfg, evals=[dict(rule, max_days, risk, mode, sample, max_starts, target=None, min_days=None)])."""
    sym, cfg = task['sym'], task['cfg']
    bars = get_bars(sym); sig, P = get_sig(sym, cfg)
    out = []
    for ev in task['evals']:
        rules = replace(RULES[ev['rule']], max_days=ev['max_days'])
        if ev.get('target') is not None: rules = replace(rules, target=ev['target'], min_trading_days=ev.get('min_days', 0))
        start, end = sample_dates(sym, ev['sample'])
        mode, risk = ev['mode'], ev['risk']
        kw = dict(risk_pct=risk, risk_on_balance=mode in ('balance', 'ladder_balance'))
        if mode in ('ladder', 'ladder_balance'): kw['risk_ladder'] = ladder(risk)
        t = time.time()
        r = evaluate_range(bars, sig, SPECS[sym], rules, start=start, end=end, max_starts=ev['max_starts'], P=P, **kw)
        r.pop('attempts')
        r = {k: (float(v) if isinstance(v, (np.floating, np.integer)) else v) for k, v in r.items()}
        r['burn_pct'] = round(r['fail_daily_pct'] + r['fail_max_pct'], 1)
        row = dict(sym=sym, **{k: v for k, v in cfg.items()}, **ev); row.update(r); row['secs'] = round(time.time() - t, 1)
        out.append(row)
    return out


def run_all(tasks, workers=4, label=''):
    t0 = time.time(); rows = []
    with get_context('fork').Pool(workers) as pool:
        for i, res in enumerate(pool.imap_unordered(run_task, tasks)):
            rows += res
            if (i + 1) % max(1, len(tasks) // 10) == 0:
                print(f'  {label} {i + 1}/{len(tasks)} tareas, {round(time.time() - t0)} s', flush=True)
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- etapas
def stage1(quick):
    ms = 250 if quick else 400
    tasks = []
    for sym, entry, tf, atr in itertools.product(SYMS, ENTRIES, ['1h', '4h'], [1.0, 2.0, 4.0]):
        cfg = dict(entry=entry, tf=tf, atr_stop=atr, trail=atr, friday=True)
        evals = [dict(rule='fundingpips_1step', max_days=md, risk=2.0, mode='fixed', sample='IS', max_starts=ms) for md in (7, 30)]
        tasks.append(dict(sym=sym, cfg=cfg, evals=evals))
    df = run_all(tasks, label='etapa 1'); df['stage'] = 1
    df.to_csv(f'{HERE}/stage1.csv', index=False)
    return df


def pick_stage1(df, k=6):
    """Selección IS: unión de los k mejores por P(pasar 7 d) y los k mejores por ratio P(pasar)/P(quemar) a 30 d."""
    w7 = df[df.max_days == 7].set_index(['sym', 'entry', 'tf', 'atr_stop'])
    w30 = df[df.max_days == 30].set_index(['sym', 'entry', 'tf', 'atr_stop'])
    sc = pd.DataFrame({'pass7': w7.pass_pct, 'burn7': w7.burn_pct, 'pass30': w30.pass_pct, 'burn30': w30.burn_pct})
    # ratio pasar/quemar a 30 d, exigiendo actividad (P(pasar 30 d) ≥ 8 %) para no premiar configs que no operan
    sc['ratio30'] = np.where(sc.pass30 >= 8, sc.pass30 / (sc.burn30 + 1), 0)
    top = pd.concat([sc.sort_values('pass7', ascending=False).head(k), sc.sort_values('ratio30', ascending=False).head(k)])
    top = top[~top.index.duplicated()]
    return top.reset_index()


def stage2(sel, quick):
    ms = 250 if quick else 400
    tasks = []
    for _, r in sel.iterrows():
        for friday in (True, False):
            cfg = dict(entry=r.entry, tf=r.tf, atr_stop=float(r.atr_stop), trail=float(r.atr_stop), friday=friday)
            evals = []
            for risk, mode, md in itertools.product([0.5, 1.0, 1.5, 2.0, 2.8], ['fixed', 'balance', 'ladder', 'ladder_balance'], [7, 14]):
                if risk == 0.5 and mode.startswith('ladder'): continue  # escalera de un solo escalón = fijo
                evals.append(dict(rule='fundingpips_1step', max_days=md, risk=risk, mode=mode, sample='IS', max_starts=ms))
            tasks.append(dict(sym=r.sym, cfg=cfg, evals=evals))
    df = run_all(tasks, label='etapa 2'); df['stage'] = 2
    df.to_csv(f'{HERE}/stage2.csv', index=False)
    return df


def pick_stage2(df):
    """Selección IS (score = P(pasar 7 d) + P(pasar 14 d) − 0,5·P(quemar 14 d)), cuatro finales con regla explícita:
    (1) mejor score global; (2) mejor escalonado (ladder*) del mismo activo/entrada; (3) mejor score de un activo
    distinto de (1) (FX/oro tienen 3 años de OOS frente a 1,5 de BTC); (4) su versión escalonada."""
    key = ['sym', 'entry', 'tf', 'atr_stop', 'friday', 'risk', 'mode']
    w7 = df[df.max_days == 7].set_index(key); w14 = df[df.max_days == 14].set_index(key)
    sc = pd.DataFrame({'pass7': w7.pass_pct, 'burn7': w7.burn_pct, 'pass14': w14.pass_pct, 'burn14': w14.burn_pct})
    sc['score'] = sc.pass7 + sc.pass14 - 0.5 * sc.burn14
    sc = sc.sort_values('score', ascending=False).reset_index()
    lad = sc['mode'].str.startswith('ladder')
    best = sc.iloc[0]
    same = (sc.sym == best.sym) & (sc.entry == best.entry) & (sc.tf == best.tf) & (sc.atr_stop == best.atr_stop)
    out = [best, sc[lad & same].iloc[0]]
    other = sc[sc.sym != best.sym].iloc[0]
    same2 = (sc.sym == other.sym) & (sc.entry == other.entry) & (sc.tf == other.tf) & (sc.atr_stop == other.atr_stop)
    out += [other, sc[lad & same2].iloc[0]]
    fin = pd.DataFrame(out).reset_index(drop=True); fin['role'] = ['mejor_global', 'escalonado', 'mejor_otro_activo', 'escalonado_otro']
    return fin


def stage3(finals, quick):
    ms = 300 if quick else None
    firms = FIRMS + ['ftmo_p2']
    tasks, coin_tasks, funded_tasks = [], [], []; seen_coin = set()
    for _, r in finals.iterrows():
        cfg = dict(entry=r.entry, tf=r.tf, atr_stop=float(r.atr_stop), trail=float(r.atr_stop), friday=bool(r.friday))
        evals = [dict(rule=f, max_days=md, risk=float(r.risk), mode=r['mode'], sample=s, max_starts=ms)
                 for f, md, s in itertools.product(firms, HORIZONS, ['IS', 'OOS'])]
        # una tarea por (firma) para repartir entre procesos
        for f in firms:
            tasks.append(dict(sym=r.sym, cfg=cfg, evals=[e for e in evals if e['rule'] == f]))
        # fase fondeada: +5 % en 30 días sin quemar, reglas de cada firma, sin días mínimos
        funded_tasks.append(dict(sym=r.sym, cfg=cfg, evals=[dict(rule=f, max_days=30, target=0.05, min_days=0, risk=float(r.risk), mode=r['mode'], sample=s, max_starts=ms)
                                                             for f, s in itertools.product(FIRMS, ['IS', 'OOS'])]))
        # línea base: moneda al aire (1 op./día, SL 1,5 ATR, TP 2R) con el mismo riesgo/modo, 5 semillas, plazos 7 y 30
        if (r.sym, float(r.risk), r['mode']) not in seen_coin:
            seen_coin.add((r.sym, float(r.risk), r['mode']))
            for seed in range(1, 6):
                coin_tasks.append(dict(sym=r.sym, cfg=dict(entry='coin', seed=seed), evals=[dict(rule=f, max_days=md, risk=float(r.risk), mode=r['mode'], sample=s, max_starts=ms)
                                                                                         for f, md, s in itertools.product(FIRMS, [7, 30], ['IS', 'OOS'])]))
    df = run_all(tasks, label='etapa 3 final'); df['stage'] = 3; df.to_csv(f'{HERE}/final.csv', index=False)
    dfun = run_all(funded_tasks, label='etapa 3 fondeada'); dfun['stage'] = '3_funded'; dfun.to_csv(f'{HERE}/funded.csv', index=False)
    dcoin = run_all(coin_tasks, label='etapa 3 moneda'); dcoin['stage'] = '3_coin'; dcoin.to_csv(f'{HERE}/coin.csv', index=False)
    return df, dfun, dcoin


def build_results(finals, df, dfun, dcoin):
    """Tablas del informe y results.json."""
    out = {'configs': [], 'firms': {f: dict(name=RULES[f].name, fee_usd=FEE.get(f, RULES[f].fee_usd), split=SPLIT[f], target=RULES[f].target, daily=RULES[f].daily_loss,
                                            max_loss=RULES[f].max_loss, trailing=RULES[f].trailing, min_days=RULES[f].min_trading_days, best_day=RULES[f].best_day) for f in FIRMS + ['ftmo_p2']}}
    coin_g = dcoin.groupby(['sym', 'risk', 'mode', 'rule', 'max_days', 'sample'])[['pass_pct', 'burn_pct', 'timeout_pct']].mean().round(1)
    for _, r in finals.iterrows():
        c = dict(role=r.get('role', ''), sym=r.sym, entry=r.entry, tf=r.tf, atr_stop=float(r.atr_stop), trail=float(r.atr_stop), friday=bool(r.friday), risk=float(r.risk), mode=r['mode'],
                 ladder=list(ladder(float(r.risk))) if str(r['mode']).startswith('ladder') else None, table=[], funded=[], coin=[])
        d = df[(df.sym == r.sym) & (df.entry == r.entry) & (df.tf == r.tf) & (df.atr_stop == float(r.atr_stop)) & (df.risk == float(r.risk)) & (df['mode'] == r['mode'])]
        for f, md, s in itertools.product(FIRMS + ['ftmo_p2'], HORIZONS, ['IS', 'OOS']):
            x = d[(d.rule == f) & (d.max_days == md) & (d['sample'] == s)]
            if not len(x): continue
            x = x.iloc[0]
            row = dict(firm=f, max_days=md, sample=s, n=int(x.n), pass_pct=x.pass_pct, pass_inconsistent_pct=x.pass_inconsistent_pct, burn_pct=x.burn_pct,
                       timeout_pct=x.timeout_pct, days_to_pass_median=x.days_to_pass_median, trades_mean=x.trades_mean)
            ck = (r.sym, float(r.risk), r['mode'], f, md, s)
            if ck in coin_g.index:
                cg = coin_g.loc[ck]; row.update(coin_pass_pct=float(cg.pass_pct), coin_burn_pct=float(cg.burn_pct))
            c['table'].append(row)
        fu = dfun[(dfun.sym == r.sym) & (dfun.entry == r.entry) & (dfun.tf == r.tf) & (dfun.atr_stop == float(r.atr_stop)) & (dfun.risk == float(r.risk)) & (dfun['mode'] == r['mode'])]
        for _, x in fu.iterrows():
            c['funded'].append(dict(firm=x.rule, sample=x['sample'], p_payout_pct=x.pass_pct, burn_pct=x.burn_pct))
        # valor esperado por intento (OOS, 7 días y 30 días): P(pasar) × P(payout) × 5000 × split − fee
        c['ev'] = []
        for f in FIRMS:
            pp = {x['sample']: x['p_payout_pct'] for x in c['funded'] if x['firm'] == f}
            for md in HORIZONS:
                for s in ['IS', 'OOS']:
                    t = [x for x in c['table'] if x['firm'] == f and x['max_days'] == md and x['sample'] == s]
                    if not t or s not in pp: continue
                    p_pass = t[0]['pass_pct'] / 100
                    if f == 'ftmo_p1':  # dos fases: multiplicar por P(pasar fase 2) al mismo plazo
                        t2 = [x for x in c['table'] if x['firm'] == 'ftmo_p2' and x['max_days'] == md and x['sample'] == s]
                        p_pass *= (t2[0]['pass_pct'] / 100) if t2 else 0
                    fee = FEE.get(f, RULES[f].fee_usd)
                    ev = p_pass * pp[s] / 100 * 5000 * SPLIT[f] - fee
                    c['ev'].append(dict(firm=f, max_days=md, sample=s, p_pass_total_pct=round(100 * p_pass, 1), p_payout_pct=pp[s], fee_usd=fee, ev_usd=round(ev, 0)))
        out['configs'].append(c)
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--stage', default='all', help="1|2|3|all|report (report: solo reconstruye grid.csv y results.json desde los CSV)"); ap.add_argument('--quick', action='store_true'); ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args(); T = time.time()
    if a.stage in ('1', 'all'):
        s1 = stage1(a.quick); print('etapa 1 lista', round(time.time() - T), 's', flush=True)
    else:
        s1 = pd.read_csv(f'{HERE}/stage1.csv')
    sel = pick_stage1(s1); print(sel.to_string(), flush=True)
    if a.stage == '1': sys.exit(0)
    if a.stage in ('2', 'all'):
        s2 = stage2(sel, a.quick); print('etapa 2 lista', round(time.time() - T), 's', flush=True)
    else:
        s2 = pd.read_csv(f'{HERE}/stage2.csv')
    finals = pick_stage2(s2); print(finals.to_string(), flush=True)
    finals.to_csv(f'{HERE}/finals.csv', index=False)
    if a.stage == '2': sys.exit(0)
    if a.stage in ('3', 'all'):
        s3, sfun, scoin = stage3(finals, a.quick); print('etapa 3 lista', round(time.time() - T), 's', flush=True)
    else:
        s3, sfun, scoin = pd.read_csv(f'{HERE}/final.csv'), pd.read_csv(f'{HERE}/funded.csv'), pd.read_csv(f'{HERE}/coin.csv')
    grid = pd.concat([s1, s2, s3, sfun, scoin], ignore_index=True)
    grid.to_csv(f'{HERE}/grid.csv', index=False)
    res = build_results(finals, s3, sfun, scoin)
    json.dump(res, open(f'{HERE}/results.json', 'w'), indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
    print('grid.csv:', len(grid), 'filas; results.json escrito. Total', round(time.time() - T), 's')
