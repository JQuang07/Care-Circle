/** Report locations and record shape. No vitest import: globalSetup loads this too. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Exchange } from "./http";

export type Owner = "voice" | "money" | "family" | "web" | "contract";

export const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "reports");
export const RECORDS_FILE = join(REPORT_DIR, "records.jsonl");

export interface FailureRecord {
  scenario: string;
  owner: Owner;
  expected: string;
  actual: string;
  exchanges: Exchange[];
}
