"""COPIA de challenge_sim.run_attempt / evaluate (enfoque B) con UN solo cambio, marcado con "CAMBIO (sim_b)":
relleno de órdenes stop OCO cuando la vela abre más allá del nivel (gap o filtro que se activa con el precio ya
fuera del rango): el original rellena al nivel del rango (precio que ya no existe → optimista); esta copia rellena
a la apertura de la vela (+ spread + slip). Es estrictamente igual o más conservadora que el original.
El resto (reglas de la firma, sizing, SL/TP, trailing, regla de consistencia) es idéntico. challenge_sim.py no se toca.
"""
import numpy as np, pandas as pd
from dataclasses import replace
from trading.fondeo.challenge_sim import Spec, Rules, Attempt, prep, summarize


def run_attempt(P: dict, spec: Spec, rules: Rules, start_i: int, risk_pct=2.0, capital=100_000.0,
                max_trades_day=1, day_stop_pct=None, risk_on_balance=False, max_calendar_days=None,
                stop_after_target=True, max_lots=None) -> Attempt:
    """Ejecuta el challenge desde la vela start_i. risk_pct = % del balance INICIAL (o del actual si risk_on_balance)
    arriesgado por operación al stop. day_stop_pct = deja de operar el día si el P/L diario ≤ -X % (autoimpuesto)."""
    o, h, l, c, ts, dayv, hourv, dowv = P['o'], P['h'], P['l'], P['c'], P['ts'], P['day'], P['hour'], P['dow']
    d_arr, sl_arr, tp_arr, stop_arr, exh_arr, trail_arr, atr_arr, width_arr = P['dir'], P['sl'], P['tp'], P['stop_px'], P['exit_hour'], P['trail'], P['atr'], P['width']
    exit_friday = P['exit_friday']
    max_days = max_calendar_days or rules.max_days
    t0 = ts[start_i]; t_end = t0 + max_days * 86400
    n = len(o)
    balance = capital; equity_hwm = capital
    pos = 0; entry = 0.0; lots = 0.0; sl_px = 0.0; tp_px = np.nan; trail_mult = 0.0
    day = dayv[start_i]; day_ref = capital; day_hi_eq = capital; day_lo_eq = capital
    trades = 0; trades_today = 0; trading_days = 0; last_trade_day = -1
    max_dd = 0.0; worst_day = 0.0; best_day = 0.0
    target_bal = capital * (1 + rules.target); target_day = -1
    daily_limit = capital * rules.daily_loss; max_limit = capital * rules.max_loss
    upl = spec.usd_per_unit_per_lot; quote_usd = spec.quote_is_usd; spread, slip, comm = spec.spread, spec.slip, spec.comm_rt_per_lot
    lot_cap = min(spec.max_lot, max_lots or spec.max_lot)
    result = 'timeout'; decided_i = -1
    day_start_bal = capital; pos_days = []  # P/L cerrado de los días positivos (regla de consistencia)
    if rules.leverage: spec = replace(spec, leverage=rules.leverage)

    def upu(px):
        return upl if quote_usd else upl / px

    i = start_i
    while i < n and ts[i] < t_end:
        dn = dayv[i]
        if dn != day:
            eq_now = balance + (pos * (o[i] - entry) * lots * upu(o[i]) if pos else 0.0)
            worst_day = min(worst_day, (day_lo_eq - day_ref) / capital); best_day = max(best_day, (day_hi_eq - day_ref) / capital)
            if balance - day_start_bal > 0: pos_days.append(balance - day_start_bal)
            day_start_bal = balance
            day = dn; day_ref = max(balance, eq_now) if rules.daily_ref_equity else balance
            day_hi_eq = day_lo_eq = day_ref; trades_today = 0
        # ---- 1) posición abierta: reglas con flotante, SL/TP, trailing, cierres horarios
        if pos:
            worst = l[i] if pos > 0 else h[i]; best = h[i] if pos > 0 else l[i]
            hit_sl = (l[i] <= sl_px) if pos > 0 else (h[i] >= sl_px)
            hit_tp = (not np.isnan(tp_px)) and ((h[i] >= tp_px) if pos > 0 else (l[i] <= tp_px))
            fill_sl = sl_px - pos * slip
            px_worst = fill_sl if hit_sl else worst
            eq_worst = balance + pos * (px_worst - entry) * lots * upu(px_worst)
            eq_best = balance + pos * (best - entry) * lots * upu(best)
            day_lo_eq = min(day_lo_eq, eq_worst); day_hi_eq = max(day_hi_eq, eq_best); equity_hwm = max(equity_hwm, eq_best)
            max_dd = max(max_dd, (equity_hwm - eq_worst) / capital)
            floor = (equity_hwm - max_limit) if rules.trailing else (capital - max_limit)
            if day_ref - eq_worst >= daily_limit or eq_worst <= floor:
                balance = eq_worst - comm * lots; pos = 0
                result = 'fail_daily' if day_ref - eq_worst >= daily_limit else 'fail_max'; decided_i = i; break
            if hit_sl:      # conservador: si SL y TP caen en la misma vela se asume SL
                balance += pos * (fill_sl - entry) * lots * upu(fill_sl) - comm * lots; pos = 0
            elif hit_tp:
                balance += pos * (tp_px - entry) * lots * upu(tp_px) - comm * lots; pos = 0
            else:
                if trail_mult and not np.isnan(atr_arr[i]) and atr_arr[i] > 0:
                    new_sl = (c[i] - trail_mult * atr_arr[i]) if pos > 0 else (c[i] + trail_mult * atr_arr[i])
                    sl_px = max(sl_px, new_sl) if pos > 0 else min(sl_px, new_sl)
                exh = exh_arr[i]
                if (exh >= 0 and hourv[i] >= exh) or (exit_friday and dowv[i] == 4 and hourv[i] >= 22) or (d_arr[i] == -pos):
                    balance += pos * (c[i] - entry) * lots * upu(c[i]) - comm * lots; pos = 0
        # ---- 2) nueva entrada
        if not pos and balance < target_bal and target_day < 0:
            d = d_arr[i]
            day_stopped = day_stop_pct is not None and (day_ref - balance) >= capital * day_stop_pct / 100.0
            if d != 0 and not day_stopped and trades_today < max_trades_day and not np.isnan(sl_arr[i]) and sl_arr[i] > 0:
                px = np.nan; both = False
                if d == 2:  # OCO: buy stop en hi, sell stop en lo = hi - width
                    hi_px = stop_arr[i]; lo_px = hi_px - width_arr[i]
                    touch_hi = h[i] >= hi_px; touch_lo = l[i] <= lo_px
                    # CAMBIO (sim_b): si la vela ABRE más allá del nivel del stop, la orden se ejecuta a la apertura
                    # (peor precio), no al nivel; el original rellena siempre al nivel aunque el precio ya esté lejos.
                    if touch_hi and not touch_lo: pos = 1; px = max(hi_px, o[i])
                    elif touch_lo and not touch_hi: pos = -1; px = min(lo_px, o[i])
                    elif touch_hi and touch_lo:
                        pos = 1 if (o[i] - lo_px) >= (hi_px - o[i]) else -1; px = max(hi_px, o[i]) if pos > 0 else min(lo_px, o[i]); both = True
                    if pos: entry = px + pos * (spread + slip)
                else:
                    pos = 1 if d > 0 else -1; entry = o[i] + pos * (spread / 2 + slip)
                if pos:
                    risk_usd = (balance if risk_on_balance else capital) * risk_pct / 100.0
                    L = risk_usd / (sl_arr[i] * upu(entry))
                    margin_cap = balance * spec.leverage / (spec.contract * (entry if quote_usd else 1.0))
                    lots = np.floor(min(L, margin_cap, lot_cap) / spec.min_lot) * spec.min_lot
                    if lots <= 0:
                        pos = 0
                    else:
                        sl_px = entry - pos * sl_arr[i]; tp_px = entry + pos * tp_arr[i] if not np.isnan(tp_arr[i]) else np.nan
                        trail_mult = trail_arr[i]; trades += 1; trades_today += 1
                        if dn != last_trade_day: trading_days += 1; last_trade_day = dn
                        # la misma vela puede tocar el stop (o ambos lados en OCO)
                        if both or ((l[i] <= sl_px) if pos > 0 else (h[i] >= sl_px)):
                            fill_sl = sl_px - pos * slip
                            eq_worst = balance + pos * (fill_sl - entry) * lots * upu(fill_sl)
                            day_lo_eq = min(day_lo_eq, eq_worst); max_dd = max(max_dd, (equity_hwm - eq_worst) / capital)
                            balance = eq_worst - comm * lots; pos = 0
                            if day_ref - balance >= daily_limit: result = 'fail_daily'; decided_i = i; break
                            if balance <= (capital - max_limit): result = 'fail_max'; decided_i = i; break
        # ---- 3) objetivo (balance cerrado, o equity si la firma lo permite)
        eq_close = balance + (pos * (c[i] - entry) * lots * upu(c[i]) if pos else 0.0)
        day_hi_eq = max(day_hi_eq, eq_close); day_lo_eq = min(day_lo_eq, eq_close)
        if target_day < 0 and (balance >= target_bal or (rules.target_on_equity and eq_close >= target_bal)):
            target_day = dn
            if pos and stop_after_target:
                balance += pos * (c[i] - entry) * lots * upu(c[i]) - comm * lots; pos = 0
            # días mínimos: se rellenan con operaciones de 0,01 lotes (coste despreciable)
            days_needed = max(rules.min_trading_days - trading_days, 0)
            t_pass = ts[i] + int(days_needed * 1.4 * 86400)
            result = 'pass' if t_pass <= t_end else 'timeout'
            if result == 'pass' and rules.best_day is not None:
                pd_all = pos_days + ([balance - day_start_bal] if balance - day_start_bal > 0 else [])
                if pd_all and max(pd_all) > rules.best_day * sum(pd_all) + 1e-9:
                    result = 'pass_inconsistent'   # objetivo alcanzado pero la regla de consistencia bloquea el pase/payout
            decided_i = i; break
        i += 1
    if decided_i < 0: decided_i = min(i, n - 1)
    if pos:
        balance += pos * (c[decided_i] - entry) * lots * upu(c[decided_i]) - comm * lots; pos = 0
    worst_day = min(worst_day, (day_lo_eq - day_ref) / capital); best_day = max(best_day, (day_hi_eq - day_ref) / capital)
    days = (ts[decided_i] - t0) / 86400
    if result == 'pass':
        days = max(days, rules.min_trading_days * 1.4)
    return Attempt(P['idx'][start_i], result, round(float(days), 2), round(balance, 2), trades, trading_days, round(max_dd, 4), round(worst_day, 4), round(best_day, 4))


def evaluate(bars, sig, spec, rules, risk_pct=2.0, starts='weekdays', start_hour=1, max_starts=None, **kw) -> dict:
    """Nota: los datos FX/oro están en hora del servidor (GMT+2/+3): el día empieza a la 01:00, Londres abre ~10:00, NY ~15:30."""
    """Ejecuta un intento por cada día de inicio (lunes a viernes a start_hour) y agrega resultados."""
    idx = bars.index
    cand = np.where((idx.hour == start_hour) & (idx.minute == 0) & (idx.dayofweek < 5))[0]
    if starts == 'mondays':
        cand = cand[idx[cand].dayofweek == 0]
    if max_starts: cand = cand[:: max(1, len(cand) // max_starts)]
    P = prep(bars, sig)
    res = [run_attempt(P, spec, rules, int(i), risk_pct=risk_pct, **kw) for i in cand]
    return summarize(res, rules)


