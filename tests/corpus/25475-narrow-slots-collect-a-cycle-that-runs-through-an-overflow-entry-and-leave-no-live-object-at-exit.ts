// An instance whose overflow array holds an object that holds the instance back is a garbage cycle: it must be collected (the exit RC audit under the
// sanitized build checks nothing is left), and an instance whose overflow holds only leaves (a string) must be freed by plain release. Interleaves both.
class Rec {
  a: any; b: any; c: any; d: any; e: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; this.d = s.d; this.e = s.e; }
  total(): any { return this.a + this.b + this.c + this.d + this.e; }
}
function asAny(o: any): any {
  return o;
}
class Link {
  back: any;
  n: number;
  constructor(back: any, n: number) {
    this.back = back;
    this.n = n;
  }
}
let checksum = 0;
for (let round = 0; round < 3000; round++) {
  const r = new Rec({ a: round, b: 4294967295, c: 7, d: 65536, e: 1 });
  const o = asAny(r);
  const holder = new Link(o, round);
  if (round % 3 === 0) o.c = holder; // a cycle through the overflow array
  else if (round % 3 === 1) o.d = "leaf" + round; // leaves only
  else o.e = 1.5; // a number that does not fit
  checksum += Number(r.a) + Number(r.b) + (round % 3 === 2 ? Number(r.e) : 0);
}
console.log("checksum", checksum);
