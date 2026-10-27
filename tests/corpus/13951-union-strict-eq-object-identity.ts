// Object arms compare by identity; a string or null arm never equals an object arm.
type Ref = { id: number } | string | null;
const a = { id: 1 };
const b = { id: 1 };
function eq(x: Ref, y: Ref): boolean { return x === y; }
function ne(x: Ref, y: Ref): boolean { return x !== y; }
console.log(eq(a, a), eq(a, b), ne(a, b), eq(a, 'x'), eq(null, a));
console.log(eq('s', 's'), eq('s', 't'), eq(null, null), ne(null, 'null'), eq(b, b));
const pool: Ref[] = [a, b, 'one', null];
let hits = 0;
for (const p of pool) {
  if (p === a) hits++;
  if (p === 'one') hits += 10;
  if (p === null) hits += 100;
}
console.log(hits);
