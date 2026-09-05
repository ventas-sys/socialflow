//+------------------------------------------------------------------+
//|                                                    reversion.mq5 |
//|  Estrategia de REVERSIÓN A LA MEDIA en BTCUSD (Bollinger + RSI)  |
//|  Réplica exacta de trading/strategies/reversion/strategy.py      |
//+------------------------------------------------------------------+
//  LÓGICA (se evalúa SOLO al abrir una vela nueva, con la vela recién cerrada = shift 1):
//   1. Bandas de Bollinger(InpBBPeriod, InpBBDev) sobre el cierre (iBands, PRICE_CLOSE).
//   2. RSI(InpRSIPeriod) (iRSI) y ATR(InpATRPeriod) (iATR). EMA(InpEMAPeriod) en H4 (iMA) como filtro de tendencia.
//   3. LONG  si close[1] < banda inferior[1] y RSI[1] < InpRSILow       (y close[1] > EMA H4 cerrada, si filtro).
//      SHORT si close[1] > banda superior[1] y RSI[1] > 100-InpRSILow   (y close[1] < EMA H4 cerrada, si filtro).
//      Con InpConfirm=true se exige que la vela [2] estuviese fuera de la banda con RSI extremo y la [1] haya vuelto dentro.
//   4. SL = close[1] -/+ InpATRMult*ATR[1] (fijo). TP = banda media, se ACTUALIZA en cada vela nueva.
//      Cierre por tiempo cuando la vela de entrada tiene shift >= InpMaxBars+1 (igual que el backtest).
//   5. Lotes por riesgo: InpRiskPct % del capital (inicial o balance actual) / distancia al SL. Una posición a la vez.
//   6. Protección: filtro de spread máximo, y cierre de TODO + parada del EA si la equity cae InpMaxEquityDD USD
//      por debajo del máximo histórico de equity (el máximo se guarda en una variable global del terminal).
//  Sin martingala, sin grid, sin librerías externas (solo Trade.mqh estándar).
//+------------------------------------------------------------------+
#property copyright "Estrategia reversion - generado para el brief BTCUSD"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
#include <Trade/PositionInfo.mqh>

//---------------------------------------------------------------- inputs (= parámetros de strategy.py)
input int             InpBBPeriod        = 20;        // Bollinger: periodo
input double          InpBBDev           = 3.0;       // Bollinger: desviaciones
input int             InpRSIPeriod       = 14;        // RSI: periodo
input double          InpRSILow          = 25.0;      // RSI: umbral (long < X, short > 100-X)
input int             InpATRPeriod       = 14;        // ATR: periodo
input double          InpATRMult         = 2.5;       // SL = ATR x este multiplicador
input int             InpMaxBars         = 8;         // Cierre por tiempo (velas después de la entrada)
input bool            InpTrendFilter     = true;      // Filtro de tendencia con EMA en marco superior
input int             InpEMAPeriod       = 200;       // EMA: periodo
input ENUM_TIMEFRAMES InpTrendTF         = PERIOD_H4; // EMA: marco temporal
input bool            InpSessionFilter   = false;     // Filtro horario (horas UTC)
input int             InpHourStart       = 7;         // Hora inicio UTC (incluida)
input int             InpHourEnd         = 21;        // Hora fin UTC (excluida)
input int             InpServerGMTOffset = 0;         // Horas que el servidor va por delante de UTC (p.ej. 2 o 3)
input bool            InpAllowLong       = true;      // Permitir compras
input bool            InpAllowShort      = true;      // Permitir ventas
input bool            InpConfirm         = false;     // Entrar al volver dentro de la banda (variante)
input double          InpRiskPct         = 1.5;       // Riesgo por operación (% del capital)
input bool            InpRiskOnInitial   = true;      // true = riesgo sobre capital inicial fijo (como el backtest); false = balance actual
input double          InpInitialCapital  = 1000.0;    // Capital inicial de referencia (USD)
input double          InpMaxSpreadUSD    = 40.0;      // Spread máximo permitido (USD de precio)
input double          InpMaxEquityDD     = 300.0;     // Cierre total si equity < máximo histórico - X USD
input bool            InpResetDDState    = false;     // true = borra el máximo de equity y la parada guardados
input int             InpSlippagePoints  = 100;       // Desviación máxima en puntos
input ulong           InpMagic           = 20260905;  // Magic number

