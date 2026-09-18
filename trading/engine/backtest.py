"""
Motor de backtest común para BTCUSD CFD (MT4/MT5-like).
- Datos: velas OHLCV con índice UTC (H1 o M15). Fuente: Bitstamp BTC/USD (ff137/bitstamp-btcusd-minute-data).
- Ejecución: la señal se calcula con el CIERRE de la vela t y se ejecuta en la APERTURA de la vela t+1.
- Costes: spread (USD por BTC, total ida y vuelta), comisión por lote ida y vuelta, swap diario (% anual, cobrado a 00:00 UTC),
  slippage fijo en USD por BTC en cada fill.
- 1 lote = 1 BTC. Lote mínimo 0.01. Margen = notional / leverage. Si el margen requerido supera el equity libre, la orden se reduce.
- SL/TP se evalúan intra-vela con high/low. Si SL y TP se tocan en la misma vela se asume SL (conservador).
- Drawdown se mide sobre EQUITY (balance + PnL flotante), que es lo que el usuario limita a 300 USD.

Uso desde una estrategia:
    from engine.backtest import Backtester, CostModel
    bt = Backtester(df, CostModel.pepperstone_razor(), capital=1000, leverage=2)
    result = bt.run(signal_fn)   # signal_fn(df_hasta_t) -> dict(pos=+1/-1/0, lots=float|None, sl=float|None, tp=float|None)
Para velocidad, signal_fn puede ser vectorizado: precalcular columnas 'pos','lots','sl','tp' en df y usar bt.run_vectorized(df).
"""
from __future__ import annotations
import json, math
from dataclasses import dataclass, asdict
import numpy as np
import pandas as pd

HOURS_PER_YEAR = 24 * 365


@dataclass
class CostModel:
    name: str
    spread_usd: float          # spread total en USD por 1 BTC (se paga mitad al entrar, mitad al salir)
    commission_per_lot_rt: float  # comisión USD por lote ida y vuelta
    swap_long_pct_year: float  # negativo = coste. Ej: -20.0
    swap_short_pct_year: float # negativo = coste, positivo = crédito
    slippage_usd: float = 5.0  # USD por BTC en cada fill (entrada y salida)
    swap_days_per_week: int = 7
    triple_swap_weekday: int | None = None  # 4 = viernes; None = sin triple

    @staticmethod
    def pepperstone_razor():
        # Fuente: WebSearch (pepperstone.com pricing, resumen): comisión 7 USD/lote RT, swap long -20 %/año, short +7.5 %/año.
        # Spread BTCUSD estimado ~15 USD (no verificado directamente; rango típico 10-30 USD). ESTIMADO.
        return CostModel("Pepperstone Razor (estimado)", spread_usd=15.0, commission_per_lot_rt=7.0,
                         swap_long_pct_year=-20.0, swap_short_pct_year=+7.5, slippage_usd=5.0)

    @staticmethod
    def eightcap():
        # Fuente: WebSearch (brokerchooser/compareforexbrokers): spread BTC ~12 USD, sin comisión en cripto. Swap no verificado -> asumo -20 %/-10 %.
        return CostModel("Eightcap (estimado)", spread_usd=12.0, commission_per_lot_rt=0.0,
                         swap_long_pct_year=-20.0, swap_short_pct_year=-10.0, slippage_usd=5.0)

    @staticmethod
    def conservative():
        # Escenario pesimista para test de robustez.
        return CostModel("Conservador", spread_usd=30.0, commission_per_lot_rt=7.0,
                         swap_long_pct_year=-25.0, swap_short_pct_year=-15.0, slippage_usd=10.0)


@dataclass
class Trade:
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    side: int
    lots: float
    entry: float
    exit: float
    pnl: float
    costs: float
    reason: str


