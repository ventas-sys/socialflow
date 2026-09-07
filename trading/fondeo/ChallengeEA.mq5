//+------------------------------------------------------------------+
//| ChallengeEA.mq5                                                   |
//| EA para challenges de fondeo: ruptura de rango (OCO) o apuesta   |
//| diaria por momentum, con sizing por riesgo fijo y guardias de     |
//| reglas (objetivo, pérdida diaria, pérdida máxima).                |
//| Réplica de trading/fondeo/challenge_sim.py. NO compilado aquí     |
//| (sin MetaEditor en Linux): revisar en MetaEditor antes de usar.   |
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>
#include <Trade/PositionInfo.mqh>
#include <Trade/OrderInfo.mqh>

enum ENUM_MODE { MODE_BREAKOUT = 0, MODE_MOMENTUM = 1 };

//--- reglas de la firma (fracciones del balance INICIAL del challenge)
input double InpInitialBalance   = 100000;  // Balance inicial del challenge (0 = usar el balance al arrancar)
input double InpTargetPct        = 10.0;    // Objetivo de beneficio (%)
input double InpDailyLossPct     = 3.0;     // Pérdida diaria máxima (%) (equity, incluye flotante)
input double InpMaxLossPct       = 10.0;    // Pérdida máxima (%)
input bool   InpTrailingMaxLoss  = true;    // Pérdida máxima trailing sobre el máximo de equity (FTMO 1-Step) o estática
input double InpSafetyBufferPct  = 0.3;     // Colchón (%) antes de cada límite: se cierra todo al acercarse

//--- riesgo y estrategia
input ENUM_MODE InpMode          = MODE_BREAKOUT;
input double InpRiskPct          = 2.5;     // Riesgo por operación (% del balance inicial)
input bool   InpRiskOnBalance    = false;   // Riesgo sobre balance actual en vez del inicial
input int    InpMaxTradesPerDay  = 1;
input double InpDayStopPct       = 2.5;     // Deja de abrir si el P/L del día (cerrado) ≤ -X %
input double InpRR               = 2.0;     // Take profit = RR × stop
input int    InpExitHour         = 22;      // Cierre forzoso a esta hora (servidor); -1 = sin cierre
//--- ruptura de rango
input int    InpRangeStartHour   = 1;       // Inicio del rango (hora servidor)
input int    InpRangeEndHour     = 9;       // Fin del rango: se colocan los stops
input int    InpExpireHour       = 17;      // Se cancelan los pendientes a esta hora
input double InpSLFrac           = 1.0;     // Stop = fracción del rango (1.0 = lado opuesto)
input double InpMinRangeATR      = 0.3;     // Rango mínimo en ATR(H1,14)
input double InpMaxRangeATR      = 3.0;     // Rango máximo en ATR(H1,14)
//--- apuesta diaria por momentum
input int    InpEntryHour        = 10;      // Hora de entrada (servidor)
input int    InpLookbackHours    = 24;      // Signo del retorno de las últimas N horas
input double InpSLATR            = 1.5;     // Stop = N × ATR(H1,14)
input long   InpMagic            = 260907;

CTrade trade; CPositionInfo posInfo; COrderInfo ordInfo;
double g_initial = 0, g_hwm = 0, g_dayRef = 0; datetime g_day = 0; int g_tradesToday = 0; bool g_done = false;
int g_atrHandle = INVALID_HANDLE; datetime g_lastRangeDay = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   g_initial = (InpInitialBalance > 0) ? InpInitialBalance : AccountInfoDouble(ACCOUNT_BALANCE);
   g_hwm = MathMax(g_initial, AccountInfoDouble(ACCOUNT_EQUITY));
   g_atrHandle = iATR(_Symbol, PERIOD_H1, 14);
   if(g_atrHandle == INVALID_HANDLE) return INIT_FAILED;
   ResetDay();
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { if(g_atrHandle != INVALID_HANDLE) IndicatorRelease(g_atrHandle); }