//---------------------------------------------------------------- globales
CTrade         trade;
CPositionInfo  posInfo;
int            hBB = INVALID_HANDLE, hRSI = INVALID_HANDLE, hATR = INVALID_HANDLE, hEMA = INVALID_HANDLE;
datetime       g_lastBar = 0;
string         g_gvPeak, g_gvHalt;   // nombres de variables globales del terminal (persisten entre reinicios)

//+------------------------------------------------------------------+
int OnInit()
{
   hBB  = iBands(_Symbol, PERIOD_CURRENT, InpBBPeriod, 0, InpBBDev, PRICE_CLOSE);
   hRSI = iRSI(_Symbol, PERIOD_CURRENT, InpRSIPeriod, PRICE_CLOSE);
   hATR = iATR(_Symbol, PERIOD_CURRENT, InpATRPeriod);
   hEMA = iMA(_Symbol, InpTrendTF, InpEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
   if(hBB == INVALID_HANDLE || hRSI == INVALID_HANDLE || hATR == INVALID_HANDLE || hEMA == INVALID_HANDLE)
   {
      Print("reversion: error creando indicadores");
      return(INIT_FAILED);
   }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePoints);
   trade.SetTypeFilling(FillingMode());
   trade.SetAsyncMode(false);

   g_gvPeak = "REV_" + IntegerToString((long)InpMagic) + "_" + _Symbol + "_PEAK";
   g_gvHalt = "REV_" + IntegerToString((long)InpMagic) + "_" + _Symbol + "_HALT";
   if(InpResetDDState)
   {
      GlobalVariableDel(g_gvPeak);
      GlobalVariableDel(g_gvHalt);
   }
   if(!GlobalVariableCheck(g_gvPeak))
      GlobalVariableSet(g_gvPeak, AccountInfoDouble(ACCOUNT_EQUITY));
   if(!GlobalVariableCheck(g_gvHalt))
      GlobalVariableSet(g_gvHalt, 0.0);
   g_lastBar = 0;
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(hBB  != INVALID_HANDLE) IndicatorRelease(hBB);
   if(hRSI != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hATR != INVALID_HANDLE) IndicatorRelease(hATR);
   if(hEMA != INVALID_HANDLE) IndicatorRelease(hEMA);
}

//+------------------------------------------------------------------+
//| Modo de ejecución compatible con el símbolo                       |
//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING FillingMode()
{
   long fm = SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
   if((fm & SYMBOL_FILLING_FOK) != 0) return ORDER_FILLING_FOK;
   if((fm & SYMBOL_FILLING_IOC) != 0) return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
}

//+------------------------------------------------------------------+
//| Protección de drawdown de EQUITY (se evalúa en CADA tick)          |
//| Devuelve true si el EA está parado.                               |
//+------------------------------------------------------------------+
bool CheckEquityDD()
{
   double eq   = AccountInfoDouble(ACCOUNT_EQUITY);
   double peak = GlobalVariableGet(g_gvPeak);
   if(eq > peak) { peak = eq; GlobalVariableSet(g_gvPeak, peak); }
   bool halted = (GlobalVariableGet(g_gvHalt) > 0.5);
   if(!halted && (peak - eq) >= InpMaxEquityDD)
   {
      PrintFormat("reversion: DRAWDOWN de equity %.2f USD >= %.2f (pico %.2f, equity %.2f). Cierro todo y paro.",
                  peak - eq, InpMaxEquityDD, peak, eq);
      CloseAllByMagic();
      GlobalVariableSet(g_gvHalt, 1.0);
      halted = true;
   }
   return halted;
}

//+------------------------------------------------------------------+
//| Cierra todas las posiciones de este EA (magic) en este símbolo    |
//+------------------------------------------------------------------+
void CloseAllByMagic()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!posInfo.SelectByTicket(ticket)) continue;
      if(posInfo.Magic() != InpMagic || posInfo.Symbol() != _Symbol) continue;
      trade.PositionClose(ticket);
   }
}

