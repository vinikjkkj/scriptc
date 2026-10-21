// String() / template conversion over a Date, a Uint8Array, a Buffer, a Map
// and a Set -- lone values and arms of a union. The Date arm is checked only
// for the zones whose long name the runtime can state (UTC / GMT), so the
// program picks its Date instants and prints them through toISOString under
// any other TZ.
type U = string | number | bigint | boolean | Date | Map<string, number> | Set<number> | Uint8Array | null | undefined;
function show(u: U): string {
  return String(u);
}
const plain = new Uint8Array([1, 2, 3]);
const buf = Buffer.from("héy");
const m = new Map<string, number>([["a", 1]]);
const s = new Set<number>([1, 2]);
console.log(String(plain), String(buf), `${plain}|${buf}`, String(m), String(s), `${m}${s}`);
console.log(show("x"), show(1.5), show(10n), show(true), show(m), show(s), show(plain), show(buf), show(null), show(undefined));
const tz = new Date(0).getTimezoneOffset();
const d = new Date(1700000000123);
const inv = new Date(NaN);
console.log(String(inv), show(inv));
if (tz === 0) {
  console.log(String(d), show(d), `${d}`, String(new Date(-62198755200000)), String(new Date(8.64e15)));
} else {
  console.log("zone-skipped", d.toISOString());
}
let evals = 0;
const mk = (): Map<string, number> => {
  evals++;
  return m;
};
console.log(String(mk()), evals);
