/* Guards backend/llvm/inline-rt.ts: the adapter tables are RECOMPUTED from the runtime sources, so a new `scr_<T>_{retain,release}_v` adapter, or one
 * whose target turns `static inline`, fails here instead of silently dodging (or wrongly entering) the direct-call pass. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DIRECT_RELEASES, DIRECT_RETAINS, inlineRuntimeHelpers } from "../src/backend/llvm/inline-rt.js";

const rt = join(fileURLToPath(import.meta.url), "../../../runtime/src");
const files = readdirSync(rt).filter((f) => f.endsWith(".c") || f.endsWith(".h"));
const text = new Map(files.map((f) => [f, readFileSync(join(rt, f), "utf8")]));
const all = [...text.values()].join("\n");
const headers = files.filter((f) => f.endsWith(".h")).map((f) => text.get(f)!).join("\n");

function recompute(): { retain: string[]; release: string[]; inlineTargets: string[] } {
  const re = /^(void \*|void )\s*(scr_[a-z0-9_]+)_(retain|release)_v\(void \*(\w+)\) \{ (?:return )?(scr_[a-z0-9_]+)\((?:\([A-Za-z0-9_ ]+ \*\))?\4\); \}/gm;
  const retain = new Set<string>();
  const release = new Set<string>();
  const inlineTargets = new Set<string>();
  for (const [f, t] of text) {
    if (!f.endsWith(".c")) continue;
    for (const m of t.matchAll(re)) {
      const [, , base, op, , target] = m as unknown as string[];
      if (target !== `${base}_${op}`) continue;
      const isInline = new RegExp(`static inline [^;{]*\\b${target}\\(`).test(all);
      const externInHeader = new RegExp(`^(?!static)[A-Za-z_][^\\n;{(]*\\b${target}\\([^)]*\\);`, "m").test(headers);
      if (isInline) inlineTargets.add(target);
      else if (externInHeader) (op === "retain" ? retain : release).add(target!);
    }
  }
  return { retain: [...retain].sort(), release: [...release].sort(), inlineTargets: [...inlineTargets].sort() };
}

test("the direct-call tables are exactly the out-of-line forwarding adapters of the runtime sources", () => {
  const r = recompute();
  expect([...DIRECT_RETAINS].sort()).toEqual(r.retain);
  expect([...DIRECT_RELEASES].sort()).toEqual(r.release);
});

test("every inline-target adapter the runtime has is one the pass defines itself or knowingly leaves", () => {
  // scr_classobj_release and scr_regex_retain are static inline and are not called through an adapter by the LLVM lane.
  expect(recompute().inlineTargets).toEqual([
    "scr_arr_retain", "scr_bytes_retain", "scr_classobj_release", "scr_closure_retain", "scr_dyn_retain", "scr_regex_retain", "scr_str_retain", "scr_union_retain",
  ]);
});

test("the pass retargets a direct call, keeps an address-taken adapter, and declares the target once (positive control)", () => {
  const src = [
    "declare void @scr_big_release_v(ptr)",
    "declare void @scr_arr_release(ptr)",
    "define void @f(ptr %p) {",
    "  call void @scr_big_release_v(ptr %p)",
    "  call void @scr_arr_release_v(ptr %p)",
    "  %u = call ptr @scr_union_new_ref(i32 1, ptr %p, ptr @scr_big_retain_v, ptr @scr_big_release_v, ptr null)",
    "  ret void",
    "}",
  ].join("\n");
  const out = inlineRuntimeHelpers(src);
  expect(out).toContain("call void @scr_big_release(ptr %p)");
  expect(out).toContain("call void @scr_arr_release(ptr %p)");
  expect(out).toContain("ptr @scr_big_retain_v, ptr @scr_big_release_v");
  expect(out.match(/^declare void @scr_arr_release\(/gm)?.length).toBe(1);
  expect(out.match(/^declare void @scr_big_release\(/gm)?.length).toBe(1);
  expect(inlineRuntimeHelpers("define void @g() {\n  ret void\n}")).toBe("define void @g() {\n  ret void\n}");
});
