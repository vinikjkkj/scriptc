// `export = Point` in a declaration file (a declared class merged with a namespace),
// paired with the UMD-shaped constructor the package ships. Construction, prototype
// methods and a prototype datum, statics, `in`, instanceof directly and through an
// untyped value, and Map, JSON and Object.keys over the instances.
const Point = require("ptpair");

const p = new Point(3, 4);
console.log(p.sum(), p.isPoint, p.x, p.y);
const r = p.scaled(2);
console.log(r.x, r.y, r.isPoint, r instanceof Point, r.sum());
const q = Point.make(5, 6);
console.log(q instanceof Point, q.isPoint, q.sum(), q.x);
console.log(Point.origin.x, Point.origin.y, Point.origin.isPoint, Point.origin instanceof Point);
console.log(new Point(1, 2).sum(), new Point(7, 8).scaled(3).x);
console.log(typeof Point, typeof p, Point.name, "isPoint" in p, "sum" in p, "nope" in p);
const list = [new Point(1, 1), Point.make(2, 2)];
console.log(list.length, list[0].sum(), list[1].isPoint);
const m = new Map();
m.set("a", p);
console.log(m.get("a") === p, m.get("a").sum());
console.log(JSON.stringify({ x: p.x, y: p.y }), Object.keys(p).join(","));
const any = p;
console.log(any instanceof Point, any.isPoint, any.sum());
let u = p;
if (p.x > 100) u = {};
console.log(u instanceof Point, u.isPoint);