//+------------------------------------------------------------------+
//| Busca la posición abierta de este EA. Devuelve ticket o 0.       |
//+------------------------------------------------------------------+
ulong FindPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!posInfo.SelectByTicket(ticket)) continue;
      if(posInfo.Magic() == InpMagic && posInfo.Symbol() == _Symbol) return ticket;
   }
   return 0;
}

//+------------------------------------------------------------------+
//| Lotes por riesgo fijo, limitados por margen libre (90 %)         |
//+------------------------------------------------------------------+
double LotsByRisk(double slDistance, ENUM_ORDER_TYPE type, double price)
{
   if(slDistance <= 0) return 0.0;
   double capital  = InpRiskOnInitial ? InpInitialCapital : AccountInfoDouble(ACCOUNT_BALANCE);
   double riskUSD  = capital * InpRiskPct / 100.0;
   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickVal <= 0 || tickSize <= 0) return 0.0;
   double lossPerLot = slDistance / tickSize * tickVal;      // pérdida en USD por 1 lote si salta el SL
   double lots = riskUSD / lossPerLot;

   // límite por margen: como el backtest, máx. 90 % del margen libre
   double margin1 = 0.0;
   if(OrderCalcMargin(type, _Symbol, 1.0, price, margin1) && margin1 > 0)
   {
      double maxLots = AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9 / margin1;
      if(lots > maxLots) lots = maxLots;
   }
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step > 0) lots = MathFloor(lots / step) * step;
   if(lots > vmax) lots = vmax;
   if(lots < vmin) return 0.0;   // sin lote mínimo no se opera (el backtest lo redondeaba a 0.01; con margen insuficiente no abre)
   return NormalizeDouble(lots, 8);
}

//+------------------------------------------------------------------+
//| Hora UTC de una vela (servidor -> UTC)                           |
//+------------------------------------------------------------------+
int HourUTC(datetime t)
{
   MqlDateTime dt; TimeToStruct(t, dt);
   int h = (dt.hour - InpServerGMTOffset) % 24;
   if(h < 0) h += 24;
   return h;
}

