//+------------------------------------------------------------------+
//|                                                    tendencia.mq5 |
//|  Estrategia de seguimiento de tendencia BTCUSD H1                 |
//|  Misma lógica que trading/strategies/tendencia/strategy.py        |
//|                                                                   |
//|  1. Filtro de tendencia: cierre > EMA(EmaLen) para largos         |
//|     (cierre < EMA para cortos si AllowShort).                     |
//|  2. Filtro de régimen: ADX(AdxLen) > AdxMin (0 = sin filtro).      |
//|  3. Entrada: ruptura del canal Donchian de las DcLen velas         |
//|     ANTERIORES a la vela cerrada (close[1] > max(high[2..DcLen+1]))|
//|  4. Stop inicial = close -/+ SlMult*ATR(AtrLen). Trailing tipo     |
//|     chandelier = close -/+ TrailMult*ATR, nunca retrocede.         |
//|  5. Lotes por riesgo: RiskPct % del balance / distancia del SL.    |
//|  Protección: cierre de TODO si la equity cae MaxEquityDD USD por   |
//|  debajo del máximo histórico de equity (el máximo se guarda en una |
//|  variable global del terminal para sobrevivir reinicios).         |
//|  Solo trabaja al abrir una vela nueva (salvo la protección de DD,  |
//|  que se comprueba en cada tick). Sin librerías externas.          |
//+------------------------------------------------------------------+
#property copyright "agente tendencia"
#property version   "1.00"
#property strict

//--- Parámetros (= DEFAULT_PARAMS / best_params.json de strategy.py)
input int      EmaLen        = 200;    // Periodo EMA (filtro de tendencia)
input int      DcLen         = 55;     // Periodo canal Donchian (velas anteriores)
input int      AtrLen        = 14;     // Periodo ATR
input double   SlMult        = 3.0;    // Stop inicial (x ATR)
input double   TrailMult     = 4.0;    // Trailing (x ATR)
input int      AdxLen        = 14;     // Periodo ADX
input double   AdxMin        = 25.0;   // ADX mínimo para operar (0 = sin filtro)
input bool     AllowShort    = false;  // Permitir cortos
input bool     ExitOnEma     = false;  // Cerrar si el cierre cruza la EMA en contra
input double   RiskPct       = 1.5;    // % de riesgo por operación
input bool     RiskOnBalance = true;   // true = % del balance actual; false = % de RiskBase fijo
input double   RiskBase      = 1000.0; // Capital de referencia si RiskOnBalance=false
input double   MaxLots       = 1.0;    // Lotes máximos
input int      MaxSpreadPts  = 3000;   // Spread máximo permitido (puntos). BTCUSD con 2 decimales: 3000 pts = 30 USD
input double   MaxEquityDD   = 300.0;  // Cierre de todo si equity < máximo histórico - este valor (USD)
input bool     HaltAfterDD   = true;   // Tras la rotura de DD, no volver a operar hasta reiniciar el EA
input long     MagicNumber   = 20260905;
input int      SlippagePts   = 500;    // Desviación máxima en puntos para órdenes a mercado
input string   GvPrefix      = "TEND_"; // Prefijo de variables globales (máximo de equity)

//--- Handles de indicadores estándar
int hEma = INVALID_HANDLE, hAtr = INVALID_HANDLE, hAdx = INVALID_HANDLE;
datetime lastBarTime = 0;
bool     ddHalted = false;
string   gvPeak;

//+------------------------------------------------------------------+
int OnInit()
{
   hEma = iMA(_Symbol, PERIOD_CURRENT, EmaLen, 0, MODE_EMA, PRICE_CLOSE);
   hAtr = iATR(_Symbol, PERIOD_CURRENT, AtrLen);
   hAdx = iADX(_Symbol, PERIOD_CURRENT, AdxLen);
   if(hEma == INVALID_HANDLE || hAtr == INVALID_HANDLE || hAdx == INVALID_HANDLE)
   {
      Print("Error creando indicadores");
      return(INIT_FAILED);
   }
   // máximo histórico de equity persistente (por símbolo + magic)
   gvPeak = GvPrefix + _Symbol + "_" + IntegerToString(MagicNumber) + "_PEAK";
   if(!GlobalVariableCheck(gvPeak) || GlobalVariableGet(gvPeak) < AccountInfoDouble(ACCOUNT_EQUITY))
      GlobalVariableSet(gvPeak, AccountInfoDouble(ACCOUNT_EQUITY));
   ddHalted = false;
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   if(hEma != INVALID_HANDLE) IndicatorRelease(hEma);
   if(hAtr != INVALID_HANDLE) IndicatorRelease(hAtr);
   if(hAdx != INVALID_HANDLE) IndicatorRelease(hAdx);
}

