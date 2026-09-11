"""
Estrategia "tendencia": seguimiento de tendencia BTCUSD H1.

Lógica (misma que el EA tendencia.mq5):
  1. Filtro de tendencia: cierre por encima (long) / debajo (short) de la EMA(ema_len).
  2. Filtro de régimen: ADX(adx_len) > adx_min (0 = desactivado). ADX calculado como el iADX de MT5
     (suavizado exponencial de +DI/-DI y de DX).
  3. Entrada: ruptura del canal Donchian(dc_len) de las dc_len velas ANTERIORES (sin incluir la vela actual):
     long si close > max(high[t-dc_len .. t-1]); short si close < min(low[...]) (solo si allow_short).
  4. Stop inicial = close -/+ sl_mult * ATR(atr_len)  (ATR = media simple del True Range, como iATR de MT5).
     Trailing tipo "chandelier": SL = max(SL, close - trail_mult*ATR) para long (min para short). Nunca retrocede.
     Salida adicional opcional: cierre cruza la EMA en contra (exit_on_ema).
  5. Tamaño: lots = (risk_pct % de risk_base USD) / distancia_SL, redondeado hacia abajo a 0.01 (mínimo 0.01).

Sin look-ahead: todo se calcula con datos <= t; el motor ejecuta en la apertura de t+1.
La simulación interna del trailing replica exactamente el orden del motor: en la vela i el motor aplica
sl_sig[i-1] y después comprueba low[i] <= sl (long) / high[i] >= sl (short).
"""
from __future__ import annotations
import math
import numpy as np
import pandas as pd

DEFAULT_PARAMS = dict(
    ema_len=200,       # EMA filtro de tendencia
    dc_len=55,         # longitud canal Donchian (velas anteriores)
    atr_len=14,        # periodo ATR
    sl_mult=2.0,       # stop inicial en múltiplos de ATR
    trail_mult=3.0,    # trailing en múltiplos de ATR
    adx_len=14,        # periodo ADX
    adx_min=20.0,      # filtro de régimen (0 = sin filtro)
    allow_short=0,     # 1 = también cortos
    exit_on_ema=0,     # 1 = cerrar si el cierre cruza la EMA en contra
    risk_pct=1.5,      # % del capital base arriesgado por operación
    risk_base=1000.0,  # capital de referencia para calcular lotes (el EA usa el balance real)
    min_lot=0.01,
    lot_step=0.01,
    max_lots=1.0,
)


# ----------------------------------------------------------------------------- indicadores (estilo MT5)
def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def atr_mt5(df: pd.DataFrame, n: int) -> pd.Series:
    """iATR de MT5 = media simple del True Range."""
    pc = df.close.shift(1)
    tr = np.maximum(df.high - df.low, np.maximum((df.high - pc).abs(), (df.low - pc).abs()))
    return tr.rolling(n).mean()


def adx_mt5(df: pd.DataFrame, n: int) -> pd.Series:
    """Réplica del indicador ADX estándar de MT5 (ADX.mq5): +DI/-DI = EMA(n) de 100*DM/TR; ADX = EMA(n) de DX."""
    h, l, c = df.high, df.low, df.close
    pc = c.shift(1)
    tr = np.maximum(h - l, np.maximum((h - pc).abs(), (l - pc).abs()))
    up = h - h.shift(1)
    dn = l.shift(1) - l
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr_safe = tr.replace(0, np.nan)
    pdi_raw = pd.Series(100.0 * plus_dm / tr_safe, index=df.index).fillna(0.0)
    mdi_raw = pd.Series(100.0 * minus_dm / tr_safe, index=df.index).fillna(0.0)
    pdi = ema(pdi_raw, n)
    mdi = ema(mdi_raw, n)
    dx = (100.0 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)).fillna(0.0)
    return ema(dx, n)


# ----------------------------------------------------------------------------- señales
def build_signals(df: pd.DataFrame, **params) -> pd.DataFrame:
    p = {**DEFAULT_PARAMS, **params}
    ema_len, dc_len, atr_len = int(p["ema_len"]), int(p["dc_len"]), int(p["atr_len"])
    sl_mult, trail_mult = float(p["sl_mult"]), float(p["trail_mult"])
    adx_len, adx_min = int(p["adx_len"]), float(p["adx_min"])
    allow_short, exit_on_ema = int(p["allow_short"]), int(p["exit_on_ema"])
    risk_usd = float(p["risk_pct"]) / 100.0 * float(p["risk_base"])
    min_lot, lot_step, max_lots = float(p["min_lot"]), float(p["lot_step"]), float(p["max_lots"])

    close = df.close.values
    high = df.high.values
    low = df.low.values
    ema_v = ema(df.close, ema_len).values
    atr_v = atr_mt5(df, atr_len).values
    adx_v = adx_mt5(df, adx_len).values if adx_min > 0 else np.full(len(df), 1e9)
    upper = df.high.rolling(dc_len).max().shift(1).values   # máximo de las dc_len velas anteriores
    lower = df.low.rolling(dc_len).min().shift(1).values

    n = len(df)
    pos = np.zeros(n, dtype=int)
    lots = np.full(n, np.nan)
    sl = np.full(n, np.nan)
    tp = np.full(n, np.nan)

    warm = max(ema_len, dc_len + 1, atr_len + 1, adx_len * 2)
    cur = 0          # posición actual (según el motor en la vela t)
    cur_sl = np.nan
    cur_lots = np.nan

    for t in range(warm, n):
        a = atr_v[t]
        if np.isnan(a) or np.isnan(ema_v[t]) or np.isnan(upper[t]):
            continue
        # --- gestión de la posición abierta (el motor la mantiene abierta en t porque pos[t-1] != 0)
        if cur != 0:
            hit = (low[t] <= cur_sl) if cur > 0 else (high[t] >= cur_sl)
            if hit:                      # stop intravela ejecutado por el motor en la vela t
                cur = 0; cur_sl = np.nan; cur_lots = np.nan
            else:
                # actualizar trailing con el cierre de t (el motor lo aplicará en t+1)
                if cur > 0:
                    cur_sl = max(cur_sl, close[t] - trail_mult * a)
                    ema_exit = exit_on_ema and close[t] < ema_v[t]
                else:
                    cur_sl = min(cur_sl, close[t] + trail_mult * a)
                    ema_exit = exit_on_ema and close[t] > ema_v[t]
                if ema_exit:
                    cur = 0; cur_sl = np.nan; cur_lots = np.nan   # el motor cierra en la apertura de t+1
                else:
                    pos[t] = cur; sl[t] = cur_sl; lots[t] = cur_lots
                    continue
        # --- sin posición: buscar entrada
        regime = adx_v[t] > adx_min
        if not regime or np.isnan(adx_v[t]):
            continue
        side = 0
        if close[t] > ema_v[t] and close[t] > upper[t]:
            side = 1
        elif allow_short and close[t] < ema_v[t] and close[t] < lower[t]:
            side = -1
        if side == 0:
            continue
        dist = sl_mult * a
        if dist <= 0:
            continue
        L = math.floor((risk_usd / dist) / lot_step) * lot_step
        L = min(max(L, min_lot), max_lots)
        cur = side
        cur_sl = close[t] - side * dist
        cur_lots = L
        pos[t] = cur; sl[t] = cur_sl; lots[t] = cur_lots

    return pd.DataFrame({"pos": pos, "lots": lots, "sl": sl, "tp": tp}, index=df.index)
