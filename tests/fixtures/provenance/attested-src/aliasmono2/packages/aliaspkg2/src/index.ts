import { shoutCore } from "@core";

export function twirl(s: string): string {
  return "{" + shoutCore(s) + "}";
}
