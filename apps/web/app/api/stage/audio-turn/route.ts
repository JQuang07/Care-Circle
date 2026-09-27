/**
 * Browser → voice /demo/audio-turn. Multipart can't go through the JSON proxy, so this
 * forwards the form as-is, adds X-CC-Secret on the server, and attaches the clip's .txt
 * as the speech-to-text fallback. The secret never reaches the browser.
 */
import { NextResponse, type NextRequest } from "next/server";
import { serviceBaseUrl } from "@/lib/services";
import { sidecar } from "@/lib/clips";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["file", "sessionId", "seniorId", "speaker"]);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const out = new FormData();
  for (const [k, v] of form.entries()) if (ALLOWED.has(k)) out.append(k, v);
  const scenario = form.get("scenario"), clip = form.get("clip");
  const text = typeof scenario === "string" && typeof clip === "string" ? sidecar(scenario, clip) : undefined;
  if (text) out.append("sidecar", text);
  try {
    const upstream = await fetch(`${serviceBaseUrl("voice")}/demo/audio-turn`, {
      method: "POST",
      headers: { "x-cc-secret": process.env.CC_INTERNAL_SECRET ?? "" },
      body: out,
      cache: "no-store",
      signal: AbortSignal.timeout(240_000), // a live DoorDash grocery quote can take minutes
    });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: { code: "UPSTREAM_UNREACHABLE", message: `voice isn't answering (${(e as Error).name}).` } }, { status: 502 });
  }
}
