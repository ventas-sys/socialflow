---
name: revision-publicidad
description: Revisión de la publicidad de Mercado Libre (Product Ads) de Uniproveedores a partir del Excel de ML. Calcula ROAS por campaña, cuánto cubre el fondo de publicidad (unidades × cargo por unidad) y qué anuncios subir, bajar o pausar. Usar cuando Rodo mande el Excel de publicidad (FULL 5164 / FERRE 5235), pida "revisar la publicidad", "ajustes de la semana" o "revisar el cargo".
---

# Revisión de publicidad (Mercado Ads)

**Regla de oro: se RECOMIENDA, Rodo aplica.** Nunca modificar campañas por código
ni por API. Todo lo de acá solo calcula.

## Qué pedirle a Rodo (si no lo mandó)

1. **Excel del reporte**, uno por cuenta: Publicidad → Reportes → Anuncios
   Estándar, 30 días, *Total del período*. (FULL = anunciante 5164, FERRE/local = 5235.)
2. **Unidades por día de ML** (no las "ventas" de nuestro dashboard): panel de ML →
   Métricas del negocio → solapa *Unidades vendidas*, últimos 30 días.
   - Ojo con la confusión de siempre: **ventas = órdenes** (una orden lleva varias
     unidades; en FERRE ~1,7). El fondo y las referencias (200 u/día en FERRE,
     800-900 en FULL) son **unidades**.
3. Si hay publicaciones deshabilitadas con mucho gasto: preguntar si es **falta de stock**.

## Cómo correrlo

```bash
python3 scripts/ads-leer-reporte.py reporte.xlsx > /tmp/ads.json   # suma los meses por anuncio
node scripts/ads-plan.mjs /tmp/ads.json <unidades_30d_ML> <cargo_por_unidad>
```

(El `.xlsx` subido queda en `/root/.claude/uploads/…`. Necesita `openpyxl`.)

Sale: gasto/ingresos/ROAS por campaña y total, cobertura del fondo, cargo que
cerraría el gasto, anuncios inactivos con ventas, y el plan de ajustes
(`lib/ml/ads-optimizer.js`).

## Reglas del optimizador (REGLAS, ajustables)

- ROAS < 3 → bajar (máx. 60% de golpe). ROAS ≥ 10 → subir (máx. 30% por semana).
- Menos de 30 clics → ruido, no se decide nada.
- Clics sin ventas → pausar y revisar la publicación.
- Anuncio **deshabilitado / pausado / movido** → no se toca (su gasto fue de cuando
  estaba activo). Si es por stock, reponer rinde más que cualquier ajuste.
- Los montos son **gasto del período (30 días)**, no presupuesto diario.
- La "facturación estimada extra" del script es un **techo optimista** (el ROAS no
  escala parejo al subir gasto): no presentarla como promesa.

## Objetivos de ROAS por campaña (los fijó Rodo)

ESTRELLAS KILLER 6,67x · IMPO MIA 4x. (LLUVIA piloto y paragua rinde ~15x.)
Juzgar por **ingresos y unidades**, no solo por ROAS.

## Fondo de publicidad y cargo por unidad

Rodo financia la publicidad con un fondo = unidades vendidas × cargo por unidad
(sumado al precio), para que el producto no cargue con todo el costo.

- **FULL**: $67,50 por unidad; con 800-900 u/día cubre ~106% (ajustado, poco margen).
- **FERRE**: $20 → **$80 el 15-sep-2026** (prueba de un mes). Resultado al 15-oct:
  213 u/día (antes 200), gasto $770.482 (antes $952.189), ROAS 8,85 (antes 9,56),
  cobertura 66%. Siguiente escalón sugerido: **$120** (cerraría ~99,6% del gasto
  actual). Se sube por escalones midiendo el efecto en ventas antes de seguir.
- Cálculo: fondo = unidades_30d × cargo; cobertura = fondo ÷ gasto; cargo que cierra = gasto ÷ unidades_30d.

Antes de recomendar subir el cargo, chequear:
1. Que las **unidades por día se mantuvieron** (mirar también sin picos: un día de
   promo puede inflar el promedio).
2. Que el **gasto no vaya a subir** por reponer stock de publicaciones deshabilitadas
   (si sube, el cargo que cierra sube también).

## Cómo contestarle a Rodo

Corto y en tabla: antes vs. ahora (unidades/día, gasto, ROAS, cobertura, lo que sale
del margen), recomendación del cargo con sus condiciones, lista de bajar/pausar y
subir con montos, y la pregunta pendiente (stock). Si quiere dejarlo registrado,
anotar el resultado en `docs/ML-PREGUNTAS-AGENTE.md`.
