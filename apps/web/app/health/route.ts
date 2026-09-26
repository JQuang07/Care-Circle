import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// CONTRACTS.md §0: GET /health → { ok: true, service, mock }
export function GET() {
  return NextResponse.json({ ok: true, service: "web", mock: process.env.MOCK === "1" });
}
