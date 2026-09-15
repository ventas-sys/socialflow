# Resultados breakout (rango asiático + compresión) BTCUSD H1

Datos: 2023-09-01 00:00:00+00:00 → 2026-09-05 01:00:00+00:00 (26402 velas H1). IS hasta 2025-02-28 23:00:00+00:00, OOS desde 2025-03-01 00:00:00+00:00.

Parámetros: `{"range_start": 0, "range_end": 8, "entry_end": 13, "exit_eod": true, "exit_hour": 23, "compress_k": 0.35, "buffer_atr": 0.0, "sl_mult": 0.5, "sl_floor_atr": 0.25, "tp_r": 2.0, "vol_mult": 1.2, "vol_len": 20, "atr_len": 14, "risk_pct": 1.0, "capital": 1000.0, "lot_step": 0.01, "min_lot": 0.01}`

## Corrida oficial (max_dd_limit=300, stop_on_dd=True)

| period | cost | leverage | net_profit | usd_per_hour | max_dd_usd_intrabar | dd_limit_breached | trades | win_rate_pct | profit_factor | avg_trade | total_costs | sharpe_daily |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| IS | pepperstone | 2 | 124.78 | 0.0095 | 53.34 | False | 70 | 47.10 | 1.50 | 1.78 | 47.36 | 1.18 |
| IS | pepperstone | 10 | 127.08 | 0.0097 | 53.34 | False | 70 | 47.10 | 1.51 | 1.82 | 47.68 | 1.20 |
| IS | eightcap | 2 | 139.58 | 0.0106 | 52.37 | False | 70 | 48.60 | 1.58 | 1.99 | 32.56 | 1.31 |
| IS | eightcap | 10 | 141.98 | 0.0108 | 52.37 | False | 70 | 48.60 | 1.59 | 2.03 | 32.78 | 1.33 |
| IS | conservative | 2 | 87.78 | 0.0067 | 55.79 | False | 70 | 45.70 | 1.33 | 1.25 | 84.36 | 0.8400 |
| IS | conservative | 10 | 89.83 | 0.0068 | 55.79 | False | 70 | 45.70 | 1.34 | 1.28 | 84.93 | 0.8600 |
| OOS | pepperstone | 2 | 1.81 | 0.0001 | 129.09 | False | 62 | 40.30 | 1.01 | 0.0300 | 23.04 | 0.0500 |
| OOS | pepperstone | 10 | -8.26 | -0.0006 | 139.16 | False | 62 | 40.30 | 0.9710 | -0.1300 | 24.00 | -0.0600 |
| OOS | eightcap | 2 | 9.01 | 0.0007 | 125.39 | False | 62 | 40.30 | 1.03 | 0.1500 | 15.84 | 0.1300 |
| OOS | eightcap | 10 | -0.7600 | -0.0001 | 135.16 | False | 62 | 40.30 | 0.9970 | -0.0100 | 16.50 | 0.0200 |
| OOS | conservative | 2 | -16.19 | -0.0012 | 138.34 | False | 62 | 38.70 | 0.9440 | -0.2600 | 41.04 | -0.1500 |
| OOS | conservative | 10 | -27.01 | -0.0020 | 149.16 | False | 62 | 38.70 | 0.9100 | -0.4400 | 42.75 | -0.2600 |
| FULL | pepperstone | 2 | 175.66 | 0.0067 | 139.16 | False | 135 | 45.20 | 1.33 | 1.30 | 72.32 | 0.8800 |
| FULL | pepperstone | 10 | 177.96 | 0.0067 | 139.16 | False | 135 | 45.20 | 1.33 | 1.32 | 72.64 | 0.8900 |
| FULL | eightcap | 2 | 198.26 | 0.0075 | 135.16 | False | 135 | 45.90 | 1.38 | 1.47 | 49.72 | 0.9800 |
| FULL | eightcap | 10 | 200.66 | 0.0076 | 135.16 | False | 135 | 45.90 | 1.38 | 1.49 | 49.94 | 0.9900 |
| FULL | conservative | 2 | 119.16 | 0.0045 | 149.16 | False | 135 | 43.70 | 1.21 | 0.8800 | 128.82 | 0.6100 |
| FULL | conservative | 10 | 121.21 | 0.0046 | 149.16 | False | 135 | 43.70 | 1.21 | 0.9000 | 129.39 | 0.6200 |

## FULL sin stop_on_dd (drawdown real)

