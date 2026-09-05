"""Simulador de rejilla/martingala estilo "copy Maderna" para pares FX en H1.

Lógica (inferida de 1.653 operaciones reales de la cuenta copy, may-sep 2026):
- En la apertura de cada hora, si no hay cesta abierta en una dirección, abre 1 posición de `base_lot` en esa dirección
  (el copy abre ambos lados; `mode` controla si se opera solo con tendencia).
- Take profit individual/cesta: precio medio ponderado ± `tp_pips` (el copy: ~6 pips brutos, 0,53 USD netos por 0,01).
- Sin stop loss individual. Si el precio va en contra `step_pips` desde el último nivel, añade otra posición con lote
  `last_lot * lot_mult` (el copy: mediana 2,0; a veces 1,5), hasta `max_levels`.
- Opcional (mejoras): `basket_sl_usd` cierra toda la cesta si su flotante < -X USD; `max_levels` acota niveles;
  `trend_filter` opera solo a favor de la EMA; `hours` restringe la sesión; `step_atr_mult` hace el paso proporcional al ATR.
- Costes: spread `spread_pips` (se paga al abrir), comisión `comm_per_lot` USD por lote ida y vuelta, swap por noche.
- Margen: apalancamiento `leverage`; stop-out si equity < 50 % del margen requerido (se cierra todo = ruina parcial).

Precios: DataFrame H1 con columnas open, high, low, close (float, p.ej. 1.10234), índice datetime.
"""
from __future__ import annotations
import numpy as np, pandas as pd

PIP = 1e-4
CONTRACT = 100000


def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().values


def atr(df, n=14):
    tr = np.maximum(df.high - df.low, np.maximum(abs(df.high - df.close.shift()), abs(df.low - df.close.shift())))
    return tr.rolling(n).mean().values


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
        # swap a medianoche
        if t.date() != last_day:
            for d in (+1, -1):
                balance += swap_per_lot_night * basket_lots(d)
            last_day = t.date()
        price = o[i]
        # 1) gestión intravela de cestas existentes: TP por avg ± tp, SL por USD, niveles nuevos
        for d in (+1, -1):
            if not baskets[d]:
                continue
            lots = basket_lots(d); avg = sum(p * L for p, L in baskets[d]) / lots
            tp_px = avg + d * tp_pips * PIP
            hit_tp = (h[i] >= tp_px) if d > 0 else (l[i] <= tp_px)
            worst = l[i] if d > 0 else h[i]
            fl_worst = basket_float(d, worst)
            # stop-loss de cesta (conservador: se evalúa antes que el TP)
            if basket_sl_usd is not None and fl_worst < -basket_sl_usd:
                close_basket(i, d, worst, 'sl'); continue
            # stop-out por margen
            margin = lots * CONTRACT * price / leverage
            eq_worst = balance + fl_worst + basket_float(-d, worst) if baskets[-d] else balance + fl_worst
            if eq_worst < 0.5 * margin:
                close_basket(i, d, worst, 'stopout'); stopouts += 1; continue
            if hit_tp:
                close_basket(i, d, tp_px, 'tp'); continue
            # nuevo nivel si el precio fue en contra step desde el último nivel
            step = (step_atr_mult * at[i] / PIP if step_atr_mult and not np.isnan(at[i]) else step_pips)
            trigger = last_level_px[d] - d * step * PIP
            if add_at_open_only:   # el copy añade niveles en la apertura de la hora, no intravela
                hit_lvl = (price <= trigger) if d > 0 else (price >= trigger); fill_px = price
            else:
                hit_lvl = (l[i] <= trigger) if d > 0 else (h[i] >= trigger); fill_px = trigger
            if hit_lvl and len(baskets[d]) < max_levels:
                # lote del nivel k = base * mult^(k-1) (calculado sin redondeos acumulados; el primer nivel se repite si first_level_repeat)
                k = len(baskets[d])
                exp = max(0, k - 1) if first_level_repeat else k
                open_pos(d, fill_px, baskets[d][0][1] * (lot_mult ** exp))
        # 2) nuevas cestas en la apertura de la hora
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
                open_pos(d, price, lot)
        fl = basket_float(+1, c[i]) + basket_float(-1, c[i])
        eq_curve[i] = balance + fl; bal_curve[i] = balance; float_curve[i] = fl
        lots_curve[i] = basket_lots(+1) + basket_lots(-1)
        if balance + min(basket_float(+1, l[i]) + basket_float(-1, h[i]), 0) <= 0:
            # ruina total
            eq_curve[i:] = 0; bal_curve[i:] = 0; float_curve[i:] = 0; lots_curve[i:] = 0
            return _result(idx, eq_curve, bal_curve, float_curve, lots_curve, closed, capital, stopouts, sl_hits, tp_hits, ruined_at=idx[i])
    return _result(idx, eq_curve, bal_curve, float_curve, lots_curve, closed, capital, stopouts, sl_hits, tp_hits)


def _result(idx, eq, bal, fl, lots, closed, capital, stopouts, sl_hits, tp_hits, ruined_at=None):
    eq = pd.Series(eq, index=idx); bal = pd.Series(bal, index=idx); fl = pd.Series(fl, index=idx); lots = pd.Series(lots, index=idx)
    hours = (idx[-1] - idx[0]).total_seconds() / 3600
    dd = eq.cummax() - eq
    dd_pct = (dd / eq.cummax().replace(0, np.nan)).max()
    yearly = eq.resample('YE').last().diff(); yearly.iloc[0] = eq.resample('YE').last().iloc[0] - capital
    cl = pd.DataFrame(closed, columns=['time', 'pnl', 'n', 'reason']) if closed else pd.DataFrame(columns=['time', 'pnl', 'n', 'reason'])
    return dict(final_equity=round(float(eq.iloc[-1]), 2), net=round(float(eq.iloc[-1] - capital), 2), usd_per_hour=round(float((eq.iloc[-1] - capital) / hours), 4),
                usd_per_hour_first_year=round(float((eq[eq.index < idx[0] + pd.Timedelta(days=365)].iloc[-1] - capital) / (365 * 24)), 4),
                max_dd_usd=round(float(dd.max()), 2), max_dd_pct=round(100 * float(dd_pct), 1), min_equity=round(float(eq.min()), 2),
                ruined_at=str(ruined_at) if ruined_at is not None else None, stopouts=stopouts, baskets_closed=len(cl),
                sl_hits=sl_hits, tp_hits=tp_hits, max_lots=round(float(lots.max()), 2), max_positions=int(cl.n.max()) if len(cl) else 0,
                worst_basket=round(float(cl.pnl.min()), 2) if len(cl) else 0, yearly={str(k.year): round(float(v), 2) for k, v in yearly.items()},
                equity=eq)


def load_fx(symbol, tf='h1', path='trading/data/fx'):
    d = pd.read_csv(f'{path}/{symbol}{tf}.csv', parse_dates=['Date']).set_index('Date')
    d = d[['open', 'high', 'low', 'close']] / 1e5
    d.index.name = 'dt'
    return d