//+------------------------------------------------------------------+
void OnTick()
{
   // 1) protección de equity en cada tick
   bool halted = CheckEquityDD();

   // 2) sólo trabajamos al abrir vela nueva
   datetime bt = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(bt == g_lastBar) return;
   g_lastBar = bt;

   // 3) datos de la vela cerrada [1] (y [2] para la variante confirm)
   double mid[3], up[3], lo[3], rsi[3], atr[3];
   if(CopyBuffer(hBB, 0, 0, 3, mid) < 3 || CopyBuffer(hBB, 1, 0, 3, up) < 3 || CopyBuffer(hBB, 2, 0, 3, lo) < 3 ||
      CopyBuffer(hRSI, 0, 0, 3, rsi) < 3 || CopyBuffer(hATR, 0, 0, 3, atr) < 3)
   {
      Print("reversion: CopyBuffer falló");
      return;
   }
   // los arrays de CopyBuffer con inicio 0 vienen en orden cronológico: índice 2 = vela actual, 1 = cerrada, 0 = anterior
   double mid1 = mid[1], up1 = up[1], lo1 = lo[1], rsi1 = rsi[1], atr1 = atr[1];
   double up2 = up[0], lo2 = lo[0], rsi2 = rsi[0];
   double close1 = iClose(_Symbol, PERIOD_CURRENT, 1);
   double close2 = iClose(_Symbol, PERIOD_CURRENT, 2);
   datetime time1 = iTime(_Symbol, PERIOD_CURRENT, 1);
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   // 4) gestión de la posición abierta: TP dinámico a la banda media y cierre por tiempo
   ulong ticket = FindPosition();
   if(ticket != 0 && posInfo.SelectByTicket(ticket))
   {
      int barsHeld = iBarShift(_Symbol, PERIOD_CURRENT, posInfo.Time(), false);   // shift de la vela de entrada
      if(barsHeld >= InpMaxBars + 1)
      {
         // el backtest señala pos=0 en la vela entry+MaxBars y cierra en la apertura siguiente = ahora
         trade.PositionClose(ticket);
         return;   // sin nueva entrada en esta misma vela (igual que strategy.py)
      }
      double newTP = NormalizeDouble(mid1, digits);
      double curTP = posInfo.TakeProfit();
      if(MathAbs(newTP - curTP) >= point)
      {
         // si el TP nuevo ya está "del lado equivocado" del precio, el servidor lo rechaza; en ese caso cerramos a mercado
         double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID), ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         bool wrongSide = (posInfo.PositionType() == POSITION_TYPE_BUY) ? (newTP <= bid) : (newTP >= ask);
         if(wrongSide) trade.PositionClose(ticket);
         else if(!trade.PositionModify(ticket, posInfo.StopLoss(), newTP))
            PrintFormat("reversion: PositionModify TP=%.2f falló (%d)", newTP, (int)trade.ResultRetcode());
      }
      return;   // una posición a la vez
   }

   // 5) sin posición: ¿podemos abrir?
   if(halted) return;
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID), ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if((ask - bid) > InpMaxSpreadUSD) { PrintFormat("reversion: spread %.2f > máximo %.2f, no opero", ask - bid, InpMaxSpreadUSD); return; }
   if(InpSessionFilter)
   {
      int h = HourUTC(time1);
      bool ok = (InpHourStart < InpHourEnd) ? (h >= InpHourStart && h < InpHourEnd) : (h >= InpHourStart || h < InpHourEnd);
      if(!ok) return;
   }

   // condiciones brutas
   bool longSig, shortSig;
   if(InpConfirm)
   {
      longSig  = (close2 < lo2) && (close1 > lo1) && (rsi2 < InpRSILow);
      shortSig = (close2 > up2) && (close1 < up1) && (rsi2 > 100.0 - InpRSILow);
   }
   else
   {
      longSig  = (close1 < lo1) && (rsi1 < InpRSILow);
      shortSig = (close1 > up1) && (rsi1 > 100.0 - InpRSILow);
   }
   if(!InpAllowLong)  longSig  = false;
   if(!InpAllowShort) shortSig = false;

   // filtro de tendencia: EMA de la vela del marco superior CERRADA antes de la que contiene a la vela [1]
   if(InpTrendFilter && (longSig || shortSig))
   {
      int k = iBarShift(_Symbol, InpTrendTF, time1, false);
      double ema[1];
      if(k < 0 || CopyBuffer(hEMA, 0, k + 1, 1, ema) < 1) { Print("reversion: EMA no disponible"); return; }
      if(ema[0] <= 0.0 || ema[0] == EMPTY_VALUE) return;
      longSig  = longSig  && (close1 > ema[0]);
      shortSig = shortSig && (close1 < ema[0]);
   }
   if(!longSig && !shortSig) return;

   // 6) SL por ATR, TP en la banda media, lotes por riesgo
   double dist = InpATRMult * atr1;
   if(dist <= 0) return;
   double sl, tp, price;
   ENUM_ORDER_TYPE type;
   if(longSig) { type = ORDER_TYPE_BUY;  price = ask; sl = close1 - dist; tp = mid1; }
   else        { type = ORDER_TYPE_SELL; price = bid; sl = close1 + dist; tp = mid1; }
   sl = NormalizeDouble(sl, digits); tp = NormalizeDouble(tp, digits);

   // el TP debe quedar del lado correcto del precio actual (si el precio ya ha vuelto a la media, no hay operación)
   long stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopsLevel * point;
   if(longSig  && (tp - ask < minDist || ask - sl < minDist)) { Print("reversion: TP/SL demasiado cerca, no opero"); return; }
   if(shortSig && (bid - tp < minDist || sl - bid < minDist)) { Print("reversion: TP/SL demasiado cerca, no opero"); return; }

   double lots = LotsByRisk(dist, type, price);
   if(lots <= 0) { Print("reversion: lotes 0 (riesgo/margen insuficiente)"); return; }

   bool ok = longSig ? trade.Buy(lots, _Symbol, ask, sl, tp, "reversion L")
                     : trade.Sell(lots, _Symbol, bid, sl, tp, "reversion S");
   if(!ok) PrintFormat("reversion: orden rechazada, retcode %d (%s)", (int)trade.ResultRetcode(), trade.ResultRetcodeDescription());
   else    PrintFormat("reversion: %s %.2f lotes @ %.2f SL %.2f TP %.2f (RSI %.1f, ATR %.1f)",
                       longSig ? "BUY" : "SELL", lots, price, sl, tp, rsi1, atr1);
}
//+------------------------------------------------------------------+
