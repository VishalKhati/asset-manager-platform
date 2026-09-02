//+------------------------------------------------------------------+
//|  SMC Gold Bot — Bridge Expert Advisor                            |
//|  Version: 2.0  (multi-symbol, broker symbol mapping)            |
//|                                                                  |
//|  SETUP (5 steps):                                                |
//|  1. Copy this file → MQL5\Experts\smc_bridge.mq5                |
//|  2. Compile in MetaEditor (F7)                                   |
//|  3. Attach to your chart (XAUUSD M5 or BTCUSD M5)               |
//|  4. Set IpcFolder = "smc_bridge" (same as bridge.js IPC_DIR)    |
//|  5. Set BrokerSymbol to exactly what YOUR broker uses            |
//|     Common names: XAUUSD  XAUUSDm  XAUUSD.  GOLD               |
//|                   BTCUSD  BTCUSDm  BTCUSD.  BTC/USD            |
//|  6. Enable "Allow DLL imports" and "Allow automated trading"     |
//+------------------------------------------------------------------+

#property copyright "SMC Gold Bot Bridge v2.0"
#property version   "2.00"
#property strict

//--- Input parameters
input string IpcFolder      = "smc_bridge";  // IPC subfolder inside MQL5/Files/
input string BrokerSymbol   = "";            // Leave blank to auto-detect from chart symbol
input double DefaultLots    = 0.01;          // Fallback lot size if signal has none
input int    MagicNumber    = 20250502;      // EA magic number (unique per EA instance)
input int    Slippage       = 30;            // Max slippage in points
input int    PollMs         = 2000;          // How often to check IPC files (ms)
input bool   DemoMode       = true;          // true = log only, NO real orders sent

//--- Internal state
string SignalFile    = "";
string AckFile       = "";
string ResultFile    = "";
string HeartbeatFile = "";
string LastSignalId  = "";
long   OpenTicket    = -1;

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   SignalFile    = IpcFolder + "\\pending_signal.json";
   AckFile       = IpcFolder + "\\signal_ack.json";
   ResultFile    = IpcFolder + "\\trade_result.json";
   HeartbeatFile = IpcFolder + "\\bridge_heartbeat.json";

   // Auto-detect symbol from chart if BrokerSymbol is blank
   string usedSymbol = (StringLen(BrokerSymbol) > 0) ? BrokerSymbol : Symbol();

   Print("================================================================");
   Print("  SMC Bridge EA v2.0 initialized");
   Print("  IPC folder:    MQL5/Files/", IpcFolder);
   Print("  Broker symbol: ", usedSymbol);
   Print("  Demo mode:     ", DemoMode ? "ON (no real orders)" : "OFF — LIVE TRADING");
   Print("  Magic number:  ", MagicNumber);
   Print("================================================================");

   if(DemoMode) {
      Print("INFO: DemoMode=true. EA will log signals but NOT send any orders to your broker.");
      Print("INFO: Set DemoMode=false AND TRADE_MODE=live in bridge .env to enable live trading.");
   }

   // Create IPC folder
   if(!FolderCreate(IpcFolder, FILE_COMMON)) {
      Print("Note: IPC folder already exists or could not be created — continuing.");
   }

   EventSetMillisecondTimer(PollMs);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("SMC Bridge EA removed. Reason: ", reason);
}

//+------------------------------------------------------------------+
//| Timer event — runs every PollMs milliseconds                     |
//+------------------------------------------------------------------+
void OnTimer()
{
   CheckHeartbeat();
   ProcessPendingSignal();
   CheckOpenTrade();
}

//+------------------------------------------------------------------+
//| Check if Node bridge is alive (reads heartbeat file)             |
//+------------------------------------------------------------------+
void CheckHeartbeat()
{
   string usedSymbol = (StringLen(BrokerSymbol) > 0) ? BrokerSymbol : Symbol();
   string status = "SMC Bridge";

   if(!FileIsExist(HeartbeatFile, FILE_COMMON)) {
      status += " | Node bridge NOT running — start bridge.js";
   } else {
      status += " | Connected | " + usedSymbol;
      status += " | Demo: " + (DemoMode ? "ON" : "OFF");
      status += " | Magic: " + IntegerToString(MagicNumber);
   }
   Comment(status);
}

