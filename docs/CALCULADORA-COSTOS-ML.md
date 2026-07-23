# Calculadora de Costos, Margen y Rentabilidad — Mercado Libre Argentina

> **Archivo**: [`recursos/Calculadora-Costos-Rentabilidad-MercadoLibre-Argentina.xlsx`](../recursos/Calculadora-Costos-Rentabilidad-MercadoLibre-Argentina.xlsx)
> **Última actualización**: 2026-07-23

Planilla Excel (compatible con Google Sheets) para calcular cuánto cobra Mercado Libre por vender en Argentina y qué margen/rentabilidad real deja cada producto, cubriendo las 4 combinaciones típicas de venta:

- Con **Mercado Envíos Full** o sin Full.
- Con envío gratis o con envío a cargo del comprador.
- Precio por debajo o por encima de los **$33.000** (umbral de envío gratis obligatorio).

## Hojas del archivo

1. **Parámetros** — todas las tarifas de ML en un solo lugar y editables (comisión por categoría, costo fijo por tramo de precio, costo de envío por peso, descuento Full por reputación, cargo por cuotas sin interés, IVA, IIBB, almacenamiento Full). Actualizá estos valores cuando Mercado Libre cambie sus tarifas — todo el resto de la planilla recalcula solo.
2. **Calculadora** — una fila por publicación/venta. Filas 6-9 son 4 ejemplos resueltos (uno por cada combinación de arriba); desde la fila 10 se cargan productos propios. Calcula comisión, costo fijo/envío, cargo por cuotas, IVA, ingreso neto, **margen** (ganancia / precio de venta) y **rentabilidad** (ganancia / costo).
3. **Notas y Fuentes** — supuestos, aclaraciones (por qué IIBB no se resta del margen, por qué el costo de envío Full es estimado, etc.) y fuentes consultadas.

## Supuestos a revisar

Mercado Libre no publica públicamente la tabla de costos de envío Full por peso ni el costo de almacenamiento, y actualiza comisiones y costos fijos con frecuencia (último cambio relevante: 12/03/2026). La hoja **Parámetros** deja estos valores como estimaciones editables — antes de fijar precios, confirmá los valores reales en tu panel de vendedor (`vendedores.mercadolibre.com.ar`) y ajustalos ahí. El detalle completo de fuentes y supuestos está en la hoja "Notas y Fuentes" del archivo.
