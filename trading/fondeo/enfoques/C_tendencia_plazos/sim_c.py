"""COPIA MODIFICADA del simulador para el enfoque C (trading/fondeo/challenge_sim.py NO se toca).

Cambios respecto al original (todos aditivos, el comportamiento por defecto es idéntico):
  1. run_attempt(..., risk_ladder=None): "riesgo escalonado" anti-martingala. Si se pasa una tupla de porcentajes
     (p.ej. (0.5, 1.0, 1.5, 2.0, 2.8)), la primera operación arriesga el escalón 0; tras una operación ganadora
     (balance al abrir la siguiente > balance al abrir la anterior) sube un escalón (tope: el último); tras una
     perdedora (o neutra) vuelve al escalón 0. Compatible con risk_on_balance (la base sobre la que se aplica el %).
     Cuando risk_ladder es None se usa risk_pct fijo, exactamente como el original.
  2. strat_donchian(): ruptura de canal Donchian N en H1/H4 con stop y trailing por ATR (misma interfaz que strat_ema_trend).
  3. evaluate_range(): igual que evaluate() pero limitando las fechas de inicio a [start, end] para separar IS y OOS,
     y devolviendo también el resultado 'pass_inconsistent' en el resumen (ya lo hacía summarize).
  4. strat_ema_trend(): sin cambios funcionales.

Simulador de challenges de fondeo (prop firms) sobre datos reales M15.

Idea: una estrategia se define como señales precomputadas sobre toda la serie (vectorizado); luego, para cada
posible fecha de inicio del challenge, un ejecutor recorre las velas aplicando las reglas de la firma
(objetivo de beneficio, pérdida diaria máxima, pérdida máxima, plazo, días mínimos) con costes reales y
sizing por riesgo fijo. Salida: probabilidad de pasar / quemar / no decidir dentro del plazo.

Uso rápido:
    from trading.fondeo.challenge_sim import *
    bars = load('XAUUSD'); sig = strat_breakout(bars)
    res = evaluate(bars, sig, SPECS['XAUUSD'], RULES['ftmo_p1'], risk_pct=2.0)
"""
from __future__ import annotations
import numpy as np, pandas as pd
from dataclasses import dataclass, field, replace

FX_SCALE = {'EURUSD': 1e5, 'GBPUSD': 1e5, 'USDJPY': 1e3, 'XAUUSD': 1e2}


def load(symbol: str, path='trading/data') -> pd.DataFrame:
    """Velas M15 con columnas open/high/low/close (float) e índice datetime (hora servidor / UTC para BTC)."""
    if symbol == 'BTCUSD':
        d = pd.read_csv(f'{path}/BTCUSD_M15_2023-09_2026-09.csv.gz', parse_dates=['dt'])
        d['dt'] = d.dt.dt.tz_localize(None); d = d.set_index('dt')
    else:
        d = pd.read_csv(f'{path}/fx/{symbol}m15.csv', parse_dates=['Date']).set_index('Date')
        d = d[['open', 'high', 'low', 'close']] / FX_SCALE[symbol]
        d.index.name = 'dt'
    return d[['open', 'high', 'low', 'close']].astype(float)


@dataclass
class Spec:
    """Especificación del instrumento en la firma (valores por defecto ESTIMADOS a partir de condiciones típicas
    de FTMO/FundedNext 2025-26; ver FIRMAS.md para las fuentes)."""
    symbol: str
    usd_per_unit_per_lot: float   # USD de P/L por 1.0 de movimiento de precio y 1 lote (USDJPY: se divide por precio)
    spread: float                 # en unidades de precio
    comm_rt_per_lot: float        # comisión ida y vuelta por lote, USD
    leverage: float               # apalancamiento máximo permitido
    contract: float               # unidades por lote (para margen)
    quote_is_usd: bool = True     # False para USDJPY (P/L en JPY convertido a USD)
    slip: float = 0.0             # deslizamiento adicional en unidades de precio (órdenes stop/mercado)
    min_lot: float = 0.01
    max_lot: float = 100.0


SPECS = {
    'EURUSD': Spec('EURUSD', 1e5, 0.00002, 6.0, 100, 1e5, slip=0.00001),
    'GBPUSD': Spec('GBPUSD', 1e5, 0.00004, 6.0, 100, 1e5, slip=0.00002),
    'USDJPY': Spec('USDJPY', 1e5, 0.003, 6.0, 100, 1e5, quote_is_usd=False, slip=0.002),
    'XAUUSD': Spec('XAUUSD', 100.0, 0.25, 6.0, 50, 100, slip=0.10),
    'BTCUSD': Spec('BTCUSD', 1.0, 30.0, 0.0, 2, 1, slip=10.0),
}