//+------------------------------------------------------------------+
//| Read and process pending_signal.json                             |
//+------------------------------------------------------------------+
void ProcessPendingSignal()
{
   if(!FileIsExist(SignalFile, FILE_COMMON)) return;

   string json = ReadFile(SignalFile);
   if(StringLen(json) == 0) return;

   // Parse signal fields
   string signalId  = JsonGetString(json, "id");
   string direction = JsonGetString(json, "direction");  // "BUY" | "SELL"
   string symField  = JsonGetString(json, "symbol");     // "XAUUSD" | "BTCUSD"
   double entry     = JsonGetDouble(json, "entry");
   double sl        = JsonGetDouble(json, "sl");
   double tp        = JsonGetDouble(json, "tp");
   double lots      = JsonGetDouble(json, "lots");
   string mode      = JsonGetString(json, "mode");

   // Avoid processing the same signal twice
   if(signalId == LastSignalId) return;
   LastSignalId = signalId;

   // Resolve broker symbol: input takes precedence → signal field → chart symbol
   string execSymbol = (StringLen(BrokerSymbol) > 0)
                       ? BrokerSymbol
                       : (StringLen(symField) > 0 ? symField : Symbol());

   Print("Signal: ", direction, " | symbol=", execSymbol,
         " | entry=", DoubleToString(entry,2),
         " | sl=", DoubleToString(sl,2),
         " | tp=", DoubleToString(tp,2),
         " | lots=", DoubleToString(lots,3),
         " | id=", signalId);

   // Write ACK
   WriteAck(signalId);

   // Delete signal file so it isn't re-processed
   FileDelete(SignalFile, FILE_COMMON);

   // Execute or simulate
   if(DemoMode || mode == "demo") {
      Print("[DEMO] Signal logged — no order sent. Set DemoMode=false for live trading.");
      WriteResult(signalId, -1, entry, sl, tp, lots > 0 ? lots : DefaultLots, "");
   } else {
      ExecuteTrade(signalId, execSymbol, direction, lots > 0 ? lots : DefaultLots, sl, tp);
   }
}

//+------------------------------------------------------------------+
//| Execute a market order                                           |
//+------------------------------------------------------------------+
void ExecuteTrade(string signalId, string sym, string direction,
                  double lots, double sl, double tp)
{
   ENUM_ORDER_TYPE orderType = (direction == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;

   MqlTradeRequest  req = {};
   MqlTradeResult   res = {};

   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = sym;
   req.volume    = lots;
   req.type      = orderType;
   req.price     = (orderType == ORDER_TYPE_BUY)
                   ? SymbolInfoDouble(sym, SYMBOL_ASK)
                   : SymbolInfoDouble(sym, SYMBOL_BID);
   req.sl        = sl;
   req.tp        = tp;
   req.deviation = Slippage;
   req.magic     = MagicNumber;
   req.comment   = "SMC_" + signalId;
   req.type_filling = ORDER_FILLING_IOC;

   if(!OrderSend(req, res)) {
      string errMsg = "OrderSend failed. retcode=" + IntegerToString(res.retcode)
                     + " (" + res.comment + ")"
                     + " — check broker symbol name matches exactly.";
      Print(errMsg);
      WriteResult(signalId, -1, 0, sl, tp, lots, errMsg);
      return;
   }

   if(res.retcode == TRADE_RETCODE_DONE) {
      OpenTicket = res.order;
      Print("Order filled! Ticket=", OpenTicket, " @ ", DoubleToString(res.price,2),
            " | sym=", sym, " | ", direction);
      WriteResult(signalId, OpenTicket, res.price, sl, tp, lots, "");
   } else {
      string errMsg = "Order not filled. retcode=" + IntegerToString(res.retcode);
      Print(errMsg);
      WriteResult(signalId, -1, 0, sl, tp, lots, errMsg);
   }
}

//+------------------------------------------------------------------+
//| Monitor open trade and write result when it closes               |
//+------------------------------------------------------------------+
void CheckOpenTrade()
{
   if(OpenTicket < 0) return;

   if(!PositionSelectByTicket(OpenTicket)) {
      double closePrice = GetClosePrice(OpenTicket);
      Print("Trade closed. Ticket=", OpenTicket, " closePrice=", DoubleToString(closePrice,2));
      WriteCloseResult(OpenTicket, closePrice);
      OpenTicket = -1;
   }
}

//+------------------------------------------------------------------+
//| Get actual close price from MT5 deal history                     |
//+------------------------------------------------------------------+
double GetClosePrice(long ticket)
{
   if(HistorySelectByPosition(ticket)) {
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--) {
         long deal = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(deal, DEAL_ENTRY) == DEAL_ENTRY_OUT)
            return HistoryDealGetDouble(deal, DEAL_PRICE);
      }
   }
   return 0;
}

