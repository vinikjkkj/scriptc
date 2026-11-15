// A record whose members alternate between types, with a short uniform run, an optional run and a long uniform run: only the long runs become a loop, the rest
// keeps the unrolled code, and the whole record answers exactly as before in both directions.
interface Opt { a: number; b?: string }
type Mixed = {
  n0: number;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  n6: number;
  n7: number;
  n8: number;
  n9: number;
  s0: string;
  s1: string;
  s2: string;
  o0?: number;
  o1?: number;
  o2?: number;
  o3?: number;
  b0: boolean;
  b1: boolean;
  b2: boolean;
  b3: boolean;
  b4: boolean;
  b5: boolean;
  b6: boolean;
  b7: boolean;
  b8: boolean;
  b9: boolean;
  b10: boolean;
  b11: boolean;
  p0: Opt;
  p1: Opt;
  p2: Opt;
  p3: Opt;
  p4: Opt;
  p5: Opt;
  p6: Opt;
  p7: Opt;
  p8: Opt;
  tail: string;
};
const m: Mixed = {
  n0: 0.5,
  n1: 2.5,
  n2: 4.5,
  n3: 6.5,
  n4: 8.5,
  n5: 10.5,
  n6: 12.5,
  n7: 14.5,
  n8: 16.5,
  n9: 18.5,
  s0: 'str0',
  s1: 'str1',
  s2: 'str2',
  o0: 100,
  o2: 102,
  b0: false,
  b1: true,
  b2: false,
  b3: true,
  b4: false,
  b5: true,
  b6: false,
  b7: true,
  b8: false,
  b9: true,
  b10: false,
  b11: true,
  p0: { a: 0, b: "B0" },
  p1: { a: 1 },
  p2: { a: 2, b: "B2" },
  p3: { a: 3 },
  p4: { a: 4, b: "B4" },
  p5: { a: 5 },
  p6: { a: 6, b: "B6" },
  p7: { a: 7 },
  p8: { a: 8, b: "B8" },
  tail: 'end',
};
function through(x: unknown): unknown { return x; }
const u = through(m);
console.log(JSON.stringify(u));
const back = u as Mixed;
console.log(back.n9, back.s2, back.o0, back.o1, back.o2, back.b11, back.p8.a, back.p8.b, back.p3.b, back.tail);
const parsed = JSON.parse(JSON.stringify(m)) as Mixed;
console.log(JSON.stringify(through(parsed)) === JSON.stringify(m), Object.keys(parsed).length);
let t = 0; for (const [k, v] of Object.entries(m)) t += k.length + (typeof v === 'number' ? v : 0);
console.log(t);