@dataclass
class Rules:
    name: str
    target: float           # objetivo de beneficio (fracción del balance inicial), p.ej. 0.10
    daily_loss: float       # pérdida diaria máxima (fracción del balance inicial)
    max_loss: float         # pérdida máxima (fracción del balance inicial)
    max_days: int = 7       # plazo en días naturales que nos autoimponemos (7 = "en una semana")
    min_trading_days: int = 0
    trailing: bool = False  # pérdida máxima trailing sobre el máximo de equity (estilo Topstep) o estática (FTMO)
    daily_ref_equity: bool = True  # referencia diaria = max(balance, equity) a medianoche (FTMO); False = balance
    target_on_equity: bool = False  # el objetivo cuenta con flotante (False = solo balance cerrado)
    best_day: float | None = None   # regla de consistencia: mejor día ≤ best_day × suma de días positivos (None = sin regla)
    leverage: float | None = None   # apalancamiento de la firma para este programa (None = el del Spec)
    fee_usd: float = 0.0            # precio del challenge de 100k en USD (aprox.)


RULES = {
    # FTMO 2 fases (100k): fase 1 10 %, fase 2 5 %; pérdida diaria 5 %, máxima 10 % estática; 4 días mínimos; sin límite de tiempo
    'ftmo_p1': Rules('FTMO fase 1', 0.10, 0.05, 0.10, max_days=7, min_trading_days=4),
    'ftmo_p2': Rules('FTMO fase 2', 0.05, 0.05, 0.10, max_days=7, min_trading_days=4),
    # 1 fase típica 2026 (FundingPips/Alpha/FundedNext "Stellar 1-step"): 10 % objetivo, 3-4 % diario, 6 % máxima
    'onestep_10_4_6': Rules('1 fase 10/4/6', 0.10, 0.04, 0.06, max_days=7, min_trading_days=3),
    'onestep_10_5_10': Rules('1 fase 10/5/10', 0.10, 0.05, 0.10, max_days=7, min_trading_days=3),
    # 2 fases "rápidas" 8/5 (FundedNext Stellar 2-step: 8 % y 5 %, diario 5 %, máx 10 %)
    'twostep_8_5_10_p1': Rules('2 fases 8/5/10 fase 1', 0.08, 0.05, 0.10, max_days=7, min_trading_days=5),
    'twostep_8_5_10_p2': Rules('2 fases 8/5/10 fase 2', 0.05, 0.05, 0.10, max_days=7, min_trading_days=5),
    # ---- programas de 1 fase reales (FIRMAS.md, sept-2026); precios de 100k aprox. en USD
    'ftmo_1step': Rules('FTMO 1-Step', 0.10, 0.03, 0.10, max_days=7, min_trading_days=0, trailing=True, best_day=0.5, leverage=100, fee_usd=540),
    'fundingpips_1step': Rules('FundingPips 1-Step', 0.10, 0.03, 0.06, max_days=7, min_trading_days=0, trailing=False, leverage=50, fee_usd=500),
    'fundednext_1step': Rules('FundedNext Stellar 1-Step', 0.10, 0.03, 0.06, max_days=7, min_trading_days=5, best_day=0.4, leverage=30, fee_usd=550),
    'the5ers_hyper': Rules('The5ers Hyper Growth', 0.10, 0.03, 0.06, max_days=7, min_trading_days=3, leverage=30, fee_usd=260),
    'e8_one_8': Rules('E8 One DD 8 %', 0.12, 1.0, 0.08, max_days=7, min_trading_days=0, trailing=True, leverage=50, fee_usd=260),
    'e8_one_14': Rules('E8 One DD 14 %', 0.21, 1.0, 0.14, max_days=7, min_trading_days=0, trailing=True, leverage=50, fee_usd=260),
    'blueguardian_1step': Rules('Blue Guardian 1-Step', 0.09, 0.03, 0.06, max_days=7, min_trading_days=3, trailing=True, best_day=0.5, leverage=100, fee_usd=470),
    'ftmo_2step_p1_noweek': Rules('FTMO fase 1 (30 días)', 0.10, 0.05, 0.10, max_days=30, min_trading_days=4, fee_usd=540),
}


