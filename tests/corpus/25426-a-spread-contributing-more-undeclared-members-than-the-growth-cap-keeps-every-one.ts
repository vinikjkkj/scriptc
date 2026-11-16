// Five members the declared interface does not name, defined at run time: well over the width-merge growth cap. None may be
// dropped from JSON, Object.keys, Object.entries or console.log, and the order is the literal's spelling.
interface Wide { id: string; a?: string; b?: number; c?: string; d?: boolean; e?: string; name: string }
interface Narrow { readonly name: string; readonly tag: string; readonly id: string }
function wide(n: number): Wide { return { id: 'id' + n, a: 'a' + n, b: n, c: 'c' + n, d: n % 2 === 0, e: 'e' + n, name: 'n' + n }; }
function make(n: number): Narrow { const w = wide(n); return { ...w, tag: 't' + n }; }
for (const r of [make(1), make(2)]) {
  console.log(JSON.stringify(r));
  console.log(Object.keys(r).join(','));
  console.log(r);
}
