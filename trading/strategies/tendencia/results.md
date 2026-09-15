# Resultados estrategia "tendencia" (BTCUSD H1)

Parámetros (optimizados solo en IS): `{"ema_len": 200, "dc_len": 55, "atr_len": 14, "sl_mult": 3.0, "trail_mult": 4.0, "adx_len": 14, "adx_min": 25.0, "allow_short": 0, "exit_on_ema": 0, "risk_pct": 1.5, "risk_base": 1000.0, "min_lot": 0.01, "lot_step": 0.01, "max_lots": 1.0}`

Periodos: IS 2023-09-01..2025-02-28 (13128 velas), OOS 2025-03-01..2026-09-05 (13274 velas), FULL 2023-09-01..2026-09-05 (26402 velas)

## Corridas oficiales (capital 1000, max_dd_limit=300, stop_on_dd=True)

| Periodo | Coste | Lev | Neto USD | USD/hora | Max DD intravela | DD>300? | Trades | Win % | PF | Costes totales |
|---|---|---|---|---|---|---|---|---|---|---|
| IS | pepperstone | 2 | 541.68 | 0.0413 | 218.71 | no | 85 | 38.8 | 1.919 | 100.43 |
| IS | pepperstone | 10 | 605.73 | 0.0461 | 218.71 | no | 85 | 38.8 | 2.027 | 102.4 |
| IS | eightcap | 2 | 553.58 | 0.0422 | 214.31 | no | 85 | 38.8 | 1.951 | 88.53 |
| IS | eightcap | 10 | 617.73 | 0.0471 | 214.31 | no | 85 | 38.8 | 2.061 | 90.39 |
| IS | conservative | 2 | 496.32 | 0.0378 | 234.57 | no | 85 | 38.8 | 1.81 | 145.79 |
| IS | conservative | 10 | 559.71 | 0.0426 | 234.57 | no | 85 | 38.8 | 1.914 | 148.41 |
| OOS | pepperstone | 2 | -205.14 | -0.0155 | 302.54 | SI | 72 | 26.4 | 0.709 | 83.2 |
| OOS | pepperstone | 10 | -203.17 | -0.0153 | 300.83 | SI | 72 | 26.4 | 0.711 | 83.08 |
| OOS | eightcap | 2 | -200.42 | -0.0151 | 301.31 | SI | 73 | 26.0 | 0.715 | 76.02 |
| OOS | eightcap | 10 | -199.81 | -0.0151 | 300.0 | SI | 72 | 26.4 | 0.715 | 76.02 |
| OOS | conservative | 2 | -215.58 | -0.0162 | 302.64 | SI | 71 | 25.4 | 0.693 | 115.46 |
| OOS | conservative | 10 | -213.54 | -0.0161 | 300.09 | SI | 71 | 26.8 | 0.695 | 115.47 |
| FULL | pepperstone | 2 | 316.57 | 0.012 | 300.83 | SI | 158 | 32.9 | 1.241 | 183.83 |
| FULL | pepperstone | 10 | 380.62 | 0.0144 | 300.83 | SI | 158 | 32.9 | 1.29 | 185.79 |
| FULL | eightcap | 2 | 331.93 | 0.0126 | 300.0 | SI | 158 | 32.9 | 1.254 | 164.78 |
| FULL | eightcap | 10 | 396.08 | 0.015 | 300.0 | SI | 158 | 32.9 | 1.303 | 166.64 |
| FULL | conservative | 2 | 278.81 | 0.0106 | 300.52 | SI | 155 | 32.9 | 1.212 | 259.01 |
| FULL | conservative | 10 | 342.2 | 0.013 | 300.52 | SI | 155 | 32.9 | 1.26 | 261.63 |

## FULL sin stop_on_dd (drawdown real de equity)

| Coste | Lev | Neto USD | USD/hora | Max DD intravela | Max DD cierre | Momento 1ª rotura 300 | Trades | PF |
|---|---|---|---|---|---|---|---|---|
| pepperstone | 2 | 438.32 | 0.0166 | 402.4 | 402.07 | 2026-05-14 23:00:00+00:00 | 173 | 1.304 |
| pepperstone | 10 | 502.37 | 0.019 | 402.4 | 402.07 | 2026-05-14 23:00:00+00:00 | 173 | 1.349 |
| eightcap | 2 | 459.73 | 0.0174 | 395.73 | 395.4 | 2026-05-15 04:00:00+00:00 | 173 | 1.323 |
| eightcap | 10 | 523.88 | 0.0198 | 395.73 | 395.4 | 2026-05-15 04:00:00+00:00 | 173 | 1.368 |
| conservative | 2 | 351.36 | 0.0133 | 445.86 | 445.53 | 2026-05-05 14:00:00+00:00 | 173 | 1.236 |
| conservative | 10 | 414.75 | 0.0157 | 445.86 | 445.53 | 2026-05-05 14:00:00+00:00 | 173 | 1.279 |

