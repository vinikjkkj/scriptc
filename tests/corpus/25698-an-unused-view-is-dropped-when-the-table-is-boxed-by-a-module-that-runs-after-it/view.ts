import { SPEC, type Spec } from "./spec.ts";
function build(spec: Spec): Record<string, { c: number; t: string; d: number | boolean | string }> {
  const view = {} as Record<string, { c: number; t: string; d: number | boolean | string }>;
  for (const [name, entry] of Object.entries(spec)) view[name] = Object.freeze({ c: entry.code, t: entry.type, d: entry.defaultValue });
  return Object.freeze(view);
}
export const UNUSED_VIEW = build(SPEC);
console.log("view module runs");