class Backtester:
    def __init__(self, df: pd.DataFrame, cost: CostModel, capital: float = 1000.0, leverage: float = 2.0,
                 min_lot: float = 0.01, lot_step: float = 0.01, max_dd_limit: float = 300.0, stop_on_dd: bool = True):
        req = {"open", "high", "low", "close"}
        assert req.issubset(df.columns), f"faltan columnas {req - set(df.columns)}"
        assert df.index.tz is not None, "índice debe ser UTC tz-aware"
        self.df = df
        self.cost = cost
        self.capital = capital
        self.leverage = leverage
        self.min_lot = min_lot
        self.lot_step = lot_step
        self.max_dd_limit = max_dd_limit
        self.stop_on_dd = stop_on_dd

    # ------------------------------------------------------------------
    def run_vectorized(self, sig: pd.DataFrame) -> "Result":
        """sig: DataFrame alineado con self.df con columnas pos (+1/-1/0), lots (float o NaN=auto), sl, tp (NaN=sin)."""
        df = self.df
        o, h, l, c = df.open.values, df.high.values, df.low.values, df.close.values
        idx = df.index
        pos_sig = sig["pos"].fillna(0).values.astype(int)
        lots_sig = sig["lots"].values if "lots" in sig else np.full(len(df), np.nan)
        sl_sig = sig["sl"].values if "sl" in sig else np.full(len(df), np.nan)
        tp_sig = sig["tp"].values if "tp" in sig else np.full(len(df), np.nan)

        cm = self.cost
        balance = self.capital
        equity_curve = np.empty(len(df)); equity_curve[:] = np.nan
        trades: list[Trade] = []
        pos = 0; lots = 0.0; entry = 0.0; sl = np.nan; tp = np.nan; entry_t = None; trade_costs = 0.0
        spent_spread = spent_comm = spent_swap = spent_slip = 0.0
        peak = self.capital; max_dd = 0.0; dd_breach_time = None
        last_day = idx[0].date()

        def close_trade(i, price, reason):
            nonlocal balance, pos, lots, entry, sl, tp, entry_t, trade_costs, spent_spread, spent_comm, spent_slip
            fill = price - pos * (cm.spread_usd / 2 + cm.slippage_usd)  # salir: long vende al bid
            gross = (fill - entry) * pos * lots
            comm = cm.commission_per_lot_rt * lots / 2
            spent_comm += comm; spent_spread += cm.spread_usd / 2 * lots; spent_slip += cm.slippage_usd * lots
            balance += gross - comm
            trades.append(Trade(entry_t, idx[i], pos, lots, entry, fill, gross - comm - trade_costs, trade_costs + comm, reason))
            pos = 0; lots = 0.0; entry = 0.0; sl = np.nan; tp = np.nan; entry_t = None; trade_costs = 0.0

        def open_trade(i, side, want_lots, s, t):
            nonlocal balance, pos, lots, entry, sl, tp, entry_t, trade_costs, spent_spread, spent_comm, spent_slip
            price = o[i]
            # tamaño: si NaN -> máximo permitido por margen usando 90 % del balance
            max_lots = (balance * 0.9 * self.leverage) / price
            L = max_lots if (want_lots is None or np.isnan(want_lots)) else min(want_lots, max_lots)
            L = math.floor(L / self.lot_step) * self.lot_step
            if L < self.min_lot - 1e-12:
                return False
            fill = price + side * (cm.spread_usd / 2 + cm.slippage_usd)
            comm = cm.commission_per_lot_rt * L / 2
            balance -= comm
            spent_comm += comm; spent_spread += cm.spread_usd / 2 * L; spent_slip += cm.slippage_usd * L
            pos, lots, entry, sl, tp, entry_t, trade_costs = side, L, fill, s, t, idx[i], comm
            return True

        for i in range(len(df)):
            # 1) swap a las 00:00 UTC (cambio de día)
            d = idx[i].date()
            if d != last_day and pos != 0:
                rate = cm.swap_long_pct_year if pos > 0 else cm.swap_short_pct_year
                mult = 3 if (cm.triple_swap_weekday is not None and idx[i].weekday() == cm.triple_swap_weekday) else 1
                swap = (rate / 100.0 / 365.0) * entry * lots * mult
                balance += swap; spent_swap -= swap; trade_costs -= swap
            last_day = d

            # 2) ejecutar señal generada en la vela anterior, en la apertura de esta
            if i > 0:
                target = pos_sig[i - 1]
                if target != pos:
                    if pos != 0:
                        close_trade(i, o[i], "signal")
                    if target != 0:
                        open_trade(i, target, lots_sig[i - 1], sl_sig[i - 1], tp_sig[i - 1])
                elif pos != 0:
                    # actualizar SL/TP dinámicos si la estrategia los cambia
                    if not np.isnan(sl_sig[i - 1]): sl = sl_sig[i - 1]
                    if not np.isnan(tp_sig[i - 1]): tp = tp_sig[i - 1]

            # 3) SL / TP intra-vela (conservador: SL primero)
            if pos != 0:
                if pos > 0:
                    if not np.isnan(sl) and l[i] <= sl:
                        close_trade(i, sl, "sl")
                    elif not np.isnan(tp) and h[i] >= tp:
                        close_trade(i, tp, "tp")
                else:
                    if not np.isnan(sl) and h[i] >= sl:
                        close_trade(i, sl, "sl")
                    elif not np.isnan(tp) and l[i] <= tp:
                        close_trade(i, tp, "tp")

            # 4) equity flotante al cierre (peor caso intravela para DD: usar low/high)
            if pos != 0:
                worst = l[i] if pos > 0 else h[i]
                float_worst = (worst - pos * (cm.spread_usd / 2) - entry) * pos * lots
                float_close = (c[i] - pos * (cm.spread_usd / 2) - entry) * pos * lots
            else:
                float_worst = float_close = 0.0
            equity_curve[i] = balance + float_close
            eq_worst = balance + float_worst
            peak = max(peak, equity_curve[i])
            dd = peak - eq_worst
            if dd > max_dd:
                max_dd = dd
            if dd > self.max_dd_limit and dd_breach_time is None:
                dd_breach_time = idx[i]
                if self.stop_on_dd:
                    if pos != 0:
                        close_trade(i, c[i], "dd_stop")
                    equity_curve[i:] = balance
                    break
            # margin call: equity < margen requerido * 50 %
            if pos != 0 and eq_worst < (entry * lots / self.leverage) * 0.5:
                close_trade(i, worst, "margin_call")
                equity_curve[i] = balance

        if pos != 0:
            close_trade(len(df) - 1, c[-1], "end")
            equity_curve[-1] = balance
        eq = pd.Series(equity_curve, index=idx).ffill()
        return Result(self, eq, trades, dict(spread=spent_spread, commission=spent_comm, swap=spent_swap, slippage=spent_slip),
                      max_dd, dd_breach_time)


