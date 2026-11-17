// A class with eighteen numeric fields, a string, a typed number and a method: the first sixteen numeric fields take lanes (the mask is 16 bits) and the rest
// stay ordinary slots, and Object.keys / entries / JSON must list every member in its declared position either way.
class Wide {
  n0: any; n1: any; n2: any; n3: any; n4: any; n5: any; n6: any; n7: any; n8: any;
  label: string;
  n9: any; n10: any; n11: any; n12: any; n13: any; n14: any; n15: any; n16: any; n17: any;
  count: number;
  constructor(s: any) {
    this.n0 = s.p0; this.n1 = s.p1; this.n2 = s.p2; this.n3 = s.p3; this.n4 = s.p4; this.n5 = s.p5; this.n6 = s.p6; this.n7 = s.p7; this.n8 = s.p8;
    this.label = "w";
    this.n9 = s.p9; this.n10 = s.p10; this.n11 = s.p11; this.n12 = s.p12; this.n13 = s.p13; this.n14 = s.p14; this.n15 = s.p15; this.n16 = s.p16; this.n17 = s.p17;
    this.count = 4;
  }
  sum(): any {
    return this.n0 + this.n1 + this.n2 + this.n3 + this.n4 + this.n5 + this.n6 + this.n7 + this.n8 + this.n9 + this.n10 + this.n11 + this.n12 + this.n13 + this.n14 + this.n15 + this.n16 + this.n17;
  }
}
function asAny(o: any): any {
  return o;
}
const srcs: any[] = [
  { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8, p9: 9, p10: 10, p11: 11, p12: 12, p13: 13, p14: 14, p15: 15, p16: 16, p17: 17 },
  { p0: 4294967295, p1: -1, p2: 1.5, p3: "s", p4: 4294967296, p5: -0, p6: NaN, p7: 65536, p8: 1, p9: 2, p10: undefined, p11: null, p12: 7, p13: 4294967294, p14: 3, p15: 4, p16: 5, p17: 4294967295 },
];
for (const s of srcs) {
  const w = new Wide(s);
  const o = asAny(w);
  console.log("keys", Object.keys(o).join(","));
  const vals: any[] = Object.values(o);
  console.log("values", vals.map((v: any) => (Object.is(v, -0) ? "-0" : String(v))).join("|"));
  console.log("json", JSON.stringify(o));
  console.log("sum", String(w.sum()), w.count, w.label, w.n16, w.n17, w.n0, w.n15);
}
