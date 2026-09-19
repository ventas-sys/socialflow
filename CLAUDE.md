# Memoria del proyecto — socialflow

## Entorno de desarrollo remoto (Claude Code)
- La red del sandbox **bloquea casi todo dominio externo** (403 del proxy de egreso): `api.mercadolibre.com`, `*.mercadolibre.com.ar`, `rest.contabilium.com`, `*.vercel.app`, etc. No insistir con curl/WebFetch a esos hosts; reportar y usar las alternativas de abajo.
- **Para "ver" cualquier web / consultar APIs externas**: hacerlo desde el backend de Vercel (las funciones serverless tienen internet libre). Helper listo: `httpGetText()` en `lib/http.js` (GET de texto completo, User-Agent de navegador, redirects). Ejemplo completo de scraping con parseo de JSON-LD: `buscarMercadoListado()` en `api/ml/costos.js`.
- Los MCP de scraping (Scrapling, ScrapeGraphAI, etc.) solo sirven si el usuario los agrega como **conector remoto en claude.ai** — instalados dentro del sandbox quedan igual de bloqueados.

## Límites duros de Vercel (plan Hobby)
- **Máximo 12 funciones serverless por deploy** y ya estamos en 12: cada archivo `.js` bajo `api/` cuenta. Para sumar un endpoint: fusionar con uno existente (patrón `mode:` como en `api/ml/costos.js`) o mover helpers a `lib/` (nunca ponerlos bajo `api/`).
- Hay un segundo proyecto de Vercel (`stock-inventario`) vinculado a este mismo repo, con Ignored Build Step; ignorar sus checks.

## Calculadora de costos ML (PR #66, rama claude/mercado-libre-cost-calculator-w0w1c6)
- Lógica de costos/margen/rentabilidad compartida en `lib/ml/costos.js`; endpoint único `api/ml/costos.js` (`mode: 'item' | 'articulo'`); página `calculadora-ml.html`; planilla `recursos/Calculadora-Costos-Rentabilidad-MercadoLibre-Argentina.xlsx` — **mantener sincronizadas la lib y la hoja "Parámetros" del Excel**.
- Reglas de negocio clave (validadas contra tarifas ML 2026): el costo fijo por unidad de productos < $33.000 aplica en todo despacho por Mercado Envíos **aunque el envío lo pague el comprador** (solo se evita con retiro en persona); envío gratis obligatorio desde $33.000; con Full hay descuento por reputación (~50% verde / 40% amarilla); si el vendedor es Responsable Inscripto, el IVA de las comisiones ML es crédito recuperable (se suma de vuelta en la ganancia, no en el ingreso neto).
- La búsqueda de mercado intenta la API oficial de ML y cae al scraping del listado público (`listado.mercadolibre.com.ar/<slug>`, JSON-LD).

## Datos sensibles
- El repo es **público**: nunca commitear archivos con costos/precios reales del usuario (los Excel que sube van por chat, no al repo).
