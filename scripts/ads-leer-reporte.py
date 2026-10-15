#!/usr/bin/env python3
"""Lee el Excel de ML (Publicidad -> Reportes -> Anuncios Estandar) y lo deja
como JSON agrupado por anuncio, listo para scripts/ads-plan.mjs.

El reporte viene "Agrupado por mes": el mismo anuncio aparece una fila por mes,
asi que se suman. Uso: python3 scripts/ads-leer-reporte.py reporte.xlsx > ads.json
"""
import json, sys
import openpyxl

def num(v):
    return v if isinstance(v, (int, float)) else 0

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb['Reporte por Anuncios']
rows = list(ws.iter_rows(min_row=1, values_only=True))
periodo = str(rows[0][0] or '').strip().replace('\n', ' ')
por = {}
for r in rows[2:]:
    if not r[4]:
        continue
    k = (r[2], r[4])
    a = por.setdefault(k, dict(camp=r[2], id=r[4], titulo=r[3], estado=r[5],
                               imp=0, clics=0, ingresos=0, inversion=0, ventas=0))
    a['imp'] += num(r[6]); a['clics'] += num(r[7])
    a['ingresos'] += num(r[11]); a['inversion'] += num(r[12]); a['ventas'] += num(r[17])
    if r[5] == 'Activo':
        a['estado'] = 'Activo'  # si estuvo activo algun mes, hoy manda el ultimo estado conocido
json.dump(dict(periodo=periodo, anuncios=list(por.values())), sys.stdout, ensure_ascii=False)
