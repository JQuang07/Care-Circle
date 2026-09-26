import { randomBytes } from "node:crypto";

export type IdPrefix = "call" | "prop" | "slot" | "sch" | "msg" | "hook" | "vn" | "evt";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
