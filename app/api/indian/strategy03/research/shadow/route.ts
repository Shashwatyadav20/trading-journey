import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const res = await fetch(`${BACKEND_URL}/api/indian/strategy03/research/shadow`, {
    headers: auth ? { Authorization: auth } : {},
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ success: false, error: "Backend unreachable" }));
  return NextResponse.json(data, { status: res.status });
}

