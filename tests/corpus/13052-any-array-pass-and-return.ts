// any[] values cross function boundaries in both directions.
function fill2(arr: any[], v: unknown): any[] {
  arr[0] = v;
  arr[1] = v;
  return arr;
}

function build(n: number): any[] {
  const out: any[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = i * 2;
  return out;
}

function sum(xs: any[]): string {
  let s = "";
  for (let i = 0; i < xs.length; i++) s += String(xs[i]) + ";";
  return s;
}

const b = build(3);
console.log(sum(b));
const c = fill2(new Array(2), "q");
console.log(c.length, String(c[0]), String(c[1]), sum(c));
console.log(sum(fill2(b, false)));
