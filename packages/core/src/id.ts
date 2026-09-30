import { randomBytes } from "node:crypto";

/** Eight lowercase base36 characters: short enough to type, random enough for concurrent writers. */
export function newId(): string {
  const n = randomBytes(6).readUIntBE(0, 6);
  return n.toString(36).padStart(8, "0").slice(-8);
}
