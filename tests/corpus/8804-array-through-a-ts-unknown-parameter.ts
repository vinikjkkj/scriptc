// A static array passed to an `unknown[]` or `unknown` parameter is one
// array: the callee's writes land on it, and a callee that stores the
// element type keeps the caller's static array.
function grow(a: unknown[], v: unknown): void { a.push(v); }
function bump(u: unknown): void { (u as number[]).push(7); }
function total(a: unknown): number {
  let t = 0;
  for (const v of a as number[]) t += v;
  return t;
}

const xs: number[] = [1, 2];
grow(xs, 3);
bump(xs);
console.log(xs.length, xs.join(","), total(xs));

const ws: string[] = ["a"];
grow(ws, "b");
console.log(ws.length, ws.join(""));