# ----------------------------------------------------------------------------------------------------------
# Indicadores auxiliares
# ----------------------------------------------------------------------------------------------------------
def atr_h1(bars: pd.DataFrame, n=14) -> np.ndarray:
    """ATR(14) en H1, propagado a cada vela M15 (usa solo información pasada)."""
    h1 = bars.resample('1h').agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last'}).dropna()
    tr = np.maximum(h1.high - h1.low, np.maximum((h1.high - h1.close.shift()).abs(), (h1.low - h1.close.shift()).abs()))
    a = tr.rolling(n).mean().shift(1)  # shift: el ATR disponible al abrir la hora es el de las horas cerradas
    return a.reindex(bars.index, method='ffill').values


def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().values


# ----------------------------------------------------------------------------------------------------------
# Estrategias: devuelven un DataFrame de señales alineado con bars:
#   dir  : +1 / -1 / 0  (orden a mercado en la apertura de esa vela, o stop pendiente si `stop_px` no es NaN)
#   stop_px : precio de la orden stop (NaN = mercado)
#   sl   : distancia del stop loss en unidades de precio (>0)
#   tp   : distancia del take profit (>0) o NaN (sin TP)
#   exit_hour : hora (0-23) a la que se cierra a mercado si sigue abierta (-1 = sin cierre horario)
#   trail: multiplicador ATR de trailing (0 = sin trailing)
# ----------------------------------------------------------------------------------------------------------
def _empty(bars):
    s = pd.DataFrame(index=bars.index)
    s['dir'] = 0; s['stop_px'] = np.nan; s['sl'] = np.nan; s['tp'] = np.nan; s['exit_hour'] = -1; s['trail'] = 0.0
    return s


def strat_daily_bet(bars, rule='momentum', entry_hour=10, sl_atr=1.5, rr=2.0, exit_hour=22, seed=0, lookback_h=24):
    """Una operación al día a la hora `entry_hour`. Dirección: 'momentum' (signo del retorno de las últimas
    lookback_h horas), 'meanrev' (contrario), o 'coin' (moneda al aire con semilla). SL = sl_atr × ATR(H1)."""
    s = _empty(bars); a = atr_h1(bars)
    idx = bars.index; hours = idx.hour; mins = idx.minute
    at_entry = (hours == entry_hour) & (mins == 0)
    n_look = lookback_h * 4
    ret = bars.open.values - np.roll(bars.open.values, n_look); ret[:n_look] = 0
    if rule == 'coin':
        rng = np.random.default_rng(seed); d = rng.choice([-1, 1], size=len(bars))
    elif rule == 'momentum':
        d = np.sign(ret)
    elif rule == 'meanrev':
        d = -np.sign(ret)
    elif rule == 'long':
        d = np.ones(len(bars))
    elif rule == 'short':
        d = -np.ones(len(bars))
    else:
        raise ValueError(rule)
    s.loc[at_entry, 'dir'] = d[at_entry]
    s['sl'] = sl_atr * a; s['tp'] = rr * sl_atr * a; s['exit_hour'] = exit_hour; s['atr'] = a
    s.loc[np.isnan(a), 'dir'] = 0
    return s


def strat_breakout(bars, range_start=1, range_end=9, expire_hour=17, exit_hour=22, sl_frac=1.0, rr=2.0, min_range_atr=0.3, max_range_atr=3.0):
    """Ruptura del rango asiático: entre range_end y expire_hour, stop de compra en el máximo del rango
    [range_start, range_end) y stop de venta en el mínimo. SL = sl_frac × rango (al lado opuesto si 1.0), TP = rr × SL.
    Solo la primera ruptura del día. Filtra rangos demasiado pequeños o grandes respecto al ATR(H1)."""
    s = _empty(bars); a = atr_h1(bars)
    df = bars.copy(); df['day'] = df.index.normalize(); df['h'] = df.index.hour
    rng = df[(df.h >= range_start) & (df.h < range_end)].groupby('day').agg(hi=('high', 'max'), lo=('low', 'min'))
    hi = rng.hi.reindex(df.day).values; lo = rng.lo.reindex(df.day).values
    width = hi - lo
    ok = (df.h.values >= range_end) & (df.h.values < expire_hour) & ~np.isnan(width) & ~np.isnan(a)
    ok &= (width >= min_range_atr * a) & (width <= max_range_atr * a)
    # señal "pendiente" en cada vela de la ventana: el ejecutor coloca ambos stops y toma el primero que se toque
    s.loc[ok, 'dir'] = 2  # 2 = OCO: buy stop en hi, sell stop en lo
    s.loc[ok, 'stop_px'] = hi[ok]  # se guarda hi; lo = hi - width
    s['width'] = width
    s['sl'] = sl_frac * width; s['tp'] = rr * sl_frac * width; s['exit_hour'] = exit_hour; s['atr'] = a
    return s


