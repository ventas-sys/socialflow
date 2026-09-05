# Resultados – estrategia `reversion` (M15)

Parámetros: `{"bb_period": 20, "bb_dev": 3.0, "rsi_period": 14, "rsi_low": 25.0, "atr_period": 14, "atr_mult": 2.5, "max_bars": 8, "trend_filter": 1, "ema_period": 200, "session_filter": 0, "hour_start": 7, "hour_end": 21, "risk_pct": 1.5, "capital": 1000.0, "allow_long": 1, "allow_short": 1, "confirm": 0}`

Datos: 105606 velas M15, 2023-09-01 00:00:00+00:00 → 2026-09-05 01:15:00+00:00; IS hasta 2025-03-01 (52512 velas), OOS 53094 velas.

## Corrida oficial (stop_on_dd=True, límite 300 USD equity)

| periodo | coste | lev | net | usd_h | dd_intrabar | dd_cierre | dd300 | trades | wr | pf | avg | costes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| IS | pepperstone | lev2 | 24.6 | 0.0019 | 57.7 | 54.99 | no | 64 | 48.4 | 1.099 | 0.38 | 43.73 |
| IS | pepperstone | lev10 | 9.63 | 0.0007 | 78.45 | 75.74 | no | 64 | 48.4 | 1.029 | 0.15 | 62.16 |
| IS | eightcap | lev2 | 32.59 | 0.0025 | 53.31 | 50.3 | no | 64 | 50 | 1.132 | 0.51 | 31.62 |
| IS | eightcap | lev10 | 27.45 | 0.0021 | 72.42 | 69.41 | no | 64 | 50 | 1.086 | 0.43 | 44.33 |
| IS | conservative | lev2 | -20.74 | -0.0016 | 69.75 | 67.39 | no | 64 | 48.4 | 0.922 | -0.32 | 78.11 |
| IS | conservative | lev10 | -40.78 | -0.0031 | 95 | 92.64 | no | 64 | 48.4 | 0.884 | -0.64 | 112.6 |
| OOS | pepperstone | lev2 | -151.7 | -0.0114 | 160.4 | 160.4 | no | 74 | 43.2 | 0.489 | -2.05 | 30.1 |
| OOS | pepperstone | lev10 | -149.3 | -0.0113 | 210.9 | 204.8 | no | 74 | 43.2 | 0.655 | -2.02 | 62.38 |
| OOS | eightcap | lev2 | -147.4 | -0.0111 | 157 | 157 | no | 74 | 43.2 | 0.505 | -1.99 | 22.59 |
| OOS | eightcap | lev10 | -132.2 | -0.01 | 198.7 | 193.5 | no | 74 | 43.2 | 0.687 | -1.79 | 45.27 |
| OOS | conservative | lev2 | -179.8 | -0.0135 | 186.1 | 186.1 | no | 74 | 37.8 | 0.424 | -2.43 | 55.05 |
| OOS | conservative | lev10 | -202.4 | -0.0153 | 245.2 | 237.7 | no | 74 | 37.8 | 0.558 | -2.74 | 113.6 |
| FULL | pepperstone | lev2 | -162.6 | -0.0062 | 205.3 | 205.3 | no | 144 | 45.1 | 0.724 | -1.13 | 76.71 |
| FULL | pepperstone | lev10 | -200.6 | -0.0076 | 276.8 | 271.6 | no | 144 | 45.1 | 0.757 | -1.39 | 133.8 |
| FULL | eightcap | lev2 | -152 | -0.0058 | 202.6 | 202.6 | no | 144 | 45.8 | 0.741 | -1.06 | 55.97 |
| FULL | eightcap | lev10 | -160.2 | -0.0061 | 251.3 | 246.9 | no | 144 | 45.8 | 0.801 | -1.11 | 96.2 |
| FULL | conservative | lev2 | -232.6 | -0.0088 | 251.6 | 251.6 | no | 144 | 41.7 | 0.62 | -1.62 | 135.4 |
| FULL | conservative | lev10 | -274.1 | -0.0104 | 300.9 | 298.4 | SÍ | 137 | 42.3 | 0.667 | -2 | 226.1 |
| IS | zero_cost | lev2 | 52.69 | 0.004 | 44.09 | 40.42 | no | 64 | 51.6 | 1.217 | 0.82 | 0 |
| OOS | zero_cost | lev2 | -132.1 | -0.0099 | 144.3 | 144.3 | no | 74 | 44.6 | 0.548 | -1.78 | 0 |
| FULL | zero_cost | lev2 | -98.94 | -0.0037 | 176.5 | 176.5 | no | 144 | 47.2 | 0.829 | -0.69 | 0 |

## FULL sin stop_on_dd (drawdown real)

| periodo | coste | lev | net | usd_h | dd_intrabar | dd_cierre | dd300 | trades | wr | pf | avg | costes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL | pepperstone | lev2 | -162.6 | -0.0062 | 205.3 | 205.3 | no | 144 | 45.1 | 0.724 | -1.13 | 76.71 |
| FULL | pepperstone | lev10 | -200.6 | -0.0076 | 276.8 | 271.6 | no | 144 | 45.1 | 0.757 | -1.39 | 133.8 |
| FULL | eightcap | lev2 | -152 | -0.0058 | 202.6 | 202.6 | no | 144 | 45.8 | 0.741 | -1.06 | 55.97 |
| FULL | eightcap | lev10 | -160.2 | -0.0061 | 251.3 | 246.9 | no | 144 | 45.8 | 0.801 | -1.11 | 96.2 |
| FULL | conservative | lev2 | -232.6 | -0.0088 | 251.6 | 251.6 | no | 144 | 41.7 | 0.62 | -1.62 | 135.4 |
| FULL | conservative | lev10 | -311.2 | -0.0118 | 339.9 | 335.4 | SÍ | 144 | 41.7 | 0.646 | -2.16 | 240.4 |
| FULL | zero_cost | lev2 | -98.94 | -0.0037 | 176.5 | 176.5 | no | 144 | 47.2 | 0.829 | -0.69 | 0 |

