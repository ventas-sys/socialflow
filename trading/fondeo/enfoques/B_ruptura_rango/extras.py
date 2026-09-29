"""Complementos del REPORT.md (ejecutar tras run.py, desde la raíz del repo):
  a) estadísticas por operación de la configuración final con un rastreador independiente del simulador;
  b) moneda al aire con la misma relación 3R y stop ~1 ATR (¿el payoff asimétrico explica los pases?);
  c) balance medio de la línea base moneda al aire (filas de la etapa 4 de grid.csv);
  d) sensibilidad al sesgo de vela para la segunda opción (XAUUSD, SL a mitad de rango).
Salida: extras.json
"""
import sys, os, json
sys.path.insert(0, '.')
import numpy as np, pandas as pd
from dataclasses import replace
from trading.fondeo.challenge_sim import load, evaluate, SPECS, RULES, strat_daily_bet
from trading.fondeo.enfoques.B_ruptura_rango.strat_b import strat_breakout_b, both_sides_stats
from trading.fondeo.enfoques.B_ruptura_rango import sim_b, sim_optimista

HERE = os.path.dirname(os.path.abspath(__file__))
R = json.load(open(os.path.join(HERE, 'results.json')))
IS_END = {'XAUUSD': '2018-12-31', 'GBPUSD': '2018-12-31', 'EURUSD': '2018-12-31', 'BTCUSD': '2025-02-28'}


def trades(bars, sig, spec):
    """Primera ruptura del día (OCO), relleno en max(nivel, open) / min(nivel, open), SL/TP/salida horaria, costes.
    Devuelve una fila por operación con el resultado en R (múltiplo del riesgo)."""
    o, h, l, c = bars.open.values, bars.high.values, bars.low.values, bars.close.values
    day = bars.index.normalize().values; hour = bars.index.hour.values
    d = sig.dir.values; hi = sig.stop_px.values; w = sig.width.values; sl = sig.sl.values; tp = sig.tp.values; exh = sig.exit_hour.values
    out = []; i = 0; n = len(o); cost = spec.spread + spec.slip
    while i < n:
        if d[i] == 2:
            lo = hi[i] - w[i]; th = h[i] >= hi[i]; tl = l[i] <= lo
            if th or tl:
                both = th and tl
                pos = (1 if (o[i] - lo) >= (hi[i] - o[i]) else -1) if both else (1 if th else -1)
                px = max(hi[i], o[i]) if pos > 0 else min(lo, o[i])
                entry = px + pos * cost; risk = sl[i]; slp = entry - pos * sl[i]; tpp = entry + pos * tp[i]
                res = None
                if both or ((l[i] <= slp) if pos > 0 else (h[i] >= slp)): res = (-(sl[i] + spec.slip) / risk, 'sl0')
                else:
                    j = i + 1
                    while j < n and day[j] == day[i]:
                        hs = (l[j] <= slp) if pos > 0 else (h[j] >= slp); ht = (h[j] >= tpp) if pos > 0 else (l[j] <= tpp)
                        if hs: res = (-(sl[i] + spec.slip) / risk, 'sl'); break
                        if ht: res = (tp[i] / risk, 'tp'); break
                        if hour[j] >= exh[j]: res = (pos * (c[j] - entry) / risk, 'exit'); break
                        j += 1
                    if res is None: res = (pos * (c[j - 1] - entry) / risk, 'eod')
                r = res[0] - spec.comm_rt_per_lot / (sl[i] * spec.usd_per_unit_per_lot)
                out.append(dict(t=bars.index[i], dir=pos, R=r, how=res[1], both=both, sl_pips=sl[i] * 1e4, hour=hour[i]))
                dd = day[i]
                while i < n and day[i] == dd: i += 1
                continue
        i += 1
    return pd.DataFrame(out).set_index('t')


def stats(tr, bars, sym):
    m = tr.index <= IS_END[sym]
    out = {}
    for lab, sub, bsub in [('IS', tr[m], bars[bars.index <= IS_END[sym]]), ('OOS', tr[~m], bars[bars.index > IS_END[sym]])]:
        weeks = len(bsub) / (4 * 24 * 5)
        out[lab] = dict(n=int(len(sub)), win_pct=round(100 * (sub.R > 0).mean(), 1), tp_pct=round(100 * (sub.how == 'tp').mean(), 1),
                        sl_pct=round(100 * sub.how.isin(['sl', 'sl0']).mean(), 1), avg_R=round(float(sub.R.mean()), 3), std_R=round(float(sub.R.std()), 2),
                        trades_per_week=round(len(sub) / weeks, 2), sl_pips_median=round(float(sub.sl_pips.median()), 1),
                        both_sides=int(sub.both.sum()), long_avg_R=round(float(sub[sub.dir > 0].R.mean()), 3), short_avg_R=round(float(sub[sub.dir < 0].R.mean()), 3))
    out['by_year'] = {int(y): dict(n=int(len(g)), avg_R=round(float(g.R.mean()), 2), win_pct=round(100 * (g.R > 0).mean(), 1), sum_R=round(float(g.R.sum()), 1))
                      for y, g in tr.groupby(tr.index.year)}
    return out


