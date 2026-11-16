const XLSX = require('/home/user/socialflow/node_modules/xlsx');
const fs = require('fs');
const S = '/tmp/claude-0/-home-user-socialflow/1e9a5f94-bef0-5866-89ae-8225e269b676/scratchpad/';
const {todos} = JSON.parse(fs.readFileSync(S+'productos.json','utf8'));
const res = JSON.parse(fs.readFileSync(S+'resultados.json','utf8'));
const VAPER = /VAPER|JUUL|NASTY|MILKMAN|NAKED|IJSUT|IJUST|SMOK|PRINCE|PEN 22|CIGARRILLO/i;

const out = [['Código','Producto','Precio app','Stock app','Referencia encontrada en ML','Link','Tipo','Precio en ML (referencia)','Confianza','OK','Notas / consejo para publicar']];
let hechos=0, cat=0, vap=0;
todos.forEach(p => {
  const r = res[p.code];
  const esVaper = VAPER.test(p.nom);
  if (r) hechos++;
  if (r && r.tipo === 'CATÁLOGO') cat++;
  if (esVaper) vap++;
  out.push([
    p.code, p.nom, p.pr||'', p.st,
    r ? r.ref : (esVaper ? '— NO SE PUEDE PUBLICAR EN ML —' : '(pendiente de buscar)'),
    r ? r.link : '', r ? r.tipo : (esVaper ? 'Prohibido' : ''),
    r ? r.precio : '', r ? r.conf : '', '',
    r ? r.nota : (esVaper ? 'Mercado Libre Argentina no permite publicar cigarrillos electrónicos ni sus líquidos.' : ''),
  ]);
});
const ws = XLSX.utils.aoa_to_sheet(out);
ws['!cols'] = [{wch:13},{wch:46},{wch:12},{wch:11},{wch:58},{wch:62},{wch:13},{wch:36},{wch:11},{wch:6},{wch:95}];
ws['!autofilter'] = { ref: 'A1:K' + out.length };
ws['!freeze'] = { xSplit: 0, ySplit: 1 };

const info = XLSX.utils.aoa_to_sheet([
  ['PRODUCTOS BASE SIN PUBLICAR EN FULL — CON REFERENCIA DE MERCADO LIBRE'],
  [''],
  ['Total sin publicar en FULL: ' + todos.length],
  ['Ya buscados: ' + hechos],
  ['Con FICHA DE CATÁLOGO encontrada (los más rápidos de publicar): ' + cat],
  ['Vapers y líquidos (no se pueden publicar en ML): ' + vap],
  ['Pendientes de buscar: ' + (todos.length - hechos - vap)],
  [''],
  ['QUÉ ES CADA COLUMNA'],
  ['  • Referencia encontrada en ML: la publicación más parecida a tu producto.'],
  ['  • Tipo: CATÁLOGO es el mejor caso (ML ya tiene título, fotos y atributos,'],
  ['    vos sólo ponés precio y stock). Publicación es un aviso suelto de otro'],
  ['    vendedor. Listado es la búsqueda entera, cuando no hubo una sola clara.'],
  ['  • Confianza: qué tan seguro es que sea el MISMO producto que el tuyo.'],
  ['      Alta  = el título coincide, es lo mismo.'],
  ['      Media = es del mismo rubro pero hay variantes; hay que mirar.'],
  ['      Baja  = sólo de orientación, puede no ser lo mismo.'],
  ['  • OK: vacía, para que marques las que te sirven.'],
  ['  • Notas: además del aviso, va un consejo de qué conviene poner en el título.'],
  [''],
  ['TIP: filtrá la columna Tipo por CATÁLOGO y arrancá por esos.'],
  [''],
  ['LAS REFERENCIAS SON PUBLICACIONES DE OTROS VENDEDORES.'],
  ['Sirven para ver categoría, ficha técnica, rango de precio y ficha de catálogo.'],
  ['NO se copian fotos ni descripción: es contenido de ellos y ML lo sanciona.'],
  [''],
  ['Los precios son del momento de la búsqueda y cambian seguido: son orientativos.'],
  ['El stock de la app es sólo de referencia y puede estar desactualizado.'],
]);
info['!cols'] = [{wch:82}];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, info, 'Resumen');
XLSX.utils.book_append_sheet(wb, ws, 'Sin publicar en FULL');
XLSX.writeFile(wb, process.argv[2]);
console.log('buscados:', hechos, '| catálogo:', cat, '| pendientes:', todos.length - hechos - vap);
