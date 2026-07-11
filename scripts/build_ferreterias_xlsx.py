# -*- coding: utf-8 -*-
"""Genera el Excel de prospección de ferreterías CABA + plan de redes para Uniproveedores.
Datos de contacto: recopilados de directorios públicos (guiaferreterias, paginasamarillas,
argentino.com.ar, buscabaires, licuo, Instagram/Facebook). Campos no públicos (encargado,
email, whatsapp directo, horario exacto) quedan vacíos y se completan en la prospección.
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# --- Paleta de marca Uniproveedores ---
VERDE = "A4D72B"
NEGRO = "0D0D0D"
GRIS = "9AA0A6"
GRIS_CLARO = "EEEEEE"

wb = openpyxl.Workbook()

# ============ Estilos reutilizables ============
thin = Side(style="thin", color="CCCCCC")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
hdr_font = Font(name="Calibri", bold=True, color="0D0D0D", size=11)
hdr_fill = PatternFill("solid", fgColor=VERDE)
title_font = Font(name="Calibri", bold=True, color="FFFFFF", size=16)
title_fill = PatternFill("solid", fgColor=NEGRO)
wrap = Alignment(wrap_text=True, vertical="top")
center = Alignment(horizontal="center", vertical="center")

# =====================================================================
# HOJA 1 — FERRETERÍAS CABA (la base de prospección)
# =====================================================================
ws = wb.active
ws.title = "Ferreterías CABA"

cols = ["#", "Nombre", "Barrio", "Dirección", "Teléfono", "WhatsApp",
        "Email", "Sitio web / Tienda", "Instagram", "Facebook",
        "Horarios", "Encargado", "Estado", "Prioridad", "Notas / Fuente"]

# Fila de título
ws.merge_cells("A1:O1")
c = ws["A1"]
c.value = "UNIPROVEEDORES · Prospección de Ferreterías — Capital Federal (CABA)"
c.font = title_font
c.fill = title_fill
c.alignment = Alignment(horizontal="left", vertical="center")
ws.row_dimensions[1].height = 28

# Subtítulo / leyenda
ws.merge_cells("A2:O2")
c = ws["A2"]
c.value = ("Datos de directorios públicos (jul-2026). Campos vacíos = completar en la llamada/visita. "
           "Actualizá 'Estado' a medida que contactás. WhatsApp marcado 'confirmar' = validar antes de escribir.")
c.font = Font(italic=True, color="666666", size=9)
c.alignment = wrap
ws.row_dimensions[2].height = 26

# Encabezados (fila 3)
for j, name in enumerate(cols, start=1):
    cell = ws.cell(row=3, column=j, value=name)
    cell.font = hdr_font
    cell.fill = hdr_fill
    cell.alignment = center
    cell.border = border

# --- Datos reales (nombre, barrio, dirección, tel, whatsapp, email, web, ig, fb, horario, encargado, estado, prioridad, notas) ---
D = [
 ("Ferretería del Once", "Balvanera / Once", "Sarmiento 2846", "011 4687-0696", "confirmar", "", "", "", "facebook.com/p/Ferreteria-del-once", "L-V 9-18, Sáb AM", "", "Sin contactar", "Alta", "35+ años. Zona mayorista Once."),
 ("RIVAFER", "Once / Balvanera", "s/d (consultar web)", "", "", "", "rivafer.com.ar", "", "", "", "", "Sin contactar", "Alta", "Tiene e-commerce propio."),
 ("Ferretería El Once", "Once / Balvanera", "s/d (tienda online)", "", "", "", "ferreteriaelonce.com", "", "", "", "", "Sin contactar", "Alta", "Vende online, buen prospecto mayorista."),
 ("MAABA Distribuidora", "Villa Lugano", "Zelada 6523 (CP 1440)", "011 7569-4425", "11 5429-1284", "", "maaba.com.ar", "", "", "", "", "Sin contactar", "Alta", "Distribuidora de ferretería. Móvil = WhatsApp probable."),
 ("Ferretería Belgrano", "Belgrano", "Manuel Ugarte 2391 / Zapiola 2468", "", "confirmar", "", "", "instagram.com/ferreteriabelgrano2", "", "", "", "Sin contactar", "Alta", "2 sucursales. Tiene IG activo."),
 ("Ferretería (Monroe)", "Belgrano", "Av. Monroe 3626", "011 4541-6047", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Belgrano."),
 ("Ferretería (Juramento)", "Belgrano", "Juramento 3125", "011 4544-9991", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Belgrano."),
 ("Ferretería (Amenábar)", "Belgrano", "Amenábar 2273", "011 4787-6355", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Belgrano."),
 ("Ferretería (Blanco Encalada)", "Belgrano", "Blanco Encalada 2606", "011 4787-4432", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Belgrano."),
 ("Ferretería (Moldes)", "Belgrano", "Moldes 1802", "011 4787-4316", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Belgrano."),
 ("Ferretería (Palermo)", "Palermo", "Jorge Luis Borges 2475 Local 37", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Palermo."),
 ("Mundo Soluciones Caballito", "Caballito", "P. Lozano 3150", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Caballito."),
 ("Ferretería y Cerraj. 24hs Trenque", "Villa Urquiza", "Echeverría 5099 (y Ávalos)", "011 4521-9377", "11 5002-4497", "", "", "", "", "24 hs", "", "Sin contactar", "Alta", "24hs. Móvil = WhatsApp probable."),
 ("Ferretería (Lavoisier)", "Villa Urquiza", "Lavoisier 3273", "011 4573-2278", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio V. Urquiza."),
 ("Ferretería (Burela)", "Villa Urquiza", "Burela 2725", "011 4521-4337", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio V. Urquiza."),
 ("Ferretería (Bauness)", "Villa Urquiza", "Bauness 2201", "011 4521-9229", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio V. Urquiza."),
 ("Ferretería (Monroe 3897)", "Villa Urquiza", "Av. Monroe 3897", "011 4545-4829", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio V. Urquiza."),
 ("Ferretería Del Norte", "Villa Urquiza", "s/d (Buscabaires)", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Baja", "Ficha Buscabaires — verificar dirección."),
 ("Ferretería JS", "Villa Urquiza", "s/d (Buscabaires)", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Baja", "Ficha Buscabaires — verificar dirección."),
 ("Argentec Herramientas (Boedo)", "Boedo", "Av. Asamblea 524", "", "confirmar", "", "argentec.com.ar", "", "", "", "", "Sin contactar", "Alta", "Cadena c/ red de sucursales y web."),
 ("Argentec Herramientas (Flores)", "Flores", "Av. Gaona 3059", "", "confirmar", "", "argentec.com.ar", "", "", "", "", "Sin contactar", "Alta", "Cadena c/ web."),
 ("Argentec Herramientas (V.Crespo)", "Villa Crespo", "Av. Córdoba 5786", "", "confirmar", "", "argentec.com.ar", "", "", "", "", "Sin contactar", "Alta", "Cadena c/ web."),
 ("Argentec Herramientas (V.Crespo 2)", "Villa Crespo", "Av. Córdoba 4038", "", "confirmar", "", "argentec.com.ar", "", "", "", "", "Sin contactar", "Media", "Cadena c/ web."),
 ("Herramientas Dali S.R.L.", "Villa Crespo", "Montenegro 32", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio V. Crespo."),
 ("Ferretería (Crisólogo Larralde)", "Núñez", "Crisólogo Larralde 1982", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Núñez."),
 ("Ferretería (Pacheco)", "Saavedra", "Pacheco 3545", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Saavedra."),
 ("Ferretería (Ruiz Huidobro)", "Saavedra", "Ruiz Huidobro 2663", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Saavedra."),
 ("Ferretería (Sanabria)", "Villa Devoto", "Sanabria 2885", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio V. Devoto."),
 ("Ferretería (Segurola)", "Villa Devoto", "Av. Segurola 2884", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio V. Devoto."),
 ("Ferretería (Marcos Paz)", "Villa Devoto", "Marcos Paz 4510", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio V. Devoto."),
 ("Ferretería Avenida", "Mataderos", "s/d (Buscabaires)", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Baja", "Ficha Buscabaires — verificar dirección."),
 ("Ferretería (Alberdi)", "Mataderos", "Av. J.B. Alberdi 5775", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Mataderos."),
 ("Ferretería (Larrazábal)", "Mataderos", "Av. Larrazábal 966", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Mataderos."),
 ("Ferretería (Eva Perón)", "Mataderos", "Av. Eva Perón 5553", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Mataderos."),
 ("Ferretería (Oliden)", "Mataderos", "Oliden 2150", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Mataderos."),
 ("Ferretería Montiel", "Liniers", "s/d (Infoisinfo)", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Baja", "Verificar dirección."),
 ("Ferretería El Ahorro", "Liniers", "s/d (Infoisinfo)", "", "confirmar", "", "", "", "", "", "", "Sin contactar", "Baja", "Verificar dirección."),
 ("Ferretería San Telmo S.R.L.", "San Telmo", "s/d (consultar IG/FB)", "", "confirmar", "", "", "instagram.com/ferreteriasantelmo", "facebook.com/p/FERRETERIA-SAN-TELMO-SRL", "", "", "Sin contactar", "Alta", "IG + FB activos. Buen prospecto."),
 ("Ferretería (Defensa)", "San Telmo", "Defensa 732", "011 4362-3299", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio San Telmo."),
 ("Ferretería (Av. Brasil)", "Constitución", "Av. Brasil 601", "011 4300-7763", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio zona sur."),
 ("Ferretería (Chacabuco)", "San Telmo", "Chacabuco 798", "011 4300-6970", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio San Telmo."),
 ("Ferretería (San Antonio)", "Barracas", "San Antonio 440", "011 4302-6979", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Barracas."),
 ("Ferretería (Salom)", "Barracas", "Salom 326", "011 4302-5832", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Barracas."),
 ("Ferretería (Rocha)", "Barracas", "Rocha 1600", "011 4302-5122", "confirmar", "", "", "", "", "", "", "Sin contactar", "Media", "Directorio Barracas."),
]

for i, row in enumerate(D, start=1):
    r = i + 3
    ws.cell(row=r, column=1, value=i).alignment = center
    for j, val in enumerate(row, start=2):
        cell = ws.cell(row=r, column=j, value=val)
        cell.alignment = wrap
        cell.border = border
    ws.cell(row=r, column=1).border = border
    # color alterno
    if i % 2 == 0:
        for j in range(1, len(cols) + 1):
            if not ws.cell(row=r, column=j).fill.fgColor.rgb or ws.cell(row=r, column=j).fill.patternType is None:
                ws.cell(row=r, column=j).fill = PatternFill("solid", fgColor="F7F7F7")

# Anchos de columna
widths = [4, 30, 16, 30, 15, 15, 22, 24, 30, 34, 14, 16, 14, 10, 34]
for j, w in enumerate(widths, start=1):
    ws.column_dimensions[get_column_letter(j)].width = w

ws.freeze_panes = "A4"
ws.auto_filter.ref = f"A3:O{len(D)+3}"

# =====================================================================
# HOJA 2 — CÓMO COMPLETAR Y ESCALAR (método de prospección semanal)
# =====================================================================
ws2 = wb.create_sheet("Cómo completar y escalar")
ws2.column_dimensions["A"].width = 4
ws2.column_dimensions["B"].width = 110

def block(ws, rows, start=1):
    r = start
    for kind, text in rows:
        cell = ws.cell(row=r, column=2, value=text)
        if kind == "h1":
            cell.font = title_font; cell.fill = title_fill
            cell.alignment = Alignment(vertical="center"); ws.row_dimensions[r].height = 26
        elif kind == "h2":
            cell.font = Font(bold=True, color="0D0D0D", size=12)
            cell.fill = PatternFill("solid", fgColor=VERDE)
        elif kind == "b":
            cell.font = Font(bold=True, size=10)
        else:
            cell.font = Font(size=10); cell.alignment = wrap
        r += 1
    return r

block(ws2, [
 ("h1", "  Cómo completar los datos que faltan (y encontrar ferreterías nuevas)"),
 ("n", ""),
 ("h2", "  A) Completar Encargado / Email / WhatsApp / Horario de cada ficha"),
 ("n", "Estos datos casi nunca están en directorios. Se consiguen así, en orden de rapidez:"),
 ("b", "1) Google Maps (la mejor fuente y gratis)"),
 ("n", "   • Buscá el nombre + dirección en maps.google.com. La ficha del negocio muestra teléfono, sitio web, horarios reales y a veces WhatsApp."),
 ("n", "   • El botón 'Sitio web' suele llevar a su IG/Facebook/tienda → de ahí sacás redes y WhatsApp."),
 ("b", "2) WhatsApp Business (para validar el número)"),
 ("n", "   • Guardá el teléfono y abrí wa.me/54911XXXXXXXX. Si tiene foto/estado de empresa, es WhatsApp válido → marcá la celda en verde."),
 ("b", "3) El nombre del encargado se pide en el primer contacto"),
 ("n", "   • Por teléfono/WhatsApp: '¿Con quién tengo el gusto? ¿Quién hace las compras?'. Se anota en la columna Encargado. NO se inventa."),
 ("n", ""),
 ("h2", "  B) Encontrar ferreterías NUEVAS cada semana (fuentes)"),
 ("n", "Rotá una zona/fuente por semana para no repetir y llegar a toda CABA:"),
 ("n", "   • Google Maps: buscá 'ferretería' + barrio, movés el mapa y agregás las que no estén en la lista. (CABA tiene cientos.)"),
 ("n", "   • Directorios: guiaferreterias.com.ar/capital-federal, paginasamarillas.com.ar, argentino.com.ar, buscabaires.com (filtran por barrio)."),
 ("n", "   • Instagram/Facebook: buscar 'ferretería + barrio'; muchas PyMEs solo están en redes."),
 ("n", "   • Mercado Libre: vendedores del rubro ferretería/herramientas en CABA = posibles revendedores."),
 ("n", "   • Grupos/cámaras: CAFARA (Cámara Argentina de Ferreterías) y grupos de compra del rubro."),
 ("n", ""),
 ("h2", "  C) Estado de prospección (usar la columna 'Estado')"),
 ("n", "   Sin contactar  →  Contactado  →  Interesado  →  Cotización enviada  →  Cliente  /  Descartado"),
 ("n", "   Filtrá por 'Prioridad = Alta' para empezar por los que tienen web/redes/volumen (compran más)."),
 ("n", ""),
 ("h2", "  D) Regla de oro"),
 ("b", "   No inventar datos. Celda vacía = 'todavía no lo tengo'. Un email o WhatsApp equivocado quema el prospecto y la reputación de la marca."),
], start=1)

# =====================================================================
# HOJA 3 — PLAN SEMANAL DE REDES (crecer seguidores)
# =====================================================================
ws3 = wb.create_sheet("Plan Semanal Redes")
headers3 = ["Día", "Bloque prospección ferreterías", "Contenido / Redes a publicar", "Acción de crecimiento (seguidores)"]
w3 = [14, 42, 46, 46]
for j, w in enumerate(w3, start=1):
    ws3.column_dimensions[get_column_letter(j)].width = w

ws3.merge_cells("A1:D1")
c = ws3["A1"]; c.value = "UNIPROVEEDORES · Plan Semanal — Redes + Prospección"
c.font = title_font; c.fill = title_fill; c.alignment = Alignment(vertical="center")
ws3.row_dimensions[1].height = 26

for j, h in enumerate(headers3, start=1):
    cell = ws3.cell(row=2, column=j, value=h)
    cell.font = hdr_font; cell.fill = hdr_fill; cell.alignment = center; cell.border = border

plan = [
 ("Lunes", "Elegí 1 barrio nuevo en Google Maps. Cargá 10 ferreterías nuevas en la hoja 1.",
  "IG+FB: foto de producto estrella con precio (cápsula verde). X: oferta corta. WA canal: 'ofertas de la semana'.",
  "Seguí a 20 ferreterías/proveedores del rubro en IG. Comentá en 5 posteos. Invitá contactos a seguir la Página FB."),
 ("Martes", "Llamá/escribí por WhatsApp a 10 ferreterías 'Sin contactar'. Completá Encargado y validá WhatsApp.",
  "YouTube: subí 1 Short (review o uso de herramienta, 20-40s, marca de agua). IG Reel = mismo clip.",
  "YouTube: respondé todos los comentarios. Pediste sub al final del video. IG: 3 stories con encuesta/pregunta."),
 ("Miércoles", "Cargá 10 ferreterías nuevas (otra zona). Pasá a 'Interesado' las que respondieron.",
  "LinkedIn: post B2B ('Somos distribuidores mayoristas para ferreterías, envío y garantía'). IG carrusel de catálogo.",
  "LinkedIn: conectá con 20 dueños/encargados de ferreterías y comercios. IG: colaborá (collab post) con 1 proveedor."),
 ("Jueves", "Enviá cotización/lista de precios a los 'Interesados'. Registrá en Notas.",
  "IG+FB: testimonio o 'antes/después' con herramienta. WA canal: novedad de stock. X: hilo con 3 tips de uso.",
  "Concurso simple: 'seguinos + etiquetá a 2 ferreteros' por un descuento. Reglas en story fija."),
 ("Viernes", "Seguimiento a todos los contactados de la semana. Cerrá lo que se pueda a 'Cliente'.",
  "YouTube: 1 video largo o Short de oferta de fin de semana. Reutilizá para IG/FB/TikTok/X.",
  "Cross-promo: compartí el video en todas las redes + WA canal. Pediste que lo reenvíen. Fijá el mejor post."),
 ("Sáb/Dom", "Actualizá KPIs (nuevos leads, contactados, clientes). Planificá barrio del lunes.",
  "Programá 2-3 posteos livianos (ofertas, frase de marca). Responder mensajes pendientes.",
  "Revisá métricas de cada red: qué post creció más → repetí ese formato la semana próxima."),
]
r = 3
for day, prosp, cont, crec in plan:
    ws3.cell(row=r, column=1, value=day).font = Font(bold=True)
    ws3.cell(row=r, column=2, value=prosp)
    ws3.cell(row=r, column=3, value=cont)
    ws3.cell(row=r, column=4, value=crec)
    for j in range(1, 5):
        ws3.cell(row=r, column=j).alignment = wrap
        ws3.cell(row=r, column=j).border = border
    ws3.row_dimensions[r].height = 60
    r += 1

# Meta semanal
ws3.merge_cells(f"A{r+1}:D{r+1}")
c = ws3.cell(row=r+1, column=1)
c.value = ("META SEMANAL: +30 ferreterías nuevas cargadas · 30 contactadas · 5 clientes nuevos  |  "
           "Redes: +50 seguidores por red · 5 publicaciones · 1 video YouTube")
c.font = Font(bold=True, color="0D0D0D"); c.fill = PatternFill("solid", fgColor=VERDE)
c.alignment = wrap
ws3.row_dimensions[r+1].height = 30

# =====================================================================
# HOJA 4 — SEGUIDORES POR RED (tácticas concretas)
# =====================================================================
ws4 = wb.create_sheet("Seguidores por Red")
ws4.column_dimensions["A"].width = 16
ws4.column_dimensions["B"].width = 60
ws4.column_dimensions["C"].width = 50
heads4 = ["Red", "Cómo conseguir seguidores (táctica principal)", "Frecuencia ideal + tip clave"]
ws4.merge_cells("A1:C1")
c = ws4["A1"]; c.value = "Cómo crecer en cada red — Uniproveedores"
c.font = title_font; c.fill = title_fill; c.alignment = Alignment(vertical="center")
ws4.row_dimensions[1].height = 26
for j, h in enumerate(heads4, start=1):
    cell = ws4.cell(row=2, column=j, value=h)
    cell.font = hdr_font; cell.fill = hdr_fill; cell.alignment = center; cell.border = border

redes = [
 ("Instagram", "Reels cortos (herramienta en acción, precio en pantalla). Usá 3-5 hashtags locales (#ferreteria #herramientas #caba). Respondé DMs con link de WhatsApp. Collabs con proveedores.", "1 Reel/día + 3 stories. El Reel con buen gancho en los primeros 2s es lo que más trae seguidores nuevos."),
 ("Facebook", "Página (no perfil). Botón 'Enviar WhatsApp'. Publicá ofertas y sumate a grupos de compra/venta y de ferreteros. Invitá a tus contactos a seguir la Página.", "4-5 posts/semana. Los grupos de FB del rubro son la vía más rápida de alcance B2B gratis."),
 ("Canal WhatsApp", "Creá el Canal desde WhatsApp Business. Poné el link en bio de IG/FB, en la firma de mail y en cada venta. Publicá 'ofertas de la semana' y stock nuevo.", "2-3 difusiones/semana. Cada cliente que atendés → invitalo al canal. Crece por invitación directa."),
 ("YouTube", "Shorts (20-40s) reutilizando los Reels + 1 video largo/semana (reviews, 'cómo usar'). Título con palabra clave + miniatura verde de marca. Pedí suscripción al final.", "2-3 Shorts + 1 largo/semana. Shorts = alcance nuevo; videos largos = autoridad y ventas."),
 ("X (Twitter)", "Ofertas cortas con imagen, hilos de 'tips de ferretería', responder a cuentas del rubro. Hashtags #Argentina #herramientas.", "1-2 posts/día. En X crecés respondiendo e interactuando más que publicando solo."),
 ("LinkedIn", "Página de empresa. Postear en tono B2B: 'distribuidor mayorista para ferreterías, envío y garantía'. Conectar con dueños/encargados y comercios. Publicar casos y catálogo.", "2-3 posts/semana. Es la red para VENDER a ferreterías (no tanto para volumen de seguidores)."),
]
r = 3
for red, tac, freq in redes:
    ws4.cell(row=r, column=1, value=red).font = Font(bold=True)
    ws4.cell(row=r, column=2, value=tac)
    ws4.cell(row=r, column=3, value=freq)
    for j in range(1, 4):
        ws4.cell(row=r, column=j).alignment = wrap
        ws4.cell(row=r, column=j).border = border
    ws4.row_dimensions[r].height = 74
    r += 1

# Reglas transversales
ws4.merge_cells(f"A{r+1}:C{r+1}")
c = ws4.cell(row=r+1, column=1)
c.value = ("REGLAS QUE APLICAN A TODAS: (1) Mismo @uniproveedoresok y mismo logo en todas. "
           "(2) Contenido 1 vez, adaptado a cada red (grabás 1 video → Reel/Short/TikTok/X). "
           "(3) Siempre link a WhatsApp wa.me/541135510715. (4) Publicá en horario pico: 12-14h y 19-21h. "
           "(5) Respondé TODO comentario/DM el mismo día: el algoritmo premia la interacción.")
c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor=NEGRO)
c.alignment = wrap
ws4.row_dimensions[r+1].height = 58

# Guardar
out = "/home/user/socialflow/data/Ferreterias-CABA-Uniproveedores.xlsx"
wb.save(out)
print("OK ->", out)
print("Ferreterías cargadas:", len(D))
