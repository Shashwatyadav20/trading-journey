export type DrawingType =
  | "HORIZONTAL_LINE"
  | "SUPPORT"
  | "RESISTANCE"
  | "ENTRY"
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "TEXT_LABEL"
  | "TREND_LINE"
  | "RAY"
  | "VERTICAL_LINE"
  | "RECTANGLE"
  | "PARALLEL_CHANNEL"
  | "ARROW"
  | "MEASURE"
  | "CROSSHAIR";

export type DrawingToolId =
  | "SELECT"
  | "CROSSHAIR"
  | "HORIZONTAL_LINE"
  | "TREND_LINE"
  | "RAY"
  | "VERTICAL_LINE"
  | "RECTANGLE"
  | "PARALLEL_CHANNEL"
  | "ARROW"
  | "TEXT_LABEL"
  | "MEASURE"
  | "ENTRY"
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "DELETE"
  | "CLEAR_ALL";

export interface ChartDrawing {
  id: string;
  type: DrawingType;
  price: number;
  label: string;
  color: string;
  lineStyle: number; // 0 = Solid, 1 = Dotted, 2 = Dashed
  time?: number;
  endPrice?: number;
  endTime?: number;
  isTradeDrawing?: boolean; // true = auto trade line, false/undefined = manual drawing
  linkedTradeId?: string; // links to a Trade.id for auto SL/TP/Entry
}