//+------------------------------------------------------------------+
//| Write signal ACK file                                            |
//+------------------------------------------------------------------+
void WriteAck(string signalId)
{
   string content = "{\"id\":\"" + signalId + "\","
                  + "\"ticket\":" + IntegerToString(OpenTicket) + ","
                  + "\"ts\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES) + "\"}";
   WriteFile(AckFile, content);
}

//+------------------------------------------------------------------+
//| Write trade open result                                          |
//+------------------------------------------------------------------+
void WriteResult(string id, long ticket, double openPrice,
                 double sl, double tp, double lots, string error)
{
   string c = "{";
   c += "\"id\":\""       + id             + "\",";
   c += "\"ticket\":"     + IntegerToString(ticket) + ",";
   c += "\"openPrice\":"  + DoubleToString(openPrice, 2) + ",";
   c += "\"sl\":"         + DoubleToString(sl, 2) + ",";
   c += "\"tp\":"         + DoubleToString(tp, 2) + ",";
   c += "\"lots\":"       + DoubleToString(lots, 3) + ",";
   c += "\"error\":\""    + error + "\",";
   c += "\"ts\":\""       + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES) + "\"";
   c += "}";
   WriteFile(ResultFile, c);
}

//+------------------------------------------------------------------+
//| Write trade close result                                         |
//+------------------------------------------------------------------+
void WriteCloseResult(long ticket, double closePrice)
{
   string c = "{";
   c += "\"ticket\":"     + IntegerToString(ticket) + ",";
   c += "\"closePrice\":" + DoubleToString(closePrice, 2) + ",";
   c += "\"closed\":true,";
   c += "\"ts\":\""       + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES) + "\"";
   c += "}";
   WriteFile(ResultFile, c);
}

//+------------------------------------------------------------------+
//| File helpers                                                     |
//+------------------------------------------------------------------+
string ReadFile(string filename)
{
   int handle = FileOpen(filename, FILE_READ|FILE_TXT|FILE_COMMON, '\n');
   if(handle == INVALID_HANDLE) return "";
   string content = "";
   while(!FileIsEnding(handle)) content += FileReadString(handle) + "\n";
   FileClose(handle);
   return content;
}

void WriteFile(string filename, string content)
{
   int handle = FileOpen(filename, FILE_WRITE|FILE_TXT|FILE_COMMON);
   if(handle == INVALID_HANDLE) {
      Print("WriteFile error: cannot open ", filename, " — check file permissions.");
      return;
   }
   FileWriteString(handle, content);
   FileClose(handle);
}

//+------------------------------------------------------------------+
//| Minimal JSON extractors (no external libraries needed)           |
//+------------------------------------------------------------------+
string JsonGetString(string json, string key)
{
   string search = "\"" + key + "\":\"";
   int pos = StringFind(json, search);
   if(pos < 0) return "";
   pos += StringLen(search);
   int end = StringFind(json, "\"", pos);
   if(end < 0) return "";
   return StringSubstr(json, pos, end - pos);
}

double JsonGetDouble(string json, string key)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if(pos < 0) return 0;
   pos += StringLen(search);
   string val = "";
   for(int i = pos; i < StringLen(json); i++) {
      string ch = StringSubstr(json, i, 1);
      if(ch == "," || ch == "}" || ch == "\n" || ch == " ") break;
      val += ch;
   }
   return StringToDouble(val);
}
