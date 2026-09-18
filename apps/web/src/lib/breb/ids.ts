import { randomUUID } from "crypto";

export function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}