//+------------------------------------------------------------------+
//| Utilidades de posición (una sola posición por símbolo+magic)      |
//+------------------------------------------------------------------+
bool FindPosition(ulong &ticket, int &side, double &vol, double &sl, double &openPrice)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      ticket = t;
      side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
      vol = PositionGetDouble(POSITION_VOLUME);
      sl = PositionGetDouble(POSITION_SL);
      openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      return true;
   }
   return false;
}

bool SendRequest(MqlTradeRequest &req)
{
   MqlTradeResult res;
   ZeroMemory(res);
   if(!OrderSend(req, res))
   {
      PrintFormat("OrderSend fallo: retcode=%d (%s)", res.retcode, res.comment);
      return false;
   }
   if(res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED && res.retcode != TRADE_RETCODE_DONE_PARTIAL)
   {
      PrintFormat("Orden rechazada: retcode=%d (%s)", res.retcode, res.comment);
      return false;
   }
   return true;
}

bool ClosePosition(ulong ticket, const string why)
{
   if(!PositionSelectByTicket(ticket)) return false;
   int side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
   MqlTradeRequest req; ZeroMemory(req);
   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = _Symbol;
   req.position  = ticket;
   req.volume    = PositionGetDouble(POSITION_VOLUME);
   req.type      = (side > 0) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   req.price     = (side > 0) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   req.deviation = SlippagePts;
   req.magic     = MagicNumber;
   req.comment   = "tendencia cierre " + why;
   req.type_filling = FillingMode();
   return SendRequest(req);
}

bool ModifySL(ulong ticket, double newSl)
{
   MqlTradeRequest req; ZeroMemory(req);
   req.action   = TRADE_ACTION_SLTP;
   req.symbol   = _Symbol;
   req.position = ticket;
   req.sl       = NormalizeDouble(newSl, _Digits);
   req.tp       = 0.0;
   req.magic    = MagicNumber;
   return SendRequest(req);
}

bool OpenPosition(int side, double lots, double sl)
{
   MqlTradeRequest req; ZeroMemory(req);
   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = _Symbol;
   req.volume    = lots;
   req.type      = (side > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   req.price     = (side > 0) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   req.sl        = NormalizeDouble(sl, _Digits);
   req.tp        = 0.0;
   req.deviation = SlippagePts;
   req.magic     = MagicNumber;
   req.comment   = (side > 0) ? "tendencia long" : "tendencia short";
   req.type_filling = FillingMode();
   return SendRequest(req);
}

ENUM_ORDER_TYPE_FILLING FillingMode()
{
   long fm = SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
   if((fm & SYMBOL_FILLING_FOK) != 0) return ORDER_FILLING_FOK;
   if((fm & SYMBOL_FILLING_IOC) != 0) return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
}

//+------------------------------------------------------------------+
//| Lotes por riesgo: riesgo_usd / (pérdida por lote a distancia SL) |
//+------------------------------------------------------------------+
double LotsByRisk(double slDistance)
{
   double base = RiskOnBalance ? AccountInfoDouble(ACCOUNT_BALANCE) : RiskBase;
   double riskUsd = base * RiskPct / 100.0;
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0 || tickValue <= 0 || slDistance <= 0) return 0.0;
   double lossPerLot = slDistance / tickSize * tickValue;   // USD perdidos por 1 lote si salta el SL
   double lots = riskUsd / lossPerLot;
   double vmin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double vstep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   lots = MathFloor(lots / vstep) * vstep;      // redondeo hacia abajo (igual que strategy.py)
   lots = MathMax(lots, vmin);
   lots = MathMin(lots, MathMin(vmax, MaxLots));
   return NormalizeDouble(lots, 2);
}

//+------------------------------------------------------------------+
//| Protección de drawdown de equity (cada tick)                      |
//+------------------------------------------------------------------+
void CheckEquityDD()
{
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double peak = GlobalVariableCheck(gvPeak) ? GlobalVariableGet(gvPeak) : eq;
   if(eq > peak) { peak = eq; GlobalVariableSet(gvPeak, peak); }
   if(peak - eq > MaxEquityDD)
   {
      ulong ticket; int side; double vol, sl, op;
      if(FindPosition(ticket, side, vol, sl, op))
      {
         PrintFormat("DD de equity %.2f > %.2f: cerrando todo", peak - eq, MaxEquityDD);
         ClosePosition(ticket, "DD_equity");
      }
      if(HaltAfterDD && !ddHalted)
      {
         ddHalted = true;
         Print("EA detenido por drawdown de equity. Reinicie el EA para continuar.");
      }
   }
}

