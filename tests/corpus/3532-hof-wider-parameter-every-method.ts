// The wider-parameter rule is a property of the HOF CALLBACK CONTRACT, so it
// holds for every method that desugars to a loop, at every declared arity —
// map/filter/forEach, find/findIndex/findLast/findLastIndex/some/every,
// flatMap, and reduce (whose lead is the accumulator AND the element, so
// both positions can widen).
//
// Arity matters because the desugared loop passes exactly the prefix the
// callback declares: a two-parameter callback whose FIRST parameter widens
// still receives the index unchanged in the second.

type E = { id: string; n: number };

const arr: E[] = [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
    { id: "c", n: 3 },
    { id: "d", n: 4 },
];

function wideStr(e: E | null | undefined): string {
    return e ? e.id : "?";
}
function widePred(e: E | undefined): boolean {
    return e !== undefined && e.n % 2 === 1;
}
function wideIdx(e: E | null, i: number): string {
    return (e ? e.id : "?") + String(i);
}
function wideAll(e: E | null, i: number, all: E[]): string {
    return (e ? e.id : "?") + String(i) + String(all.length);
}

console.log(arr.map(wideStr).join(","));
console.log(arr.map(wideIdx).join(","));
console.log(arr.map(wideAll).join(","));

console.log(arr.filter(widePred).map((e) => e.id).join(","));
console.log(arr.filter((e: E | undefined, i: number) => i > 1 && e !== undefined).length);

let seen = "";
arr.forEach(wideStr);
arr.forEach((e: E | null) => { seen += e ? e.id : "?"; });
console.log(seen);

console.log(String(arr.find(widePred)?.id));
console.log(arr.findIndex(widePred));
console.log(String(arr.findLast(widePred)?.id));
console.log(arr.findLastIndex(widePred));
console.log(arr.some(widePred), arr.every(widePred));
console.log(arr.some((e: E | null | undefined) => e !== null && e !== undefined && e.n > 3));

console.log(arr.flatMap((e: E | null) => (e ? [e.id, e.id.toUpperCase()] : [])).join(","));

// reduce: the accumulator position widens too, independently of the element.
console.log(arr.reduce((acc: string, e: E | null) => acc + (e ? e.id : ""), "<"));
console.log(arr.reduceRight((acc: string | undefined, e: E | undefined) => (acc ?? "") + (e ? e.n : 0), ">"));

// Interning: two call sites with the SAME widened signature share one
// adapter, and a third with a different one gets its own. Nothing here can
// observe the sharing directly — the point is that both answer.
const other: E[] = [{ id: "x", n: 7 }];
console.log(other.map(wideStr).join(","));
console.log(other.map(wideIdx).join(","));
