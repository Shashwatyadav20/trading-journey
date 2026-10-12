import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/backendUrl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get("limit") || "30";

    const res = await fetch(`${BACKEND_URL}/api/indian/swing/daily-scanner/history?limit=${encodeURIComponent(limit)}`, {
      cache: "no-store",
    }).catch(() => null);

    if (!res || !res.ok) {
      return NextResponse.json({
        success: true,
        count: 0,
        runs: [],
        message: "Backend history service unavailable or no runs persisted yet.",
      });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed to retrieve scan run history",
      },
      { status: 500 }
    );
  }
}
