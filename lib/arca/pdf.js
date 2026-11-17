// PDF de factura con QR ARCA. Devuelve Buffer.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const LETRA = { 1: "A", 3: "A", 6: "B", 8: "B", 0: "X" };
const NOMBRE = { 1: "FACTURA", 3: "NOTA DE CRÉDITO", 6: "FACTURA", 8: "NOTA DE CRÉDITO", 0: "PRESUPUESTO" };
const COD = { 1: "01", 3: "03", 6: "06", 8: "08", 0: "--" };
const COND_TXT = { 1: "IVA Responsable Inscripto", 4: "IVA Sujeto Exento", 5: "Consumidor Final", 6: "Responsable Monotributo", 13: "Monotributista Social" };
const $ = (n) => "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;

export async function generarPDF(c, empresa) {
  const esPresupuesto = c.cbteTipo === 0;
  const qrPng = esPresupuesto ? null : await QRCode.toBuffer(c.qr, { margin: 0, width: 110 });
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks = [];
  doc.on("data", (b) => chunks.push(b));
  const fin = new Promise((r) => doc.on("end", () => r(Buffer.concat(chunks))));

  const W = doc.page.width - 72;
  // Encabezado
  doc.rect(36, 36, W, 110).stroke();
  doc.rect(36 + W / 2 - 25, 36, 50, 46).stroke();
  doc.fontSize(28).text(LETRA[c.cbteTipo], 36 + W / 2 - 25, 42, { width: 50, align: "center" });
  doc.fontSize(7).text(`COD. ${COD[c.cbteTipo]}`, 36 + W / 2 - 25, 72, { width: 50, align: "center" });
  doc.fontSize(14).text(empresa.razonSocial, 44, 44, { width: W / 2 - 40 });
  doc.fontSize(8).text(`${empresa.domicilio}\n${COND_TXT[1]}${empresa.extra ? "\n" + empresa.extra : ""}`, 44, 80, { width: W / 2 - 40 });
  const xr = 36 + W / 2 + 34;
  doc.fontSize(14).text(NOMBRE[c.cbteTipo], xr, 44);
  doc.fontSize(9).text(
    `Punto de Venta: ${String(c.ptoVta).padStart(5, "0")}   Comp. Nro: ${String(c.nro).padStart(8, "0")}\nFecha de Emisión: ${f(c.fecha)}\nCUIT: ${empresa.cuit}\nIngresos Brutos: ${empresa.iibb || empresa.cuit}\nInicio de Actividades: ${empresa.inicioActividades || ""}`,
    xr, 66
  );

  // Receptor
  doc.rect(36, 152, W, 48).stroke();
  const docTxt = c.receptor.DocTipo === 80 ? "CUIT" : c.receptor.DocTipo === 86 ? "CUIL" : c.receptor.DocTipo === 96 ? "DNI" : "Doc";
  doc.fontSize(9).text(
    `${docTxt}: ${c.receptor.DocNro || "-"}     Apellido y Nombre / Razón Social: ${c.receptor.nombre || "Consumidor Final"}\nCondición frente al IVA: ${COND_TXT[c.receptor.condicionIva] || ""}     Domicilio: ${c.receptor.domicilio || "-"}\nCondición de venta: ${c.condicionVenta || "Mercado Pago"}${c.anula ? `     Comprobante asociado: ${LETRA[c.anula.cbteTipo]} ${String(c.anula.ptoVta).padStart(5, "0")}-${String(c.anula.nro).padStart(8, "0")}` : ""}`,
    44, 158, { width: W - 16 }
  );

  // Ítems
  let y = 210;
  const esA = LETRA[c.cbteTipo] === "A";
  const cols = esA ? [["Código", 60], ["Descripción", 200], ["Cant.", 40], ["P. Unit. s/IVA", 70], ["IVA %", 40], ["Subtotal s/IVA", 113]]
                   : [["Código", 60], ["Descripción", 250], ["Cant.", 50], ["P. Unit.", 80], ["Subtotal", 83]];
  doc.rect(36, y, W, 16).fill("#e6e6e6").fillColor("black");
  let x = 40;
  doc.fontSize(8);
  cols.forEach(([t, w]) => { doc.text(t, x, y + 4, { width: w }); x += w; });
  y += 20;
  for (const it of c.items) {
    const vals = esA
      ? [it.sku || "", it.descripcion, it.cantidad, $(it.neto / it.cantidad), it.iva, $(it.neto)]
      : [it.sku || "", it.descripcion, it.cantidad, $(it.precioFinal), $(it.subtotal)];
    x = 40;
    const h = doc.heightOfString(it.descripcion, { width: cols[1][1] });
    vals.forEach((v, i) => { doc.text(String(v), x, y, { width: cols[i][1] }); x += cols[i][1]; });
    y += Math.max(h, 10) + 4;
  }

  // Totales
  y = Math.max(y + 10, 560);
  doc.rect(36, y, W, esA ? 70 : 60).stroke();
  const tx = 36 + W - 220;
  if (esA) {
    doc.fontSize(9).text(`Importe Neto Gravado: ${$(c.neto)}`, tx, y + 8, { width: 210, align: "right" });
    c.iva.forEach((a, i) => doc.text(`IVA ${{ 3: "0", 4: "10,5", 5: "21", 6: "27", 8: "5", 9: "2,5" }[a.Id]}%: ${$(a.Importe)}`, tx, y + 22 + i * 12, { width: 210, align: "right" }));
  } else {
    // Ley 27.743 Régimen de Transparencia Fiscal al Consumidor
    doc.fontSize(8).text(`Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)\nIVA Contenido: ${$(c.ivaTotal)}`, 44, y + 8);
  }
  doc.fontSize(12).text(`Importe Total: ${$(c.total)}`, tx, y + (esA ? 50 : 36), { width: 210, align: "right" });

  // Pie con QR y CAE (el presupuesto no lleva)
  y += esA ? 84 : 74;
  if (esPresupuesto) {
    doc.fontSize(10).fillColor("#a00").text("DOCUMENTO NO VÁLIDO COMO FACTURA" + (c.validez ? `  ·  Validez: ${c.validez}` : ""), 40, y + 10);
    doc.fillColor("black");
  } else {
    doc.image(qrPng, 40, y, { width: 90 });
    doc.fontSize(9).text(`CAE N°: ${c.cae}\nFecha de Vto. de CAE: ${f(String(c.caeVto))}`, 36 + W - 220, y + 10, { width: 210, align: "right" });
    doc.fontSize(8).text("Comprobante Autorizado por ARCA", 140, y + 40);
    if (c.ambiente !== "produccion") doc.fillColor("red").fontSize(10).text("HOMOLOGACIÓN — SIN VALIDEZ FISCAL", 140, y + 56);
  }
  if (c.observaciones) doc.fillColor("black").fontSize(8).text(`Obs.: ${c.observaciones}`, 40, y + 100, { width: W - 8 });

  doc.end();
  return fin;
}
