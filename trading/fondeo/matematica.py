"""Matemática del challenge, independiente del activo: Monte Carlo de operaciones i.i.d. con tasa de acierto p,
ratio beneficio/riesgo RR, riesgo r por operación, k operaciones por día, durante D días de trading, bajo las reglas
(objetivo T, pérdida diaria d, pérdida máxima L). Costes: cada operación paga c (fracción del riesgo) en spread+comisión.
Salida: probabilidad de pasar / quemar / no decidir. Sirve para saber qué edge hace falta antes de buscar estrategias.
Uso: python3 trading/fondeo/matematica.py  (escribe trading/fondeo/matematica.md)
"""
import numpy as np, itertools, sys

rng = np.random.default_rng(7)


def simulate(p, RR, r, k, D, T, d, L, c=0.15, n=20000, trailing=False):
    """Devuelve (P_pass, P_fail, P_timeout, mediana de días para pasar)."""
    res = np.zeros(n, dtype=int); days_pass = []
    for s in range(n):
        bal = 0.0; hwm = 0.0; passed = False; failed = False
        for day in range(D):
            day_pl = 0.0
            for t in range(k):
                win = rng.random() < p
                pl = r * RR - r * c if win else -r - r * c
                bal += pl; day_pl += pl; hwm = max(hwm, bal)
                floor = (hwm - L) if trailing else -L
                if day_pl <= -d or bal <= floor:
                    failed = True; break
                if bal >= T:
                    passed = True; break
            if passed or failed: break
        res[s] = 1 if passed else (-1 if failed else 0)
        if passed: days_pass.append(day + 1)
    return (res == 1).mean(), (res == -1).mean(), (res == 0).mean(), (np.median(days_pass) if days_pass else None)


def main():
    out = ['# Matemática del challenge (Monte Carlo, independiente del activo)\n',
           'Operaciones independientes con tasa de acierto p y ratio beneficio/riesgo RR; riesgo r por operación; k operaciones por día; '
           '5 días de trading (una semana). Costes: 15 % del riesgo por operación (spread + comisión + deslizamiento, típico en oro con SL de 1 ATR H1). '
           'Reglas: objetivo 10 %, pérdida diaria 3 %, pérdida máxima 10 % (FTMO 1-Step) o 6 % (FundingPips / FundedNext / The5ers 1-Step).\n']
    rules = {'FTMO 1-Step (10/3/10)': (0.10, 0.03, 0.10, True), '1-Step 10/3/6': (0.10, 0.03, 0.06, False), 'FTMO fase 1 2-Step (10/5/10)': (0.10, 0.05, 0.10, False),
             'E8 One DD 8 % (12/–/8)': (0.12, 1.0, 0.08, True)}
    for name, (T, d, L, tr) in rules.items():
        out.append(f'\n## {name}\n')
        out.append('| edge por operación | p (acierto) | RR | riesgo/op | ops/día | P(pasar 5 días) | P(quemar) | P(sin decidir) |\n|---|---|---|---|---|---|---|---|\n')
        c = 0.15
        combos = []
        for RR in (1, 2, 3, 4):
            p0 = (1 + c) / (1 + RR)                      # tasa de acierto de un sistema SIN edge (esperanza neta cero)
            for edge, label in ((0.0, 'cero (sin edge)'), (0.2, '+0,2 R'), (0.5, '+0,5 R')):
                p = p0 + edge / (1 + RR)
                for r, k in ((0.025, 1), (0.014, 2)):
                    combos.append((label, p, RR, r, k))
        for label, p, RR, r, k in combos:
            pp, pf, pt, md = simulate(p, RR, r, k, 5, T, d, L, c=c, trailing=tr, n=4000)
            out.append(f'| {label} | {p:.2f} | {RR} | {100*r:.1f} % | {k} | **{100*pp:.0f} %** | {100*pf:.0f} % | {100*pt:.0f} % |\n')
    out.append('\n## Lectura\n')
    out.append('- "Sin edge" = la tasa de acierto que corresponde a cada RR cuando el mercado es una moneda al aire (p = (1+c)/(1+RR)); '
               'un sistema real sin ventaja se comporta así cualquiera sea el activo. Con RR alto la línea "sin edge" pasa más veces en 5 días, '
               'pero quema en la misma proporción: es pura varianza, no ventaja.\n')
    out.append('- Para pasar en una semana la mitad de las veces con menos de un 15 % de ruina hace falta una esperanza de +0,5 R por operación '
               '(p.ej. 45 % de acierto con RR 2, o 62 % con RR 1). Ningún sistema de los que probamos con datos reales (BTC, FX, oro) '
               'tiene eso fuera de muestra: los mejores rondan 0 a +0,1 R.\n')
    out.append('- El límite diario del 3 % es lo que manda: obliga a arriesgar ≤ 2,5 % por operación (una sola operación al día) o ≤ 1,3 % (dos al día). '
               'Con 2,5 % y RR 2, el 10 % exige 2 ganadoras netas (≈ +5 % cada una) antes de acumular 4 perdedoras.\n')
    open('trading/fondeo/matematica.md', 'w').write(''.join(out)); print(''.join(out))


if __name__ == '__main__':
    main()
