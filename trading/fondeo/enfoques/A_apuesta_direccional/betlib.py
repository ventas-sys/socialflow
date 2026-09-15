"""Enfoque A: apuesta direccional de alta volatilidad con 1-2 operaciones al día.
Estrategia propia `strat_bet` (generaliza strat_daily_bet) + utilidades de evaluación IS/OOS que reutilizan
`run_attempt` del simulador sin modificarlo. Ejecutar desde la raíz del repo."""
from __future__ import annotations
import sys; sys.path.insert(0, '.')
import numpy as np, pandas as pd
from dataclasses import replace
from trading.fondeo.challenge_sim import (load, atr_h1, _empty, prep, run_attempt, summarize, SPECS, RULES, Rules)

IS_END = {'XAUUSD': '2018-12-31', 'USDJPY': '2018-12-31', 'EURUSD': '2018-12-31', 'GBPUSD': '2018-12-31', 'BTCUSD': '2025-02-28'}
OOS_START = {'XAUUSD': '2019-01-01', 'USDJPY': '2019-01-01', 'EURUSD': '2019-01-01', 'GBPUSD': '2019-01-01', 'BTCUSD': '2025-03-01'}
# sesión asiática: 01-09 hora servidor en FX/oro; 00-08 UTC en BTC
ASIA = {'XAUUSD': (1, 9), 'USDJPY': (1, 9), 'EURUSD': (1, 9), 'GBPUSD': (1, 9), 'BTCUSD': (0, 8)}


def strat_bet(bars, rule='momentum', entry_hours=(10,), sl_atr=1.5, rr=2.0, exit_hour=22, trail=0.0,
              lookback_h=24, seed=0, asia=(1, 9)):
    """1-2 operaciones al día a las horas `entry_hours` (entrada a mercado en la apertura de la vela HH:00).
    Dirección (solo con información hasta la vela anterior):
      momentum / meanrev : signo del retorno de las últimas lookback_h horas (búsqueda temporal, robusta a huecos)
      prevday            : signo del cuerpo (close-open) del día natural anterior
      asian              : signo del retorno de la sesión asiática [asia[0], asia[1]) del mismo día (si la entrada es
                           posterior) o del día anterior (entrada 01:00)
      long / short       : sesgo permanente
      coin               : moneda al aire con semilla
    SL = sl_atr × ATR14(H1); TP = rr × SL (rr<=0: sin TP); exit_hour = cierre horario (-1: dejar correr);
    trail = múltiplo ATR de trailing (0 = sin trailing)."""
    s = _empty(bars); a = atr_h1(bars)
    idx = bars.index; hours = idx.hour.values; mins = idx.minute.values
    o = bars.open.values; c = bars.close.values
    ts = idx.values.astype('datetime64[s]').astype(np.int64)
    at_entry = np.isin(hours, list(entry_hours)) & (mins == 0)
    n = len(bars)
    if rule in ('momentum', 'meanrev'):
        j = np.searchsorted(ts, ts - lookback_h * 3600, side='right') - 1
        ret = o - o[np.clip(j, 0, n - 1)]; ret[j < 0] = 0
        d = np.sign(ret) * (1 if rule == 'momentum' else -1)
    elif rule == 'prevday':
        day = idx.normalize()
        dd = pd.DataFrame({'o': o, 'c': c, 'day': day}).groupby('day').agg(o=('o', 'first'), c=('c', 'last'))
        body = (dd.c - dd.o).shift(1)                      # cuerpo del día anterior
        d = np.sign(body.reindex(day).values); d[np.isnan(d)] = 0
    elif rule == 'asian':
        day = idx.normalize()
        m = (hours >= asia[0]) & (hours < asia[1])
        dd = pd.DataFrame({'o': o[m], 'c': c[m], 'day': day[m]}).groupby('day').agg(o=('o', 'first'), c=('c', 'last'))
        ar = np.sign(dd.c - dd.o)
        same = ar.reindex(day).values; prev = ar.shift(1).reindex(day).values
        d = np.where(hours >= asia[1], same, prev); d = np.nan_to_num(d)
    elif rule == 'long':
        d = np.ones(n)
    elif rule == 'short':
        d = -np.ones(n)
    elif rule == 'coin':
        d = np.random.default_rng(seed).choice([-1, 1], size=n)
    else:
        raise ValueError(rule)
    s.loc[at_entry, 'dir'] = d[at_entry]
    s['sl'] = sl_atr * a; s['tp'] = (rr * sl_atr * a) if rr > 0 else np.nan
    s['exit_hour'] = exit_hour; s['trail'] = float(trail); s['atr'] = a
    s.loc[np.isnan(a), 'dir'] = 0
    return s


def start_indices(bars, start_hour=1):
    idx = bars.index
    return np.where((idx.hour == start_hour) & (idx.minute == 0) & (idx.dayofweek < 5))[0]


