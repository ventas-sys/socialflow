#!/usr/bin/env node
// Carga el "Precio de lista" de publicaciones de Mercado Libre desde el
// panel de vendedor, manejando un navegador de verdad (Edge por default).
// Existe porque ML no deja escribir el precio de lista por API (ver
// getListPrice en lib/ml/ml-api.js).
//
// Se corre en la PC, con la ventana a la vista. La primera vez pide iniciar
// sesión a mano en ML; la sesión queda guardada en ./perfil-navegador.
//
// Uso (desde esta carpeta):
//   node precio-de-lista.mjs MLA1108642079
//     -> EXPLORAR: abre la publicación, calcula el precio de lista, abre la
//        casilla y muestra qué campos/botones ve. No guarda nada.
//   node precio-de-lista.mjs MLA1108642079 MLA... --aplicar
//     -> además lo carga y guarda en cada publicación.
//   --archivo=lista.txt    toma los MLA de un archivo (uno por línea)
//   --forzar               pisa un precio de lista que ya esté cargado
//   --navegador=chrome     usa Chrome en vez de Edge
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { computeListPrice } from '../../lib/ml/pricing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL = process.env.ML_PANEL_URL || 'https://vendedores.mercadolibre.com.ar';

const args = process.argv.slice(2);
const flag = name => args.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = name => flag(name)?.split('=')[1];
const aplicar = !!flag('aplicar');
const forzar = !!flag('forzar');
let ids = args.filter(a => !a.startsWith('--'));
if (flag('archivo')) {
  ids.push(...fs.readFileSync(flagValue('archivo'), 'utf8').split(/\s+/));
}
ids = [...new Set(ids.map(s => s.trim().toUpperCase()).filter(s => /^MLA\d+$/.test(s)))];
if (!ids.length) {
  console.error('Uso: node precio-de-lista.mjs <MLA...> [más MLA] [--aplicar] [--archivo=lista.txt] [--forzar]');
  process.exit(1);
}

// "$ 2.981,69" -> 2981.69
function parsePesos(txt) {
  const m = String(txt).match(/\$\s*([\d.]+(?:,\d+)?)/);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
}

const navegador = flagValue('navegador');
const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'perfil-navegador'), {
  headless: !!process.env.ML_PANEL_HEADLESS,
  ...(navegador === 'chromium' ? {} : { channel: navegador || 'msedge' }),
  viewport: { width: 1280, height: 900 },
});
const page = ctx.pages()[0] || await ctx.newPage();
const preguntar = async msg => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(msg);
  rl.close();
};

// Abre la edición de la publicación; si ML manda al login, espera a que la
// persona inicie sesión en la ventana.
async function abrirEdicion(id) {
  const url = `${PANEL}/publicaciones/${id}/modificar`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const seccion = page.getByText('Precio de lista', { exact: true }).first();
  try {
    await seccion.waitFor({ timeout: 20000 });
  } catch {
    if (/login|lgz|registration/i.test(page.url())) {
      await preguntar('\n>> Iniciá sesión en Mercado Libre en la ventana que se abrió y después apretá Enter acá... ');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await seccion.waitFor({ timeout: 30000 });
    } else {
      throw new Error('no apareció la sección "Precio de lista" en ' + page.url());
    }
  }
  return seccion;
}

// Texto de la tarjeta que contiene `titulo` (ej: "Precio de lista Sin precio de lista.").
// Toma la ÚLTIMA coincidencia: "Condiciones de venta" también es el título de
// la sección, que arriba incluye el "Recibís $..." y confundiría el precio.
async function textoTarjeta(titulo) {
  return page.evaluate(t => {
    const el = [...document.querySelectorAll('body *')].filter(e => e.childElementCount === 0 && e.textContent.trim() === t).pop();
    let n = el;
    for (let i = 0; n && i < 6; i++, n = n.parentElement) {
      const txt = (n.innerText || '').replace(/\s+/g, ' ').trim();
      if (/\$|sin precio/i.test(txt)) return txt;
    }
    return '';
  }, titulo);
}

