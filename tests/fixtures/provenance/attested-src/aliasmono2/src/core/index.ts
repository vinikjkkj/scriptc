/* A SECOND attested repo that spells the SAME alias key. Its `shoutCore`
 * has the same name and the same signature as aliasmono's and a different
 * ANSWER, which is the only way a test can tell "resolved to the right
 * checkout" from "resolved to a checkout". */
export const CORE = "core-2.0.0";

export function shoutCore(s: string): string {
  return CORE + "/" + s.toLowerCase();
}
