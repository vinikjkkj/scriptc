// Instances sorted and searched by their numeric fields: the comparison reads lanes and overflow entries alike, before and after fields move between them.
class Rec {
  id: any; weight: any; size: any; stamp: any; rank: any;
  constructor(s: any) { this.id = s.id; this.weight = s.weight; this.size = s.size; this.stamp = s.stamp; this.rank = s.rank; }
  score(): any { return this.id + this.weight + this.size + this.stamp + this.rank; }
}
function asAny(o: any): any {
  return o;
}
const srcs: any[] = [
  { id: 5, weight: 4294967295, size: 10, stamp: 65536, rank: 1 },
  { id: 3, weight: 7, size: 4294967296, stamp: 1, rank: 2 },
  { id: 9, weight: 0, size: 12, stamp: 4294967294, rank: 3 },
  { id: 1, weight: 100, size: 1.5, stamp: 5, rank: 4 },
  { id: 7, weight: 50, size: 20, stamp: 3, rank: 5 },
];
const recs: Rec[] = srcs.map((s) => new Rec(s));
recs.sort((x, y) => Number(x.id) - Number(y.id));
console.log("by id", recs.map((r) => String(r.id) + ":" + String(r.size)).join(" "));
recs.sort((x, y) => Number(y.stamp) - Number(x.stamp));
console.log("by stamp", recs.map((r) => String(r.id) + ":" + String(r.stamp)).join(" "));
for (const r of recs) {
  const o = asAny(r);
  o.weight = "w" + String(r.id);
  o.rank = r.id;
}
recs.sort((x, y) => Number(x.rank) - Number(y.rank));
console.log("by rank", recs.map((r) => String(r.id) + ":" + String(r.weight) + ":" + String(r.rank)).join(" "));
console.log("score", recs.map((r) => String(r.score())).join(" "));
