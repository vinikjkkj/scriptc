// An index-signature keyed read whose key is ABSENT, passed straight into
// a parameter DECLARED with an undefined arm. The checker types the read
// by the signature's VALUE type, so the expression cannot say `undefined`
// — but the parameter can, and the callee was compiled against it.
//
// This is zapo `transport/stream/parse.ts:79`
// (`parseOptionalInt(node.attrs.abprops)`) and
// `client/coordinators/WaIncomingNodeCoordinator.ts:508`
// (`parseOptionalInt(child.attrs.message)`): a compiled client ABORTED
// there — `record has no key 'abprops'`, an untagged process abort past
// every catch clause — on a `<success>` node that simply did not carry
// the attribute. Node hands the callee `undefined` and the callee's own
// first line answers it.
//
// Every expectation below is Node's answer, taken from Node and not from
// the compiler.

type Attrs = Readonly<Record<string, string>>;
const attrs: Attrs = { present: "7", zero: "0" };

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function show(v: number | undefined): string {
  return v === undefined ? "undef" : String(v);
}
function label(a: number, v: string | undefined, b: number): string {
  return String(a) + "/" + (v ?? "undef") + "/" + String(b);
}
function optional(v?: string): string {
  return v === undefined ? "undef" : "[" + v + "]";
}
class Holder {
  readonly v: string | undefined;
  constructor(v: string | undefined) { this.v = v; }
  read(): string { return this.v === undefined ? "undef" : "<" + this.v + ">"; }
}
const viaValue = (v: string | undefined): string => (v ?? "undef");
const table = {
  take(v: string | undefined): string { return v === undefined ? "undef" : v.toUpperCase(); }
};

// 1 — the direct argument, absent and present.
console.log(show(parseOptionalInt(attrs.abprops)));
console.log(show(parseOptionalInt(attrs.present)));
console.log(show(parseOptionalInt(attrs.zero)));

// 2 — a non-first position, so the neighbours' evaluation order is visible.
console.log(label(1, attrs.missing, 2));
console.log(label(1, attrs.present, 2));

// 3 — an OPTIONAL parameter (`v?: string`), which accepts undefined
//     without spelling the arm.
console.log(optional(attrs.nope));
console.log(optional(attrs.present));

// 4 — a CONSTRUCTOR argument, and the field it lands in.
console.log(new Holder(attrs.gone).read());
console.log(new Holder(attrs.present).read());

// 5 — a call through a VALUE (an arrow binding), and a method on an
//     object literal.
console.log(viaValue(attrs.vanished));
console.log(table.take(attrs.absent));
console.log(table.take(attrs.present));

// 6 — an ELEMENT access, literal key and computed key alike.
console.log(optional(attrs["bracket"]));
const computed = "comp" + "uted";
console.log(optional(attrs[computed]));
console.log(optional(attrs["present"]));

// 7 — the spellings that already answered undefined before this rung
//     reached arguments, so a regression in any of them shows here too.
const field: { a?: string } = { a: attrs.fieldMiss };
console.log(field.a === undefined ? "field:undef" : "field:" + field.a);
console.log(attrs.nullishMiss ?? "nullish:undef");
console.log(typeof attrs.typeofMiss === "string" ? "typeof:str" : "typeof:undef");

// 8 — the value is the very one the map holds: read it twice, keep one
//     alive across another read, and print both, so a wrong retain shows
//     as a wrong string rather than as nothing at all.
const kept = attrs.present;
console.log(optional(kept));
console.log(optional(attrs.present) + optional(kept) + String(kept.length));

// 9 — many misses in a row over the same shape (the helper is shared).
let acc = "";
for (const k of ["a", "b", "present", "c"]) {
  acc += optional(attrs[k]) + ";";
}
console.log(acc);
