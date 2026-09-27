import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { clipPath } from "@/lib/clips";

export const dynamic = "force-dynamic";
const TYPES: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg" };

export async function GET(_req: Request, { params }: { params: Promise<{ scenario: string; file: string }> }) {
  const { scenario, file } = await params;
  const p = clipPath(scenario, file);
  if (!p) return NextResponse.json({ error: { code: "NOT_FOUND", message: "No such clip." } }, { status: 404 });
  const ext = file.split(".").pop()!.toLowerCase();
  return new NextResponse(readFileSync(p), { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" } });
}
