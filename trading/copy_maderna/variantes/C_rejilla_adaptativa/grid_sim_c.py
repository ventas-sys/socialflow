"""Variante C - REJILLA ADAPTATIVA. Copia de trading/copy_maderna/grid_sim.simulate() con tres cambios:

1. `max_basket_hours` (stop temporal): en la apertura de cada hora, si la cesta lleva abierta más de N horas reales
   (timestamp actual - timestamp de la primera posición), se cierra toda la cesta al precio de apertura (reason='time').
2. `vol_filter` (filtro de volatilidad): no se abren cestas NUEVAS si ATR14 de la vela anterior > percentil 90 de los
   últimos 500 valores de ATR14 (rolling, sin lookahead). Sí se siguen añadiendo niveles a cestas ya abiertas.
3. El ATR usado para el paso (`step_atr_mult`) y para el filtro es el de la vela ANTERIOR (at[i-1]); el original usa at[i],
   que incluye el high/low de la vela que aún no ha cerrado (lookahead leve). Aquí se evita.

El resto de la lógica (TP por precio medio, SL de cesta en USD, stop-out por margen, costes, swap, risk_scale, sesión)
es idéntica al original. grid_sim.py NO se modifica.
"""
from __future__ import annotations
import numpy as np, pandas as pd
from trading.copy_maderna.grid_sim import ema, atr, PIP, CONTRACT, load_fx  # noqa: F401  (reutilizamos helpers)


def simulate_c(df: pd.DataFrame, capital=1000.0, base_lot=0.01, tp_pips=6.0, step_pips=19.0, lot_mult=2.0, max_levels=12,
               basket_sl_usd=None, trend_filter=None, hours=None, spread_pips=1.0, comm_per_lot=7.0, swap_per_lot_night=-3.0,
               leverage=200.0, step_atr_mult=None, min_lot=0.01, lot_cap=None, both_sides=True, risk_scale=False,
               add_at_open_only=True, first_level_repeat=True,
               max_basket_hours=None, vol_filter=False, vol_window=500, vol_pct=0.90, verbose=False):
    o, h, l, c = df.open.values, df.high.values, df.low.values, df.close.values
    idx = df.index
    n = len(df)
    em = ema(c, trend_filter) if trend_filter else None
    need_atr = bool(step_atr_mult) or vol_filter
    at = atr(df, 14) if need_atr else None
    # ATR de la vela anterior (sin lookahead)
    at_prev = np.concatenate([[np.nan], at[:-1]]) if need_atr else None
    q90_prev = None
    if vol_filter:
        q90 = pd.Series(at).rolling(vol_window).quantile(vol_pct).values
        q90_prev = np.concatenate([[np.nan], q90[:-1]])
    balance = capital
    baskets = {+1: [], -1: []}   # lista de (price, lots)
    last_level_px = {+1: None, -1: None}
    open_time = {+1: None, -1: None}
    eq_curve = np.empty(n); bal_curve = np.empty(n); float_curve = np.empty(n); lots_curve = np.empty(n)
    closed = []  # (time, pnl, n_positions, reason)
    stopouts = 0; sl_hits = 0; tp_hits = 0; time_hits = 0; vol_blocked = 0
    last_day = idx[0].date()
    max_age = pd.Timedelta(hours=max_basket_hours) if max_basket_hours else None

    def basket_float(d, price):
        return sum(d * (price - p) * L * CONTRACT for p, L in baskets[d])

    def basket_lots(d):
        return sum(L for _, L in baskets[d])

    def close_basket(i, d, price, reason):
        nonlocal balance, tp_hits, sl_hits, time_hits
        pnl = basket_float(d, price) - comm_per_lot * basket_lots(d) / 2  # la mitad de la comisión ya se cobró al abrir
        balance += pnl
        closed.append((idx[i], pnl, len(baskets[d]), reason))
        if reason == 'tp': tp_hits += 1
        elif reason == 'sl': sl_hits += 1
        elif reason == 'time': time_hits += 1
        baskets[d] = []; last_level_px[d] = None; open_time[d] = None

    def open_pos(d, price, lots, t):
        nonlocal balance
        lots = max(min_lot, round(lots, 2))
        if lot_cap: lots = min(lots, lot_cap)
        fill = price + d * spread_pips * PIP
        balance -= comm_per_lot * lots / 2
        if not baskets[d]: open_time[d] = t
        baskets[d].append((fill, lots)); last_level_px[d] = fill

    for i in range(n):
        t = idx[i]
        if t.date() != last_day:
            for d in (+1, -1):
                balance += swap_per_lot_night * basket_lots(d)
            last_day = t.date()
        price = o[i]
        # 0) stop temporal: se evalúa en la apertura de la hora, antes de nada
        if max_age is not None:
            for d in (+1, -1):
                if baskets[d] and (t - open_time[d]) > max_age:
                    close_basket(i, d, price, 'time')
        # 1) gestión intravela de cestas existentes: TP por avg ± tp, SL por USD, niveles nuevos
        for d in (+1, -1):
            if not baskets[d]:
                continue
            lots = basket_lots(d); avg = sum(p * L for p, L in baskets[d]) / lots
            tp_px = avg + d * tp_pips * PIP
            hit_tp = (h[i] >= tp_px) if d > 0 else (l[i] <= tp_px)
            worst = l[i] if d > 0 else h[i]
            fl_worst = basket_float(d, worst)
            if basket_sl_usd is not None and fl_worst < -basket_sl_usd:
                close_basket(i, d, worst, 'sl'); continue
            margin = lots * CONTRACT * price / leverage
            eq_worst = balance + fl_worst + basket_float(-d, worst) if baskets[-d] else balance + fl_worst
            if eq_worst < 0.5 * margin:
                close_basket(i, d, worst, 'stopout'); stopouts += 1; continue
            if hit_tp:
                close_basket(i, d, tp_px, 'tp'); continue
            step = (step_atr_mult * at_prev[i] / PIP if step_atr_mult and not np.isnan(at_prev[i]) else step_pips)
            trigger = last_level_px[d] - d * step * PIP
            if add_at_open_only:
                hit_lvl = (price <= trigger) if d > 0 else (price >= trigger); fill_px = price
            else:
                hit_lvl = (l[i] <= trigger) if d > 0 else (h[i] >= trigger); fill_px = trigger
            if hit_lvl and len(baskets[d]) < max_levels:
                last_lot = baskets[d][-1][1]
                mult = 1.0 if (first_level_repeat and len(baskets[d]) == 1) else lot_mult
                open_pos(d, fill_px, last_lot * mult, t)
        # 2) nuevas cestas en la apertura de la hora
        allow_new = hours is None or t.hour in hours
        if allow_new and vol_filter:
            if np.isnan(q90_prev[i]) or np.isnan(at_prev[i]):
                allow_new = False
            elif at_prev[i] > q90_prev[i]:
                allow_new = False; vol_blocked += 1
        if allow_new:
            for d in (+1, -1):
                if baskets[d]:
                    continue
                if not both_sides and d < 0 and not trend_filter:
                    continue
                if trend_filter is not None:
                    if d > 0 and not (c[i - 1] > em[i - 1] if i > 0 else False): continue
                    if d < 0 and not (c[i - 1] < em[i - 1] if i > 0 else False): continue
                lot = base_lot * (balance / capital if risk_scale else 1.0)
                open_pos(d, price, lot, t)
        fl = basket_float(+1, c[i]) + basket_float(-1, c[i])
        eq_curve[i] = balance + fl; bal_curve[i] = balance; float_curve[i] = fl
        lots_curve[i] = basket_lots(+1) + basket_lots(-1)
        if balance + min(basket_float(+1, l[i]) + basket_float(-1, h[i]), 0) <= 0:
            eq_curve[i:] = 0; bal_curve[i:] = 0; float_curve[i:] = 0; lots_curve[i:] = 0
            return _result_c(idx, eq_curve, bal_curve, float_curve, lots_curve, closed, capital, stopouts, sl_hits, tp_hits, time_hits, vol_blocked, ruined_at=idx[i])
    return _result_c(idx, eq_curve, bal_curve, float_curve, lots_curve, closed, capital, stopouts, sl_hits, tp_hits, time_hits, vol_blocked)


