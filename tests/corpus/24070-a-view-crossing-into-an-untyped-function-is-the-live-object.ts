// A view record handed to an untyped function crosses as the object itself: a write and an added member land on the record the caller still holds, and the dynamic result returned to a typed slot is the original.
interface Wide { id: number; label: string; extra: number }
interface Narrow { id: number; label: string }
function narrowOf(n: Narrow): Narrow { return n; }
function mutate(o: any): any { o.id = 99; o.added = "new"; o.label = o.label + "!"; return o; }
function identity(o: any): any { return o; }
const w: Wide = { id: 1, label: "a", extra: 5 };
const v: Narrow = narrowOf(w);
const back = mutate(v) as Narrow;
console.log(w.id, w.label, w.extra, v.id, v.label, back.id, back.label);
console.log((w as any).added, (v as any).added, (back as any).added);
console.log(back === v, (identity(v) as Narrow) === v);
const again: Narrow = identity(v);
console.log(again === v, JSON.stringify(w), JSON.stringify(v), Object.keys(w).join(","));
w.id = 7;
console.log(v.id, again.id, back.id);
