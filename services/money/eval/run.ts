// pnpm eval — runs all scenarios, prints the confusion matrix, logs to eval/results/.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FraudAssessment, OrderRequest } from '../src/contracts';
import { credentialFor, makeLlm } from '../src/deps';
import { seedFamilyClient } from '../src/family';
import { assess } from '../src/fraud/assess';
import { heuristicClassifier, museClassifier } from '../src/fraud/layer2';
import { generateHistory } from '../src/seed';
import { MemoryStore } from '../src/store/store';

interface Scenario { id: string; label: 'scam' | 'legit'; description: string; at: string; request: OrderRequest }

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export async function runEval(opts: { useMuse?: boolean; write?: boolean } = {}) {
  const files = (await readdir(dir('./scenarios/'))).filter((f) => f.endsWith('.json')).sort();
  const scenarios: Scenario[] = await Promise.all(files.map(async (f) => JSON.parse(await readFile(dir(`./scenarios/${f}`), 'utf8'))));

  const llm = opts.useMuse ? makeLlm(process.env) : null;
  const classifier = llm ? museClassifier(llm, (m) => console.warn(m)) : heuristicClassifier;

  const rows: { id: string; label: string; risk: FraudAssessment['risk']; score: number; hardStop: boolean;
    typology?: string; codes: string[]; ok: boolean; seniorFacingMessage: string }[] = [];
  for (const s of scenarios) {
    const now = new Date(s.at);
    const store = new MemoryStore();
    await store.addLedger(generateHistory(now));
    const a = await assess(s.request, {
      store, family: seedFamilyClient(() => now), classifier, llm, credential: credentialFor, now: () => now,
    });
    const ok = s.label === 'scam' ? a.risk !== 'low' : a.risk !== 'high';
    rows.push({ id: s.id, label: s.label, risk: a.risk, score: a.score, hardStop: a.hardStop, typology: a.typology,
      codes: a.signals.map((x) => x.code), ok, seniorFacingMessage: a.seniorFacingMessage });
  }

  const count = (label: string, risk: string) => rows.filter((r) => r.label === label && r.risk === risk).length;
  const matrix = {
    scam: { low: count('scam', 'low'), medium: count('scam', 'medium'), high: count('scam', 'high') },
    legit: { low: count('legit', 'low'), medium: count('legit', 'medium'), high: count('legit', 'high') },
  };
  const scams = rows.filter((r) => r.label === 'scam').length;
  const scamsCaught = matrix.scam.medium + matrix.scam.high;
  const falseHighHolds = matrix.legit.high;
  const summary = {
    ranAt: new Date().toISOString(),
    layer2: llm ? 'muse' : 'heuristic',
    scenarios: rows.length,
    scamsCaught, scams, falseHighHolds,
    targets: { scamsCaught: `${scams}/${scams}`, maxFalseHighHolds: 2 },
    pass: scamsCaught === scams && falseHighHolds <= 2,
    matrix,
    rows,
  };

  if (opts.write !== false) {
    await mkdir(dir('./results/'), { recursive: true });
    const body = JSON.stringify(summary, null, 2);
    await writeFile(dir(`./results/${summary.ranAt.replace(/[:.]/g, '-')}.json`), body);
    await writeFile(dir('./results/latest.json'), body);
  }
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = await runEval({ useMuse: process.env.EVAL_LAYER2 === 'muse' });
  const pad = (x: string | number, n = 8) => String(x).padEnd(n);
  console.log(`\nFraud eval · layer2=${s.layer2} · ${s.scenarios} scenarios\n`);
  console.log(`${pad('actual', 10)}${pad('low')}${pad('medium')}${pad('high')}`);
  console.log(`${pad('scam', 10)}${pad(s.matrix.scam.low)}${pad(s.matrix.scam.medium)}${pad(s.matrix.scam.high)}`);
  console.log(`${pad('legit', 10)}${pad(s.matrix.legit.low)}${pad(s.matrix.legit.medium)}${pad(s.matrix.legit.high)}\n`);
  for (const r of s.rows) {
    console.log(`${r.ok ? '✓' : '✗'} ${pad(r.id, 36)} ${pad(r.risk, 7)} ${pad(r.score, 4)} ${r.codes.join(',')}`);
  }
  console.log(`\nScams caught: ${s.scamsCaught}/${s.scams} · false high holds: ${s.falseHighHolds} (max 2) · ${s.pass ? 'PASS' : 'FAIL'}`);
  process.exitCode = s.pass ? 0 : 1;
}
