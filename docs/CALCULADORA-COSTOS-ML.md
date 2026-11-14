# Calculadora de Costos, Margen y Rentabilidad — Mercado Libre Argentina

Hay dos formas de usar esta calculadora: la **herramienta web** (`/calculadora-ml`, en vivo, con datos reales de Mercado Libre) y la **planilla Excel** (offline, para simular varios productos a la vez).

> **Última actualización**: 2026-07-24

## Herramienta web — `/calculadora-ml`

Página `calculadora-ml.html` con dos pestañas:

1. **Por link de publicación**: pegás el link de cualquier publicación de Mercado Libre (propia o de la competencia) + tu costo del producto, y calcula gastos y ganancia **en pesos y en porcentaje**. Usa la [API pública de Mercado Libre](https://developers.mercadolibre.com.ar/) para traer precio, categoría, tipo de publicación, envío gratis/Full y reputación del vendedor reales, y la comisión exacta vía `sites/MLA/listing_prices` (si esa consulta falla, cae a la comisión estimada de la planilla).
2. **Por artículo**: describís un producto + precio estimado, y detecta la **categoría sugerida** (endpoint público `category_predictor`) y calcula el margen/rentabilidad posible con esa categoría.

Backend: un único endpoint `api/ml/costos.js` (`mode: 'item'` o `mode: 'articulo'`, para no pasarse del límite de funciones serverless del plan Hobby de Vercel) con la lógica de costos en `lib/ml/costos.js` (mismos supuestos que la hoja "Parámetros" de la planilla — mantenerlos sincronizados si cambian las tarifas). El helper HTTP compartido vive en `lib/http.js` (antes `api/_http.js`) por el mismo motivo: solo los archivos bajo `api/` que son endpoints reales cuentan para ese límite.

## Planilla Excel

> **Archivo**: [`recursos/Calculadora-Costos-Rentabilidad-MercadoLibre-Argentina.xlsx`](../recursos/Calculadora-Costos-Rentabilidad-MercadoLibre-Argentina.xlsx)

Planilla Excel (compatible con Google Sheets) para calcular cuánto cobra Mercado Libre por vender en Argentina y qué margen/rentabilidad real deja cada producto, cubriendo las 4 combinaciones típicas de venta:

- Con **Mercado Envíos Full** o sin Full.
- Con envío gratis o con envío a cargo del comprador.
- Precio por debajo o por encima de los **$33.000** (umbral de envío gratis obligatorio).

## Hojas del archivo

1. **Parámetros** — todas las tarifas de ML en un solo lugar y editables (comisión por categoría, costo fijo por tramo de precio, costo de envío por peso, descuento Full por reputación, cargo por cuotas sin interés, IVA, IIBB, almacenamiento Full, condición fiscal del vendedor). Actualizá estos valores cuando Mercado Libre cambie sus tarifas — todo el resto de la planilla recalcula solo.
2. **Calculadora** — una fila por publicación/venta. Filas 6-9 son 4 ejemplos resueltos (uno por cada combinación de arriba); desde la fila 10 se cargan productos propios. Calcula comisión, costo fijo/envío, cargo por cuotas, IVA, ingreso neto, **margen** (ganancia / precio de venta) y **rentabilidad** (ganancia / costo).
3. **Resumen** — panel con KPIs de todos los productos cargados: cantidad, precio/margen/rentabilidad promedio, ganancia total, alerta de productos con rentabilidad negativa, y el producto más y menos rentable.
4. **Notas y Fuentes** — supuestos, aclaraciones (por qué IIBB no se resta del margen, por qué el costo de envío Full es estimado, cómo afecta la condición fiscal a la Ganancia, etc.) y fuentes consultadas.

## Supuestos a revisar

- Mercado Libre no publica públicamente la tabla de costos de envío Full por peso ni el costo de almacenamiento, y actualiza comisiones y costos fijos con frecuencia (último cambio relevante: 12/03/2026). La hoja **Parámetros** deja estos valores como estimaciones editables — antes de fijar precios, confirmá los valores reales en tu panel de vendedor (`vendedores.mercadolibre.com.ar`) y ajustalos ahí.
- **Condición fiscal** (`Parámetros!C57`): si sos Responsable Inscripto, el IVA que Mercado Libre descuenta sobre su comisión es un crédito fiscal recuperable — la planilla lo suma de vuelta en Ganancia/Margen/Rentabilidad (el Ingreso neto recibido sigue mostrando la plata real que cobrás ese mes). Si sos Monotributista o Exento, ese IVA no se recupera y queda como costo real. Escribí exactamente `Responsable Inscripto` para activar la recuperación.

El detalle completo de fuentes y supuestos está en la hoja "Notas y Fuentes" del archivo.
