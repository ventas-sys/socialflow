"""Análisis de la cuenta copy (Pepperstone, estrategia copiada) a partir de trades.csv / balance_ops.csv.
Uso: python3 trading/copy_maderna/analyze_copy.py <dir_con_csv> <dir_salida>
Reconstruye precios horarios a partir de las propias entradas/salidas (el copy opera casi cada hora en punto)
y con ellos estima la equity flotante hora a hora y el drawdown real.
"""
import sys, os, json
import numpy as np, pandas as pd

SRC = sys.argv[1]; OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
tr = pd.read_csv(os.path.join(SRC, 'trades.csv'), parse_dates=['open_time', 'close_time'])
bl = pd.read_csv(os.path.join(SRC, 'balance_ops.csv'), parse_dates=['time'])
tr['pips'] = np.where(tr.type == 'buy', tr.close_price - tr.open_price, tr.open_price - tr.close_price) * 1e4
tr['dur_h'] = (tr.close_time - tr.open_time).dt.total_seconds() / 3600
tr['open_min'] = tr.open_time.dt.minute * 60 + tr.open_time.dt.second
R = {}

# ---- 1. Perfil de la estrategia
R['n_trades'] = len(tr); R['symbols'] = tr.symbol.value_counts().to_dict(); R['types'] = tr.type.value_counts().to_dict()
R['lots_dist'] = tr.lots.value_counts().sort_index().to_dict()
R['entries_at_hour_open_pct'] = round(100 * (tr.open_min <= 10).mean(), 1)
R['tp_pips_winners_median'] = round(float(tr[tr.net > 0].pips.median()), 1)
R['pnl_per_trade_median_winner'] = round(float(tr[tr.net > 0].net.median()), 2)
R['win_rate_pct'] = round(100 * (tr.net > 0).mean(), 1)
R['avg_win'] = round(float(tr[tr.net > 0].net.mean()), 2); R['avg_loss'] = round(float(tr[tr.net <= 0].net.mean()), 2)
R['max_loss_trade'] = round(float(tr.net.min()), 2); R['max_win_trade'] = round(float(tr.net.max()), 2)
R['duration_h_median'] = round(float(tr.dur_h.median()), 2); R['duration_h_max'] = round(float(tr.dur_h.max()), 1)
R['gross_pnl'] = round(float(tr.pnl.sum()), 2); R['commission'] = round(float(tr.commission.sum()), 2); R['swap'] = round(float(tr.swap.sum()), 2)
R['net_closed'] = round(float(tr.net.sum()), 2)
R['perf_fees'] = round(float(bl[bl.kind.str.startswith('PPF')].amount.sum()), 2)
R['withdrawals'] = round(float(bl[bl.kind.str.startswith('WD')].amount.sum()), 2)
R['deposit'] = 934.43

# ---- 2. Curva de balance diaria (P/L cerrado + comisiones de rendimiento)
daily = tr.groupby(tr.close_time.dt.date).net.sum()
fees = bl[bl.kind.str.startswith('PPF')].groupby(bl.time.dt.date).amount.sum()
days = pd.date_range(tr.open_time.min().date(), tr.close_time.max().date(), freq='D')
d = pd.DataFrame(index=days)
d['closed'] = pd.Series(daily.values, index=pd.to_datetime(daily.index)).reindex(days).fillna(0)
d['fees'] = pd.Series(fees.values, index=pd.to_datetime(fees.index)).reindex(days).fillna(0)
d['net'] = d.closed + d.fees
d['balance'] = R['deposit'] + d.net.cumsum()
n_days = len(d); R['calendar_days'] = n_days
R['net_after_fees'] = round(float(d.net.sum()), 2)
R['return_total_pct'] = round(100 * d.net.sum() / R['deposit'], 1)
R['return_per_day_pct_simple'] = round(100 * d.net.sum() / R['deposit'] / n_days, 3)
R['usd_per_hour'] = round(float(d.net.sum() / (n_days * 24)), 3)
R['usd_per_hour_on_1000'] = round(float(d.net.sum() / (n_days * 24) * 1000 / R['deposit']), 3)
R['positive_days_pct'] = round(100 * (d.net[d.closed != 0] > 0).mean(), 1)
R['worst_day'] = round(float(d.net.min()), 2); R['best_day'] = round(float(d.net.max()), 2)
m = d.net.groupby(d.index.to_period('M')).sum(); R['monthly_net'] = {str(k): round(float(v), 2) for k, v in m.items()}
d.to_csv(os.path.join(OUT, 'daily_balance.csv'))

# ---- 3. Reconstrucción de precios horarios desde las propias operaciones
px = {}
for s in tr.symbol.unique():
    t = tr[tr.symbol == s]
    pts = pd.concat([pd.Series(t.open_price.values, index=t.open_time), pd.Series(t.close_price.values, index=t.close_time)]).sort_index()
    pts = pts[~pts.index.duplicated()]
    hourly = pts.resample('1h').last().ffill()
    px[s] = hourly
    R[f'price_points_{s}'] = int(len(pts))
