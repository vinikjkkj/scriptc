// The two-table shape of an experiment config: a frozen table by name and a frozen reverse table by numeric code, each cast to a wider record, read by a
// computed key. Present keys, absent keys and the enumeration all match Node.
interface Prop { readonly code: number; readonly type: string; readonly defaultValue: string | number | boolean }
const BY_NAME = Object.freeze({
  feature_a: Object.freeze({ code: 101, type: "bool", defaultValue: true }),
  feature_b: Object.freeze({ code: 102, type: "int", defaultValue: 30 }),
  feature_c: Object.freeze({ code: 103, type: "string", defaultValue: "on" }),
})
const BY_CODE = Object.freeze({ 101: "feature_a", 102: "feature_b", 103: "feature_c" })
type PropName = keyof typeof BY_NAME
const PROPS = BY_NAME as Readonly<Record<PropName, Prop>>
const NAME_BY_CODE = BY_CODE as unknown as Readonly<Record<number, PropName | undefined>>
function resolve(code: number): PropName | undefined { return NAME_BY_CODE[code] }
function valueOf(name: PropName): string | number | boolean { return PROPS[name].defaultValue }
for (const code of [101, 102, 103, 104]) {
  const name = resolve(code)
  console.log(code, name, name === undefined ? "-" : valueOf(name))
}
console.log(Object.keys(PROPS).join(","), JSON.stringify(PROPS.feature_b))