// Marca los inputs/botones visibles para después encontrar los que aparecen
// al abrir la casilla.
const marcarVisibles = () => page.evaluate(() => {
  for (const e of document.querySelectorAll('input, button')) if (e.offsetParent) e.dataset.plAntes = '1';
});
const nuevosVisibles = () => page.evaluate(() =>
  [...document.querySelectorAll('input, button')]
    .filter(e => e.offsetParent && !e.dataset.plAntes)
    .map((e, i) => {
      e.dataset.plNuevo = String(i);
      return { i, tag: e.tagName.toLowerCase(), type: e.type, name: e.name, placeholder: e.placeholder,
        texto: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 40) };
    }));

async function procesar(id) {
  const seccion = await abrirEdicion(id);
  const condiciones = await textoTarjeta('Condiciones de venta');
  const precio = parsePesos(condiciones);
  if (!precio) throw new Error('no pude leer el precio de venta: ' + condiciones);
  const propuesto = computeListPrice(precio);
  if (!propuesto) {
    console.log(`\n${id}: venta $${precio} -> ningún precio de lista deja entre 25% y 31% OFF, la salteo`);
    return 'salteada';
  }
  const { original_price, off } = propuesto;
  const actualTxt = await textoTarjeta('Precio de lista');
  const actual = /sin precio de lista/i.test(actualTxt) ? null : parsePesos(actualTxt);
  console.log(`\n${id}: venta $${precio} -> lista $${original_price} (${(off * 100).toFixed(1)}% OFF). Cargado hoy: ${actual ? '$' + actual : 'ninguno'}`);
  if (actual && !forzar) {
    console.log('   ya tiene precio de lista, lo salteo (usá --forzar para pisarlo)');
    return 'salteada';
  }

  await marcarVisibles();
  await seccion.click();
  await page.waitForTimeout(1500);
  const nuevos = await nuevosVisibles();

  if (!aplicar) {
    console.log('   [explorar] campos que aparecieron al abrir la casilla:');
    for (const n of nuevos) console.log('     ', JSON.stringify(n));
    const foto = path.join(__dirname, `explorar-${id}.png`);
    await page.screenshot({ path: foto, fullPage: true });
    fs.writeFileSync(path.join(__dirname, `explorar-${id}.html`), await page.content());
    console.log(`   captura: ${foto} (no se guardó nada)`);
    return 'explorada';
  }

  const input = nuevos.find(n => n.tag === 'input' && n.type !== 'hidden' && n.type !== 'checkbox' && n.type !== 'radio');
  if (!input) throw new Error('no encontré el campo para escribir el precio de lista');
  const campo = page.locator(`[data-pl-nuevo="${input.i}"]`);
  await campo.fill('');
  await campo.pressSequentially(String(original_price), { delay: 40 });
  const boton = nuevos.find(n => n.tag === 'button' && /^(guardar|confirmar|modificar|aplicar|listo)/i.test(n.texto));
  if (!boton) throw new Error('no encontré el botón para guardar (vi: ' + nuevos.map(n => n.texto).join(' | ') + ')');
  await page.locator(`[data-pl-nuevo="${boton.i}"]`).click();
  await page.waitForTimeout(3000);

  // Verificación: recargo y leo la tarjeta de nuevo.
  await abrirEdicion(id);
  const despues = parsePesos(await textoTarjeta('Precio de lista'));
  if (despues !== original_price) throw new Error(`después de guardar quedó ${despues ?? 'vacío'}, esperaba ${original_price}`);
  console.log(`   ✅ cargado: $${despues}`);
  return 'cargada';
}

const resumen = {};
for (const id of ids) {
  try {
    const r = await procesar(id);
    resumen[r] = (resumen[r] || 0) + 1;
  } catch (e) {
    resumen.error = (resumen.error || 0) + 1;
    console.log(`   ❌ ${id}: ${e.message}`);
    await page.screenshot({ path: path.join(__dirname, `error-${id}.png`), fullPage: true }).catch(() => {});
  }
}
console.log('\nResumen:', JSON.stringify(resumen));
if (!aplicar) console.log('(modo explorar: no se guardó nada. Agregá --aplicar para cargarlo de verdad)');
await ctx.close();