def strat_ema_trend(bars, fast=20, slow=50, atr_stop=2.0, trail=2.0, tf='1h', exit_friday=True):
    """Cruce de EMAs en `tf` (1h/4h) con stop y trailing por ATR. Entra en la apertura de la vela M15 siguiente
    al cruce. Sin TP; sale por trailing, cruce contrario o (opcional) viernes a las 21h."""
    s = _empty(bars); a = atr_h1(bars)
    h = bars.resample(tf).agg({'close': 'last'}).dropna()
    ef, es = ema(h.close.values, fast), ema(h.close.values, slow)
    cross = np.sign(ef - es); prev = np.roll(cross, 1); prev[0] = 0
    sig = pd.Series(np.where((cross != prev) & (cross != 0), cross, 0), index=h.index)
    # la señal de la vela tf cerrada en t se ejecuta en la primera vela M15 posterior
    sig.index = sig.index + pd.tseries.frequencies.to_offset(tf)
    sig = sig[sig != 0].reindex(bars.index).fillna(0)
    s['dir'] = sig.values; s['sl'] = atr_stop * a; s['trail'] = trail; s['exit_hour'] = -1; s['atr'] = a
    s['exit_friday'] = exit_friday
    s.loc[np.isnan(a), 'dir'] = 0
    return s


def strat_donchian(bars, n=20, atr_stop=2.0, trail=2.0, tf='1h', exit_friday=True):
    """[C] Ruptura de canal Donchian: en `tf`, compra cuando el cierre supera el máximo de las últimas n velas
    (sin contar la actual) y vende cuando cae por debajo del mínimo. Solo la vela en la que se produce el cruce
    (de dentro a fuera del canal). Ejecuta en la apertura de la vela M15 siguiente. Stop = atr_stop × ATR(H1),
    trailing = trail × ATR(H1), sin TP; sale por trailing, señal contraria o viernes 22h (opcional)."""
    s = _empty(bars); a = atr_h1(bars)
    h = bars.resample(tf).agg({'high': 'max', 'low': 'min', 'close': 'last'}).dropna()
    hi = h.high.rolling(n).max().shift(1).values; lo = h.low.rolling(n).min().shift(1).values
    c = h.close.values
    state = np.where(c > hi, 1, np.where(c < lo, -1, 0)).astype(float)
    state[np.isnan(hi)] = 0
    prev = np.roll(state, 1); prev[0] = 0
    sig = pd.Series(np.where((state != 0) & (state != prev), state, 0), index=h.index)
    sig.index = sig.index + pd.tseries.frequencies.to_offset(tf)
    sig = sig[sig != 0].reindex(bars.index).fillna(0)
    s['dir'] = sig.values; s['sl'] = atr_stop * a; s['trail'] = trail; s['exit_hour'] = -1; s['atr'] = a
    s['exit_friday'] = exit_friday
    s.loc[np.isnan(a), 'dir'] = 0
    return s


