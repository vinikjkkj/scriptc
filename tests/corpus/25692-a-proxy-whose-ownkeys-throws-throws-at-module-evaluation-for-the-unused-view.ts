// The Proxy's ownKeys trap throws: Node throws at module evaluation, so must the program (the view is never read).
const base = {
  alpha: { code: 1, type: "int", defaultValue: 10 },
  beta: { code: 2, type: "bool", defaultValue: false },
  gamma: { code: 3, type: "string", defaultValue: "g" },
};
type Spec = typeof base;
type Cfg = { code: number; type: string; defaultValue: number | boolean | string };
function fromJson(s: string): Spec { return JSON.parse(s) as Spec; }
function buildView(spec: Spec): Record<string, { configCode: number; type: string; defaultValue: number | boolean | string }> {
  const view = {} as Record<string, { configCode: number; type: string; defaultValue: number | boolean | string }>;
  for (const [name, entry] of Object.entries(spec)) {
    view[name] = Object.freeze({ configCode: entry.code, type: entry.type, defaultValue: entry.defaultValue });
  }
  return Object.freeze(view);
}
const JSON_TEXT = JSON.stringify({ alpha: { code: 9, type: "int", defaultValue: 4 }, beta: { code: 8, type: "bool", defaultValue: true }, gamma: { code: 7, type: "string", defaultValue: "j" } });
const SPEC: Spec = new Proxy(base, { ownKeys() { throw new Error("ownKeys boom"); } });
console.log("before");
export const UNUSED_VIEW = buildView(SPEC);
const other = fromJson(JSON_TEXT);
console.log("after", other.alpha.code);
