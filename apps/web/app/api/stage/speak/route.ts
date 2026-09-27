/**
 * Browser → voice /demo/speak: Care Circle's reply as MP3 (Deepgram Aura-2). Adds X-CC-Secret
 * on the server so the secret never reaches the browser. On any failure the stage falls back
 * to the browser's own speech synthesis.
 */
import { NextResponse, type NextRequest } from "next/server";
import { serviceBaseUrl } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { text, voice } = (await req.json().catch(() => ({}))) as { text?: unknown; voice?: unknown };
  if (typeof text !== "string" || !text.trim() || text.length > 1000)
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "text (1–1000 chars) is required" } }, { status: 400 });
  try {
    const upstream = await fetch(`${serviceBaseUrl("voice")}/demo/speak`, {
      method: "POST",
      headers: { "x-cc-secret": process.env.CC_INTERNAL_SECRET ?? "", "content-type": "application/json" },
      body: JSON.stringify({ text, voice: voice === "rose" ? "rose" : "care" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok)
      return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
    return new NextResponse(await upstream.arrayBuffer(), { headers: { "content-type": upstream.headers.get("content-type") ?? "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: { code: "UPSTREAM_UNREACHABLE", message: `voice isn't answering (${(e as Error).name}).` } }, { status: 502 });
  }
}
