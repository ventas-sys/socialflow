"""
Estrategia BREAKOUT del rango asiático con filtro de compresión de volatilidad (BTCUSD, H1).

Lógica (resumen):
 1. Rango asiático = máximo/mínimo de las velas H1 entre 00:00 y 07:59 UTC (8 velas). Queda fijado al cierre de la vela 07:00.
 2. Filtro de compresión: ancho del rango < compress_k × ATR(14) diario (ATR = SMA del True Range, como el iATR de MT5;
    se usa el ATR del día ANTERIOR ya cerrado → sin look-ahead).
 3. Entrada durante la sesión EU/US (velas con hora en [range_end, entry_end)): si una vela H1 CIERRA por encima del máximo
    del rango (+ buffer) → largo; si cierra por debajo del mínimo → corto. La orden se ejecuta en la apertura de la vela
    siguiente (lo hace el motor). Filtro de volumen opcional: volumen de la vela de ruptura > vol_mult × SMA(volumen, vol_len).
    Máximo 1 operación por día y por dirección.
 4. SL = sl_mult × ancho del rango (mínimo sl_floor_atr × ATR diario) medido desde el cierre de la vela de señal.
    TP = tp_r × distancia de SL. Si exit_eod=True, se cierra todo antes de la hora exit_hour UTC (salida al cierre del día).
 5. Tamaño: lotes = (capital × risk_pct/100) / distancia_SL, redondeado a 0,01 (mínimo 0,01). Capital fijo (sin interés
    compuesto) para que el resultado sea comparable entre corridas; el EA usa el balance real.

build_signals(df, **params) devuelve un DataFrame alineado con df con columnas pos, lots, sl, tp.
La columna pos se mantiene en ±1 mientras la operación está viva y vuelve a 0 en la vela en la que el SL/TP/salida
horaria la cierra (se replica la regla del motor: SL tiene prioridad sobre TP en la misma vela), de modo que el motor
no reabra la operación tras un stop.
"""
from __future__ import annotations
import math
import numpy as np
import pandas as pd

# Valores elegidos en optimize.py (solo in-sample, 192 combos, criterio PF x DD, ver opt_grid.csv)
DEFAULT_PARAMS = dict(
    range_start=0,      # hora UTC de inicio del rango (inclusive)
    range_end=8,        # hora UTC de fin del rango (exclusive) -> velas 00..07
    entry_end=13,       # última hora UTC (exclusive) en la que se aceptan rupturas
    exit_eod=True,      # cerrar la posición al final del día
    exit_hour=23,       # la posición se cierra en la apertura de la primera vela con hora >= exit_hour
    compress_k=0.35,    # filtro: ancho del rango < compress_k * ATR diario (>=9 => sin filtro)
    buffer_atr=0.0,     # buffer de ruptura en fracción del ATR diario
    sl_mult=0.5,        # SL = sl_mult * ancho del rango
    sl_floor_atr=0.25,  # distancia mínima de SL en fracción del ATR diario
    tp_r=2.0,           # TP en múltiplos de R
    vol_mult=1.2,       # filtro de volumen: vol > vol_mult * SMA(vol); 0 = sin filtro
    vol_len=20,
    atr_len=14,         # periodo del ATR diario
    risk_pct=1.0,       # % del capital arriesgado por operación
    capital=1000.0,
    lot_step=0.01,
    min_lot=0.01,
)


def daily_atr_sma(df: pd.DataFrame, atr_len: int) -> pd.Series:
    """ATR diario (SMA del True Range, igual que el iATR estándar de MT5) del día anterior, mapeado a cada vela.
    Se usa el día UTC completo anterior (shift 1) => no hay look-ahead."""
    d = df.resample("1D").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    prev_close = d["close"].shift(1)
    tr = pd.concat([d["high"] - d["low"], (d["high"] - prev_close).abs(), (d["low"] - prev_close).abs()], axis=1).max(axis=1)
    atr = tr.rolling(atr_len).mean().shift(1)  # ATR del día anterior, disponible desde las 00:00 de hoy
    day_key = df.index.normalize()
    return pd.Series(atr.reindex(day_key).values, index=df.index)


