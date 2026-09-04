import { EventEmitter } from "events";

class TradingEventBus extends EventEmitter {
  // Typesafe wrapper can be added here if desired
}

export const tradingEventBus = new TradingEventBus();