## Beneficio por año (FULL sin stop, Pepperstone lev 2)

`{"2023": -8.84, "2024": 30.5, "2025": -64.81, "2026": -119.44}`

## Motivos de salida (FULL sin stop, Pepperstone lev 2)

`{"signal": 63, "sl": 57, "tp": 24}`

## Robustez OOS (Pepperstone, lev 2, sin stop DD): 1/32 variaciones positivas (3.1 %)

| param | factor | value | net | usd_h | dd | pf | trades | positive |
|---|---|---|---|---|---|---|---|---|
| (base) | 1 | None | -151.7 | -0.0114 | 160.4 | 0.489 | 74 | False |
| bb_period | 0.6 | 12 | -42.29 | -0.0032 | 50.66 | 0.512 | 18 | False |
| bb_period | 0.8 | 16 | -132.5 | -0.01 | 140.8 | 0.411 | 50 | False |
| bb_period | 1.2 | 24 | -174.1 | -0.0131 | 176.8 | 0.471 | 84 | False |
| bb_period | 1.4 | 28 | -189.9 | -0.0143 | 204.2 | 0.473 | 91 | False |
| bb_dev | 0.6 | 1.8 | -258.1 | -0.0194 | 269.9 | 0.59 | 177 | False |
| bb_dev | 0.8 | 2.4 | -201.5 | -0.0152 | 212.8 | 0.558 | 125 | False |
| bb_dev | 1.2 | 3.6 | -72.79 | -0.0055 | 72.79 | 0.299 | 18 | False |
| bb_dev | 1.4 | 4.2 | 0 | 0 | 0 | 0 | 0 | False |
| rsi_low | 0.6 | 15 | 23.31 | 0.0018 | 19.43 | 2.227 | 7 | True |
| rsi_low | 0.8 | 20 | -69.1 | -0.0052 | 91.15 | 0.458 | 24 | False |
| rsi_low | 1.2 | 30 | -233.5 | -0.0176 | 254.2 | 0.499 | 125 | False |
| rsi_low | 1.4 | 35 | -231.2 | -0.0174 | 275.5 | 0.633 | 190 | False |
| atr_mult | 0.6 | 1.5 | -146 | -0.011 | 146 | 0.49 | 79 | False |
| atr_mult | 0.8 | 2 | -146 | -0.011 | 159.2 | 0.533 | 77 | False |
| atr_mult | 1.2 | 3 | -132.3 | -0.01 | 146.7 | 0.517 | 73 | False |
| atr_mult | 1.4 | 3.5 | -154.3 | -0.0116 | 156.7 | 0.433 | 71 | False |
| max_bars | 0.6 | 5 | -115.1 | -0.0087 | 124.3 | 0.572 | 74 | False |
| max_bars | 0.8 | 6 | -118 | -0.0089 | 132.4 | 0.572 | 74 | False |
| max_bars | 1.2 | 10 | -143.8 | -0.0108 | 159.7 | 0.541 | 74 | False |
| max_bars | 1.4 | 11 | -114.4 | -0.0086 | 129.5 | 0.623 | 74 | False |
| ema_period | 0.6 | 120 | -107.9 | -0.0081 | 110.6 | 0.539 | 56 | False |
| ema_period | 0.8 | 160 | -133.2 | -0.01 | 141.9 | 0.52 | 68 | False |
| ema_period | 1.2 | 240 | -130.1 | -0.0098 | 155.8 | 0.563 | 74 | False |
| ema_period | 1.4 | 280 | -120.7 | -0.0091 | 150.4 | 0.592 | 76 | False |
| rsi_period | 0.6 | 8 | -258.7 | -0.0195 | 277.2 | 0.568 | 173 | False |
| rsi_period | 0.8 | 11 | -227.5 | -0.0171 | 229.8 | 0.452 | 113 | False |
| rsi_period | 1.2 | 17 | -104.4 | -0.0079 | 117.3 | 0.469 | 40 | False |
| rsi_period | 1.4 | 20 | -80.9 | -0.0061 | 104.1 | 0.394 | 23 | False |
| atr_period | 0.6 | 8 | -168.3 | -0.0127 | 168.3 | 0.425 | 73 | False |
| atr_period | 0.8 | 11 | -138.2 | -0.0104 | 144.4 | 0.521 | 74 | False |
| atr_period | 1.2 | 17 | -150.7 | -0.0114 | 160.8 | 0.491 | 74 | False |
| atr_period | 1.4 | 20 | -150.1 | -0.0113 | 162.1 | 0.514 | 76 | False |

## Coste por trade vs movimiento objetivo (144 señales FULL, precio medio 79531.0 USD)

| coste | cost_rt_usd_per_btc | avg_target_move_usd | median_target_move_usd | cost_pct_of_target | avg_sl_dist_usd | cost_pct_of_sl |
|---|---|---|---|---|---|---|
| pepperstone | 32.00 | 1230.10 | 1000.60 | 2.60 | 657.80 | 4.86 |
| eightcap | 22.00 | 1230.10 | 1000.60 | 1.79 | 657.80 | 3.34 |
| conservative | 57.00 | 1230.10 | 1000.60 | 4.63 | 657.80 | 8.66 |