def evaluate_range(bars, sig, spec, rules, start=None, end=None, risk_pct=2.0, start_hour=1, max_starts=None, P=None, **kw) -> dict:
    """[C] Como evaluate(), pero solo con fechas de inicio en [start, end] (para separar IS/OOS). Un intento por día
    hábil a start_hour. `P` permite reutilizar prep(bars, sig) entre llamadas."""
    idx = bars.index
    mask = (idx.hour == start_hour) & (idx.minute == 0) & (idx.dayofweek < 5)
    if start is not None: mask &= idx >= pd.Timestamp(start)
    if end is not None: mask &= idx <= pd.Timestamp(end)
    cand = np.where(mask)[0]
    if max_starts and len(cand) > max_starts: cand = cand[:: max(1, len(cand) // max_starts)]
    if P is None: P = prep(bars, sig)
    res = [run_attempt(P, spec, rules, int(i), risk_pct=risk_pct, **kw) for i in cand]
    return summarize(res, rules)


# ----------------------------------------------------------------------------------------------------------
# Ejecutor de un intento de challenge (arrays numéricos precomputados para velocidad)
# ----------------------------------------------------------------------------------------------------------
@dataclass
class Attempt:
    start: pd.Timestamp
    result: str          # 'pass' | 'fail_daily' | 'fail_max' | 'timeout'
    days: float          # días naturales hasta la decisión
    end_balance: float
    trades: int
    trading_days: int
    max_dd: float        # peor drawdown de equity (fracción del inicial)
    worst_day: float     # peor día (fracción del inicial)
    best_day: float


def prep(bars: pd.DataFrame, sig: pd.DataFrame) -> dict:
    """Convierte velas y señales en arrays numpy (evita crear Timestamps en el bucle)."""
    idx = bars.index
    P = dict(o=bars.open.values, h=bars.high.values, l=bars.low.values, c=bars.close.values,
             ts=idx.values.astype('datetime64[s]').astype(np.int64), day=(idx.values.astype('datetime64[D]').astype(np.int64)),
             hour=idx.hour.values, dow=idx.dayofweek.values, idx=idx,
             dir=sig['dir'].values.astype(float), sl=sig['sl'].values, tp=sig['tp'].values, stop_px=sig['stop_px'].values,
             exit_hour=sig['exit_hour'].values, trail=sig['trail'].values,
             atr=sig['atr'].values if 'atr' in sig else np.full(len(bars), np.nan),
             width=sig['width'].values if 'width' in sig else np.full(len(bars), np.nan),
             exit_friday=bool(sig['exit_friday'].iloc[0]) if 'exit_friday' in sig else False)
    return P


def run_attempt(P: dict, spec: Spec, rules: Rules, start_i: int, risk_pct=2.0, capital=100_000.0,
                max_trades_day=1, day_stop_pct=None, risk_on_balance=False, max_calendar_days=None,
                stop_after_target=True, max_lots=None, risk_ladder=None) -> Attempt:
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
    ladder_step = 0; last_entry_bal = capital  # [C] riesgo escalonado anti-martingala
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
                    if touch_hi and not touch_lo: pos = 1; px = hi_px
                    elif touch_lo and not touch_hi: pos = -1; px = lo_px
                    elif touch_hi and touch_lo:
                        pos = 1 if (o[i] - lo_px) >= (hi_px - o[i]) else -1; px = hi_px if pos > 0 else lo_px; both = True
                    if pos: entry = px + pos * (spread + slip)
                else:
                    pos = 1 if d > 0 else -1; entry = o[i] + pos * (spread / 2 + slip)
                if pos:
                    if risk_ladder is not None:  # [C] escalonado: sube tras ganar, vuelve al mínimo tras perder
                        if trades > 0:
                            ladder_step = min(ladder_step + 1, len(risk_ladder) - 1) if balance > last_entry_bal else 0
                        rp = risk_ladder[ladder_step]
                    else:
                        rp = risk_pct
                    last_entry_bal = balance
                    risk_usd = (balance if risk_on_balance else capital) * rp / 100.0
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


def summarize(res: list[Attempt], rules: Rules) -> dict:
    df = pd.DataFrame([a.__dict__ for a in res])
    n = len(df)
    p = lambda r: round(100 * (df.result == r).mean(), 1)
    passed = df[df.result == 'pass']
    return dict(n=n, pass_pct=p('pass'), pass_inconsistent_pct=p('pass_inconsistent'), fail_daily_pct=p('fail_daily'), fail_max_pct=p('fail_max'), timeout_pct=p('timeout'),
                days_to_pass_median=round(float(passed.days.median()), 1) if len(passed) else None,
                trades_mean=round(float(df.trades.mean()), 1), max_dd_mean=round(100 * float(df.max_dd.mean()), 2),
                worst_day_mean=round(100 * float(df.worst_day.mean()), 2), end_balance_mean=round(float(df.end_balance.mean()), 0),
                attempts=df)


def ev_per_attempt(pass_pct, fee, payout_if_pass):
    """Valor esperado de un intento: P(pasar) × valor esperado de la cuenta fondeada − fee."""
    return round(pass_pct / 100 * payout_if_pass - fee, 2)