hours = pd.date_range(tr.open_time.min().floor('h'), tr.close_time.max().ceil('h'), freq='h')

# ---- 4. Equity flotante hora a hora
bal_events = pd.concat([pd.Series(tr.net.values, index=tr.close_time), pd.Series(bl[bl.kind.str.startswith('PPF')].amount.values, index=bl[bl.kind.str.startswith('PPF')].time)]).sort_index()
bal_hourly = R['deposit'] + bal_events.resample('1h').sum().reindex(hours).fillna(0).cumsum()
float_pnl = pd.Series(0.0, index=hours); lots_open = pd.Series(0.0, index=hours); notional = pd.Series(0.0, index=hours)
for _, r in tr.iterrows():
    mask = (hours >= r.open_time.floor('h') + pd.Timedelta(hours=1)) & (hours < r.close_time.floor('h'))
    if not mask.any(): continue
    p = px[r.symbol].reindex(hours[mask]).ffill().values
    sign = 1 if r.type == 'buy' else -1
    float_pnl[mask] += sign * (p - r.open_price) * r.lots * 100000
    lots_open[mask] += r.lots; notional[mask] += r.lots * 100000 * p
equity = bal_hourly + float_pnl
eq = pd.DataFrame(dict(balance=bal_hourly, float_pnl=float_pnl, equity=equity, lots_open=lots_open, notional=notional))
eq.to_csv(os.path.join(OUT, 'equity_hourly.csv'))
dd = eq.equity.cummax() - eq.equity
R['max_dd_usd_est'] = round(float(dd.max()), 2); R['max_dd_time'] = str(dd.idxmax())
R['max_dd_pct_of_equity_peak'] = round(100 * float(dd.max() / eq.equity.cummax()[dd.idxmax()]), 1)
R['min_equity_est'] = round(float(eq.equity.min()), 2)
R['max_float_loss_est'] = round(float(float_pnl.min()), 2); R['max_float_loss_time'] = str(float_pnl.idxmin())
R['max_lots_open'] = round(float(lots_open.max()), 2); R['max_notional_usd'] = round(float(notional.max()), 0)
R['max_leverage_est'] = round(float((notional / eq.equity).max()), 1)
# validación contra los snapshots de fin de mes (P/L flotante real)
snaps = pd.read_csv(os.path.join(SRC, 'open_snapshots.csv'))
R['float_snapshot_check'] = {s: dict(real=round(float(g.float_pnl.sum()), 2)) for s, g in snaps.groupby('snapshot')}
for s in R['float_snapshot_check']:
    t = pd.Timestamp(s + '-01' if len(s) == 7 else s) + (pd.offsets.MonthEnd(0) if len(s) == 7 else pd.Timedelta(0))
    t = t.normalize() + pd.Timedelta(hours=23)
    if t in float_pnl.index: R['float_snapshot_check'][s]['estimado'] = round(float(float_pnl[t]), 2)

# ---- 5. Cestas (grid): agrupar posiciones abiertas simultáneamente en el mismo símbolo y dirección
tr = tr.sort_values('open_time')
baskets = []
for (s, ty), g in tr.groupby(['symbol', 'type']):
    g = g.sort_values('open_time'); cur = []; end = None
    for _, r in g.iterrows():
        if cur and r.open_time > end:
            baskets.append((s, ty, cur)); cur = []; end = None
        cur.append(r); end = max(end, r.close_time) if end is not None else r.close_time
    if cur: baskets.append((s, ty, cur))
rows = []
for s, ty, rs in baskets:
    g = pd.DataFrame(rs)
    rows.append(dict(symbol=s, type=ty, start=g.open_time.min(), end=g.close_time.max(), n=len(g), lots_total=round(g.lots.sum(), 2), lots_max=g.lots.max(),
                     span_pips=round(abs(g.open_price.max() - g.open_price.min()) * 1e4, 1), net=round(g.net.sum(), 2), hours=round((g.close_time.max() - g.open_time.min()).total_seconds() / 3600, 1)))
bk = pd.DataFrame(rows).sort_values('start'); bk.to_csv(os.path.join(OUT, 'baskets.csv'), index=False)
big = bk[bk.n >= 6]
R['baskets_total'] = len(bk); R['baskets_6plus_positions'] = len(big)
R['biggest_baskets'] = big.sort_values('lots_total', ascending=False).head(6).astype(str).to_dict('records')
R['lot_multiplier_observed'] = 'secuencia típica 0.01,0.01,0.02,0.03,0.04,0.06,0.09,0.13 (x3 por triplicado) -> ratio ~1.45 (Fibonacci-like)'
json.dump(R, open(os.path.join(OUT, 'resumen_copy.json'), 'w'), indent=2, ensure_ascii=False, default=str)
print(json.dumps(R, indent=2, ensure_ascii=False, default=str))
