//+------------------------------------------------------------------+
//|                                                     breakout.mq5 |
//|  Breakout del rango asiático con filtro de compresión (BTCUSD H1)|
//|  Misma lógica que trading/strategies/breakout/strategy.py         |
//+------------------------------------------------------------------+
#property copyright "Estrategia breakout - agente breakout"
#property version   "1.00"
#property strict
#include <Trade\Trade.mqh>

//--- Lógica (resumen, ver REPORT.md):
//  1) Rango = máx/mín de las velas H1 cuya hora UTC está en [InpRangeStart, InpRangeEnd). Queda fijo al cerrar la
//     última vela del rango.
//  2) Filtro de compresión: (rango_alto - rango_bajo) < InpCompressK * ATR(D1, InpAtrLen) del día anterior (iATR shift 1).
//  3) Ruptura: durante las horas UTC [InpRangeEnd, InpEntryEnd), si una vela H1 CIERRA por encima del máximo del rango
//     (+ buffer) -> compra a mercado en la apertura de la siguiente vela; si cierra por debajo del mínimo -> venta.
//     Filtro de volumen opcional: volumen(tick) de la vela de ruptura > InpVolMult * iMA(volumen, InpVolLen).
//     Máximo 1 operación por día y por dirección.
//  4) SL = max(InpSlMult * ancho_rango, InpSlFloorAtr * ATR_D1) desde el cierre de la vela de señal; TP = InpTpR * SL.
//     Si InpExitEod, se cierra la posición en la apertura de la primera vela con hora UTC >= InpExitHour.
//  5) Lotes por riesgo: (balance * InpRiskPct/100) / distancia_SL, redondeado al paso del bróker (mínimo lote mínimo).
//  6) Protección: si el equity cae InpMaxEquityDD USD por debajo del máximo histórico de equity, se cierra todo y el EA
//     deja de operar (el máximo se guarda en una variable global del terminal para sobrevivir reinicios).
//  7) Filtro de spread máximo. Todo el trabajo se hace SOLO al abrir una vela nueva (salvo la vigilancia del DD).

//--- Inputs = parámetros de DEFAULT_PARAMS en strategy.py
input int      InpRangeStart   = 0;      // Hora UTC inicio del rango (inclusive)
input int      InpRangeEnd     = 8;      // Hora UTC fin del rango (exclusive)
input int      InpEntryEnd     = 13;     // Última hora UTC (exclusive) para aceptar rupturas
input bool     InpExitEod      = true;   // Cerrar al final del día
input int      InpExitHour     = 23;     // Hora UTC de cierre (se cierra al abrir la vela de esa hora)
input double   InpCompressK    = 0.35;   // Ancho del rango < K * ATR diario (>=9 => sin filtro)
input double   InpBufferAtr    = 0.0;    // Buffer de ruptura (fracción del ATR diario)
input double   InpSlMult       = 0.5;    // SL = SlMult * ancho del rango
input double   InpSlFloorAtr   = 0.25;   // Distancia mínima del SL (fracción del ATR diario)
input double   InpTpR          = 2.0;    // TP en múltiplos de R
input double   InpVolMult      = 1.2;    // Filtro de volumen (0 = sin filtro)
input int      InpVolLen       = 20;     // Periodo de la media de volumen
input int      InpAtrLen       = 14;     // Periodo del ATR diario
input double   InpRiskPct      = 1.0;    // % del balance arriesgado por operación
input int      InpServerUtcOffset = 0;   // Offset del servidor respecto a UTC (horas). Hora servidor = UTC + offset
input double   InpMaxSpreadUsd = 40.0;   // Spread máximo permitido (USD por 1 BTC)
input double   InpMaxEquityDD  = 300.0;  // Cierre total si equity < máximo histórico - este valor (USD)
input ulong    InpMagic        = 20260905; // Magic number
input int      InpSlippagePts  = 50;     // Desviación máxima (puntos)

//--- Globales
CTrade   trade;
int      hAtrD1 = INVALID_HANDLE;   // iATR diario
int      hVolMa = INVALID_HANDLE;   // iMA sobre volumen tick (SMA)
datetime lastBarTime = 0;
datetime rangeDay    = 0;           // día UTC al que pertenece el rango actual
double   rangeHi = 0, rangeLo = 0;
bool     rangeOk = false;
bool     longDone = false, shortDone = false;
bool     tradingHalted = false;
string   gvPeakName;

