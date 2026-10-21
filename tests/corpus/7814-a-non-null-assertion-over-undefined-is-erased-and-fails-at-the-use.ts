// `x!` does not throw in Node: it is erased. The value is only a problem
// where it is USED. A non-null assertion over a value that is undefined hands
// its consumer the undefined: printing, templates, typeof, comparisons, ??,
// conditions; a member use throws Node's exact TypeError naming the property.
function t(name: string, f: () => void) {
  try { f(); } catch (e) { console.log(name, "threw", e instanceof TypeError ? "TypeError" : "other", (e as Error).message); }
}
const m = new Map<string, string>([["a", "A"]]);
const arr: string[] = ["x"];
t("print", () => console.log(m.get("zz")!));
t("len", () => console.log(m.get("zz")!.length));
t("typeof", () => console.log(typeof m.get("zz")!));
t("eq", () => console.log(m.get("zz")! === undefined));
t("nn", () => console.log(m.get("zz")! ?? "dflt"));
t("cond", () => console.log(m.get("zz")! ? "y" : "n"));
t("ok", () => console.log(m.get("a")!, m.get("a")!.length, arr[0]!));
