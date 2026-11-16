// Disagreeing evidence: two producers of one narrow shape, each spreading a wider literal's result and spelling the
// declared members in a different relative order. Each instance serialises in the order ITS literal spells (JSON.stringify only: Node's keys also list `extra`, which the
// narrow shape's copy ends).
interface Wide { a: string; extra?: string; b: string; c: string }
interface Narrow { readonly c: string; readonly a: string; readonly b: string; readonly d: string }
function wide(x: string): Wide { return { a: x + 'a', extra: undefined, b: x + 'b', c: x + 'c' }; }
function one(x: string): Narrow { const w = wide(x); return { ...w, d: x + 'd' }; }
function two(x: string): Narrow { const w = wide(x); return { d: x + 'd', ...w }; }
for (const n of [one('1'), two('2')]) {
  console.log(JSON.stringify(n));
}