class Result:
    def __init__(self, bt, equity, trades, costs, max_dd, dd_breach_time):
        self.bt, self.equity, self.trades, self.costs, self.max_dd, self.dd_breach_time = bt, equity, trades, costs, max_dd, dd_breach_time

    def metrics(self) -> dict:
        eq = self.equity
        cap = self.bt.capital
        hours = (eq.index[-1] - eq.index[0]).total_seconds() / 3600
        net = eq.iloc[-1] - cap
        pnls = np.array([t.pnl for t in self.trades])
        wins = pnls[pnls > 0]; losses = pnls[pnls <= 0]
        pf = wins.sum() / abs(losses.sum()) if len(losses) and losses.sum() != 0 else float("inf") if len(wins) else 0.0
        daily = eq.resample("1D").last().dropna().pct_change().dropna()
        sharpe = float(daily.mean() / daily.std() * math.sqrt(365)) if len(daily) > 2 and daily.std() > 0 else 0.0
        bh = cap * (self.bt.df.close.iloc[-1] / self.bt.df.close.iloc[0]) - cap
        years = hours / HOURS_PER_YEAR
        cagr = ((eq.iloc[-1] / cap) ** (1 / years) - 1) * 100 if years > 0 and eq.iloc[-1] > 0 else -100.0
        # rolling DD sobre equity de cierre
        roll_dd = (eq.cummax() - eq)
        m = dict(
            capital=cap, final_equity=round(float(eq.iloc[-1]), 2), net_profit=round(float(net), 2),
            usd_per_hour=round(float(net / hours), 4), usd_per_day=round(float(net / hours * 24), 3),
            hours=int(hours), years=round(years, 2), cagr_pct=round(float(cagr), 2),
            max_dd_usd_intrabar=round(float(self.max_dd), 2), max_dd_usd_close=round(float(roll_dd.max()), 2),
            dd_limit_breached=self.dd_breach_time is not None, dd_breach_time=str(self.dd_breach_time) if self.dd_breach_time else None,
            trades=len(self.trades), win_rate_pct=round(100 * len(wins) / len(pnls), 1) if len(pnls) else 0.0,
            profit_factor=round(float(pf), 3) if pf != float("inf") else "inf",
            avg_trade=round(float(pnls.mean()), 2) if len(pnls) else 0.0,
            sharpe_daily=round(sharpe, 2),
            costs=dict((k, round(float(v), 2)) for k, v in self.costs.items()),
            total_costs=round(float(sum(self.costs.values())), 2),
            buy_and_hold_net=round(float(bh), 2), buy_and_hold_usd_per_hour=round(float(bh / hours), 4),
            target_usd_per_hour=1.0, target_met=bool(net / hours >= 1.0 and self.dd_breach_time is None),
        )
        # por año
        by_year = {}
        for y, g in eq.groupby(eq.index.year):
            by_year[int(y)] = round(float(g.iloc[-1] - (eq[eq.index < g.index[0]].iloc[-1] if (eq.index < g.index[0]).any() else cap)), 2)
        m["net_by_year"] = by_year
        return m

    def summary(self) -> str:
        return json.dumps(self.metrics(), indent=2, ensure_ascii=False)


def load_h1(path="trading/data/BTCUSD_H1_2023-09_2026-09.csv") -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["dt"], index_col="dt")
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    return df


def load_m15(path="trading/data/BTCUSD_M15_2023-09_2026-09.csv.gz") -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["dt"], index_col="dt")
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    return df


IS_END = pd.Timestamp("2025-03-01", tz="UTC")   # in-sample: 2023-09-01 .. 2025-02-28 ; out-of-sample: 2025-03-01 .. 2026-09-05


def split(df):
    return df[df.index < IS_END], df[df.index >= IS_END]
