"""Copia de trading/copy_maderna/grid_sim.simulate() con UNA modificación (variante A, martingala acotada).

Motivo: en el simulador original el lote del nivel k se calcula como `last_lot * lot_mult` y luego se redondea a 0,01.
Con base_lot = 0,01 eso hace que 0,01·1,2 = 0,012 → 0,01, 0,01·1,3 → 0,01 y 0,01·1,5 = 0,015 → 0,01 (float), es decir, la
cadena nunca crece y lot_mult ∈ {1,0; 1,2; 1,3; 1,5} produce resultados IDÉNTICOS (comprobado: 768 combinaciones iguales).
Aquí el lote del nivel se calcula desde la cadena sin redondear: lots_k = base_lot · lot_mult^(k-1) (k = nº de posiciones ya
abiertas en la cesta; con first_level_repeat el 2º nivel repite el lote base) y SOLO ENTONCES se redondea a 0,01.
Ejemplo mult 1,5 y 6 niveles: 0,01 / 0,01 / 0,01 / 0,02 / 0,03 / 0,05 (original: 0,01 ×6).  Todo lo demás es idéntico.
"""
from __future__ import annotations
import numpy as np, pandas as pd
from trading.copy_maderna.grid_sim import ema, atr, _result, load_fx, PIP, CONTRACT  # noqa: F401


def simulate(df: pd.DataFrame, capital=1000.0, base_lot=0.01, tp_pips=6.0, step_pips=19.0, lot_mult=2.0, max_levels=12,
             basket_sl_usd=None, trend_filter=None, hours=None, spread_pips=1.0, comm_per_lot=7.0, swap_per_lot_night=-3.0,
             leverage=200.0, step_atr_mult=None, min_lot=0.01, lot_cap=None, both_sides=True, risk_scale=False, add_at_open_only=True, first_level_repeat=True, verbose=False):
    o, h, l, c = df.open.values, df.high.values, df.low.values, df.close.values
    idx = df.index
    n = len(df)
    em = ema(c, trend_filter) if trend_filter else None
    at = atr(df, 14) if step_atr_mult else None
    balance = capital
    baskets = {+1: [], -1: []}   # lista de (price, lots)
    last_level_px = {+1: None, -1: None}
    base_lot_of = {+1: base_lot, -1: base_lot}   # lote base (sin redondear) con el que se abrió la cesta
    eq_curve = np.empty(n); bal_curve = np.empty(n); float_curve = np.empty(n); lots_curve = np.empty(n)
    closed = []  # (time, pnl, n_positions, reason)
    stopouts = 0; sl_hits = 0; tp_hits = 0
    last_day = idx[0].date()

    def basket_float(d, price):
        return sum(d * (price - p) * L * CONTRACT for p, L in baskets[d])

    def basket_lots(d):
        return sum(L for _, L in baskets[d])

    def close_basket(i, d, price, reason):
        nonlocal balance, tp_hits, sl_hits
        pnl = basket_float(d, price) - comm_per_lot * basket_lots(d) / 2  # la mitad de la comisión ya se cobró al abrir
        balance += pnl
        closed.append((idx[i], pnl, len(baskets[d]), reason))
        if reason == 'tp': tp_hits += 1
        elif reason == 'sl': sl_hits += 1
        baskets[d] = []; last_level_px[d] = None

    def open_pos(d, price, lots):
        nonlocal balance
        lots = max(min_lot, round(lots, 2))
        if lot_cap: lots = min(lots, lot_cap)
        fill = price + d * spread_pips * PIP
        balance -= comm_per_lot * lots / 2
        baskets[d].append((fill, lots)); last_level_px[d] = fill

    for i in range(n):
        t = idx[i]
        if t.date() != last_day:
            for d in (+1, -1):
                balance += swap_per_lot_night * basket_lots(d)
            last_day = t.date()
        price = o[i]
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
            step = (step_atr_mult * at[i] / PIP if step_atr_mult and not np.isnan(at[i]) else step_pips)
            trigger = last_level_px[d] - d * step * PIP
            if add_at_open_only:
                hit_lvl = (price <= trigger) if d > 0 else (price >= trigger); fill_px = price
            else:
                hit_lvl = (l[i] <= trigger) if d > 0 else (h[i] >= trigger); fill_px = trigger
            if hit_lvl and len(baskets[d]) < max_levels:
                k = len(baskets[d])                      # nº de posiciones ya abiertas
                expo = (k - 1) if first_level_repeat else k
                open_pos(d, fill_px, base_lot_of[d] * lot_mult ** max(expo, 0))   # <-- ÚNICO CAMBIO
        if hours is None or t.hour in hours:
            for d in (+1, -1):
                if baskets[d]:
                    continue
                if not both_sides and d < 0 and not trend_filter:
                    continue
                if trend_filter is not None:
                    if d > 0 and not (c[i - 1] > em[i - 1] if i > 0 else False): continue
                    if d < 0 and not (c[i - 1] < em[i - 1] if i > 0 else False): continue
                lot = base_lot * (balance / capital if risk_scale else 1.0)
                base_lot_of[d] = lot
                open_pos(d, price, lot)
        fl = basket_float(+1, c[i]) + basket_float(-1, c[i])
        eq_curve[i] = balance + fl; bal_curve[i] = balance; float_curve[i] = fl
        lots_curve[i] = basket_lots(+1) + basket_lots(-1)
        if balance + min(basket_float(+1, l[i]) + basket_float(-1, h[i]), 0) <= 0:
            eq_curve[i:] = 0; bal_curve[i:] = 0; float_curve[i:] = 0; lots_curve[i:] = 0
            return _result(idx, eq_curve, bal_curve, float_curve, lots_curve, closed, capital, stopouts, sl_hits, tp_hits, ruined_at=idx[i])
    return _result(idx, eq_curve, bal_curve, float_curve, lots_curve, closed, capital, stopouts, sl_hits, tp_hits)
