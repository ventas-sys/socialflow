# 🛠️ Progreso — Prospección Ferreterías CABA (Uniproveedores)

> Registro para ir viendo resultados semana a semana. Actualizar al final de cada semana.
> Base de datos y tablero: `data/Ferreterias-CABA-Uniproveedores.xlsx`.

## 📍 Contexto
- **Depósito:** Bacacay 4726 — Comuna 10 (borde Floresta / Vélez Sarsfield).
- **Estrategia:** contactar por cercanía. Empezar por **Anillo 1** (Comuna 10, ~0-2 km),
  luego Anillo 2 (~2-6 km) y Anillo 3 (resto de CABA).
- **Estimación real de mercado:** ~800-1.500 ferreterías en toda CABA (no 10.000).
  Listado completo y actualizado → correr `scripts/scrape_ferreterias_gmaps.py` (Google Maps).

## 🎯 Metas semanales
- +30 ferreterías nuevas cargadas
- 30 ferreterías contactadas
- 5 clientes nuevos
- Redes: +50 seguidores por red · 5 publicaciones · 1 video YouTube

## 📊 Estado actual (base cargada)
- **78 ferreterías reales** cargadas (de directorios públicos), ordenadas por cercanía.
  - Anillo 1: 19 · Anillo 2: 33 · Anillo 3: 26
- Datos por completar en el contacto: WhatsApp validado, email, encargado, horario.

## 🗒️ Herramientas listas
- [x] Excel de prospección con anillos + autofiltro
- [x] Tablero de resultados (se actualiza con la columna "Estado")
- [x] Plantillas de contacto WhatsApp/email/visita (hoja "Mensajes de contacto")
- [x] Script Google Maps para bajar TODAS (`scripts/scrape_ferreterias_gmaps.py`) — falta API key
- [ ] API key de Google Maps cargada y barrido completo corrido

## 📈 Bitácora semanal
| Semana | Cargadas | Contactadas | Interesadas | Clientes | Notas / aprendizajes |
|---|---|---|---|---|---|
| Base (jul-2026) | 78 | 0 | 0 | 0 | Lista inicial armada. Arrancar por Anillo 1. |
|  |  |  |  |  |  |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

## ⏭️ Próximos pasos
1. Conseguir la API key de Google Maps y correr el scraper → listado completo por distancia.
2. Contactar Anillo 1 con las plantillas (empezar por Prioridad = Alta).
3. Anotar cada resultado en la columna "Estado" del Excel → el Tablero se actualiza solo.
4. Cerrar la semana volcando los números en esta bitácora.