def main():
    sym = R['symbol']; bars = load(sym); spec = SPECS[sym]
    st = dict(R['strategy']); st['skip_dow'] = tuple(st['skip_dow'])
    sig = strat_breakout_b(bars, **st)
    out = {'final': dict(symbol=sym, strategy=R['strategy'])}
    # a) por operación
    tr = trades(bars, sig, spec); out['final']['trade_stats'] = stats(tr, bars, sym)
    # b) moneda al aire con 3R y stop 1 ATR, una operación/día a las 10h (sin lunes/viernes como la estrategia): R medio por operación
    coin = []
    for seed in range(5):
        s = strat_daily_bet(bars, 'coin', seed=seed, entry_hour=10, sl_atr=1.0, rr=3.0, exit_hour=23)
        m = s.dir != 0; d = s[m]; o = bars.open.values[m.values]; idx = np.where(m.values)[0]
        h, l, c = bars.high.values, bars.low.values, bars.close.values; hour = bars.index.hour.values; day = bars.index.normalize().values
        rs = []
        for k, i in enumerate(idx):
            if bars.index[i].dayofweek in (0, 4): continue
            pos = int(d.dir.iloc[k]); entry = o[k] + pos * (spec.spread / 2 + spec.slip); sl = d.sl.iloc[k]; tp = d.tp.iloc[k]
            slp = entry - pos * sl; tpp = entry + pos * tp; j = i; res = None
            while j < len(c) and day[j] == day[i]:
                if ((l[j] <= slp) if pos > 0 else (h[j] >= slp)): res = -(sl + spec.slip) / sl; break
                if ((h[j] >= tpp) if pos > 0 else (l[j] <= tpp)): res = tp / sl; break
                if hour[j] >= 23: res = pos * (c[j] - entry) / sl; break
                j += 1
            if res is None: res = pos * (c[j - 1] - entry) / sl
            rs.append((bars.index[i], res - spec.comm_rt_per_lot / (sl * spec.usd_per_unit_per_lot)))
        rs = pd.Series(dict(rs)); coin.append(dict(seed=seed, IS_avg_R=round(float(rs[rs.index <= IS_END[sym]].mean()), 3), OOS_avg_R=round(float(rs[rs.index > IS_END[sym]].mean()), 3),
                                                  IS_win_pct=round(100 * float((rs[rs.index <= IS_END[sym]] > 0).mean()), 1), OOS_win_pct=round(100 * float((rs[rs.index > IS_END[sym]] > 0).mean()), 1)))
    out['coin_3R_trade_stats'] = coin
    # c) balance medio de la moneda al aire (grid, etapa 4) y de la estrategia
    g = pd.read_csv(os.path.join(HERE, 'grid.csv')); g4 = g[(g.stage == 4) & (g.max_days == 7) & g.target.isna()]
    out['endbal_7d'] = {}
    for firm in R['firms']:
        c = g4[(g4.firm == firm) & g4.baseline_seed.notna()]; s = g4[(g4.firm == firm) & g4.baseline_seed.isna() & g4.sim.isna()].iloc[0]
        out['endbal_7d'][firm] = dict(strategy_is=float(s.is_endbal), strategy_oos=float(s.oos_endbal), coin_is=round(float(c.is_endbal.mean())), coin_oos=round(float(c.oos_endbal.mean())),
                                      strategy_trades_oos=float(s.oos_trades), coin_trades_oos=round(float(c.oos_trades.mean()), 1))
    # d) sesgo de vela en la segunda opción (XAUUSD, sl_frac 0.5) con fundingpips 2.8 %
    ru = R['runner_up']; sym2 = ru['symbol']; b2 = load(sym2); st2 = dict(ru['strategy']); st2['skip_dow'] = tuple(st2['skip_dow'])
    sig2 = strat_breakout_b(b2, **st2); nf, nb, fr = both_sides_stats(b2, sig2)
    sens = dict(both_sides=dict(first_breakouts=nf, both=nb, frac=round(fr, 4)))
    for name, ev in [('sim_b', sim_b.evaluate), ('optimista', sim_optimista.evaluate), ('original', evaluate)]:
        r = ev(b2, sig2, SPECS[sym2], RULES['fundingpips_1step'], risk_pct=2.8, max_trades_day=1)
        a = r['attempts']; ai = a[a.start <= IS_END[sym2]]; ao = a[a.start > IS_END[sym2]]
        sens[name] = dict(is_pass=round(100 * (ai.result == 'pass').mean(), 1), is_fail=round(100 * ai.result.str.startswith('fail').mean(), 1),
                          oos_pass=round(100 * (ao.result == 'pass').mean(), 1), oos_fail=round(100 * ao.result.str.startswith('fail').mean(), 1))
    out['runner_up_candle_bias'] = dict(symbol=sym2, strategy=ru['strategy'], **sens)
    json.dump(out, open(os.path.join(HERE, 'extras.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