| period | cost | leverage | net_profit | usd_per_hour | max_dd_usd_intrabar | dd_limit_breached | trades | win_rate_pct | profit_factor | avg_trade | total_costs | sharpe_daily |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL | pepperstone | 2 | 175.66 | 0.0067 | 139.16 | False | 135 | 45.20 | 1.33 | 1.30 | 72.32 | 0.8800 |
| FULL | pepperstone | 10 | 177.96 | 0.0067 | 139.16 | False | 135 | 45.20 | 1.33 | 1.32 | 72.64 | 0.8900 |
| FULL | eightcap | 2 | 198.26 | 0.0075 | 135.16 | False | 135 | 45.90 | 1.38 | 1.47 | 49.72 | 0.9800 |
| FULL | eightcap | 10 | 200.66 | 0.0076 | 135.16 | False | 135 | 45.90 | 1.38 | 1.49 | 49.94 | 0.9900 |
| FULL | conservative | 2 | 119.16 | 0.0045 | 149.16 | False | 135 | 43.70 | 1.21 | 0.8800 | 128.82 | 0.6100 |
| FULL | conservative | 10 | 121.21 | 0.0046 | 149.16 | False | 135 | 43.70 | 1.21 | 0.9000 | 129.39 | 0.6200 |

## Robustez ±20 % / ±40 % (OOS, Pepperstone, leverage 2, stop_on_dd=False) — 14/36 variaciones con beneficio > 0 (38.9 %)

| param | factor | value | net_profit | usd_per_hour | max_dd_usd_intrabar | trades | profit_factor | win_rate_pct |
|---|---|---|---|---|---|---|---|---|
| (base) | 1.00 | None | 1.81 | 0.0001 | 129.09 | 62 | 1.01 | 40.30 |
| compress_k | 0.6000 | 0.2100 | 16.31 | 0.0012 | 59.65 | 24 | 1.16 | 45.80 |
| compress_k | 0.8000 | 0.2800 | -10.13 | -0.0008 | 117.30 | 43 | 0.9480 | 41.90 |
| compress_k | 1.20 | 0.4200 | -52.77 | -0.0040 | 142.30 | 85 | 0.8690 | 36.50 |
| compress_k | 1.40 | 0.4900 | -85.91 | -0.0065 | 165.91 | 102 | 0.8250 | 35.30 |
| sl_mult | 0.6000 | 0.3000 | 1.81 | 0.0001 | 129.09 | 62 | 1.01 | 40.30 |
| sl_mult | 0.8000 | 0.4000 | 1.81 | 0.0001 | 129.09 | 62 | 1.01 | 40.30 |
| sl_mult | 1.20 | 0.6000 | 1.81 | 0.0001 | 129.09 | 62 | 1.01 | 40.30 |
| sl_mult | 1.40 | 0.7000 | 1.81 | 0.0001 | 129.09 | 62 | 1.01 | 40.30 |
| sl_floor_atr | 0.6000 | 0.1500 | -13.89 | -0.0010 | 100.85 | 62 | 0.9450 | 40.30 |
| sl_floor_atr | 0.8000 | 0.2000 | -70.44 | -0.0053 | 145.63 | 62 | 0.7580 | 37.10 |
| sl_floor_atr | 1.20 | 0.3000 | 52.76 | 0.0040 | 124.65 | 62 | 1.20 | 45.20 |
| sl_floor_atr | 1.40 | 0.3500 | 105.91 | 0.0080 | 97.74 | 62 | 1.44 | 50.00 |
| tp_r | 0.6000 | 1.20 | -48.28 | -0.0036 | 106.15 | 62 | 0.8190 | 43.50 |
| tp_r | 0.8000 | 1.60 | -41.34 | -0.0031 | 135.71 | 62 | 0.8510 | 40.30 |
| tp_r | 1.20 | 2.40 | 12.28 | 0.0009 | 127.53 | 62 | 1.04 | 40.30 |
| tp_r | 1.40 | 2.80 | 24.92 | 0.0019 | 124.85 | 62 | 1.09 | 40.30 |
| vol_mult | 0.6000 | 0.7200 | -107.01 | -0.0081 | 172.94 | 99 | 0.7720 | 35.40 |
| vol_mult | 0.8000 | 0.9600 | -38.39 | -0.0029 | 121.77 | 81 | 0.8950 | 39.50 |
| vol_mult | 1.20 | 1.44 | -33.34 | -0.0025 | 130.28 | 54 | 0.8650 | 38.90 |
| vol_mult | 1.40 | 1.68 | -42.69 | -0.0032 | 127.82 | 49 | 0.8140 | 38.80 |
| entry_end | 0.6000 | 8 | 0.0000 | 0.0000 | 0.0000 | 0 | 0.0000 | 0.0000 |
| entry_end | 0.8000 | 10 | 22.22 | 0.0017 | 43.92 | 27 | 1.22 | 48.10 |
| entry_end | 1.20 | 16 | -128.79 | -0.0097 | 241.04 | 144 | 0.7930 | 35.40 |
| entry_end | 1.40 | 18 | -111.98 | -0.0084 | 235.04 | 169 | 0.8350 | 36.70 |
| risk_pct | 0.6000 | 0.6000 | 13.76 | 0.0010 | 117.14 | 62 | 1.05 | 40.30 |
| risk_pct | 0.8000 | 0.8000 | 6.93 | 0.0005 | 123.97 | 62 | 1.03 | 40.30 |
| risk_pct | 1.20 | 1.20 | -26.34 | -0.0020 | 152.89 | 62 | 0.9140 | 40.30 |
| risk_pct | 1.40 | 1.40 | -18.88 | -0.0014 | 157.59 | 62 | 0.9440 | 40.30 |
| atr_len | 0.6000 | 8 | 31.77 | 0.0024 | 102.54 | 64 | 1.11 | 42.20 |
| atr_len | 0.8000 | 11 | -29.87 | -0.0023 | 109.26 | 64 | 0.9000 | 39.10 |
| atr_len | 1.20 | 17 | -34.49 | -0.0026 | 128.95 | 63 | 0.8820 | 38.10 |
| atr_len | 1.40 | 20 | -53.09 | -0.0040 | 138.69 | 62 | 0.8140 | 37.10 |
| vol_len | 0.6000 | 12 | -77.72 | -0.0059 | 151.35 | 95 | 0.8230 | 34.70 |
| vol_len | 0.8000 | 16 | -43.56 | -0.0033 | 130.80 | 80 | 0.8780 | 38.80 |
| vol_len | 1.20 | 24 | 13.82 | 0.0010 | 111.67 | 57 | 1.06 | 42.10 |
| vol_len | 1.40 | 28 | -22.58 | -0.0017 | 127.24 | 60 | 0.9180 | 38.30 |

