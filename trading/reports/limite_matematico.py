"""Simulación Monte Carlo: ¿qué tasa de acierto diario necesita un trader para ganar 1 USD/h con 1.000 USD y DD <= 300 USD?
Usa los movimientos diarios REALES de BTCUSD (2023-09 → 2026-09), sin costes (mejor caso). Es independiente del activo:
cualquier activo con distinta volatilidad solo cambia el tamaño del lote, no la relación beneficio/drawdown.
Ejecutar desde la raíz del repo: python3 trading/reports/limite_matematico.py
"""
import sys; sys.path.insert(0, '.')
from trading.engine.backtest import load_h1
import numpy as np
df = load_h1()
d = df.resample('1D').agg({'open': 'first', 'close': 'last'}).dropna()
mv = (d.close - d.open).values
hours = (df.index[-1] - df.index[0]).total_seconds() / 3600
rng = np.random.default_rng(0)
print("p_acierto lotes  USD/h  P(DD<=300)  DD_mediana  P(DD>1000)")
for p in [0.50, 0.55, 0.60, 0.70, 0.80, 0.90]:
    for lots in [0.02, 0.05, 0.10, 0.20]:
        res = []
        for _ in range(300):
            hit = rng.random(len(mv)) < p
            pnl = np.where(hit, np.abs(mv), -np.abs(mv)) * lots
            eq = np.r_[0, np.cumsum(pnl)]
            res.append((eq[-1] / hours, (np.maximum.accumulate(eq) - eq).max()))
        res = np.array(res)
        print(f"{p:.2f}      {lots:.2f}  {res[:,0].mean():6.3f}   {(res[:,1]<=300).mean():5.0%}     {np.median(res[:,1]):7.0f}     {(res[:,1]>1000).mean():4.0%}")