Neto por año (FULL sin stop, Pepperstone lev 2): 2023: 392.44, 2024: 166.26, 2025: -94.18, 2026: -26.19

## Robustez OOS (Pepperstone, lev 2): variación de cada parámetro clave

Base OOS: neto -205.14 USD, USD/h -0.0155, DD 302.54, trades 72, PF 0.709

| Parámetro | Variación | Valor | Neto USD | USD/hora | Max DD | Trades | PF | Positivo? |
|---|---|---|---|---|---|---|---|---|
| ema_len | -40 % | 120 | -225.92 | -0.017 | 300.18 | 74 | 0.693 | NO |
| ema_len | -20 % | 160 | -208.9 | -0.0157 | 306.3 | 72 | 0.705 | NO |
| ema_len | +20 % | 240 | -196.44 | -0.0148 | 301.02 | 71 | 0.718 | NO |
| ema_len | +40 % | 280 | -191.79 | -0.0144 | 302.17 | 74 | 0.723 | NO |
| dc_len | -40 % | 33 | -177.94 | -0.0134 | 300.53 | 89 | 0.77 | NO |
| dc_len | -20 % | 44 | -156.64 | -0.0118 | 300.25 | 74 | 0.775 | NO |
| dc_len | +20 % | 66 | -204.61 | -0.0154 | 301.13 | 70 | 0.705 | NO |
| dc_len | +40 % | 77 | -202.61 | -0.0153 | 302.04 | 64 | 0.69 | NO |
| atr_len | -40 % | 8 | -237.05 | -0.0179 | 300.43 | 71 | 0.663 | NO |
| atr_len | -20 % | 11 | -233.06 | -0.0176 | 302.33 | 68 | 0.652 | NO |
| atr_len | +20 % | 17 | -207.12 | -0.0156 | 300.22 | 73 | 0.712 | NO |
| atr_len | +40 % | 20 | -216.44 | -0.0163 | 301.44 | 72 | 0.685 | NO |
| sl_mult | -40 % | 1.8 | -240.85 | -0.0181 | 300.37 | 75 | 0.612 | NO |
| sl_mult | -20 % | 2.4 | -194.63 | -0.0147 | 300.82 | 78 | 0.717 | NO |
| sl_mult | +20 % | 3.6 | -197.26 | -0.0149 | 301.27 | 69 | 0.727 | NO |
| sl_mult | +40 % | 4.2 | -219.85 | -0.0166 | 302.09 | 68 | 0.7 | NO |
| trail_mult | -40 % | 2.4 | -240.03 | -0.0181 | 300.63 | 99 | 0.62 | NO |
| trail_mult | -20 % | 3.2 | -249.43 | -0.0188 | 300.37 | 77 | 0.599 | NO |
| trail_mult | +20 % | 4.8 | -227.82 | -0.0172 | 300.47 | 62 | 0.659 | NO |
| trail_mult | +40 % | 5.6 | -258.71 | -0.0195 | 300.89 | 53 | 0.593 | NO |
| adx_min | -40 % | 15.0 | -210.8 | -0.0159 | 300.82 | 76 | 0.719 | NO |
| adx_min | -20 % | 20.0 | -229.53 | -0.0173 | 307.32 | 76 | 0.697 | NO |
| adx_min | +20 % | 30.0 | -231.22 | -0.0174 | 300.51 | 62 | 0.642 | NO |
| adx_min | +40 % | 35.0 | 13.21 | 0.001 | 242.59 | 55 | 1.025 | si |
| risk_pct | -40 % | 0.9 | -213.92 | -0.0161 | 300.1 | 73 | 0.695 | NO |
| risk_pct | -20 % | 1.2 | -202.21 | -0.0152 | 300.1 | 73 | 0.712 | NO |
| risk_pct | +20 % | 1.8 | -202.4 | -0.0152 | 300.07 | 72 | 0.712 | NO |
| risk_pct | +40 % | 2.1 | -202.76 | -0.0153 | 300.43 | 72 | 0.711 | NO |

Variaciones con OOS positivo: 1/28 = 4 % (rúbrica pide >= 70 %)

## Diagnóstico: comportamiento OOS de TODA la rejilla IS (144 combos, Pepperstone lev 2)

No se usa para elegir parámetros; sirve para saber si la familia de estrategias funciona fuera de muestra.

- Combos con OOS positivo: 19 %; mediana neto OOS -214.48 USD; máximo 321.84 USD
- Mediana PF OOS: 0.701; correlación neto IS vs OOS: -0.383
- Neto OOS de los 10 mejores IS por PF: [-205.14, -222.69, -245.47, 119.47, -229.53, -210.8, -272.68, -138.84, -178.17, -182.44]
- Mediana neto OOS long-only vs long+short: {0: -240.06, 1: -168.52}; por trail_mult: {2.0: -72.85, 3.0: -246.99, 4.0: -195.29}