def build_signals(df: pd.DataFrame, **params) -> pd.DataFrame:
    p = dict(DEFAULT_PARAMS); p.update(params)
    n = len(df)
    o, h, l, c = df["open"].values, df["high"].values, df["low"].values, df["close"].values
    vol = df["volume"].values if "volume" in df.columns else np.zeros(n)
    idx = df.index
    hours = idx.hour.values
    days = idx.normalize().values.astype("datetime64[D]")
    bar_delta = (idx[1] - idx[0])
    next_hours = (idx + bar_delta).hour.values

    atr_d = daily_atr_sma(df, int(p["atr_len"])).values
    vol_sma = pd.Series(vol).rolling(int(p["vol_len"])).mean().shift(0).values  # incluye la vela actual (igual que iMA shift 0)

    pos = np.zeros(n, dtype=int)
    lots = np.full(n, np.nan)
    sl_col = np.full(n, np.nan)
    tp_col = np.full(n, np.nan)

    rs, re_, ee = int(p["range_start"]), int(p["range_end"]), int(p["entry_end"])
    compress_k = float(p["compress_k"]); buffer_atr = float(p["buffer_atr"])
    sl_mult = float(p["sl_mult"]); sl_floor_atr = float(p["sl_floor_atr"]); tp_r = float(p["tp_r"])
    vol_mult = float(p["vol_mult"]); exit_eod = bool(p["exit_eod"]); exit_hour = int(p["exit_hour"])
    risk_usd = float(p["capital"]) * float(p["risk_pct"]) / 100.0
    lot_step, min_lot = float(p["lot_step"]), float(p["min_lot"])

    cur_day = None
    rng_hi = -np.inf; rng_lo = np.inf; rng_bars = 0; rng_ok = False
    long_done = short_done = False
    in_pos = 0; cur_sl = np.nan; cur_tp = np.nan; cur_lots = np.nan
    pending = 0  # señal emitida en la vela anterior; la operación "vive" desde esta vela

    for i in range(n):
        if days[i] != cur_day:
            cur_day = days[i]
            rng_hi = -np.inf; rng_lo = np.inf; rng_bars = 0; rng_ok = False
            long_done = short_done = False

        hr = hours[i]

        # --- 0) gestionar operación viva (abierta en la apertura de esta vela o antes) ---
        if pending != 0:
            in_pos = pending; pending = 0
        closed_now = False
        if in_pos != 0:
            if in_pos > 0:
                if l[i] <= cur_sl: closed_now = True
                elif h[i] >= cur_tp: closed_now = True
            else:
                if h[i] >= cur_sl: closed_now = True
                elif l[i] <= cur_tp: closed_now = True
            if closed_now:
                in_pos = 0; cur_sl = cur_tp = cur_lots = np.nan
                pos[i] = 0
            else:
                # salida horaria: la siguiente vela ya es >= exit_hour (o cambia el día) -> señal 0 en esta vela
                if exit_eod and (next_hours[i] >= exit_hour or next_hours[i] < hr):
                    pos[i] = 0
                    in_pos = 0; cur_sl = cur_tp = cur_lots = np.nan
                else:
                    pos[i] = in_pos; sl_col[i] = cur_sl; tp_col[i] = cur_tp; lots[i] = cur_lots

        # --- 1) construir el rango ---
        if rs <= hr < re_:
            rng_hi = max(rng_hi, h[i]); rng_lo = min(rng_lo, l[i]); rng_bars += 1
            if hr == re_ - 1 and rng_bars >= (re_ - rs) * max(1, int(round(pd.Timedelta("1h") / bar_delta))) // 2:
                rng_ok = True  # rango completo (o al menos la mitad de las velas presentes)
            continue

        # --- 2) buscar ruptura ---
        if in_pos != 0 or not rng_ok or not (re_ <= hr < ee):
            continue
        atr = atr_d[i]
        if not np.isfinite(atr) or atr <= 0:
            continue
        width = rng_hi - rng_lo
        if width <= 0 or width >= compress_k * atr:
            continue
        if vol_mult > 0 and not (np.isfinite(vol_sma[i]) and vol[i] > vol_mult * vol_sma[i]):
            continue
        buf = buffer_atr * atr
        side = 0
        if not long_done and c[i] > rng_hi + buf:
            side = 1
        elif not short_done and c[i] < rng_lo - buf:
            side = -1
        if side == 0:
            continue
        sl_dist = max(sl_mult * width, sl_floor_atr * atr)
        sl_px = c[i] - side * sl_dist
        tp_px = c[i] + side * tp_r * sl_dist
        L = math.floor(risk_usd / sl_dist / lot_step) * lot_step
        L = max(L, min_lot)
        pos[i] = side; sl_col[i] = sl_px; tp_col[i] = tp_px; lots[i] = L
        pending = side; cur_sl = sl_px; cur_tp = tp_px; cur_lots = L
        if side > 0: long_done = True
        else: short_done = True

    return pd.DataFrame({"pos": pos, "lots": lots, "sl": sl_col, "tp": tp_col}, index=idx)
