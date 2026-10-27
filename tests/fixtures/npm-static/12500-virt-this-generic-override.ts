// npm-static: a base method calls this.end(...) with differently typed arguments; Pool overrides
// end with the same arity, Leaf with a different signature (the mysql2 dispatch shape).
import v from "virt12500";
const a = new v.Base(0);
const p = new v.Pool(1);
const l = new v.Leaf(2);
console.log(a.close(), a.finish(5), a.twice(3));
console.log(p.close(), p.finish("x"), p.twice(4));
console.log(l.close(), l.finish(true), l.twice(6));
const asBase = l;
console.log(asBase.close(), asBase.finish(9), asBase.end(), asBase.end(8, 9));
const pb = p;
console.log(pb.finish(null), pb.twice(undefined));
