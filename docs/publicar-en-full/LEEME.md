# Productos base que NO están publicados en FULL — con referencia de ML

Esto es el resultado del trabajo del 7 al 11/11/2026. Está acá y no en el
scratchpad porque el scratchpad se borra y rehacerlo son ~200 búsquedas web.

## Qué hay

| Archivo | Qué es |
|---|---|
| `NO-publicados-en-FULL-con-referencia.xlsx` | **El entregable.** Lo que se le pasó al usuario. Dos hojas: Resumen y la lista. |
| `productos.json` | Los 519 productos base sin publicar en FULL, salidos de la app (`todos`, `buscables`, `excluidos`). |
| `resultados.json` | La referencia de ML de cada uno: `codigo -> {ref, link, tipo, precio, conf, nota}`. **Es lo que costó hacer.** |
| `armar.js` | Arma el Excel. Uso: `node armar.js /ruta/salida.xlsx` |
| `merge.js` | Suma un fragmento a `resultados.json`. Uso: `node merge.js frag.json` |

`armar.js` requiere `xlsx`, que lo toma de `node_modules` del repo.

## Los números

- **519** productos base sin publicar en FULL
- **505** con referencia encontrada (el resto son datos mal cargados, ver abajo)
- **74** con **ficha de catálogo** → son los más rápidos de publicar: ML ya tiene
  título, fotos y atributos, sólo hay que poner precio y stock
- **330** confianza Alta · **147** Media · **20** Baja
- **14** vapers + 1 esencia (`1305`) que **ML Argentina prohíbe publicar**

## Cómo leer la columna "Tipo"

- **CATÁLOGO** — el mejor caso, hay ficha de catálogo de ML para ese producto
- **Publicación** — un aviso suelto de otro vendedor que es el mismo producto
- **Listado** — la búsqueda entera, cuando no hubo una sola clara
- **Revisar dato** — el producto está mal cargado en el sistema, no es un
  problema de búsqueda

## ⚠️ Reglas que no se pueden saltear

- **De las publicaciones de otros vendedores NO se copia nada** (ni fotos ni
  descripción): es contenido de ellos y ML sanciona. Sirven de referencia de
  categoría, ficha técnica, rango de precio y ficha de catálogo.
- **Nada se marcó como "igual" automáticamente.** El cruce por nombre es
  difuso. La columna **OK** va vacía a propósito: decide el usuario mirando.
- Los **vapers y sus esencias** no se publican. Es sanción a la cuenta.
- `1087` cargador Samsung → publicar como **"compatible con Samsung"**, nunca
  "original" (uso indebido de marca).
- `2100` → **"tipo Magiclick"**, no "Magiclick" (marca registrada).

## Fichas de catálogo de NUESTRAS propias marcas (lo más rápido de todo)

`1156` Soldadora Inverter **Thunder** 130A MIG · `1338` Disco Diamantado
Continuo 115mm **Thunder** · `2211` Llave Ajustable **Bulit** Serie 600 8" ·
`2500` Masilla **Suprabond** Erpox Acero 100g · `1244` Amoladora 115mm 650W
(**Horse Power AA650** ya publicada) · `1122` Rotomartillo 4J 850W
(**Thunderplus**) · `1265` Pad de pulido azul 125mm (coincidencia palabra por
palabra del título).

## Datos para corregir en el sistema (no son fallas de búsqueda)

- Basura: `2` ("UP-"), `103` ("VER ERROR"), `0450` (.TORNILLO), `0451`
  (.FERRETERIA), `0453` (.PEGAMENTO) — los últimos tres son rubros cargados
  como producto
- `0319` MONITOR 24 → falta marca y modelo
- `1152` dice "OLDADORA" → le falta la S
- `2063` "ALFOMBRA DESLIZ. -- 51027" → el código 51027 es una **pileta
  Bestway**, no una alfombra
- Duplicados: `1259`/`1273` (eje flexible minitorno), `1175`/`1240` (cadena
  motosierra 16"), `1054`/`1056`

## Los 7 que no se pudieron buscar (el nombre no alcanza)

`1146` ARRANQUE 15X20 · `1147` ARRANQUE 25X35 · `1300` CABO METAL PLÁSTICO ·
`1367` 4X RUEDA RULEMANES · `1378` FIJACIÓN UNIVERSAL CON TORNILLO · `1682`
ESQUINERO REDONDO DOBLE · `2000` TARUGOS (sin medida).
Hay que preguntarle al usuario qué son.

## Etapa 2 — lo que falta

Con el Excel ya marcado en la columna **OK**, armar el publicador automático
en FULL (contra la ficha de catálogo cuando la hay). **Se dejó afuera a
propósito**: ahí se definen precio, stock y tipo de envío de cada publicación
y eso no se puede adivinar — lo tiene que definir el usuario.
