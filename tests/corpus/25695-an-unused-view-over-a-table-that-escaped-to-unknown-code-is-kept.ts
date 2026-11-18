// The table escapes to a function taking 'any' (it may box the table, so the view arm is live); the UNUSED view is kept and the program prints as Node does.
type Cfg = { code: number; type: string; defaultValue: number | boolean | string };
type Spec = { alpha: Cfg; beta: Cfg; gamma: Cfg };
function fromJson(s: string): Spec { return JSON.parse(s) as Spec; }
function buildView(spec: Spec): Record<string, { configCode: number; type: string; defaultValue: number | boolean | string }> {
  const view = {} as Record<string, { configCode: number; type: string; defaultValue: number | boolean | string }>;
  for (const [name, entry] of Object.entries(spec)) {
    view[name] = Object.freeze({ configCode: entry.code, type: entry.type, defaultValue: entry.defaultValue });
  }
  return Object.freeze(view);
}
const JSON_TEXT = JSON.stringify({ alpha: { code: 9, type: "int", defaultValue: 4 }, beta: { code: 8, type: "bool", defaultValue: true }, gamma: { code: 7, type: "string", defaultValue: "j" } });
const TBL = () => ({
  alpha: { code: 1, type: "int", defaultValue: 10 },
  beta: { code: 2, type: "bool", defaultValue: false },
  gamma: { code: 3, type: "string", defaultValue: "g" },
});
const SPEC: Spec = TBL();
function unknownCode(o: any): void { console.log("unknown code saw", Object.keys(o).length); }
unknownCode(SPEC);
export const UNUSED_VIEW = buildView(SPEC);
const other = fromJson(JSON_TEXT);
console.log(SPEC.alpha.code, SPEC.beta.code, other.alpha.code);
