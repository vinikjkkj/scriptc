// POSITIVE CONTROL: the never-read const built by iterating a frozen literal table (whose record shape also has a dyn cast, so the lowering keeps a view arm)
// is dropped (SCRIPTC_DEADINIT=report prints "drop"); the table and the cast value behave as in Node.
const SPEC = Object.freeze({
  alpha: Object.freeze({ code: 1, type: "int", defaultValue: 10 }),
  beta: Object.freeze({ code: 2, type: "bool", defaultValue: false }),
  gamma: Object.freeze({ code: 3, type: "string", defaultValue: "g" }),
});
type Spec = typeof SPEC;
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
export const UNUSED_VIEW = buildView(SPEC);
const other = fromJson(JSON_TEXT);
console.log(SPEC.alpha.code, SPEC.beta.type, SPEC.gamma.defaultValue, other.alpha.code, other.beta.type);
console.log(Object.keys(SPEC).join(","));
