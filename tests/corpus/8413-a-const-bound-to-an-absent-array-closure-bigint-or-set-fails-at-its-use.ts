const grid: number[][] = [[1, 2], [3]];
const fns: (() => number)[] = [() => 5];
const sets: Set<string>[] = [new Set(["a"])];
const bigs: bigint[] = [10n];
function t(name: string, f: () => void) { try { f(); } catch (e) { console.log(name, "threw", (e as Error).message); } }
const g1 = grid[5];
const f1 = fns[4];
const s1 = sets[3];
const b1 = bigs[2];
const g0 = grid[0];
console.log("start");
t("g1.length", () => console.log(g1.length));
t("g1[0]", () => console.log(g1[0]));
t("f1()", () => console.log(f1()));
t("s1.size", () => console.log(s1.size));
t("b1 + 1n", () => console.log(b1 + 1n));
t("g0", () => console.log(g0.length, g0[1]));
function local(i: number) {
  const row = grid[i];
  const fn = fns[i];
  const st = sets[i];
  console.log("local", i);
  t("row.length", () => console.log(row.length));
  t("fn()", () => console.log(fn()));
  t("st.has", () => console.log(st.has("a")));
  t("row.map", () => console.log(row.map((x) => x * 2)));
}
local(0);
local(7);
const peelRow = grid[9];
console.log(peelRow === undefined, typeof peelRow);
const peelRow0 = grid[0];
console.log(peelRow0 === undefined);
