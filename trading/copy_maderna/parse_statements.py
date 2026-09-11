"""Parsea los extractos de Pepperstone (texto plano de los emails "Monthly Statement" / "Daily Confirmation")
y genera trades.csv, balance_ops.csv y open_snapshots.csv.
Los extractos crudos NO se guardan en el repo (contienen nombre y nº de cuenta); se leen de un directorio local.
Uso: python3 trading/copy_maderna/parse_statements.py <directorio_con_txt> <directorio_salida>
"""
import re, glob, os, sys
import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else 'statements'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'trading/copy_maderna'
os.makedirs(OUT, exist_ok=True)

# Formato A (texto concatenado): "60899153 2026.05.14 23:39:34buy0.01eurusd1.166710.000000.00000 2026.05.14 23:39:471.16677-0.070.000.06"
A_CLOSED = re.compile(r'(\d{8})\s+(\d{4}\.\d\d\.\d\d)\s+(\d\d:\d\d:\d\d)(buy|sell)(\d+\.\d\d)([a-z]+)(\d\.\d{5})(\d\.\d{5})(\d\.\d{5})\s+(\d{4}\.\d\d\.\d\d)\s+(\d\d:\d\d:\d\d)(\d\.\d{5})(-?\d+\.\d\d)(-?\d+\.\d\d)(-?\d+\.\d\d)')
A_OPEN = re.compile(r'(\d{8})\s+(\d{4}\.\d\d\.\d\d)\s+(\d\d:\d\d:\d\d)(buy|sell)(\d+\.\d\d)([a-z]+)(\d\.\d{5})(\d\.\d{5})(\d\.\d{5})\s+(\d\.\d{5})(-?\d+\.\d\d)(-?\d+\.\d\d)(-?\d+\.\d\d)')
A_BAL = re.compile(r'(\d{8})\s+(\d{4}\.\d\d\.\d\d)\s+(\d\d:\d\d:\d\d)balance(\w+)[^\d-]*(-?\d+\.\d\d)')
# Formato B (tabla con |): "| 61009973 | 2026.05.29 12:00:00 | sell | 0.01 | eurusd | 1.16283 | 0.00000 | 0.00000 | 2026.06.01 03:23:14 | 1.16476 | -0.07 | 0.03 | -1.93 |"
B_CLOSED = re.compile(r'\|\s*(\d{8})\s*\|\s*(\d{4}\.\d\d\.\d\d \d\d:\d\d:\d\d)\s*\|\s*(buy|sell)\s*\|\s*([\d.]+)\s*\|\s*([a-z]+)\s*\|\s*([\d.]+)\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*(\d{4}\.\d\d\.\d\d \d\d:\d\d:\d\d)\s*\|\s*([\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|')
B_OPEN = re.compile(r'\|\s*(\d{8})\s*\|\s*(\d{4}\.\d\d\.\d\d \d\d:\d\d:\d\d)\s*\|\s*(buy|sell)\s*\|\s*([\d.]+)\s*\|\s*([a-z]+)\s*\|\s*([\d.]+)\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*([\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|')
B_BAL = re.compile(r'\|\s*(\d{8})\s*\|\s*(\d{4}\.\d\d\.\d\d \d\d:\d\d:\d\d)\s*\|\s*balance\s*\|\s*([^|]*?)\s*\|\s*(-?[\d.]+)\s*\|')

def ts(d, t=None):
    return pd.Timestamp((d + ' ' + t if t else d).replace('.', '-', 2))