## Variante B (referencia; elegida solo con IS: mayor beneficio IS con PF≥1.3 y DD≤300)

Parámetros B: `{"range_start": 0, "range_end": 8, "entry_end": 16, "exit_eod": false, "exit_hour": 23, "compress_k": 0.7, "buffer_atr": 0.0, "sl_mult": 1.0, "sl_floor_atr": 0.25, "tp_r": 2.0, "vol_mult": 0.0, "vol_len": 20, "atr_len": 14, "risk_pct": 1.0, "capital": 1000.0, "lot_step": 0.01, "min_lot": 0.01}`

| period | cost | leverage | stop_on_dd | net_profit | usd_per_hour | max_dd_usd_intrabar | dd_limit_breached | trades | profit_factor | win_rate_pct |
|---|---|---|---|---|---|---|---|---|---|---|
| IS | pepperstone | 2 | True | 564.25 | 0.0430 | 199.73 | False | 260 | 1.31 | 42.70 |
| IS | pepperstone | 10 | True | 567.09 | 0.0432 | 199.73 | False | 260 | 1.31 | 42.70 |
| IS | pepperstone | 2 | False | 564.25 | 0.0430 | 199.73 | False | 260 | 1.31 | 42.70 |
| OOS | pepperstone | 2 | True | -180.08 | -0.0136 | 300.36 | True | 226 | 0.9040 | 31.40 |
| OOS | pepperstone | 10 | True | -180.08 | -0.0136 | 300.36 | True | 226 | 0.9040 | 31.40 |
| OOS | pepperstone | 2 | False | -208.02 | -0.0157 | 330.55 | True | 235 | 0.8930 | 31.10 |
| FULL | pepperstone | 2 | True | 402.78 | 0.0153 | 304.21 | True | 303 | 1.18 | 40.60 |
| FULL | pepperstone | 10 | True | 405.62 | 0.0154 | 304.21 | True | 303 | 1.18 | 40.60 |
| FULL | pepperstone | 2 | False | 367.87 | 0.0139 | 395.18 | True | 507 | 1.09 | 37.30 |

## Rúbrica (cálculo automático)

```
{
  "usd_per_hour_oos_pep_lev2": 0.0001,
  "pts_usd_hour": 1,
  "max_dd_full_nostop": 139.16,
  "pts_dd": 2,
  "pts_robustness": 0,
  "pf_oos": 1.007,
  "trades_oos": 62,
  "pts_pf_trades": 0,
  "subtotal_sin_EA_ni_informe": 3
}
```