//+------------------------------------------------------------------+
//| Utilidades de tiempo: convertir hora del servidor a UTC          |
//+------------------------------------------------------------------+
datetime ToUtc(datetime serverTime) { return serverTime - InpServerUtcOffset * 3600; }
int      UtcHour(datetime serverTime) { MqlDateTime t; TimeToStruct(ToUtc(serverTime), t); return t.hour; }
datetime UtcDay(datetime serverTime)  { datetime u = ToUtc(serverTime); return u - (u % 86400); }

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePts);
   trade.SetTypeFillingBySymbol(_Symbol);
   hAtrD1 = iATR(_Symbol, PERIOD_D1, InpAtrLen);
   hVolMa = iMA(_Symbol, PERIOD_CURRENT, InpVolLen, 0, MODE_SMA, VOLUME_TICK);
   if(hAtrD1 == INVALID_HANDLE || hVolMa == INVALID_HANDLE)
   {
      Print("Error creando indicadores");
      return INIT_FAILED;
   }
   if(InpRangeEnd <= InpRangeStart || InpEntryEnd <= InpRangeEnd)
   {
      Print("Parámetros de horas incoherentes");
      return INIT_PARAMETERS_INCORRECT;
   }
   // máximo histórico de equity persistente entre reinicios
   gvPeakName = "BRK_PEAK_" + _Symbol + "_" + IntegerToString((int)InpMagic);
   if(!GlobalVariableCheck(gvPeakName))
      GlobalVariableSet(gvPeakName, AccountInfoDouble(ACCOUNT_EQUITY));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(hAtrD1 != INVALID_HANDLE) IndicatorRelease(hAtrD1);
   if(hVolMa != INVALID_HANDLE) IndicatorRelease(hVolMa);
}

//+------------------------------------------------------------------+
//| Protección de drawdown de equity (se vigila en cada tick)        |
//+------------------------------------------------------------------+
bool CheckEquityDD()
{
   double eq   = AccountInfoDouble(ACCOUNT_EQUITY);
   double peak = GlobalVariableGet(gvPeakName);
   if(eq > peak) { peak = eq; GlobalVariableSet(gvPeakName, peak); }
   if(peak - eq >= InpMaxEquityDD)
   {
      if(!tradingHalted)
         PrintFormat("DD de equity %.2f >= %.2f: cierro todo y detengo el EA", peak - eq, InpMaxEquityDD);
      tradingHalted = true;
      CloseAllPositions("dd_stop");
      return true;
   }
   return tradingHalted;
}

//+------------------------------------------------------------------+
//| Cerrar todas las posiciones de este EA en este símbolo           |
//+------------------------------------------------------------------+
void CloseAllPositions(string reason)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) continue;
      if(!trade.PositionClose(ticket))
         PrintFormat("Error cerrando %I64u (%s): %d", ticket, reason, trade.ResultRetcode());
   }
}

bool HasPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == (long)InpMagic) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Cálculo de lotes por riesgo fijo                                 |
//+------------------------------------------------------------------+
double LotsByRisk(double slDistance)
{
   if(slDistance <= 0) return 0;
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskUsd  = balance * InpRiskPct / 100.0;
   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickVal <= 0 || tickSize <= 0) return 0;
   double lossPerLot = slDistance / tickSize * tickVal;   // pérdida en moneda de la cuenta por 1 lote
   double lots = riskUsd / lossPerLot;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   lots = MathFloor(lots / step) * step;
   if(lots < minL) lots = minL;         // igual que el backtest: nunca por debajo del lote mínimo
   if(lots > maxL) lots = maxL;
   // comprobar margen disponible; si no alcanza, reducir
   double marginReq = 0;
   double price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(OrderCalcMargin(ORDER_TYPE_BUY, _Symbol, lots, price, marginReq))
   {
      double freeM = AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9;
      while(lots >= minL && marginReq > freeM)
      {
         lots -= step;
         if(!OrderCalcMargin(ORDER_TYPE_BUY, _Symbol, lots, price, marginReq)) break;
      }
      if(lots < minL) return 0;
   }
   return NormalizeDouble(lots, 2);
}

//+------------------------------------------------------------------+
//| Reconstruir el rango asiático del día UTC actual con velas H1    |
//| (se recorre hacia atrás desde la vela recién cerrada)            |
//+------------------------------------------------------------------+
void UpdateRange(datetime closedBarTime)
{
   datetime day = UtcDay(closedBarTime);
   if(day != rangeDay)
   {
      rangeDay = day; rangeHi = 0; rangeLo = 0; rangeOk = false; longDone = false; shortDone = false;
   }
   if(rangeOk) return;
   // Solo tiene sentido cerrar el rango cuando la vela cerrada es la última del rango
   int hr = UtcHour(closedBarTime);
   if(hr != InpRangeEnd - 1) return;
   int need = InpRangeEnd - InpRangeStart;
   int bars = 0; double hi = -DBL_MAX, lo = DBL_MAX;
   for(int s = 1; s <= 48; s++)   // shift 1 = vela recién cerrada
   {
      datetime t = iTime(_Symbol, PERIOD_CURRENT, s);
      if(t == 0) break;
      if(UtcDay(t) != day) break;
      int h = UtcHour(t);
      if(h >= InpRangeStart && h < InpRangeEnd)
      {
         hi = MathMax(hi, iHigh(_Symbol, PERIOD_CURRENT, s));
         lo = MathMin(lo, iLow(_Symbol, PERIOD_CURRENT, s));
         bars++;
      }
   }
   if(bars >= need / 2 && bars > 0)
   {
      rangeHi = hi; rangeLo = lo; rangeOk = true;
      PrintFormat("Rango %s: %.2f - %.2f (%d velas)", TimeToString(day, TIME_DATE), rangeLo, rangeHi, bars);
   }
}