//+------------------------------------------------------------------+
void OnTick()
{
   // 1) protección de DD en cada tick
   CheckEquityDD();
   if(ddHalted) return;

   // 2) solo trabajar al abrir vela nueva
   datetime barTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(barTime == lastBarTime) return;
   lastBarTime = barTime;

   // 3) datos de la vela cerrada (índice 1), equivalentes a la "vela t" de strategy.py
   int need = MathMax(EmaLen, MathMax(DcLen + 2, MathMax(AtrLen, AdxLen * 2))) + 5;
   if(Bars(_Symbol, PERIOD_CURRENT) < need) return;

   double emaB[2], atrB[2], adxB[2];
   if(CopyBuffer(hEma, 0, 1, 1, emaB) < 1) return;
   if(CopyBuffer(hAtr, 0, 1, 1, atrB) < 1) return;
   if(CopyBuffer(hAdx, 0, 1, 1, adxB) < 1) return;   // buffer 0 = línea ADX
   double emaV = emaB[0], atrV = atrB[0], adxV = adxB[0];
   double close1 = iClose(_Symbol, PERIOD_CURRENT, 1);
   // canal Donchian de las DcLen velas anteriores a la vela cerrada (índices 2 .. DcLen+1)
   int ih = iHighest(_Symbol, PERIOD_CURRENT, MODE_HIGH, DcLen, 2);
   int il = iLowest(_Symbol, PERIOD_CURRENT, MODE_LOW, DcLen, 2);
   if(ih < 0 || il < 0 || atrV <= 0) return;
   double upper = iHigh(_Symbol, PERIOD_CURRENT, ih);
   double lower = iLow(_Symbol, PERIOD_CURRENT, il);

   double point = _Point;
   double stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;

   // 4) gestión de la posición abierta: trailing chandelier y salida por EMA
   ulong ticket; int side; double vol, curSl, openPrice;
   if(FindPosition(ticket, side, vol, curSl, openPrice))
   {
      if(ExitOnEma && ((side > 0 && close1 < emaV) || (side < 0 && close1 > emaV)))
      {
         ClosePosition(ticket, "EMA");
         return;
      }
      double newSl = (side > 0) ? close1 - TrailMult * atrV : close1 + TrailMult * atrV;
      bool better = (side > 0) ? (newSl > curSl + point) : (curSl == 0.0 || newSl < curSl - point);
      if(better)
      {
         // respetar distancia mínima del broker
         double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID), ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         if(side > 0 && newSl > bid - stopsLevel) newSl = bid - stopsLevel;
         if(side < 0 && newSl < ask + stopsLevel) newSl = ask + stopsLevel;
         if((side > 0 && newSl > curSl) || (side < 0 && (curSl == 0.0 || newSl < curSl)))
            ModifySL(ticket, newSl);
      }
      return;   // una sola posición: no buscar entradas
   }

   // 5) sin posición: filtros y entrada
   if(AdxMin > 0 && adxV <= AdxMin) return;
   long spreadPts = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spreadPts > MaxSpreadPts)
   {
      PrintFormat("Spread %d pts > máximo %d: no se opera esta vela", spreadPts, MaxSpreadPts);
      return;
   }
   int sig = 0;
   if(close1 > emaV && close1 > upper) sig = 1;
   else if(AllowShort && close1 < emaV && close1 < lower) sig = -1;
   if(sig == 0) return;

   double dist = SlMult * atrV;
   double lots = LotsByRisk(dist);
   if(lots <= 0) return;
   // SL calculado sobre el cierre de la vela t (igual que strategy.py); se ajusta al stops level si hace falta
   double sl = (sig > 0) ? close1 - dist : close1 + dist;
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID), ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(sig > 0 && sl > bid - stopsLevel) sl = bid - stopsLevel;
   if(sig < 0 && sl < ask + stopsLevel) sl = ask + stopsLevel;

   // comprobación de margen libre
   double marginReq = 0.0;
   ENUM_ORDER_TYPE ot = (sig > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double px = (sig > 0) ? ask : bid;
   if(OrderCalcMargin(ot, _Symbol, lots, px, marginReq) && marginReq > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9)
   {
      // reducir lotes al máximo permitido por margen (el backtest hace lo mismo con el 90 % del balance)
      double vstep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      double vmin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      double maxL  = MathFloor(lots * AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9 / marginReq / vstep) * vstep;
      if(maxL < vmin) { Print("Margen insuficiente para el lote mínimo"); return; }
      lots = maxL;
   }
   if(OpenPosition(sig, lots, sl))
      PrintFormat("Entrada %s lots=%.2f sl=%.2f atr=%.2f adx=%.1f", (sig > 0 ? "LONG" : "SHORT"), lots, sl, atrV, adxV);
}
//+------------------------------------------------------------------+