def _result_c(idx, eq, bal, fl, lots, closed, capital, stopouts, sl_hits, tp_hits, time_hits, vol_blocked, ruined_at=None):
    eq = pd.Series(eq, index=idx); lots = pd.Series(lots, index=idx)
    hours = (idx[-1] - idx[0]).total_seconds() / 3600
    dd = eq.cummax() - eq
    dd_pct = (dd / eq.cummax().replace(0, np.nan)).max()
    yearly = eq.resample('YE').last().diff(); yearly.iloc[0] = eq.resample('YE').last().iloc[0] - capital
    cl = pd.DataFrame(closed, columns=['time', 'pnl', 'n', 'reason']) if closed else pd.DataFrame(columns=['time', 'pnl', 'n', 'reason'])
    return dict(final_equity=round(float(eq.iloc[-1]), 2), net=round(float(eq.iloc[-1] - capital), 2),
                usd_per_hour=round(float((eq.iloc[-1] - capital) / hours), 4),
                max_dd_usd=round(float(dd.max()), 2), max_dd_pct=round(100 * float(dd_pct), 1), min_equity=round(float(eq.min()), 2),
                ruined_at=str(ruined_at) if ruined_at is not None else None, stopouts=stopouts, baskets_closed=len(cl),
                sl_hits=sl_hits, tp_hits=tp_hits, time_hits=time_hits, vol_blocked_hours=vol_blocked,
                max_lots=round(float(lots.max()), 2), max_positions=int(cl.n.max()) if len(cl) else 0,
                worst_basket=round(float(cl.pnl.min()), 2) if len(cl) else 0,
                yearly={str(k.year): round(float(v), 2) for k, v in yearly.items()}, equity=eq, closed=cl)
