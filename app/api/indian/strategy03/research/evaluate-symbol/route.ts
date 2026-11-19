import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const body = await req.text();
  const res = await fetch(`${BACKEND_URL}/api/indian/strategy03/research/evaluate-symbol`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body,
  });
  const data = await res.json().catch(() => ({ success: false, error: "Backend unreachable" }));
  return NextResponse.json(data, { status: res.status });
}

