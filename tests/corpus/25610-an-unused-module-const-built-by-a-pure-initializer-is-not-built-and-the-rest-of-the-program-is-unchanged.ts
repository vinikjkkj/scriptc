// The positive control of dead-initializer removal: ABSENT is never read, its initializer is a pure table build, so it is not built; USED is read and stays.
const SRC: Record<string, { code: number; label: string }> = { a: { code: 1, label: "x" }, b: { code: 2, label: "y" }, c: { code: 3, label: "z" } };
function buildView(): Record<string, { configCode: number; label: string }> {
  const view: Record<string, { configCode: number; label: string }> = {};
  for (const [name, entry] of Object.entries(SRC)) view[name] = { configCode: entry.code * 10, label: entry.label };
  return view;
}
export const ABSENT = buildView();
export const ABSENT_LIST = Object.keys(SRC).map((k) => k + "!");
export const USED = buildView();
console.log(Object.keys(USED).join(","), USED.b.configCode, USED.c.label);
console.log(Object.keys(SRC).length);