trades, bals, snaps, summ = [], [], [], []
for f in sorted(glob.glob(os.path.join(SRC, '*.txt'))):
    name = os.path.basename(f)
    stamp = name.split('_')[1].replace('.txt', '')
    t = open(f).read()
    closed, sep, rest = t.partition('Open Trades:')
    if '| Ticket |' in t or '| A/C No' in t:  # formato B
        for m in B_CLOSED.finditer(closed):
            tk, ot, ty, lots, sym, op, ct, cp, com, sw, pnl = m.groups()
            trades.append(dict(ticket=int(tk), open_time=ts(ot), type=ty, lots=float(lots), symbol=sym, open_price=float(op), close_time=ts(ct), close_price=float(cp), commission=float(com), swap=float(sw), pnl=float(pnl), src=name))
        for m in B_BAL.finditer(closed):
            tk, tm, kind, amt = m.groups()
            bals.append(dict(ticket=int(tk), time=ts(tm), kind=kind.strip(), amount=float(amt), src=name))
        for m in B_OPEN.finditer(rest):
            tk, ot, ty, lots, sym, op, cp, com, sw, pnl = m.groups()
            snaps.append(dict(snapshot=stamp, ticket=int(tk), open_time=ts(ot), type=ty, lots=float(lots), symbol=sym, open_price=float(op), mark_price=float(cp), swap=float(sw), float_pnl=float(pnl)))
        eq = re.search(r'Equity:\s*\|\s*([\d ]+\.\d\d)', rest); ba = re.search(r'Balance:\s*\|\s*([\d ]+\.\d\d)', rest)
        dw = re.search(r'Deposit/Withdrawal:\s*\|\s*(-?[\d ]+\.\d\d)', rest)
    else:  # formato A
        for m in A_CLOSED.finditer(closed):
            tk, od, ot, ty, lots, sym, op, sl, tp, cd, ct, cp, com, sw, pnl = m.groups()
            trades.append(dict(ticket=int(tk), open_time=ts(od, ot), type=ty, lots=float(lots), symbol=sym, open_price=float(op), close_time=ts(cd, ct), close_price=float(cp), commission=float(com), swap=float(sw), pnl=float(pnl), src=name))
        for m in A_BAL.finditer(closed):
            tk, d, tm, kind, amt = m.groups()
            bals.append(dict(ticket=int(tk), time=ts(d, tm), kind=kind, amount=float(amt), src=name))
        for m in A_OPEN.finditer(rest):
            tk, od, ot, ty, lots, sym, op, sl, tp, cp, com, sw, pnl = m.groups()
            snaps.append(dict(snapshot=stamp, ticket=int(tk), open_time=ts(od, ot), type=ty, lots=float(lots), symbol=sym, open_price=float(op), mark_price=float(cp), swap=float(sw), float_pnl=float(pnl)))
        eq = re.search(r'Equity:\s*([\d ]+\.\d\d)', rest); ba = re.search(r'Balance:\s*([\d ]+\.\d\d)', rest)
        dw = re.search(r'Deposit/Withdrawal:\s*(-?[\d ]+\.\d\d)', rest)
    summ.append(dict(snapshot=stamp, equity=float(eq.group(1).replace(' ', '')) if eq else None, balance=float(ba.group(1).replace(' ', '')) if ba else None,
                     deposit_withdrawal=float(dw.group(1).replace(' ', '')) if dw else None))

tr = pd.DataFrame(trades).drop_duplicates('ticket').sort_values('open_time').reset_index(drop=True)
tr['net'] = tr.pnl + tr.commission + tr.swap
tr.to_csv(os.path.join(OUT, 'trades.csv'), index=False)
bl = pd.DataFrame(bals).drop_duplicates('ticket').sort_values('time')
bl.to_csv(os.path.join(OUT, 'balance_ops.csv'), index=False)
pd.DataFrame(snaps).to_csv(os.path.join(OUT, 'open_snapshots.csv'), index=False)
sm = pd.DataFrame(summ); sm.to_csv(os.path.join(OUT, 'account_snapshots.csv'), index=False)
print(sm.to_string(index=False))
print('trades', len(tr), 'desde', tr.open_time.min(), 'hasta', tr.close_time.max())
print('por archivo:', tr.groupby('src').size().to_dict())
print('balance ops por tipo:'); print(bl.groupby('kind').amount.agg(['count', 'sum']))
print('P/L neto cerrado total', round(tr.net.sum(), 2), '| bruto', round(tr.pnl.sum(), 2), '| comisiones', round(tr.commission.sum(), 2), '| swap', round(tr.swap.sum(), 2))
