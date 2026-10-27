// Compiled values of every primitive arm, plus an object, are boxed into the any[].
type Pt = { x: number; y: number };
const p: Pt = { x: 1, y: 2 };
const arr: any[] = new Array(6);
arr[0] = 3.5;
arr[1] = "text";
arr[2] = true;
arr[3] = null;
arr[4] = p;
arr[5] = undefined;
const parts: string[] = [];
for (let i = 0; i < arr.length; i++) {
  const v: unknown = arr[i];
  parts.push(v === null ? "null" : v === undefined ? "undef" : typeof v);
}
console.log(parts.join(","));
const q = arr[4] as Pt;
console.log(q.x + q.y, arr[1] === "text", arr[3] === null);