def split_starts(bars, symbol, max_starts=None, start_hour=1):
    """Índices de inicio de intento (lunes-viernes a start_hour) separados IS/OOS."""
    cand = start_indices(bars, start_hour); dates = bars.index[cand]
    is_ = cand[dates <= pd.Timestamp(IS_END[symbol]) + pd.Timedelta(hours=23)]
    oos = cand[dates >= pd.Timestamp(OOS_START[symbol])]
    if max_starts:
        is_ = is_[:: max(1, len(is_) // max_starts)]; oos = oos[:: max(1, len(oos) // max_starts)]
    return is_, oos


def run_many(P, spec, rules, starts, risk_pct, **kw):
    """Como evaluate(), pero sobre índices de inicio ya elegidos y con arrays ya preparados."""
    res = [run_attempt(P, spec, rules, int(i), risk_pct=risk_pct, **kw) for i in starts]
    r = summarize(res, rules); r.pop('attempts'); r['fail_pct'] = round(r['fail_daily_pct'] + r['fail_max_pct'], 1)
    return r


def trade_stats(P, spec, leverage=None):
    """Estadística por operación (win rate, R medio, payoff) simulando cada señal aislada con la misma lógica de
    ejecución del simulador (spread/2+slip a la entrada, SL con slip, SL prioritario en la vela, cierre horario,
    trailing). Devuelve DataFrame con una fila por operación: fecha, dir, r (P/L en múltiplos del riesgo)."""
    o, h, l, c, hourv, dowv = P['o'], P['h'], P['l'], P['c'], P['hour'], P['dow']
    d_arr, sl_arr, tp_arr, exh_arr, trail_arr, atr_arr = P['dir'], P['sl'], P['tp'], P['exit_hour'], P['trail'], P['atr']
    spread, slip = spec.spread, spec.slip; n = len(o); rows = []
    sig_i = np.where((d_arr != 0) & ~np.isnan(sl_arr) & (sl_arr > 0))[0]
    i = 0; last_close = -1
    for k in sig_i:
        if k <= last_close: continue            # posición aún abierta (dejar correr): sin nueva entrada
        pos = 1 if d_arr[k] > 0 else -1
        entry = o[k] + pos * (spread / 2 + slip); sl = sl_arr[k]; sl_px = entry - pos * sl
        tp_px = entry + pos * tp_arr[k] if not np.isnan(tp_arr[k]) else np.nan
        tm = trail_arr[k]; r = None; j = k
        while j < n:
            hit_sl = (l[j] <= sl_px) if pos > 0 else (h[j] >= sl_px)
            hit_tp = (not np.isnan(tp_px)) and ((h[j] >= tp_px) if pos > 0 else (l[j] <= tp_px))
            if hit_sl: r = pos * (sl_px - pos * slip - entry) / sl; break
            if hit_tp: r = pos * (tp_px - entry) / sl; break
            if tm and not np.isnan(atr_arr[j]) and atr_arr[j] > 0:
                new_sl = (c[j] - tm * atr_arr[j]) if pos > 0 else (c[j] + tm * atr_arr[j])
                sl_px = max(sl_px, new_sl) if pos > 0 else min(sl_px, new_sl)
            exh = exh_arr[j]
            if (exh >= 0 and hourv[j] >= exh) or (j > k and d_arr[j] == -pos):
                r = pos * (c[j] - entry) / sl; break
            j += 1
        if r is None: r = pos * (c[n - 1] - entry) / sl; j = n - 1
        # comisión: en múltiplos de R = comm_por_lote / (sl × usd_por_unidad_por_lote)
        upu = spec.usd_per_unit_per_lot if spec.quote_is_usd else spec.usd_per_unit_per_lot / entry
        r -= spec.comm_rt_per_lot / (sl * upu)
        rows.append((P['idx'][k], pos, r, j - k)); last_close = j
    return pd.DataFrame(rows, columns=['dt', 'dir', 'r', 'bars'])


def summarize_trades(t):
    if len(t) == 0: return dict(n=0)
    w = t.r > 0
    return dict(n=int(len(t)), win_rate=round(float(w.mean()), 3), avg_win_r=round(float(t.r[w].mean()), 3) if w.any() else 0.0,
                avg_loss_r=round(float(t.r[~w].mean()), 3) if (~w).any() else 0.0, expectancy_r=round(float(t.r.mean()), 4),
                long_share=round(float((t.dir > 0).mean()), 3))


def wins_needed(win_rate, avg_win_r, risk_pct, target_pct=10.0):
    """Cuántas ganadoras seguidas hacen falta para +target y P(racha) = win_rate^n (sin compounding)."""
    n = int(np.ceil(target_pct / (risk_pct * avg_win_r))) if avg_win_r > 0 else None
    return n, (round(win_rate ** n, 4) if n else 0.0)


def mc_pass(win_rate, avg_win_r, avg_loss_r, risk_pct, target=10.0, max_loss=6.0, daily_loss=3.0, trades_per_day=1,
            n_days=7, trailing=False, sims=20000, seed=0):
    """Monte Carlo sencillo con operaciones i.i.d. (Bernoulli con win_rate) y tamaño fijo en % del inicial.
    Devuelve P(pasar), P(quemar) en n_days de trading (aprox. 5 por semana)."""
    rng = np.random.default_rng(seed); n_tr = int(n_days * 5 / 7) * trades_per_day
    outcomes = np.where(rng.random((sims, n_tr)) < win_rate, avg_win_r, avg_loss_r) * risk_pct
    eq = np.cumsum(outcomes, axis=1); hwm = np.maximum.accumulate(np.maximum(eq, 0), axis=1)
    dd = (hwm - eq) if trailing else -eq
    burned = dd >= max_loss
    if trades_per_day > 1:
        daily = outcomes.reshape(sims, -1, trades_per_day).sum(axis=2)
        burned |= np.repeat(daily <= -daily_loss, trades_per_day, axis=1)
    else:
        burned |= outcomes <= -daily_loss
    passed = eq >= target
    t_pass = np.where(passed.any(1), passed.argmax(1), 10 ** 6); t_burn = np.where(burned.any(1), burned.argmax(1), 10 ** 6)
    return round(float((t_pass < t_burn).mean() * 100), 1), round(float((t_burn < t_pass).mean() * 100), 1)
