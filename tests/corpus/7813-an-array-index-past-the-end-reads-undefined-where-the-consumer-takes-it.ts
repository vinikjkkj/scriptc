// An array index past the end reads undefined in Node (no
// noUncheckedIndexedAccess). A consumer that takes the value as written gets
// it: printing, templates, typeof, comparisons with undefined/null, ??, ||, ?.,
// conditions and string `+`; arithmetic sees NaN; a member use throws Node's
// exact TypeError. A binding the program tests against undefined keeps the
// wider slot.
const nums: number[] = [1, 2, 3];
const strs: string[] = ["a", "b"];
const objs: { id: number; name: string }[] = [{ id: 1, name: "x" }];
const bools: boolean[] = [true, false];
const nested: number[][] = [[1, 2], [3]];
function t(name: string, f: () => unknown) {
  try { const r = f(); if (r !== undefined) console.log(name, r); } catch (e) { console.log(name, "threw", e instanceof TypeError ? "TypeError" : "other", (e as Error).message); }
}
let i = 7;
t("a", () => nums[i] === undefined);
t("b", () => strs[i] ?? "dflt");
t("c", () => objs[i] === undefined ? "undef" : "def");
t("d", () => bools[i] ? "t" : "f");
t("e", () => typeof objs[i]);
t("f", () => typeof strs[i] + typeof nums[i] + typeof bools[i]);
t("g", () => `${objs[i]}|${strs[i]}|${nums[i]}|${bools[i]}`);
t("h", () => objs[i].id);
t("h2", () => objs[i].name.length);
t("i", () => nums[i] + 1);
t("j", () => nums[i] * 2 > 3);
t("k", () => -nums[i]);
t("l", () => strs[i] + "!" + strs[0]);
t("m", () => String(strs[i]) + String(nums[i]));
t("n", () => !objs[i]);
t("o", () => console.log(strs[i]?.length));
t("p", () => console.log(objs[i]?.id));
t("q", () => nums[i] ?? 5);
t("r", () => nums[i] == null);
t("s", () => nums[0] + nums[1] + nums[2]);
t("u", () => { for (let k = 0; nums[k] !== undefined; k++) { if (k > 10) return "runaway"; } return "ok"; });
t("v", () => { let k = 0; while (strs[k]) k++; return k; });
t("w", () => { objs[i].id = 5; });
t("x", () => nested[0][1] + nested[1][0]);
console.log(nums[i], strs[i], objs[i], bools[i]);
console.log(nums[-1], nums[1.5], nums[NaN]);
function firstMissing(words: string[]): number {
  for (let k = 0; ; k++) {
    const w = words[k];
    if (w === undefined) return k;
    if (w.length > 99) return -1;
  }
}
console.log(firstMissing(["a", "bb", "ccc"]), firstMissing([]));
function sumUntilHole(xs: number[]): number {
  let total = 0;
  for (let k = 0; ; k++) {
    const x = xs[k];
    if (x === undefined) break;
    total += x;
  }
  return total;
}
console.log(sumUntilHole([1, 2, 3, 4]));
