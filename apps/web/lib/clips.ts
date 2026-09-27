/** Server-only: demo clips under demo-audio/<scenario>/NN.(wav|mp3|m4a), each with a .txt transcript. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const CLIP_DIR = process.env.DEMO_AUDIO_DIR ?? resolve(process.cwd(), "../../demo-audio");
export const AUDIO = /\.(wav|mp3|m4a|webm|ogg)$/i;
const SAFE = /^[\w-]+$/;
const SAFE_FILE = /^[\w-]+\.(wav|mp3|m4a|webm|ogg)$/i;

export interface Clip { file: string; text: string; speaker?: string }
export interface Scenario { name: string; clips: Clip[] }

export function listScenarios(): Scenario[] {
  if (!existsSync(CLIP_DIR)) return [];
  const order = ["groceries", "family", "scam", "gift"];
  return readdirSync(CLIP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SAFE.test(d.name))
    .map((d) => ({
      name: d.name,
      clips: readdirSync(join(CLIP_DIR, d.name)).filter((f) => AUDIO.test(f)).sort().map((file) => {
        const raw = sidecar(d.name, file) ?? "";
        const speaker = /^(mem_\w+):/.exec(raw)?.[1];
        return { file, speaker, text: raw.replace(/^mem_\w+:\s*/, "") };
      }),
    }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  function rank(n: string) { const i = order.indexOf(n); return i < 0 ? 99 : i; }
}

export function clipPath(scenario: string, file: string): string | undefined {
  if (!SAFE.test(scenario) || !SAFE_FILE.test(file)) return undefined;
  const p = join(CLIP_DIR, scenario, file);
  return existsSync(p) ? p : undefined;
}

export function sidecar(scenario: string, file: string): string | undefined {
  const p = clipPath(scenario, file);
  const txt = p?.replace(AUDIO, ".txt");
  return txt && existsSync(txt) ? readFileSync(txt, "utf8").trim() : undefined;
}
