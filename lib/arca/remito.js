// Remitos de envío (no fiscales: no van a ARCA) y etiquetas de bultos.
// - Remito para expreso: A4 con ORIGINAL y DUPLICADO + etiquetas 15x10 (una por bulto).
// - Remito chico para micro: una etiqueta 15x10 que hace de remito.
import PDFDocument from 'pdfkit';

const ETQ = [425.2, 283.46]; // 150 x 100 mm (apaisado)
const fecha = (iso) => { const d = new Date(iso); return d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }); };
const nro = (r) => `R-${String(r.nro).padStart(8, '0')}`;

function pdf(opts) {
  const doc = new PDFDocument({ autoFirstPage: false, ...opts });
  const chunks = [];
  doc.on('data', (b) => chunks.push(b));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(chunks))));
  return { doc, fin };
}

const linea = (d) => [d.domicilio, d.localidad, d.provincia, d.cp ? `CP ${d.cp}` : ''].filter(Boolean).join(', ');

function remitoA4(doc, r, emp, copia) {
  doc.addPage({ size: 'A4', margin: 36 });
  const W = doc.page.width - 72;
  doc.rect(36, 36, W, 96).stroke();
  doc.rect(36 + W / 2 - 22, 36, 44, 40).stroke();
  doc.fontSize(24).text('R', 36 + W / 2 - 22, 42, { width: 44, align: 'center' });
  doc.fontSize(14).text(emp.razonSocial, 44, 44, { width: W / 2 - 40 });
  doc.fontSize(8).text(`${emp.domicilio}\nCUIT ${emp.cuit} · IVA Responsable Inscripto`, 44, 82, { width: W / 2 - 40 });
  const xr = 36 + W / 2 + 30;
  doc.fontSize(14).text('REMITO', xr, 44);
  doc.fontSize(9).text(`Nº ${nro(r)}\nFecha: ${fecha(r.creado)}\n${copia}`, xr, 64);
  doc.fontSize(7).fillColor('#a00').text('Documento no válido como factura', xr, 110).fillColor('black');

  doc.rect(36, 138, W, 64).stroke();
  doc.fontSize(9).text(
    `Destinatario: ${r.destinatario.nombre}    ${r.destinatario.docNro ? 'CUIT/DNI: ' + r.destinatario.docNro : ''}\n` +
    `Domicilio de entrega: ${linea(r.destinatario) || '-'}\n` +
    `Teléfono / contacto: ${[r.destinatario.telefono, r.destinatario.contacto].filter(Boolean).join(' · ') || '-'}`,
    44, 145, { width: W - 16 });

  doc.rect(36, 208, W, 50).stroke();
  doc.text(
    `Transporte: ${r.transporte.nombre || '-'}    ${r.transporte.cuit ? 'CUIT: ' + r.transporte.cuit : ''}\n` +
    `Domicilio del transporte: ${r.transporte.domicilio || '-'}\n` +
    `Bultos: ${r.bultos}    Peso total: ${r.peso ? r.peso + ' kg' : '-'}    Valor declarado: ${r.valorDeclarado ? '$ ' + Number(r.valorDeclarado).toLocaleString('es-AR') : '-'}` +
    `${r.comprobante ? '    Factura: ' + r.comprobante : ''}`,
    44, 215, { width: W - 16 });

  let y = 268;
  doc.rect(36, y, W, 16).fill('#e6e6e6').fillColor('black');
  doc.fontSize(8).text('Cant.', 40, y + 4, { width: 50 }).text('Código', 92, y + 4, { width: 90 }).text('Descripción', 186, y + 4, { width: W - 160 });
  y += 20;
  for (const it of r.items) {
    const h = Math.max(doc.heightOfString(it.descripcion, { width: W - 160 }), 10);
    if (y + h > 700) { doc.text('… continúa', 40, y); break; }
    doc.text(String(it.cantidad), 40, y, { width: 50 }).text(it.sku || '', 92, y, { width: 90 }).text(it.descripcion, 186, y, { width: W - 160 });
    y += h + 4;
  }
  if (r.observaciones) doc.fontSize(8).text(`Observaciones: ${r.observaciones}`, 40, Math.max(y + 8, 640), { width: W - 8 });
  doc.fontSize(8)
    .text('_____________________________', 60, 760).text('Firma y aclaración del transporte', 60, 772)
    .text('_____________________________', 330, 760).text('Recibí conforme (firma, aclaración, DNI)', 330, 772);
}