//+------------------------------------------------------------------+
//| Lógica principal: se ejecuta una vez por vela nueva              |
//+------------------------------------------------------------------+
void OnNewBar()
{
   datetime closedTime = iTime(_Symbol, PERIOD_CURRENT, 1);   // vela recién cerrada = "vela de señal"
   int hr = UtcHour(closedTime);
   int nextHr = UtcHour(iTime(_Symbol, PERIOD_CURRENT, 0));

   // 0) salida horaria: la vela que acaba de abrir tiene hora UTC >= InpExitHour (o es un día nuevo)
   if(InpExitEod && HasPosition() && (nextHr >= InpExitHour || nextHr < hr))
   {
      CloseAllPositions("eod");
      return;
   }

   // 1) rango
   UpdateRange(closedTime);

   // 2) ¿estamos en ventana de entrada y sin posición?
   if(HasPosition() || !rangeOk) return;
   if(!(hr >= InpRangeEnd && hr < InpEntryEnd)) return;

   // ATR diario del día anterior (shift 1). Nota: la vela D1 del bróker empieza a medianoche del servidor,
   // no a las 00:00 UTC; con offsets grandes hay una pequeña diferencia con el backtest.
   double atrBuf[];
   if(CopyBuffer(hAtrD1, 0, 1, 1, atrBuf) != 1 || atrBuf[0] <= 0) return;
   double atr = atrBuf[0];

   double width = rangeHi - rangeLo;
   if(width <= 0 || width >= InpCompressK * atr) return;

   // filtro de volumen (vela de señal vs SMA de volumen tick con shift 0 = incluye la vela de señal)
   if(InpVolMult > 0)
   {
      double vma[];
      if(CopyBuffer(hVolMa, 0, 1, 1, vma) != 1) return;
      double v = (double)iVolume(_Symbol, PERIOD_CURRENT, 1);
      if(!(v > InpVolMult * vma[0])) return;
   }

   // filtro de spread
   double spread = SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(spread > InpMaxSpreadUsd) { PrintFormat("Spread %.2f > máximo, no opero", spread); return; }

   double close1 = iClose(_Symbol, PERIOD_CURRENT, 1);
   double buf = InpBufferAtr * atr;
   int side = 0;
   if(!longDone && close1 > rangeHi + buf) side = 1;
   else if(!shortDone && close1 < rangeLo - buf) side = -1;
   if(side == 0) return;

   double slDist = MathMax(InpSlMult * width, InpSlFloorAtr * atr);
   // SL/TP medidos desde el cierre de la vela de señal (igual que el backtest)
   double sl = close1 - side * slDist;
   double tp = close1 + side * InpTpR * slDist;
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   sl = NormalizeDouble(sl, digits); tp = NormalizeDouble(tp, digits);

   double lots = LotsByRisk(slDist);
   if(lots <= 0) { Print("Lotes = 0 (margen insuficiente)"); return; }

   bool ok;
   if(side > 0) ok = trade.Buy(lots, _Symbol, 0, sl, tp, "brk_long");
   else         ok = trade.Sell(lots, _Symbol, 0, sl, tp, "brk_short");
   if(ok)
   {
      if(side > 0) longDone = true; else shortDone = true;
      PrintFormat("%s %.2f lotes, SL %.2f TP %.2f (rango %.2f-%.2f, ATR %.2f)", side > 0 ? "BUY" : "SELL", lots, sl, tp, rangeLo, rangeHi, atr);
   }
   else
      PrintFormat("Error al abrir: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
}

//+------------------------------------------------------------------+
void OnTick()
{
   // vigilancia del drawdown de equity en cada tick
   if(CheckEquityDD()) return;

   // trabajar solo al abrir una vela nueva
   datetime t0 = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(t0 == lastBarTime) return;
   lastBarTime = t0;
   OnNewBar();
}
//+------------------------------------------------------------------+
