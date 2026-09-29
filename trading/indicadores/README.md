# Indicadores TradingView

## EscanerOB.pine
Réplica del panel "Escáner OB" (estructura de mercado + estadísticas) para TradingView, Pine Script v5.

Qué dibuja:
- Pivotes (longitud configurable, 5 por defecto) y rupturas por cierre: **BOS** si va a favor de la tendencia, **CHoCH** si la cambia. Línea desde el pivote hasta la vela de ruptura con etiqueta.
- Nivel alto y bajo en curso con línea punteada y etiqueta a la derecha: **LH/LL** en tendencia bajista, **HH/HL** en alcista. El nivel "en validación" es el extremo desde el último pivote confirmado, aún sin confirmar.
- Order blocks opcionales (última vela contraria antes de la ruptura), apagados por defecto.

Tabla superior "Escáner OB": tendencia, máximos y mínimos válidos (pivotes confirmados), LL/LH (o HL/HH) actual, estado ("Validando mínimo..." tras un máximo confirmado, "Validando máximo..." tras un mínimo).

Tabla inferior de estadísticas:
- **Tasa cont.**: BOS / (BOS + CHoCH), en %.
- **Racha tendencia**: BOS consecutivos desde el último CHoCH.
- **Retest BOS arriba / Retest arriba**: % de rupturas alcistas (solo BOS / todas) cuyo nivel fue tocado de nuevo dentro de N barras (60 por defecto). Igual para abajo.
- Niveles: BAJO < 30 %, MEDIO 30-59 %, ALTO ≥ 60 %.
- **Calificación**: un 🔥 por cada condición cumplida: tasa de continuación ≥ 60 %, retest en la dirección de la tendencia ≥ 60 %, racha ≥ 1.

Uso: TradingView → Editor Pine → pegar el contenido → "Añadir al gráfico". No está compilado en este repositorio; si el editor marca un error, copiar el mensaje para corregirlo.
