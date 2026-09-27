// Regenerates Rose's demo clips from their .txt in her grandmother voice: Deepgram Aura-2
// Athena, aged with the voice service's own recipe (services/voice/src/speech.ts: ROSE), so
// the clips match what the stage speaks when you type as Rose. Family members' lines
// ("mem_danny: …") are left as recorded. Rose is a fictional demo persona.
//   npx dotenv -e .env -- npx tsx demo-audio/make-rose-voice.ts
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../services/voice/src/config.js";
import { speakRoseWav } from "../services/voice/src/speech.js";

const here = dirname(fileURLToPath(import.meta.url));
const c = config({ ...process.env, MOCK: "1" });

for (const scenario of readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  for (const t of readdirSync(join(here, scenario)).filter((f) => /^\d+\.txt$/.test(f))) {
    const text = readFileSync(join(here, scenario, t), "utf8").trim();
    if (!text || /^mem_\w+:/.test(text)) continue;
    const file = t.replace(/\.txt$/, ".wav");
    writeFileSync(join(here, scenario, file), await speakRoseWav(c, text));
    console.log(`Rose → ${scenario}/${file}: "${text.slice(0, 60)}"`);
  }
}
