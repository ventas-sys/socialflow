"""Variantes de ruptura de rango intradía (enfoque B). No modifica challenge_sim.py: devuelve señales con el
formato estándar (dir=2 → OCO) y se apoya en las capacidades que run_attempt ya tiene:
  * trail>0 y tp=NaN → salida por trailing ATR(H1) sin TP;
  * max_trades_day=2 → tras un stop, la señal dir=2 sigue viva en la ventana y el ejecutor re-arma el OCO
    (segunda ruptura del día); con sl_frac=1.0 esto equivale a "stop-and-reverse" al lado opuesto.
Tipos de rango (hora del servidor GMT+2/3 en FX/oro; UTC en BTC):
  asian     : [1, 9)     ventana de entrada desde las 9   (ruptura del rango asiático)
  prelondon : [7, 10)    ventana desde las 10             (London breakout clásico)
  london1h  : [10, 11)   ventana desde las 11             (rango de la primera hora de Londres)
  nypre     : [10, 15)   ventana desde las 15             (ruptura de la sesión de Londres al abrir NY)
  prevday   : máximo/mínimo del día anterior, ventana desde las 8
"""
from __future__ import annotations
import numpy as np, pandas as pd
import sys; sys.path.insert(0, '.')
from trading.fondeo.challenge_sim import _empty, atr_h1

RANGES = {'asian': (1, 9), 'prelondon': (7, 10), 'london1h': (10, 11), 'nypre': (10, 15), 'prevday': (None, 8)}


def strat_breakout_b(bars, rng_type='asian', expire_hour=17, exit_hour=22, sl_frac=1.0, rr=2.0, trail=0.0,
                     min_range_atr=0.3, max_range_atr=3.0, skip_dow=(), sl_atr=None, win_start=None):
    """Ruptura de rango con OCO. rr>0 → TP = rr × SL; rr=None/0 y trail>0 → sin TP, trailing ATR.
    sl_frac: SL como fracción del rango (1.0 = lado opuesto). sl_atr: si se da, SL = sl_atr × ATR(H1) (ignora sl_frac).
    skip_dow: días de la semana sin operar (0=lunes ... 4=viernes). win_start: hora de inicio de la ventana (por defecto range_end)."""
    s = _empty(bars); a = atr_h1(bars)
    df = pd.DataFrame(index=bars.index); df['day'] = bars.index.normalize(); df['h'] = bars.index.hour
    r0, r1 = RANGES[rng_type]
    if rng_type == 'prevday':
        daily = bars.groupby(df.day.values).agg(hi=('high', 'max'), lo=('low', 'min'))
        daily = daily.shift(1)   # rango del día anterior (información pasada)
        hi = daily.hi.reindex(df.day).values; lo = daily.lo.reindex(df.day).values
    else:
        rng = bars[(df.h.values >= r0) & (df.h.values < r1)].groupby(df.day.values[(df.h.values >= r0) & (df.h.values < r1)]).agg(hi=('high', 'max'), lo=('low', 'min'))
        hi = rng.hi.reindex(df.day).values; lo = rng.lo.reindex(df.day).values
    width = hi - lo
    ws = r1 if win_start is None else win_start
    # ATR de referencia FIJO por día: el disponible en la primera vela de la ventana (solo horas H1 ya cerradas).
    # Si se usara el ATR de cada vela, el filtro podría "activarse" a mitad de día porque el ATR sube con el propio
    # movimiento, cuando el precio ya está lejos del rango, y el ejecutor rellenaría la orden stop a un precio
    # que ya no existe (artefacto detectado en la primera versión de este enfoque; ver REPORT.md).
    a_day = pd.Series(np.where(df.h.values == ws, a, np.nan), index=bars.index).groupby(df.day.values).transform('first').values
    ok = (df.h.values >= ws) & (df.h.values < expire_hour) & ~np.isnan(width) & ~np.isnan(a_day) & (width > 0)
    ok &= (width >= min_range_atr * a_day) & (width <= max_range_atr * a_day)
    if skip_dow:
        ok &= ~np.isin(bars.index.dayofweek.values, list(skip_dow))
    s.loc[ok, 'dir'] = 2
    s.loc[ok, 'stop_px'] = hi[ok]
    s['width'] = width
    sl = (sl_atr * a) if sl_atr else (sl_frac * width)
    s['sl'] = sl
    s['tp'] = (rr * sl) if (rr and rr > 0) else np.nan
    s['trail'] = float(trail) if trail else 0.0
    s['exit_hour'] = exit_hour; s['atr'] = a
    return s


def both_sides_stats(bars, sig):
    """Cuántas rupturas (primer toque del día) ocurren en una vela M15 que toca AMBOS lados del rango
    (el simulador asume entrada + stop en esa vela). Devuelve (n_primeras_rupturas, n_ambos, fracción)."""
    d = pd.DataFrame({'day': bars.index.normalize(), 'h': bars.high.values, 'l': bars.low.values,
                      'ok': sig['dir'].values == 2, 'hi': sig['stop_px'].values, 'w': sig['width'].values}, index=bars.index)
    d = d[d.ok]; d['lo'] = d.hi - d.w
    d['th'] = d.h >= d.hi; d['tl'] = d.l <= d.lo; d['t'] = d.th | d.tl
    first = d[d.t].groupby('day').head(1)
    n = len(first); nb = int((first.th & first.tl).sum())
    return n, nb, (nb / n if n else float('nan'))
