import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getISTTimestamp } from "@/lib/indian/tradePersistence";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const WEBHOOK_LOG_FILE = path.join(DATA_DIR, "broker_webhooks.json");

/**
 * GET /api/indian/swing/trades/webhook
 * Returns recent broker webhook event audit logs.
 */
export async function GET() {
  try {
    if (!fs.existsSync(WEBHOOK_LOG_FILE)) {
      return NextResponse.json({ success: true, count: 0, webhooks: [] });
    }
    const raw = fs.readFileSync(WEBHOOK_LOG_FILE, "utf-8");
    const webhooks = JSON.parse(raw);
    return NextResponse.json({
      success: true,
      count: webhooks.length,
      webhooks,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}

/**
 * POST /api/indian/swing/trades/webhook
 * Simulates receiving an incoming broker webhook callback from Dhan HQ or Zerodha Kite.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { ist } = getISTTimestamp();

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    let existing: any[] = [];
    if (fs.existsSync(WEBHOOK_LOG_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(WEBHOOK_LOG_FILE, "utf-8"));
      } catch {
        existing = [];
      }
    }

    const newEvent = {
      broker: payload.broker || "DHAN_HQ",
      brokerOrderId: payload.orderId || `BRK-${Date.now()}`,
      orderStatus: payload.orderStatus || "CONFIRMED",
      webhookDispatchedAt: ist,
      payloadHash: `wh_${Math.random().toString(36).substring(2, 10)}`,
      lastWebhookPayload: payload,
    };

    existing.unshift(newEvent);
    fs.writeFileSync(WEBHOOK_LOG_FILE, JSON.stringify(existing.slice(0, 100), null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      receivedAt: ist,
      message: "Broker webhook callback acknowledged and logged.",
      event: newEvent,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}
