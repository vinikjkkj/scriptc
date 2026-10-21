function t(name: string, f: () => void) {
  try { f(); } catch (e) { console.log(name, "threw", (e as Error).message); }
}
const gm = new Map<string, string>([["a", "A"]]);
const gx: string[] = ["p"];
const gn: number[] = [5];
const gobj: { n: number }[] = [{ n: 1 }];
const g1 = gm.get("zz")!;
const g2 = gx[3];
const g3 = gn[9];
const g4 = gobj[2];
console.log("start");
t("g1.length", () => console.log(g1.length));
t("g2.len", () => console.log(g2.length));
t("g3 num", () => console.log(g3 + 1, g3 * 2));
t("g4.n", () => console.log(g4.n));
const gok = gx[0];
t("gok", () => console.log(gok.length, gok.toUpperCase()));
function local(i: number) {
  const a = gx[i];
  const n = gn[i];
  const m = gm.get("k" + i)!;
  const o = gobj[i];
  console.log("in range?", i);
  t("a.len", () => console.log(a.length));
  t("n arith", () => console.log(n + 1, n * 2, n > 1));
  t("m.len", () => console.log(m.length));
  t("o.n", () => console.log(o.n));
  t("a.upper", () => console.log(a.toUpperCase()));
}
local(0);
local(5);
local(1.5);
function direct(i: number) {
  const a = gx[i];
  console.log("before use");
  console.log(a.length);
}
direct(0);
try { direct(2); } catch (e) { console.log((e as Error).message); }
const k = gx[7];
const k2 = gx[0];
console.log(k2.length);
try { console.log(k.length); } catch (e) { console.log((e as Error).message); }