//+------------------------------------------------------------------+
void ResetDay()
{
   MqlDateTime t; TimeToStruct(TimeCurrent(), t); t.hour = 0; t.min = 0; t.sec = 0;
   g_day = StructToTime(t);
   g_dayRef = MathMax(AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY)); // referencia diaria estilo FTMO
   g_tradesToday = 0;
}
double ATR() { double b[1]; if(CopyBuffer(g_atrHandle, 0, 1, 1, b) != 1) return 0; return b[0]; }
bool HasPosition() { for(int i = PositionsTotal() - 1; i >= 0; i--) if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagic) return true; return false; }
int  PendingCount() { int n = 0; for(int i = OrdersTotal() - 1; i >= 0; i--) if(ordInfo.SelectByIndex(i) && ordInfo.Symbol() == _Symbol && ordInfo.Magic() == InpMagic) n++; return n; }
void CloseAll(string why)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--) if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagic) trade.PositionClose(posInfo.Ticket());
   for(int i = OrdersTotal() - 1; i >= 0; i--) if(ordInfo.SelectByIndex(i) && ordInfo.Symbol() == _Symbol && ordInfo.Magic() == InpMagic) trade.OrderDelete(ordInfo.Ticket());
   Print("CloseAll: ", why);
}
//+------------------------------------------------------------------+
//| Lotes para arriesgar InpRiskPct con un stop de slDist (precio)    |
//+------------------------------------------------------------------+
double LotsForRisk(double slDist)
{
   double base = InpRiskOnBalance ? AccountInfoDouble(ACCOUNT_BALANCE) : g_initial;
   double riskUsd = base * InpRiskPct / 100.0;
   double tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE), tickSz = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickVal <= 0 || tickSz <= 0 || slDist <= 0) return 0;
   double lossPerLot = slDist / tickSz * tickVal;
   double lots = riskUsd / lossPerLot;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   lots = MathFloor(lots / step) * step;
   // margen: no usar más del 80 % del margen libre
   double marginReq = 0; if(OrderCalcMargin(ORDER_TYPE_BUY, _Symbol, 1.0, SymbolInfoDouble(_Symbol, SYMBOL_ASK), marginReq) && marginReq > 0)
      lots = MathMin(lots, MathFloor(AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.8 / marginReq / step) * step);
   if(lots < vmin) return 0;
   return MathMin(lots, vmax);
}
//+------------------------------------------------------------------+
//| Guardias de reglas: se evalúan en cada tick con la equity actual  |
//+------------------------------------------------------------------+
bool Guards()
{
   double eq = AccountInfoDouble(ACCOUNT_EQUITY), bal = AccountInfoDouble(ACCOUNT_BALANCE);
   g_hwm = MathMax(g_hwm, eq);
   double buf = g_initial * InpSafetyBufferPct / 100.0;
   double dailyFloor = g_dayRef - g_initial * InpDailyLossPct / 100.0 + buf;
   double maxFloor = (InpTrailingMaxLoss ? g_hwm : g_initial) - g_initial * InpMaxLossPct / 100.0 + buf;
   if(eq <= dailyFloor) { CloseAll("límite diario cercano"); return false; }
   if(eq <= maxFloor)   { CloseAll("límite máximo cercano"); return false; }
   if(bal >= g_initial * (1 + InpTargetPct / 100.0)) { if(!g_done) { CloseAll("objetivo alcanzado"); g_done = true; } return false; }
   if(InpDayStopPct > 0 && (g_dayRef - bal) >= g_initial * InpDayStopPct / 100.0) return false;   // parada diaria autoimpuesta
   return true;
}
//+------------------------------------------------------------------+
void OnTick()
{
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   MqlDateTime d0; TimeToStruct(g_day, d0);
   if(t.day != d0.day) ResetDay();
   bool canOpen = Guards();
   if(g_done) return;
   // cierre horario
   if(InpExitHour >= 0 && t.hour >= InpExitHour && (HasPosition() || PendingCount() > 0)) { CloseAll("cierre horario"); return; }
   if(InpMode == MODE_BREAKOUT && t.hour >= InpExpireHour && PendingCount() > 0 && !HasPosition()) CloseAll("expiración de pendientes");
   if(!canOpen || HasPosition() || g_tradesToday >= InpMaxTradesPerDay) return;
   static datetime lastBar = 0; datetime bar = iTime(_Symbol, PERIOD_M15, 0); if(bar == lastBar) return; lastBar = bar;   // una decisión por vela M15
   double atr = ATR(); if(atr <= 0) return;
   if(InpMode == MODE_BREAKOUT) DoBreakout(t, atr); else DoMomentum(t, atr);
}
//+------------------------------------------------------------------+
void DoBreakout(MqlDateTime &t, double atr)
{
   if(t.hour < InpRangeEndHour || t.hour >= InpExpireHour || PendingCount() > 0) return;
   if(g_lastRangeDay == g_day) return;   // ya se colocaron los stops hoy (o ya se operó)
   // rango [start, end) de hoy en M15
   datetime from = g_day + InpRangeStartHour * 3600, to = g_day + InpRangeEndHour * 3600;
   double hi = -1, lo = -1; MqlRates r[]; int n = CopyRates(_Symbol, PERIOD_M15, from, to - 1, r);
   if(n <= 0) return;
   for(int i = 0; i < n; i++) { if(hi < 0 || r[i].high > hi) hi = r[i].high; if(lo < 0 || r[i].low < lo) lo = r[i].low; }
   double width = hi - lo;
   if(width < InpMinRangeATR * atr || width > InpMaxRangeATR * atr) { g_lastRangeDay = g_day; return; }
   double sl = InpSLFrac * width, tp = InpRR * sl;
   double lots = LotsForRisk(sl); if(lots <= 0) return;
   datetime expiry = g_day + InpExpireHour * 3600;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   int dg = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   if(ask < hi) trade.BuyStop(lots, NormalizeDouble(hi, dg), _Symbol, NormalizeDouble(hi - sl, dg), NormalizeDouble(hi + tp, dg), ORDER_TIME_SPECIFIED, expiry, "brk buy");
   if(bid > lo) trade.SellStop(lots, NormalizeDouble(lo, dg), _Symbol, NormalizeDouble(lo + sl, dg), NormalizeDouble(lo - tp, dg), ORDER_TIME_SPECIFIED, expiry, "brk sell");
   g_lastRangeDay = g_day;
}
void DoMomentum(MqlDateTime &t, double atr)
{
   if(t.hour != InpEntryHour || t.min != 0) return;
   double now = iOpen(_Symbol, PERIOD_M15, 0), before = iOpen(_Symbol, PERIOD_M15, InpLookbackHours * 4);
   if(before <= 0) return;
   int dir = (now > before) ? 1 : (now < before ? -1 : 0); if(dir == 0) return;
   double sl = InpSLATR * atr, tp = InpRR * sl, lots = LotsForRisk(sl); if(lots <= 0) return;
   int dg = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   if(dir > 0) { double a = SymbolInfoDouble(_Symbol, SYMBOL_ASK); trade.Buy(lots, _Symbol, a, NormalizeDouble(a - sl, dg), NormalizeDouble(a + tp, dg), "mom buy"); }
   else        { double b = SymbolInfoDouble(_Symbol, SYMBOL_BID); trade.Sell(lots, _Symbol, b, NormalizeDouble(b + sl, dg), NormalizeDouble(b - tp, dg), "mom sell"); }
   g_tradesToday++;
}
//+------------------------------------------------------------------+
//| Cuando se ejecuta un pendiente del OCO se cancela el contrario    |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &tr, const MqlTradeRequest &req, const MqlTradeResult &res)
{
   if(tr.type == TRADE_TRANSACTION_DEAL_ADD && tr.symbol == _Symbol)
   {
      if(HistoryDealSelect(tr.deal) && HistoryDealGetInteger(tr.deal, DEAL_MAGIC) == InpMagic && HistoryDealGetInteger(tr.deal, DEAL_ENTRY) == DEAL_ENTRY_IN)
      {
         g_tradesToday++;
         for(int i = OrdersTotal() - 1; i >= 0; i--) if(ordInfo.SelectByIndex(i) && ordInfo.Symbol() == _Symbol && ordInfo.Magic() == InpMagic) trade.OrderDelete(ordInfo.Ticket());
      }
   }
}
//+------------------------------------------------------------------+