function etiquetaBulto(doc, r, emp, i) {
  doc.addPage({ size: ETQ, margin: 14 });
  const W = ETQ[0] - 28;
  doc.rect(10, 10, ETQ[0] - 20, ETQ[1] - 20).lineWidth(1.5).stroke().lineWidth(1);
  doc.fontSize(9).text(`REMITENTE: ${emp.razonSocial} · ${emp.domicilio}`, 18, 18, { width: W - 90 });
  doc.fontSize(22).text(`${i} / ${r.bultos}`, ETQ[0] - 110, 16, { width: 90, align: 'right' });
  doc.fontSize(8).text('BULTO', ETQ[0] - 110, 42, { width: 90, align: 'right' });
  doc.moveTo(18, 58).lineTo(ETQ[0] - 18, 58).stroke();
  doc.fontSize(9).text('DESTINATARIO', 18, 64);
  doc.fontSize(16).text(r.destinatario.nombre, 18, 76, { width: W });
  doc.fontSize(11).text(linea(r.destinatario) || '', 18, doc.y + 2, { width: W });
  if (r.destinatario.telefono || r.destinatario.contacto) doc.fontSize(10).text(`Tel: ${[r.destinatario.telefono, r.destinatario.contacto].filter(Boolean).join(' · ')}`, 18, doc.y + 2, { width: W });
  doc.moveTo(18, 214).lineTo(ETQ[0] - 18, 214).stroke();
  doc.fontSize(10).text(`TRANSPORTE: ${r.transporte.nombre || '-'}${r.transporte.destino ? '  ->  ' + r.transporte.destino : ''}`, 18, 220, { width: W });
  doc.fontSize(9).text(`${nro(r)} · ${fecha(r.creado)}${r.peso ? ' · ' + r.peso + ' kg total' : ''}`, 18, 238, { width: W });
  if (r.fragil) doc.fontSize(12).fillColor('#c00').text('FRÁGIL', ETQ[0] - 110, 236, { width: 90, align: 'right' }).fillColor('black');
}

function remitoChico(doc, r, emp) {
  doc.addPage({ size: ETQ, margin: 12 });
  const W = ETQ[0] - 24;
  doc.rect(8, 8, ETQ[0] - 16, ETQ[1] - 16).stroke();
  doc.fontSize(11).text(`REMITO ${nro(r)}`, 14, 14, { width: W / 2 });
  doc.fontSize(8).text(`${fecha(r.creado)} · Bultos: ${r.bultos}${r.peso ? ' · ' + r.peso + ' kg' : ''}`, 14 + W / 2, 16, { width: W / 2, align: 'right' });
  doc.fontSize(7).text(`De: ${emp.razonSocial} · CUIT ${emp.cuit} · ${emp.domicilio}`, 14, 30, { width: W });
  doc.moveTo(14, 42).lineTo(ETQ[0] - 14, 42).stroke();
  doc.fontSize(8).text('PARA:', 14, 46);
  doc.fontSize(14).text(r.destinatario.nombre, 14, 56, { width: W });
  doc.fontSize(9).text([linea(r.destinatario), r.destinatario.telefono ? 'Tel: ' + r.destinatario.telefono : '', r.destinatario.docNro ? 'CUIT/DNI: ' + r.destinatario.docNro : ''].filter(Boolean).join('\n'), 14, doc.y + 1, { width: W });
  doc.fontSize(10).text(`MICRO: ${r.transporte.nombre || '-'}${r.transporte.destino ? '  ->  Terminal: ' + r.transporte.destino : ''}`, 14, doc.y + 4, { width: W });
  let y = doc.y + 4;
  doc.moveTo(14, y).lineTo(ETQ[0] - 14, y).stroke();
  y += 4;
  doc.fontSize(7);
  const max = 236;
  for (const it of r.items) {
    if (y > max) { doc.text('… y más', 14, y); break; }
    doc.text(`${it.cantidad} x ${it.sku ? it.sku + ' ' : ''}${it.descripcion}`, 14, y, { width: W, lineBreak: false, ellipsis: true });
    y += 9;
  }
  doc.fontSize(7).text('Recibí conforme: ______________________   DNI: ____________', 14, ETQ[1] - 26, { width: W });
}

/** Devuelve { remito: Buffer, etiquetas?: Buffer } */
export async function generarRemito(r, emp) {
  if (r.tipo === 'micro') {
    const { doc, fin } = pdf({});
    remitoChico(doc, r, emp);
    doc.end();
    return { remito: await fin };
  }
  const a = pdf({});
  remitoA4(a.doc, r, emp, 'ORIGINAL');
  remitoA4(a.doc, r, emp, 'DUPLICADO');
  a.doc.end();
  const e = pdf({});
  for (let i = 1; i <= Math.max(1, Number(r.bultos) || 1); i++) etiquetaBulto(e.doc, r, emp, i);
  e.doc.end();
  return { remito: await a.fin, etiquetas: await e.fin };
}
