import type { Member, Senior } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { notFound } from "../deps.js";
import { MEMBERS, SENIOR_ROSE, generateCallHistory } from "../seed-data.js";
import { COLLECTIONS } from "../store/types.js";

export interface Circle { senior: Senior; members: Member[]; }

export async function getCircle(deps: Deps, seniorId: string): Promise<Circle> {
  const doc = await deps.store.circle.get(seniorId);
  if (!doc) throw notFound(`senior ${seniorId}`);
  return { senior: doc.senior, members: doc.members };
}

export async function getMember(deps: Deps, seniorId: string, memberId: string): Promise<Member> {
  const { members } = await getCircle(deps, seniorId);
  const m = members.find((x) => x.id === memberId);
  if (!m) throw notFound(`member ${memberId}`);
  return m;
}

/** Find which circle a member belongs to (single-senior demo, but kept general). */
export async function findMember(deps: Deps, memberId: string): Promise<{ member: Member; senior: Senior } | undefined> {
  for (const doc of await deps.store.circle.list()) {
    const member = doc.members.find((m) => m.id === memberId);
    if (member) return { member, senior: doc.senior };
  }
  return undefined;
}

export function memberName(members: Member[], id: string): string {
  return members.find((m) => m.id === id)?.name ?? id;
}

/** Wipes the family schema's data and re-seeds the circle + 8 weeks of call history. */
export async function seedAll(deps: Deps): Promise<{ calls: number }> {
  for (const name of COLLECTIONS) await deps.store[name].clear();
  await deps.store.circle.put({ id: SENIOR_ROSE.id, senior: SENIOR_ROSE, members: MEMBERS });
  const history = generateCallHistory(deps.clock.now());
  for (const c of history) await deps.store.calls.put(c);
  return { calls: history.length };
}

/** Seed only if the circle is missing (boot-time convenience). */
export async function ensureSeeded(deps: Deps): Promise<boolean> {
  if (await deps.store.circle.get(SENIOR_ROSE.id)) return false;
  await seedAll(deps);
  return true;
}
