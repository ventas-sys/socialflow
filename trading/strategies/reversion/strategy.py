"""
Estrategia REVERSIÓN A LA MEDIA en BTCUSD (Bollinger + RSI extremos + SL por ATR).

Lógica (idéntica a la del EA reversion.mq5):
  1. Bollinger(bb_period, bb_dev) sobre el cierre (SMA + desviación poblacional, igual que iBands de MT5).
  2. RSI(rsi_period) Wilder (igual que iRSI). ATR(atr_period) = media simple del rango verdadero (igual que iATR).
  3. LONG  cuando close < banda inferior  y RSI < rsi_low       (y, si trend_filter, close > EMA200 de H4 cerrada).
     SHORT cuando close > banda superior  y RSI > 100-rsi_low   (y, si trend_filter, close < EMA200 de H4 cerrada).
     Con confirm=1 la entrada se retrasa a la vela en que el cierre vuelve DENTRO de la banda (vela previa fuera + RSI extremo).
  4. Salida: TP dinámico = banda media (se actualiza cada vela), SL fijo = close ± atr_mult*ATR, o cierre por tiempo
     tras max_bars velas. Filtro horario opcional (horas UTC [hour_start, hour_end)).
  5. Tamaño: riesgo fijo = risk_pct % del capital inicial / distancia al SL (sin piramidar, una posición a la vez).

La señal de la vela t se ejecuta en la apertura de t+1 (lo hace el motor). Aquí sólo se usan datos <= t.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

DEFAULT_PARAMS = dict(
    bb_period=20,
    bb_dev=3.0,
    rsi_period=14,
    rsi_low=25.0,       # umbral RSI: long < rsi_low, short > 100 - rsi_low
    atr_period=14,
    atr_mult=2.5,       # SL = close -/+ atr_mult * ATR
    max_bars=8,         # cierre por tiempo (velas)
    trend_filter=1,     # 1 = sólo a favor de EMA200 H4; 0 = sin filtro
    ema_period=200,     # EMA en H4
    session_filter=0,   # 1 = sólo entra en [hour_start, hour_end) UTC
    hour_start=7,
    hour_end=21,
    risk_pct=1.5,       # % del capital inicial arriesgado por operación
    capital=1000.0,
    allow_long=1,
    allow_short=1,
    confirm=0,          # 1 = entra cuando el cierre VUELVE dentro de la banda (vela anterior fuera + RSI extremo en esa vela)
)


# ----------------------------------------------------------------------------- indicadores estilo MT5
def bollinger(close: pd.Series, period: int, dev: float):
    mid = close.rolling(period).mean()
    sd = close.rolling(period).std(ddof=0)          # iBands usa desviación poblacional
    return mid, mid + dev * sd, mid - dev * sd


def rsi_wilder(close: pd.Series, period: int) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0.0)
    dn = (-d).clip(lower=0.0)
    # Semilla como MT5: media simple de las primeras `period` variaciones, luego suavizado Wilder (alpha = 1/period)
    au = up.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    ad = dn.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    rs = au / ad.replace(0.0, np.nan)
    rsi = 100.0 - 100.0 / (1.0 + rs)
    rsi = rsi.where(ad != 0.0, 100.0)
    return rsi


def atr_sma(df: pd.DataFrame, period: int) -> pd.Series:
    pc = df.close.shift(1)
    tr = pd.concat([df.high - df.low, (df.high - pc).abs(), (df.low - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(period).mean()                 # iATR de MT5 = media simple del TR


def ema_h4_closed(df: pd.DataFrame, period: int) -> pd.Series:
    """EMA(period) de la vela H4 CERRADA anterior, propagada al índice de df (sin look-ahead: shift(1) en H4)."""
    h4 = df.close.resample("4h", label="left", closed="left").last().dropna()
    ema = h4.ewm(span=period, adjust=False, min_periods=period).mean().shift(1)
    # Cada vela intradía usa la EMA de la última H4 completada: la H4 abierta a floor(t/4h) toma ema.shift(1)
    return ema.reindex(df.index, method="ffill")


# ----------------------------------------------------------------------------- señales
def build_signals(df: pd.DataFrame, **params) -> pd.DataFrame:
    p = dict(DEFAULT_PARAMS); p.update(params)
    bbp, bbd = int(p["bb_period"]), float(p["bb_dev"])
    rsip, rsi_low = int(p["rsi_period"]), float(p["rsi_low"])
    atrp, atrk = int(p["atr_period"]), float(p["atr_mult"])
    max_bars = int(p["max_bars"])
    risk_usd = float(p["capital"]) * float(p["risk_pct"]) / 100.0

    close = df.close
    mid, upper, lower = bollinger(close, bbp, bbd)
    rsi = rsi_wilder(close, rsip)
    atr = atr_sma(df, atrp)
    ema = ema_h4_closed(df, int(p["ema_period"])) if int(p["trend_filter"]) else None

    n = len(df)
    c = close.values; h = df.high.values; l = df.low.values
    midv = mid.values; upv = upper.values; lov = lower.values; rsiv = rsi.values; atrv = atr.values
    emav = ema.values if ema is not None else None
    hours = df.index.hour.values
    sess_ok = np.ones(n, dtype=bool)
    if int(p["session_filter"]):
        hs, he = int(p["hour_start"]), int(p["hour_end"])
        sess_ok = (hours >= hs) & (hours < he) if hs < he else (hours >= hs) | (hours < he)

    if int(p["confirm"]):
        c1 = np.roll(c, 1); lo1 = np.roll(lov, 1); up1 = np.roll(upv, 1); rsi1 = np.roll(rsiv, 1)
        c1[0] = np.nan; lo1[0] = np.nan; up1[0] = np.nan; rsi1[0] = np.nan
        long_raw = (c1 < lo1) & (c > lov) & (rsi1 < rsi_low) & sess_ok
        short_raw = (c1 > up1) & (c < upv) & (rsi1 > 100.0 - rsi_low) & sess_ok
    else:
        long_raw = (c < lov) & (rsiv < rsi_low) & sess_ok
        short_raw = (c > upv) & (rsiv > 100.0 - rsi_low) & sess_ok
    if emav is not None:
        long_raw &= c > emav
        short_raw &= c < emav
    if not int(p["allow_long"]): long_raw[:] = False
    if not int(p["allow_short"]): short_raw[:] = False
    valid = ~(np.isnan(midv) | np.isnan(rsiv) | np.isnan(atrv))
    if emav is not None: valid &= ~np.isnan(emav)
    long_raw &= valid; short_raw &= valid

    pos = np.zeros(n, dtype=np.int8)
    lots = np.full(n, np.nan); sl_out = np.full(n, np.nan); tp_out = np.full(n, np.nan)

    # Máquina de estados que replica al motor: la señal en t abre en open[t+1]; SL/TP se evalúan con low/high
    # desde la vela de entrada; el TP se actualiza cada vela a la banda media de la vela anterior.
    state = 0; sl = np.nan; entry_bar = -1
    for i in range(n):
        if state != 0:
            # vela i: el motor usa el TP enviado en la vela i-1 (= banda media de i-1)
            tp_active = midv[i - 1]
            hit_sl = (l[i] <= sl) if state > 0 else (h[i] >= sl)
            hit_tp = (h[i] >= tp_active) if state > 0 else (l[i] <= tp_active)
            if hit_sl or hit_tp:
                state = 0
            elif i - entry_bar >= max_bars:
                state = 0                     # pos=0 en la vela i -> el motor cierra en open[i+1]
            else:
                pos[i] = state; sl_out[i] = sl; tp_out[i] = midv[i]
                continue
        # plano: ¿nueva señal en la vela i?
        if long_raw[i] or short_raw[i]:
            side = 1 if long_raw[i] else -1
            dist = atrk * atrv[i]
            if dist <= 0: continue
            sl = c[i] - side * dist
            L = risk_usd / dist
            L = max(0.01, np.floor(L * 100) / 100.0)
            pos[i] = side; lots[i] = L; sl_out[i] = sl; tp_out[i] = midv[i]
            state = side; entry_bar = i + 1   # la posición se abre en la apertura de i+1
    out = pd.DataFrame(dict(pos=pos.astype(int), lots=lots, sl=sl_out, tp=tp_out), index=df.index)
    return out
